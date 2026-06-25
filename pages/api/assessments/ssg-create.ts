import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { checkAssessmentEligibility } from '../../../lib/services/enrolmentEligibility';
import { checkAttendanceGate } from '../../../lib/services/learnerAttendance';
import crypto from 'crypto';

/**
 * POST /api/assessments/ssg-create
 * Create an assessment record via SSG TPG API.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    courseRunId,
    courseReferenceNumber,
    result,
    traineeId,
    traineeIdType,
    traineeFullName,
    skillCode,
    assessmentDate,
    trainingPartnerUen,
    trainingPartnerCode,
    enrolmentReferenceNumber,
  } = req.body;

  if (!courseRunId || !courseReferenceNumber || !result || !traineeId || !traineeIdType || !traineeFullName || !skillCode || !assessmentDate || !trainingPartnerUen || !trainingPartnerCode) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    // Guard: never push an assessment (→ SSG issues an SOA) for a cancelled
    // class or a cancelled/withdrawn enrolment. Straight-through: this is a
    // silent skip (HTTP 200, skipped:true), NOT an error — the caller may be an
    // unattended external system that should keep processing the rest of its
    // batch. See enrolmentEligibility.ts.
    const eligibility = await checkAssessmentEligibility({
      ssgCourseRunId: String(courseRunId),
      enrolmentReferenceNumber: enrolmentReferenceNumber,
      traineeId: String(traineeId),
    });
    if (!eligibility.eligible) {
      console.log(`⏭️ Skipping assessment create for ${traineeFullName} (run ${courseRunId}) — ${eligibility.reason}`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: `Skipped — ${eligibility.reason}.`,
        classStatus: eligibility.classStatus,
        enrolmentStatus: eligibility.enrolmentStatus,
      });
    }

    // Guard: block when attendance is below the configured requirement. Fail-open when attendance can't
    // be determined yet (never block on missing data). Source is the LMS record (QR + manual marks).
    const attGate = await checkAttendanceGate(String(courseRunId), String(traineeId));
    if (attGate.blocked) {
      console.log(`⏭️ Skipping assessment create for ${traineeFullName} (run ${courseRunId}) — attendance ${attGate.percent}% < ${attGate.threshold}%`);
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: `Skipped — attendance ${attGate.percent}% is below the ${attGate.threshold}% requirement.`,
        attendancePercent: attGate.percent,
        attendanceThreshold: attGate.threshold,
      });
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
        course: {
          run: { id: String(courseRunId) },
          referenceNumber: String(courseReferenceNumber),
        },
        result,
        trainee: {
          id: traineeId,
          idType: traineeIdType,
          fullName: traineeFullName,
        },
        skillCode,
        assessmentDate,
        trainingPartner: {
          uen: trainingPartnerUen,
          code: trainingPartnerCode,
        },
      },
    };

    if (enrolmentReferenceNumber?.trim()) {
      ssgPayload.assessment.enrolment = { referenceNumber: enrolmentReferenceNumber.trim() };
    }

    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/tpg/assessments')
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
      console.error(`❌ SSG create assessment error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
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

    console.log('📦 SSG create assessment response:', JSON.stringify(parsed));

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

    return res.status(200).json({ success: true, data: parsed?.data ?? parsed });

  } catch (error) {
    console.error('❌ Create assessment error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
