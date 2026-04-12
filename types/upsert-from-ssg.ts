// Shared types for the "Upsert from SSG" feature (backlog #65).
// Used by POST /api/admin/upsert-from-ssg and components/admin/UpsertFromSsgModal.tsx.

export type UpsertFromSsgMode = 'preview' | 'apply';

export interface UpsertFromSsgRequest {
  courseRunIds: string[];
  mode: UpsertFromSsgMode;
}

// Per-field diff for course_run changes (SSG → local)
export interface UpsertFromSsgFieldDiff {
  field: string;
  old: string | null;
  new: string | null;
}

export interface UpsertFromSsgCourseRunResult {
  inserted: number; // 0 or 1 — a CR is either newly inserted or updated
  updated: number;
  fieldsChanged: UpsertFromSsgFieldDiff[];
}

// Individual session record returned for per-session diff display in the modal.
export interface UpsertFromSsgSessionDetail {
  ssgSessionId: string;
  sessionNumber: string;
  startDate: string;  // compact YYYYMMDD or raw SSG format
  endDate: string;
  startTime: string;
  endTime: string;
  // For 'update' action only — per-field changes (old → new)
  fieldsChanged?: UpsertFromSsgFieldDiff[];
}

export interface UpsertFromSsgSessionsResult {
  inserted: number;
  updated: number;
  softDeleted: number;
  // Detailed records for the expanded row view — populated on both preview and apply.
  insertedDetails: UpsertFromSsgSessionDetail[];
  updatedDetails: UpsertFromSsgSessionDetail[];
  softDeletedDetails: UpsertFromSsgSessionDetail[];
}

// Orphans = local enrolments not in SSG response. Report only, never written.
export interface UpsertFromSsgOrphan {
  enrolmentId: string;
  email: string;
  traineeName?: string;
}

// Individual enrolment record for per-enrolment diff display.
export interface UpsertFromSsgEnrolmentDetail {
  enrolmentId: string;
  email: string;
  traineeName: string;
  // For 'update' action only — status + sponsorship field diff
  fieldsChanged?: UpsertFromSsgFieldDiff[];
}

// Warning surfaced when SSG returns multiple enrolment records for the same
// user+CR combination (e.g. a learner was cancelled then re-enrolled, producing
// two enrolment rows on SSG's side). Local DB has a UNIQUE (user_id, course_run_id)
// constraint so only one can survive. We resolve by "Confirmed wins over Cancelled".
export interface UpsertFromSsgDupWarning {
  traineeEmail: string;
  traineeName: string;
  picked: { enrolmentId: string; status: string };
  skipped: Array<{ enrolmentId: string; status: string }>;
}

export interface UpsertFromSsgEnrolmentsResult {
  inserted: number;
  updated: number;
  orphans: UpsertFromSsgOrphan[];
  // Detailed records for the expanded row view
  insertedDetails: UpsertFromSsgEnrolmentDetail[];
  updatedDetails: UpsertFromSsgEnrolmentDetail[];
  // SSG returned multiple enrolments for the same user+CR. We pick Confirmed
  // over Cancelled and skip the rest; these warnings surface the choice.
  dupWarnings: UpsertFromSsgDupWarning[];
}

export type UpsertFromSsgCrStatus = 'success' | 'failed' | 'partial';

export interface UpsertFromSsgCrResult {
  courseRunId: string;
  courseTitle?: string;
  status: UpsertFromSsgCrStatus;
  error?: string;
  // Which step failed, if any (for 'partial' or 'failed' status)
  failedStep?: 'courseRun' | 'sessions' | 'enrolments';
  courseRun: UpsertFromSsgCourseRunResult;
  sessions: UpsertFromSsgSessionsResult;
  enrolments: UpsertFromSsgEnrolmentsResult;
}

export interface UpsertFromSsgSummary {
  total: number;
  succeeded: number;
  failed: number;
  partial: number;
}

export interface UpsertFromSsgResponse {
  success: boolean;
  mode: UpsertFromSsgMode;
  results: UpsertFromSsgCrResult[];
  summary: UpsertFromSsgSummary;
  error?: string;
}

export const UPSERT_FROM_SSG_MAX_BATCH = 10;
