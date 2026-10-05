import { getSSGCredentialsService } from './credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../utils/http-utils';
import crypto from 'crypto';

interface EnrolmentSearchPayload {
  enrolment: {
    course: { run: { id: string }; referenceNumber: string };
    trainee: {
      id: string;
      idType: { type: string };
      sponsorshipType: string;
      employer?: { uen: string };
    };
    trainingPartner: { uen: string; code: string };
  };
  parameters: { page: number; pageSize: number };
}

export interface EnrolmentSearchResult {
  success: boolean;
  status: 'found' | 'not_found' | 'error';
  referenceNumber?: string;
  enrolmentStatus?: string;
  enrolmentData?: any;
  error?: string;
}

export interface EnrolmentCancelResult {
  success: boolean;
  referenceNumber?: string;
  enrolmentStatus?: string;
  error?: string;
}

async function getSSGContext() {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) throw new Error('SSG credentials not found');

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const encKey = Buffer.from(credentials.encryptionKey, 'base64');
  const iv = Buffer.from('SSGAPIInitVector', 'utf8');

  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });

  return { credentials, ssgBaseUrl, encKey, iv, httpClient };
}

type SsgContext = Awaited<ReturnType<typeof getSSGContext>>;

function parseSsgBody(rawData: unknown, encKey: Buffer, iv: Buffer): any {
  const rawBody = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch {
    return JSON.parse(rawBody);
  }
}

function ssgErrorMessage(parsed: any): string {
  return String(parsed?.error?.details?.[0]?.message || parsed?.error?.message || '');
}

function hasSsgError(parsed: any): boolean {
  if (parsed?.status && String(parsed.status) !== '200') return true;
  return !!(parsed?.error && (parsed.error.code || parsed.error.message || parsed.error.details?.length));
}

function isEmployerUenValidation(parsed: any): boolean {
  const fields = Array.isArray(parsed?.error?.details)
    ? parsed.error.details.map((d: any) => String(d?.field || '').toLowerCase())
    : [];
  const message = ssgErrorMessage(parsed).toLowerCase();
  return fields.includes('employer.uen') || message.includes('invalid employer uen');
}

function buildDedicatedCancelPayload(enrolmentData: any, courseRunId: string): any {
  const enrolment = enrolmentData?.enrolment ?? enrolmentData;
  const trainee = enrolment?.trainee ?? {};
  const course = enrolment?.course ?? {};
  const trainingPartner = enrolment?.trainingPartner ?? {};

  const payload: any = {
    enrolment: {
      course: { run: { id: String(courseRunId) } },
      trainee: {},
      trainingPartner: {},
    },
  };

  if (course?.referenceNumber) payload.enrolment.course.referenceNumber = String(course.referenceNumber).trim();
  if (trainee?.id) payload.enrolment.trainee.id = String(trainee.id).trim().toUpperCase();
  if (trainee?.idType) payload.enrolment.trainee.idType = trainee.idType;
  if (trainingPartner?.uen) payload.enrolment.trainingPartner.uen = String(trainingPartner.uen).trim().toUpperCase();
  if (trainingPartner?.code) payload.enrolment.trainingPartner.code = String(trainingPartner.code).trim();

  return payload;
}

async function viewEnrolmentForCancel(referenceNumber: string, ctx: SsgContext): Promise<any | null> {
  const builder = new HTTPRequestBuilder()
    .withEndpoint(ctx.ssgBaseUrl, `/tpg/enrolments/details/${referenceNumber.trim()}`)
    .withMethod(HttpMethod.GET)
    .withParam('uen', ctx.credentials.uen);

  if (ctx.credentials.certificateContent && ctx.credentials.privateKeyContent) {
    builder.withCertificate(ctx.credentials.certificateContent, ctx.credentials.privateKeyContent);
  }

  const httpResponse = await ctx.httpClient.request(builder.build());
  if (httpResponse.status !== 200) return null;
  const parsed = parseSsgBody(httpResponse.data, ctx.encKey, ctx.iv);
  if (hasSsgError(parsed)) return null;
  return parsed?.data ?? parsed;
}

async function postCancelPayload(
  referenceNumber: string,
  payload: any,
  ctx: SsgContext,
  path = `/tpg/enrolments/details/${referenceNumber.trim()}`,
  queryUen?: string,
): Promise<{ success: boolean; parsed: any | null; status: number; error?: string }> {
  const cipher = crypto.createCipheriv('aes-256-cbc', ctx.encKey, ctx.iv);
  let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encryptedPayload += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ctx.ssgBaseUrl, path)
    .withMethod(HttpMethod.POST)
    .withBody(encryptedPayload);

  if (queryUen) builder.withParam('uen', queryUen);

  if (ctx.credentials.certificateContent && ctx.credentials.privateKeyContent) {
    builder.withCertificate(ctx.credentials.certificateContent, ctx.credentials.privateKeyContent);
  }

  const httpResponse = await ctx.httpClient.request(builder.build());
  let parsed: any = null;
  try {
    parsed = parseSsgBody(httpResponse.data, ctx.encKey, ctx.iv);
  } catch {
    parsed = null;
  }

  if (httpResponse.status !== 200) {
    return { success: false, parsed, status: httpResponse.status, error: ssgErrorMessage(parsed) || `SSG error ${httpResponse.status}` };
  }
  if (parsed === null) {
    return { success: false, parsed, status: httpResponse.status, error: 'Unable to parse SSG response' };
  }
  if (hasSsgError(parsed)) {
    return { success: false, parsed, status: Number(parsed?.status) || httpResponse.status, error: ssgErrorMessage(parsed) || `SSG status ${parsed?.status || httpResponse.status}` };
  }
  return { success: true, parsed, status: httpResponse.status };
}

/**
 * Search SSG for an enrolment record.
 * Calls POST /tpg/enrolments/search with an encrypted payload.
 */
export async function searchEnrolment(payload: EnrolmentSearchPayload): Promise<EnrolmentSearchResult> {
  const { credentials, ssgBaseUrl, encKey, iv, httpClient } = await getSSGContext();

  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  let encryptedPayload = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encryptedPayload += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, '/tpg/enrolments/search')
    .withMethod(HttpMethod.POST)
    .withBody(encryptedPayload);

  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpResponse = await httpClient.request(builder.build());

  if (httpResponse.status === 404) {
    return { success: false, status: 'not_found' };
  }

  if (httpResponse.status !== 200) {
    return { success: false, status: 'error', error: `SSG error ${httpResponse.status}` };
  }

  const parsed = parseSsgBody(httpResponse.data, encKey, iv);

  if (hasSsgError(parsed)) {
    const decryptedStatus = Number(parsed.status) || 400;
    if (decryptedStatus === 404 || decryptedStatus === 403) {
      return { success: false, status: 'not_found' };
    }
    return {
      success: false,
      status: 'error',
      error: ssgErrorMessage(parsed),
    };
  }

  const enrolmentData = parsed?.data?.enrolment ?? parsed?.data?.[0]?.enrolment;
  return {
    success: true,
    status: 'found',
    referenceNumber: enrolmentData?.referenceNumber,
    enrolmentStatus: enrolmentData?.status ?? 'Confirmed',
    enrolmentData,
  };
}

/**
 * Cancel an SSG enrolment by its reference number.
 * First uses the historical details action endpoint. If SSG rejects an
 * employer-sponsored record because the existing Employer.UEN is invalid, retry
 * through the dedicated cancel endpoint without resubmitting employer fields.
 */
export async function cancelEnrolment(
  referenceNumber: string,
  courseRunId: string,
): Promise<EnrolmentCancelResult> {
  const ctx = await getSSGContext();

  const ssgPayload = {
    enrolment: {
      action: 'Cancel',
      course: { run: { id: courseRunId } },
    },
  };

  let result = await postCancelPayload(referenceNumber, ssgPayload, ctx);
  console.log(`SSG cancel enrolment [${referenceNumber}] status:`, result.status);

  if (!result.success && result.parsed && isEmployerUenValidation(result.parsed)) {
    console.warn(`[enrolment-service] Employer.UEN validation failed for ${referenceNumber}; retrying dedicated cancel payload`);
    const enrolmentDataForRetry = await viewEnrolmentForCancel(referenceNumber, ctx);
    if (enrolmentDataForRetry) {
      const dedicatedPayload = buildDedicatedCancelPayload(enrolmentDataForRetry, courseRunId);
      result = await postCancelPayload(
        referenceNumber,
        dedicatedPayload,
        ctx,
        `/tpg/enrolments/${referenceNumber.trim()}/cancel`,
        ctx.credentials.uen,
      );
      console.log(`SSG dedicated cancel enrolment [${referenceNumber}] status:`, result.status);
    }
  }

  console.log(`SSG cancel enrolment response [${referenceNumber}]:`, JSON.stringify(result.parsed));

  if (!result.success) {
    return { success: false, error: result.error || `SSG status ${result.status}` };
  }

  const enrolmentData = result.parsed?.data?.enrolment;
  return {
    success: true,
    referenceNumber: enrolmentData?.referenceNumber ?? referenceNumber,
    enrolmentStatus: enrolmentData?.status,
  };
}
