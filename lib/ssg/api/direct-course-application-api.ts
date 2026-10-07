import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../utils/http-utils';
import { Cryptography } from '../utils/cryptography';
import type { SSGCredentials } from '../services/credentials-service';

export interface DirectCourseApplicationFilter {
  uen: string;
  tpCode: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  keyword?: string;
  runStartDate?: {
    from?: number;
    to?: number;
  };
  applicationId?: string;
  lastUpdateDate?: number;
  applicationStatus?: string;
}

export interface DirectCourseApplicationResponse {
  data?: {
    courseApplications?: DirectCourseApplication[];
  };
  meta?: {
    total?: number;
  };
  error?: {
    code?: string | number;
    message?: string;
    details?: Array<{ field?: string; message?: string }>;
    errorId?: string;
  };
  status?: number;
}

export interface DirectCourseApplication {
  run?: {
    current?: {
      id?: number | string;
      startDate?: number | string;
      endDate?: number | string;
    };
    previous?: {
      id?: number | string;
      startDate?: number | string;
      endDate?: number | string;
    };
  };
  course?: {
    tpCode?: string;
    tpAlias?: string;
    category?: string;
    courseTitle?: string;
    courseReferenceNumber?: string;
  };
  profile?: {
    sex?: string;
    nric?: string;
    fullName?: string;
    countryCode?: number | string;
    dateOfBirth?: number | string;
    emailAddress?: string;
    contactNumber?: number | string;
    citizenshipType?: string;
    highestQualification?: {
      code?: string;
      title?: string;
      version?: string;
    };
    highestRelevantCertification?: string;
  };
  feeDetail?: {
    hasGST?: boolean;
    gstAmount?: number | string;
    payableFee?: number | string;
    fullCourseFee?: number | string;
    maximumSFCUsableAmount?: number | string;
    indicatedSFCUsageAmount?: number | string;
    skillsFutureSubsidyAmount?: number | string;
  };
  sfcClaimId?: string;
  cancelledBy?: string;
  cancelledOn?: string;
  confirmedOn?: string;
  finalisedOn?: string;
  applicationId?: string;
  paymentDetail?: unknown;
  applicationStatus?: string;
  reasonForCancellation?: string;
  createdOn?: string;
  modifiedOn?: string;
}

function removeEmptyFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(removeEmptyFields).filter((item) => item !== undefined && item !== null) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = removeEmptyFields(child);
      if (cleaned === undefined || cleaned === null || cleaned === '') continue;
      if (typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) continue;
      out[key] = cleaned;
    }
    return out as T;
  }
  return value;
}

function parseMaybeEncrypted(data: unknown, encryptionKey: string): DirectCourseApplicationResponse {
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      if (!encryptionKey) throw new Error('SSG returned a non-JSON response and no encryption key is configured');
      return Cryptography.decryptJSON(encryptionKey, trimmed);
    }
  }
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as { data?: unknown }).data === 'string' &&
    encryptionKey
  ) {
    try {
      const decrypted = Cryptography.decryptJSON(encryptionKey, (data as { data: string }).data);
      return {
        ...(data as Record<string, unknown>),
        data: decrypted?.data ?? decrypted,
        error: decrypted?.error ?? (data as DirectCourseApplicationResponse).error,
        meta: decrypted?.meta ?? (data as DirectCourseApplicationResponse).meta,
        status: Number(decrypted?.status ?? (data as DirectCourseApplicationResponse).status),
      } as DirectCourseApplicationResponse;
    } catch {
      // Plain responses also use `data`; fall through and let the caller read it.
    }
  }
  return data as DirectCourseApplicationResponse;
}

function apiErrorMessage(parsed: DirectCourseApplicationResponse, httpStatus: number): string {
  const details = parsed.error?.details
    ?.map((d) => [d.field, d.message].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ');
  return details || parsed.error?.message || `SSG direct application API returned ${httpStatus}`;
}

export class SSGDirectCourseApplicationAPI {
  private readonly httpClient: HttpClient;

  constructor(
    private readonly baseUrl: string,
    private readonly credentials: SSGCredentials,
  ) {
    this.httpClient = new HttpClient(baseUrl, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  }

  async retrieveTrainingProviderCourseApplications(
    filter: DirectCourseApplicationFilter,
  ): Promise<DirectCourseApplicationResponse> {
    const builder = new HTTPRequestBuilder()
      .withEndpoint(this.baseUrl, '/courses/applications/trainingprovider/filter')
      .withMethod(HttpMethod.POST)
      .withHeader('x-api-version', 'v1.0')
      .withBody(removeEmptyFields(filter));

    if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
      builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
    }

    const response = await this.httpClient.request(builder.build());
    const parsed = parseMaybeEncrypted(response.data, this.credentials.encryptionKey);

    if (response.status === 404 || Number(parsed.status) === 404) {
      return { data: { courseApplications: [] }, meta: { total: 0 }, status: 404, error: parsed.error };
    }

    const status = Number(parsed.status || response.status);
    if (response.status < 200 || response.status >= 300 || (status && (status < 200 || status >= 300))) {
      throw new Error(apiErrorMessage(parsed, response.status));
    }

    return parsed;
  }
}

export const createSSGDirectCourseApplicationAPI = (
  baseUrl: string,
  credentials: SSGCredentials,
): SSGDirectCourseApplicationAPI => new SSGDirectCourseApplicationAPI(baseUrl, credentials);
