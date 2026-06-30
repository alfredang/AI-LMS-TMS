import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { checkAssessmentEligibility } from '../../../lib/services/enrolmentEligibility';
import { checkAttendanceGate } from '../../../lib/services/learnerAttendance';
import { pushFeeCollectionToTpg } from '../../../lib/ssg/pushFeeCollectionToTpg';
import pool from '../../../lib/db';
import crypto from 'crypto';

/**
 * PUT /api/assessments/ssg-update
 * Update or void an assessment record via SSG TPG API.
 * Body: { referenceNumber, action, result?, traineeFullName?, skillCode?, assessmentDate?, grade?, score? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    referenceNumber,
    action,
    result,
    traineeFullName,
    skillCode,
    assessmentDate,
    grade,
    score,
    courseRunId,
    traineeId,
  } = req.body;

  if (!referenceNumber || !action) {
    return res.status(400).json({ success: false, error: 'referenceNumber and action are required' });
  }

  try {
    // Guard (only when the caller supplies run + trainee identifiers): never update an assessment
    // (→ SSG keeps/issues an SOA) for a cancelled class or a cancelled/withdrawn enrolment. The
    // Update view sends courseRunId + traineeId for exactly this. 'void' is always allowed — voiding
    // a record for a cancelled learner is corrective, not an issuance.
    if (action === 'update' && courseRunId && traineeId) {
      const eligibility = await checkAssessmentEligibility({
        ssgCourseRunId: String(courseRunId),
        traineeId: String(traineeId),
      });
      if (!eligibility.eligible) {
        console.log(`⏭️ Skipping assessment update for ${traineeFullName || traineeId} (run ${courseRunId}) — ${eligibility.reason}`);
        return res.status(200).json({
          success: true,
          skipped: true,
          reason: `Skipped — ${eligibility.reason}.`,
          classStatus: eligibility.classStatus,
          enrolmentStatus: eligibility.enrolmentStatus,
        });
      }

      // Attendance gate: block when below the configured requirement; fail-open when unavailable.
      const attGate = await checkAttendanceGate(String(courseRunId), String(traineeId));
      if (attGate.blocked) {
        console.log(`⏭️ Skipping assessment update for ${traineeFullName || traineeId} (run ${courseRunId}) — attendance ${attGate.percent}% < ${attGate.threshold}%`);
        return res.status(200).json({
          success: true,
          skipped: true,
          reason: `Skipped — attendance ${attGate.percent}% is below the ${attGate.threshold}% requirement.`,
          attendancePercent: attGate.percent,
          attendanceThreshold: attGate.threshold,
        });
      }
    }

    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');

    const ssgPayload: any = {
      assessment: {
        action,
      },
    };

    if (action === 'update') {
      ssgPayload.assessment.result = result;
      ssgPayload.assessment.trainee = { fullName: traineeFullName };
      ssgPayload.assessment.skillCode = skillCode;
      ssgPayload.assessment.assessmentDate = assessmentDate;
      if (grade) ssgPayload.assessment.grade = grade;
      if (score !== undefined && score !== '') ssgPayload.assessment.score = parseInt(score, 10);
    }

    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/tpg/assessments/details/${referenceNumber.trim()}`)
      .withMethod(HttpMethod.POST)
      .withBody(encryptedPayload);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG update assessment error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      return res.status(httpResponse.status).json({
        success: false,
        error: `SSG error ${httpResponse.status}`,
        details: httpResponse.data,
      });
    }

    // Decrypt SSG response
    const rawBody = typeof httpResponse.data === 'string'
      ? httpResponse.data
      : JSON.stringify(httpResponse.data);

    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);

    console.log('📦 SSG update assessment response:', JSON.stringify(parsed));

    // SSG always returns "error": {} even on success — only treat as error if code/message present
    const hasError = parsed?.error && (parsed.error.code || parsed.error.message ||
      (parsed.error.details && parsed.error.details.length > 0));
    if (hasError) {
      const decryptedStatus = Number(parsed.status) || 400;
      return res.status(decryptedStatus).json({
        success: false,
        error: parsed.error.details?.[0]?.message || parsed.error.message,
        details: parsed.error.details,
      });
    }

    // On a Pass result, best-effort set Full Payment on TPGateway (7-day window).
    // Requires courseRunId + traineeId to look up the enrolment reference number.
    let paymentWarning: string | undefined;
    if (action === 'update' && result === 'Pass' && courseRunId && traineeId) {
      try {
        const enrResult = await pool.query<{ enrolment_id: string }>(
          `SELECT e.enrolment_id
           FROM enrollment e
           JOIN app_user au ON au.id = e.user_id
           JOIN course_run cr ON cr.id = e.course_run_id
           WHERE cr.course_run_id = $1
             AND au.nric = $2
             AND e.enrolment_id IS NOT NULL
             AND e.enrolment_status NOT IN ('Cancelled', 'Withdrawn', 'Rejected')
           LIMIT 1`,
          [String(courseRunId), String(traineeId)]
        );
        const enrolmentRef = enrResult.rows[0]?.enrolment_id;
        const feeResult = await pushFeeCollectionToTpg(enrolmentRef);
        if (feeResult.status === 'error') {
          paymentWarning = `TPG payment status could not be updated: ${feeResult.message}`;
        }
      } catch (feeErr) {
        const msg = feeErr instanceof Error ? feeErr.message : String(feeErr);
        console.warn(`⚠️ [ssg-update fee lookup] ${msg}`);
        paymentWarning = `TPG payment status lookup failed: ${msg}`;
      }
    }

    return res.status(200).json({ success: true, data: parsed?.data ?? parsed, ...(paymentWarning && { paymentWarning }) });

  } catch (error) {
    console.error('❌ Update assessment error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
