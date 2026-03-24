/**
 * SSG API — Public barrel export
 *
 * Usage:
 *   import { SSGEnrolmentAPI, createSSGEnrolmentAPI, SponsorshipType } from '@/lib/ssg';
 *   import { getSSGCredentialsService } from '@/lib/ssg';
 */

// ── Credentials ───────────────────────────────────────────────────────────────
export type { SSGCredentials } from './services/credentials-service';
export { SSGCredentialsService, getSSGCredentialsService } from './services/credentials-service';

// ── Encryption helpers (reads SSG_ENCRYPTION_KEY from env) ───────────────────
export { encryptPayload, decryptResponse } from './utils/encryption-service';
export { Cryptography, CryptoUtils } from './utils/cryptography';

// ── HTTP utilities ─────────────────────────────────────────────────────────────
export { HTTPRequestBuilder, HttpClient, HttpMethod, handleRequest, createSSGHttpClient } from './utils/http-utils';
export type { HttpRequestConfig, HttpResponse } from './utils/http-utils';

// ── Validators ─────────────────────────────────────────────────────────────────
export { Validators } from './utils/validators';

// ── Constants & Enums ─────────────────────────────────────────────────────────
export {
  IdType,
  IdTypeSummary,
  SponsorshipType,
  CollectionStatus,
  CancellableCollectionStatus,
  Grade,
  AssessmentResult,
  AssessmentAction,
  AttendanceStatus,
  SurveyLanguage,
  ModeOfTraining,
  Salutation,
  TrainerType,
  Vacancy,
  SortField,
  SortOrder,
  EnrolmentStatus,
  CancelClaimsCode,
  PermittedFileType,
  SSG_ENDPOINTS
} from './constants';

// ── API Clients ────────────────────────────────────────────────────────────────
export { SSGCourseAPI, createSSGCourseAPI, CourseOperations } from './api/course-api';
export { SSGEnrolmentAPI, createSSGEnrolmentAPI } from './api/enrolment-api';
export { SSGAssessmentAPI, createSSGAssessmentAPI } from './api/assessment-api';
export { SSGAttendanceAPI, createSSGAttendanceAPI } from './api/attendance-api';

// ── Models ─────────────────────────────────────────────────────────────────────
export type { SSGApiResponse } from './models/course-runs';
export type {
  CreateEnrolmentPayload,
  SearchEnrolmentPayload,
  UpdateEnrolmentPayload,
  UpdateFeeCollectionPayload,
  CancelEnrolmentPayload,
  EnrolmentRecord,
  EnrolmentSearchResult
} from './models/enrolment';
export type {
  CreateAssessmentPayload,
  SearchAssessmentPayload,
  UpdateVoidAssessmentPayload,
  AssessmentRecord
} from './models/assessment';
export type {
  UploadAttendancePayload,
  AttendanceTrainee,
  AttendanceRecord
} from './models/attendance';
