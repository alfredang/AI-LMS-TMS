import crypto from 'crypto';
import pool from '../db';
import { getSSGCredentialsService } from './services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from './utils/http-utils';

/**
 * SSG → LMS enrolment PULL (reconciliation backstop).
 *
 * Reads SSG's authoritative enrolment state for a run and updates ONLY the local
 * `enrollment.enrolment_id` to match — linking the SSG reference when a learner is enrolled
 * on TPGateway, clearing a stale reference when they're no longer actively enrolled there.
 *
 * STRICTLY enrolment_id + on-TPG status reconciliation. It NEVER:
 *   - inserts an enrollment row (no adding trainees),
 *   - changes `enrolment_status` / soft-removes (no removing trainees),
 *   - touches the calendar, trainers, or anything else.
 *
 * The badge / "Learner · TPG" column reads off enrolment_id, so linking/clearing it IS the
 * status sync. Source of truth is a direct SSG search per run (one call lists all the run's
 * enrolments); reconciliation is SKIPPED for a run if the search errors (never guess).
 */

const IV = Buffer.from('SSGAPIInitVector', 'utf8');
const isActive = (s: string) => !['cancelled', 'withdrawn', 'rejected'].includes(String(s || '').toLowerCase());

export interface ReconcileRunResult {
  linked: number;   // enrolment_id set/updated to the live SSG ref
  cleared: number;  // stale enrolment_id removed (no active SSG enrolment)
  checked: number;  // local active enrolments examined
  skipped?: string; // reason this run was not reconciled (search failed / no creds / not found)
}

interface SsgRunEnrolment { ref: string; nric: string; status: string; }

/**
 * List ALL of a run's SSG enrolments (paged). Returns null on ANY error so the caller can
 * safely SKIP reconciliation rather than act on a partial/failed read.
 */
async function searchRunEnrolments(
  ssgRunId: string, courseRef: string,
  tp: { uen: string; code: string },
  creds: { encryptionKey: string; certificateContent?: string; privateKeyContent?: string },
  baseUrl: string,
): Promise<SsgRunEnrolment[] | null> {
  const out: SsgRunEnrolment[] = [];
  const encKey = Buffer.from(creds.encryptionKey, 'base64');
  const httpClient = new HttpClient(baseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' });

  for (let page = 0; page < 50; page++) {
    const payload = {
      enrolment: { course: { run: { id: ssgRunId }, referenceNumber: courseRef }, trainingPartner: { uen: tp.uen, code: tp.code } },
      parameters: { page, pageSize: 100 },
    };
    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, IV);
    let body = cipher.update(JSON.stringify(payload), 'utf8', 'base64'); body += cipher.final('base64');
    const builder = new HTTPRequestBuilder().withEndpoint(baseUrl, '/tpg/enrolments/search').withMethod(HttpMethod.POST).withBody(body);
    if (creds.certificateContent && creds.privateKeyContent) builder.withCertificate(creds.certificateContent, creds.privateKeyContent);

    let r: any;
    try { r = await httpClient.request(builder.build()); } catch { return null; }
    if (r.status === 404) return out;            // no records — valid empty result
    if (r.status !== 200) return null;            // hard error — skip reconcile

    let parsed: any;
    try {
      const raw = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      const d = crypto.createDecipheriv('aes-256-cbc', encKey, IV);
      let s = d.update(raw, 'base64', 'utf8'); s += d.final('utf8');
      parsed = JSON.parse(s);
    } catch { return null; }

    const code = Number(parsed?.status);
    const hasError = parsed?.error && (parsed.error.code || parsed.error.message || (parsed.error.details?.length));
    if (hasError) { if (code === 404 || code === 403) return out; return null; }

    const arr: any[] = Array.isArray(parsed?.data) ? parsed.data : (parsed?.data?.enrolment ? [parsed.data] : []);
    for (const item of arr) {
      const e = item?.enrolment ?? item;
      const ref = e?.referenceNumber;
      const nric = String(e?.trainee?.id || '').trim().toUpperCase();
      if (ref && nric) out.push({ ref: String(ref), nric, status: String(e?.status || '') });
    }
    if (arr.length < 100) break;  // last page
  }
  return out;
}

/** Reconcile one run's local enrolment_ids against SSG. enrolment_id ONLY. */
export async function reconcileEnrolmentIdsForRun(courseRunUuid: string): Promise<ReconcileRunResult> {
  const run = (await pool.query<{ ssg_run_id: string; course_ref: string }>(
    `SELECT cr.course_run_id AS ssg_run_id, c.course_code AS course_ref
       FROM course_run cr JOIN course c ON c.id = cr.course_id WHERE cr.id = $1`,
    [courseRunUuid]
  )).rows[0];
  if (!run) return { linked: 0, cleared: 0, checked: 0, skipped: 'run not found' };

  const creds = await getSSGCredentialsService().getSSGCredentials();
  if (!creds) return { linked: 0, cleared: 0, checked: 0, skipped: 'no SSG credentials' };
  const tp = await getTrainingPartnerIdentifiers();
  const baseUrl = (creds as any).ssgApiBaseUrl || process.env.SSG_API_URL || process.env.SSG_API_BASE_URL || 'https://api.ssg-wsg.sg';

  const ssgList = await searchRunEnrolments(run.ssg_run_id, run.course_ref, { uen: tp.uen, code: tp.code }, creds as any, baseUrl);
  if (ssgList === null) return { linked: 0, cleared: 0, checked: 0, skipped: 'SSG search failed' };  // never reconcile on a failed read

  // nric -> the live ACTIVE ref on this run (first one wins; cancelled ignored)
  const activeByNric = new Map<string, string>();
  for (const e of ssgList) if (isActive(e.status) && !activeByNric.has(e.nric)) activeByNric.set(e.nric, e.ref);

  // Local ACTIVE enrolments on the run (roster status untouched — we only read it to scope).
  const locals = (await pool.query<{ id: string; enrolment_id: string | null; nric: string }>(
    `SELECT e.id, e.enrolment_id,
            UPPER(COALESCE(NULLIF(TRIM(e.nric), ''), lp.nric, '')) AS nric
       FROM enrollment e LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
      WHERE e.course_run_id = $1
        AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')`,
    [courseRunUuid]
  )).rows;

  let linked = 0, cleared = 0, checked = 0;
  for (const l of locals) {
    if (!l.nric) continue;  // can't match without an NRIC
    checked++;
    const activeRef = activeByNric.get(l.nric) || null;
    if (activeRef) {
      if (l.enrolment_id !== activeRef) {
        await pool.query(`UPDATE enrollment SET enrolment_id = $1, updated_at = NOW() WHERE id = $2`, [activeRef, l.id]);
        linked++;
      }
    } else if (l.enrolment_id) {
      // No active SSG enrolment for this learner on the run → the stored ref is stale (cancelled
      // or removed outside the LMS). Clear ONLY enrolment_id; the local roster row stays put.
      await pool.query(`UPDATE enrollment SET enrolment_id = NULL, updated_at = NOW() WHERE id = $1`, [l.id]);
      cleared++;
    }
  }
  return { linked, cleared, checked };
}

export interface ReconcileSweepResult { runs: number; linked: number; cleared: number; checked: number; skipped: number; }

/**
 * Nightly sweep: reconcile enrolment_ids for current/upcoming runs (end_date >= yesterday),
 * skipping Cancelled classes. Bounded to runs that still matter; historical runs are left alone.
 */
export async function reconcileEnrolmentIdsForUpcomingRuns(): Promise<ReconcileSweepResult> {
  const runs = (await pool.query<{ id: string }>(
    `SELECT id FROM course_run
      WHERE end_date >= CURRENT_DATE - INTERVAL '1 day'
        AND LOWER(COALESCE(class_status, '')) <> 'cancelled'
      ORDER BY start_date ASC`
  )).rows;

  const agg: ReconcileSweepResult = { runs: 0, linked: 0, cleared: 0, checked: 0, skipped: 0 };
  for (const r of runs) {
    try {
      const res = await reconcileEnrolmentIdsForRun(r.id);
      agg.runs++;
      agg.linked += res.linked; agg.cleared += res.cleared; agg.checked += res.checked;
      if (res.skipped) agg.skipped++;
    } catch {
      agg.skipped++;
    }
  }
  return agg;
}
