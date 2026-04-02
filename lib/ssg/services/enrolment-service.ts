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

  const rawBody = typeof httpResponse.data === 'string'
    ? httpResponse.data
    : JSON.stringify(httpResponse.data);

  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  const parsed = JSON.parse(decrypted);

  const hasError = parsed?.error && (parsed.error.code || parsed.error.message ||
    (parsed.error.details && parsed.error.details.length > 0));

  if (hasError) {
    const decryptedStatus = Number(parsed.status) || 400;
    if (decryptedStatus === 404 || decryptedStatus === 403) {
      return { success: false, status: 'not_found' };
    }
    return {
      success: false,
      status: 'error',
      error: parsed.error.details?.[0]?.message || parsed.error.message,
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
 * Calls POST /tpg/enrolments/details/{referenceNumber} with action: 'Cancel'.
 */
export async function cancelEnrolment(
  referenceNumber: string,
  courseRunId: string,
): Promise<EnrolmentCancelResult> {
  const { credentials, ssgBaseUrl, encKey, iv, httpClient } = await getSSGContext();

  const ssgPayload = {
    enrolment: {
      action: 'Cancel',
      course: { run: { id: courseRunId } },
    },
  };

  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  let encryptedPayload = cipher.update(JSON.stringify(ssgPayload), 'utf8', 'base64');
  encryptedPayload += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, `/tpg/enrolments/details/${referenceNumber.trim()}`)
    .withMethod(HttpMethod.POST)
    .withBody(encryptedPayload);

  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpResponse = await httpClient.request(builder.build());

  console.log(`📦 SSG cancel enrolment [${referenceNumber}] HTTP status:`, httpResponse.status);

  if (httpResponse.status !== 200) {
    return { success: false, error: `SSG error ${httpResponse.status}` };
  }

  const rawBody = typeof httpResponse.data === 'string'
    ? httpResponse.data
    : JSON.stringify(httpResponse.data);

  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  const parsed = JSON.parse(decrypted);

  console.log(`📦 SSG cancel enrolment response [${referenceNumber}]:`, JSON.stringify(parsed));

  const hasError = parsed?.error && (parsed.error.code || parsed.error.message ||
    (parsed.error.details && parsed.error.details.length > 0));

  if (hasError) {
    return {
      success: false,
      error: parsed.error.details?.[0]?.message || parsed.error.message,
    };
  }

  const enrolmentData = parsed?.data?.enrolment;
  return {
    success: true,
    referenceNumber: enrolmentData?.referenceNumber ?? referenceNumber,
    enrolmentStatus: enrolmentData?.status,
  };
}
