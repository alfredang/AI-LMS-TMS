import pool from '../db';

/**
 * Client for the Tertiary Exams bearer-token API (exams.tertiaryinfotech.com/api/v1).
 * The token (scope `assign:practice-exams`, from Exams → Admin → API Tokens) and
 * base URL are set under Company Settings → Integrations → AI Exam
 * (`training_provider.exams_api_token` / `exams_api_url`); the EXAMS_API_TOKEN /
 * EXAMS_API_URL env vars are the fallback. The feature is off without a token,
 * so tenants that haven't set one never see the Practice Exam section.
 */
const DEFAULT_BASE_URL = 'https://exams.tertiaryinfotech.com';
const CONFIG_TTL_MS = 60_000;

interface ExamsConfig { baseUrl: string; token: string }
let cached: { at: number; value: ExamsConfig } | null = null;

async function getConfig(): Promise<ExamsConfig> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value;
  let dbUrl = '';
  let dbToken = '';
  try {
    const r = await pool.query('SELECT exams_api_url, exams_api_token FROM training_provider LIMIT 1');
    dbUrl = String(r.rows[0]?.exams_api_url ?? '').trim();
    dbToken = String(r.rows[0]?.exams_api_token ?? '').trim();
  } catch { /* columns not created yet — use env */ }
  const value: ExamsConfig = {
    baseUrl: (dbUrl || process.env.EXAMS_API_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    token: dbToken || process.env.EXAMS_API_TOKEN?.trim() || '',
  };
  cached = { at: Date.now(), value };
  return value;
}

/** Call after the integration settings are saved so the new token applies immediately. */
export function invalidateExamsConfigCache(): void {
  cached = null;
}

export async function examsApiConfigured(): Promise<boolean> {
  return !!(await getConfig()).token;
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
  const cfg = await getConfig();
  const res = await fetch(`${cfg.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
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
  /** The exams site emailed the learner the exam link + email-code sign-in steps (first registration for this class only). */
  emailSent?: boolean;
  registeredAt?: string | null;
}

/** Create the account if needed, grant the practice exam, record course run + "Registered from TMS". */
export async function registerLearner(input: { name: string; email: string; exam: string; courseRunId: string; remark?: string }): Promise<RegisterResult> {
  const r = await call<{
    accountCreated: boolean; created: boolean; alreadyHadAccess: boolean;
    registrationEmailSent?: boolean; welcomeEmailSent?: boolean;
    registration?: { registeredAt: string | null };
  }>('/registrations', {
    method: 'POST',
    body: JSON.stringify({ ...input, remark: input.remark || 'Registered from TMS' }),
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.data.error || `Exams API error ${r.status}` };
  return {
    ok: true,
    status: r.status,
    accountCreated: r.data.accountCreated,
    created: r.data.created,
    alreadyHadAccess: r.data.alreadyHadAccess,
    emailSent: !!(r.data.registrationEmailSent ?? r.data.welcomeEmailSent),
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
