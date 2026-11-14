import pool from '../db';

/**
 * Client for the Tertiary Exams bearer-token API (exams.tertiaryinfotech.com/api/v1).
 * The feature is off unless EXAMS_API_TOKEN is set (a token with the
 * `assign:practice-exams` scope from Exams → Admin → API Tokens), so tenants
 * without it never see the Practice Exam panel.
 */
const BASE_URL = (process.env.EXAMS_API_URL || 'https://exams.tertiaryinfotech.com').replace(/\/+$/, '');

export function examsApiConfigured(): boolean {
  return !!process.env.EXAMS_API_TOKEN?.trim();
}

export interface PracticeExamRef {
  examId: string;
  slug: string;
  code: string;
  title: string;
  vendor: string;
  onSale: boolean;
}

export interface ExamRegistration {
  email: string;
  name: string | null;
  signedIn: boolean;
  courseRunId: string | null;
  registeredAt: string | null;
  remark: string | null;
}

interface ApiResult<T> { ok: boolean; status: number; data: T & { error?: string } }

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.EXAMS_API_TOKEN?.trim() || ''}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

export async function listPracticeExams(): Promise<PracticeExamRef[]> {
  const r = await call<{ practiceExams: PracticeExamRef[] }>('/practice-exams');
  if (!r.ok) throw new Error(r.data.error || `Exams API error ${r.status}`);
  return r.data.practiceExams || [];
}

export async function listRegistrations(courseRunId: string, exam: string): Promise<ExamRegistration[]> {
  const qs = new URLSearchParams({ courseRunId, exam }).toString();
  const r = await call<{ registrations: ExamRegistration[] }>(`/registrations?${qs}`);
  if (!r.ok) throw new Error(r.data.error || `Exams API error ${r.status}`);
  return r.data.registrations || [];
}

export interface RegisterResult {
  ok: boolean;
  status: number;
  error?: string;
  accountCreated?: boolean;
  created?: boolean;
  alreadyHadAccess?: boolean;
  registeredAt?: string | null;
}

/** Create the account if needed, grant the practice exam, record course run + "Registered from TMS". */
export async function registerLearner(input: { name: string; email: string; exam: string; courseRunId: string }): Promise<RegisterResult> {
  const r = await call<{
    accountCreated: boolean; created: boolean; alreadyHadAccess: boolean;
    registration?: { registeredAt: string | null };
  }>('/registrations', {
    method: 'POST',
    body: JSON.stringify({ ...input, remark: 'Registered from TMS' }),
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.data.error || `Exams API error ${r.status}` };
  return {
    ok: true,
    status: r.status,
    accountCreated: r.data.accountCreated,
    created: r.data.created,
    alreadyHadAccess: r.data.alreadyHadAccess,
    registeredAt: r.data.registration?.registeredAt ?? null,
  };
}

let columnReady = false;
/** Migrations don't run on deploy: add course.practice_exam_code on first use. */
export async function ensurePracticeExamColumn(): Promise<void> {
  if (columnReady) return;
  await pool.query('ALTER TABLE course ADD COLUMN IF NOT EXISTS practice_exam_code text');
  columnReady = true;
}
