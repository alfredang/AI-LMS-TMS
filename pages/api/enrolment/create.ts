import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { normalizeSsgCreateEnrolmentData, runPostSsgEnrolSync } from '@/lib/services/postSsgEnrolSync';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import crypto from 'crypto';

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

    // Inject/override training partner in the payload
    if (enrolment.trainingPartner) {
      enrolment.trainingPartner.uen = enrolment.trainingPartner.uen || uen;
      enrolment.trainingPartner.code = enrolment.trainingPartner.code || tpCode;
    } else {
      enrolment.trainingPartner = { uen, code: tpCode };
    }

    const payload = { enrolment };
    console.log('📤 Server-side final payload before encryption:', JSON.stringify(payload, null, 2));

    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');
    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encryptedPayload += cipher.final('base64');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/tpg/enrolments')
      .withMethod(HttpMethod.POST)
      .withBody(encryptedPayload);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, { 'Content-Type': 'application/json', 'Accept': 'application/json' });
    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200 && httpResponse.status !== 201) {
      console.error(`❌ SSG create enrolment error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      return res.status(httpResponse.status).json({ success: false, error: `SSG error ${httpResponse.status}`, details: httpResponse.data });
    }

    const rawBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);

    if (parsed?.status && String(parsed.status) !== '200') {
      console.error('❌ SSG Enrollment Internal Error:', JSON.stringify(parsed.error || parsed));
      return res.status(Number(parsed.status) || 400).json({ 
        success: false, 
        error: (parsed?.error?.message || parsed?.error) ?? `SSG status ${parsed.status}`,
        details: parsed?.error?.details || parsed?.error
      });
    }

    console.log('✅ Create enrolment SSG response:', JSON.stringify(parsed));

    const rawData = parsed?.data ?? parsed;
    const normalizedData = normalizeSsgCreateEnrolmentData(rawData);

    const enrol = req.body?.enrolment as Record<string, unknown> | undefined;
    const trainee = enrol?.trainee as Record<string, unknown> | undefined;
    const course = enrol?.course as Record<string, unknown> | undefined;
    const run = course?.run as Record<string, unknown> | undefined;

    const traineeEmail = typeof trainee?.emailAddress === 'string' ? trainee.emailAddress : '';
    const courseReferenceNumber = typeof course?.referenceNumber === 'string' ? course.referenceNumber : '';
    const courseRunId = run?.id != null ? String(run.id) : '';

    const en = normalizedData.enrolment as Record<string, unknown> | undefined;
    const enrolmentRef =
      typeof en?.referenceNumber === 'string' ? en.referenceNumber.trim() : '';
    const enrolmentSt = typeof en?.status === 'string' ? en.status : undefined;

    let localEnrollmentSynced = false;
    if (traineeEmail && courseReferenceNumber && courseRunId) {
      try {
        await runPostSsgEnrolSync({
          traineeEmail,
          courseReferenceNumber,
          courseRunId,
          sponsorshipType: typeof trainee?.sponsorshipType === 'string' ? trainee.sponsorshipType : undefined,
          traineeName: typeof trainee?.fullName === 'string' ? trainee.fullName : undefined,
          traineeNric: typeof trainee?.id === 'string' ? trainee.id : undefined,
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

    return res.status(200).json({
      success: true,
      data: normalizedData,
      localEnrollmentSynced,
    });

  } catch (error) {
    console.error('❌ Create enrolment error:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
