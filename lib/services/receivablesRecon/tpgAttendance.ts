import { getSSGCredentialsService } from '@/lib/ssg/services/credentials-service';
import { createSSGEnrolmentAPI } from '@/lib/ssg/api/enrolment-api';
import { createSSGCourseAPI } from '@/lib/ssg/api/course-api';
import { createSSGAttendanceAPI } from '@/lib/ssg/api/attendance-api';
import { OptionalSelector } from '@/lib/ssg/models/course-runs';
import { extractRecordsFromViewAttendance, normalizeAttendanceRecord } from '@/lib/ssg/utils/attendance-decrypt';

/**
 * TPG attendance for an enrolment, read live from TPGateway (read-only).
 *
 * Receivables Reconciliation shows it on invoices whose grant / claim / enrolment TPG cancelled,
 * so Finance can see at a glance whether the learner actually attended before deleting or
 * credit-noting the invoice. TPG, not the LMS: TPG's record is what grants and claims follow.
 *
 * Per enrolment: TPG's enrolment record (real NRIC — the LMS masks it once paid — run and course),
 * the run's sessions, then each session's attendance. Session attendance is cached per run, so a
 * run shared by several cancelled learners is read once. NRICs are never stored or returned.
 */

export type TpgAttendanceStatus = 'attended' | 'partial' | 'absent' | 'not_taken' | 'no_sessions' | 'error';

export interface TpgAttendance {
  status: TpgAttendanceStatus;
  /** Sessions the learner was marked present for. */
  attended: number;
  /** The run's sessions on TPG (deleted sessions excluded). */
  sessions: number;
  /** Sessions TPG has any attendance taken for. */
  taken: number;
  checkedAt: string;
  note?: string;
}

const CALL_GAP_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classify(attended: number, sessions: number, taken: number): TpgAttendanceStatus {
  if (sessions === 0) return 'no_sessions';
  if (attended === 0) return taken === 0 ? 'not_taken' : 'absent';
  return attended >= taken ? 'attended' : 'partial';
}

export async function fetchTpgAttendance(
  enrolmentIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, TpgAttendance>> {
  const ids = [...new Set(enrolmentIds.map((e) => String(e || '').trim().toUpperCase()).filter(Boolean))];
  const out: Record<string, TpgAttendance> = {};
  if (!ids.length) return out;

  const cred = await getSSGCredentialsService().getSSGCredentials(undefined, undefined);
  if (!cred) throw new Error('SSG credentials not configured');
  const base = cred.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const enrApi = createSSGEnrolmentAPI(base, cred);
  const courseApi = createSSGCourseAPI(base, cred);
  const attApi = createSSGAttendanceAPI(base, cred);

  // run id -> { sessions taken / total, attendance by NRIC per session }
  const runCache = new Map<string, Promise<{ sessions: number; taken: number; presentBySession: Array<Map<string, boolean>> }>>();
  const loadRun = (runId: string, courseRef: string) => {
    if (!runCache.has(runId)) {
      runCache.set(
        runId,
        (async () => {
          const sv: any = await courseApi.viewCourseSessions(courseRef, runId, OptionalSelector.YES);
          await sleep(CALL_GAP_MS);
          const list: any[] = Array.isArray(sv?.data?.sessions) ? sv.data.sessions : [];
          const live = list.filter((s) => s?.id && s?.deleted !== true);
          const presentBySession: Array<Map<string, boolean>> = [];
          let taken = 0;
          for (const s of live) {
            const a: any = await attApi.viewAttendance(runId, courseRef, String(s.id));
            await sleep(CALL_GAP_MS);
            const byNric = new Map<string, boolean>();
            if (!a?.error && (!a?.status || a.status === 200)) {
              for (const rec of extractRecordsFromViewAttendance(a?.data, cred.encryptionKey, String(s.id))) {
                const n = normalizeAttendanceRecord(rec);
                if (n) byNric.set(String(n.nric).toUpperCase(), n.isPresent);
              }
            }
            if (byNric.size > 0 || s.attendanceTaken === true) taken++;
            presentBySession.push(byNric);
          }
          return { sessions: live.length, taken, presentBySession };
        })()
      );
    }
    return runCache.get(runId)!;
  };

  let done = 0;
  for (const enr of ids) {
    const checkedAt = new Date().toISOString();
    try {
      const v: any = await enrApi.viewEnrolment(enr);
      await sleep(CALL_GAP_MS);
      const e = v?.data?.enrolment ?? v?.data;
      const nric = String(e?.trainee?.id || '').trim().toUpperCase();
      const runId = String(e?.course?.run?.id || '').trim();
      const courseRef = String(e?.course?.referenceNumber || '').trim();
      if (!nric || !runId || !courseRef) {
        out[enr] = { status: 'error', attended: 0, sessions: 0, taken: 0, checkedAt, note: 'TPG enrolment record could not be read' };
      } else {
        const run = await loadRun(runId, courseRef);
        const attended = run.presentBySession.filter((m) => m.get(nric) === true).length;
        out[enr] = { status: classify(attended, run.sessions, run.taken), attended, sessions: run.sessions, taken: run.taken, checkedAt };
      }
    } catch (err) {
      out[enr] = { status: 'error', attended: 0, sessions: 0, taken: 0, checkedAt, note: err instanceof Error ? err.message.slice(0, 120) : 'TPG lookup failed' };
    }
    onProgress?.(++done, ids.length);
  }
  return out;
}
