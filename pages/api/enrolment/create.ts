import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { normalizeSsgCreateEnrolmentData, runPostSsgEnrolSync } from '@/lib/services/postSsgEnrolSync';
import { searchEnrolment } from '../../../lib/ssg/services/enrolment-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import crypto from 'crypto';

// SSG's create-enrolment call can be slow; the old 30s cap frequently aborted
// AFTER SSG had already created the enrolment — surfacing an error to the admin
// while the learner was in fact enrolled. Give it more headroom, and on any
// failure fall back to a search that treats "already there" as success.
const CREATE_TIMEOUT_MS = 60000;
const DEAD_STATUSES = ['cancelled', 'withdrawn', 'rejected'];

/**
 * POST /api/enrolment/create
 * Create a new enrolment via SSG API.
 * Body: full enrolment payload matching SSG TPG schema
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { enrolment } = req.body;
  if (!enrolment) {
    return res.status(400).json({ success: false, error: 'enrolment payload is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

    // Server-side UEN injection — never trust the frontend for this
    const tp = await getTrainingPartnerIdentifiers();
    const uen = credentials.uen || tp.uen;
    const tpCode = uen ? `${uen}-01` : tp.code;

    if (enrolment.trainingPartner) {
      enrolment.trainingPartner.uen = enrolment.trainingPartner.uen || uen;
      enrolment.trainingPartner.code = enrolment.trainingPartner.code || tpCode;
    } else {
      enrolment.trainingPartner = { uen, code: tpCode };
    }

    const payload = { enrolment };
    console.log('📤 Server-side final payload before encryption:', JSON.stringify(payload, null, 2));

    // Identifiers used by BOTH the success path and the recovery search.
    const trainee = enrolment?.trainee as Record<string, unknown> | undefined;
    const course = enrolment?.course as Record<string, unknown> | undefined;
    const run = course?.run as Record<string, unknown> | undefined;
    const traineeEmail = typeof trainee?.emailAddress === 'string' ? trainee.emailAddress : '';
    const courseReferenceNumber = typeof course?.referenceNumber === 'string' ? course.referenceNumber : '';
    const courseRunId = run?.id != null ? String(run.id) : '';
    const traineeId = typeof trainee?.id === 'string' ? trainee.id : '';
    const traineeIdType = (trainee?.idType as Record<string, unknown> | undefined)?.type;
    const sponsorshipType = typeof trainee?.sponsorshipType === 'string' ? trainee.sponsorshipType : 'INDIVIDUAL';
    const traineeName = typeof trainee?.fullName === 'string' ? trainee.fullName : undefined;
    const employer = trainee?.employer as Record<string, unknown> | undefined;
    const employerUen = typeof employer?.uen === 'string' ? employer.uen : '';

    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/tpg/enrolments')
      .withMethod(HttpMethod.POST)
      .withBody(encryptedPayload)
      .withTimeout(CREATE_TIMEOUT_MS);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    // Runs the local DB sync then responds success. Shared by the normal path
    // and the recovery path.
    const finaliseSuccess = async (normalizedData: any, recovered = false) => {
      const en = normalizedData?.enrolment as Record<string, unknown> | undefined;
      const enrolmentRef = typeof en?.referenceNumber === 'string' ? en.referenceNumber.trim() : '';
      const enrolmentSt = typeof en?.status === 'string' ? en.status : undefined;

      let localEnrollmentSynced = false;
      if (traineeEmail && courseReferenceNumber && courseRunId) {
        try {
          await runPostSsgEnrolSync({
            traineeEmail,
            courseReferenceNumber,
            courseRunId,
            sponsorshipType,
            traineeName,
            traineeNric: traineeId || undefined,
            enrolmentId: enrolmentRef || null,
            enrolmentStatus: enrolmentSt ?? null,
          });
          localEnrollmentSynced = true;
        } catch (syncErr) {
          console.warn('[enrolment/create] Local enrollment sync failed (non-blocking):', syncErr);
        }
      } else {
        console.warn('[enrolment/create] Skipping local sync — missing traineeEmail, course ref, or run id');
      }

      res.status(200).json({ success: true, data: normalizedData, localEnrollmentSynced, recovered });
    };

    // After a timeout / failed create, SSG may still have created the enrolment.
    // Search for it; if it exists and isn't cancelled, treat it as a success.
    const recoverCreatedEnrolment = async (): Promise<boolean> => {
      if (!traineeId || !courseReferenceNumber || !courseRunId) return false;
      try {
        const found = await searchEnrolment({
          enrolment: {
            course: { run: { id: courseRunId }, referenceNumber: courseReferenceNumber },
            trainee: {
              id: traineeId,
              idType: { type: typeof traineeIdType === 'string' ? traineeIdType : 'NRIC' },
              sponsorshipType,
              ...(employerUen ? { employer: { uen: employerUen } } : {}),
            },
            trainingPartner: { uen, code: tpCode },
          },
          parameters: { page: 0, pageSize: 40 },
        });
        if (
          found.success &&
          found.referenceNumber &&
          !DEAD_STATUSES.includes(String(found.enrolmentStatus || '').toLowerCase())
        ) {
          console.log(`✅ [enrolment/create] recovered enrolment after failed create: ${found.referenceNumber}`);
          const normalizedData = normalizeSsgCreateEnrolmentData({
            enrolment: { referenceNumber: found.referenceNumber, status: found.enrolmentStatus },
          });
          await finaliseSuccess(normalizedData, true);
          return true;
        }
      } catch (searchErr) {
        console.warn('[enrolment/create] recovery search failed:', searchErr);
      }
      return false;
    };

    const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', 'Accept': 'application/json' });

    let httpResponse;
    try {
      httpResponse = await httpClient.request(builder.build());
    } catch (reqErr) {
      // Timeout or network drop — SSG may have created it anyway.
      console.warn('[enrolment/create] SSG request failed, attempting recovery:', reqErr instanceof Error ? reqErr.message : reqErr);
      if (await recoverCreatedEnrolment()) return;
      return res.status(504).json({
        success: false,
        error: reqErr instanceof Error ? reqErr.message : 'SSG request failed',
        recoveryAttempted: true,
      });
    }

    if (httpResponse.status !== 200 && httpResponse.status !== 201) {
      console.error(`❌ SSG create enrolment error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      // Only a server-side (5xx) failure is ambiguous enough that SSG may have
      // created the enrolment anyway; a 4xx is a definitive rejection, so we
      // surface it rather than reporting a possibly-unrelated existing enrolment.
      if (httpResponse.status >= 500 && (await recoverCreatedEnrolment())) return;
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}`, details: httpResponse.data });
    }

    const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
    let parsed: any;
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
      let decrypted = decipher.update(rawBody, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      parsed = JSON.parse(decrypted);
    } catch (decErr) {
      console.warn('[enrolment/create] could not decode SSG response, attempting recovery:', decErr instanceof Error ? decErr.message : decErr);
      if (await recoverCreatedEnrolment()) return;
      throw decErr;
    }

    if (parsed?.status && String(parsed.status) !== '200') {
      console.error('❌ SSG Enrollment Internal Error:', JSON.stringify(parsed.error || parsed));
      // A decrypted business/validation rejection is definitive — surface it
      // rather than recovering (which could report a pre-existing enrolment as a
      // fresh success and hide the real error, e.g. a resubmit with a bad field).
      return res.status(Number(parsed.status) || 400).json({
        success: false,
        error: (parsed?.error?.message || parsed?.error) ?? `SSG status ${parsed.status}`,
        details: parsed?.error?.details || parsed?.error,
      });
    }

    console.log('✅ Create enrolment SSG response:', JSON.stringify(parsed));
    const normalizedData = normalizeSsgCreateEnrolmentData(parsed?.data ?? parsed);
    await finaliseSuccess(normalizedData, false);
    return;
  } catch (error) {
    console.error('❌ Create enrolment error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
