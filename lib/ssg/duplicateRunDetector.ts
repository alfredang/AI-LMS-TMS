import pool from '../db';
import { createSSGCourseAPI } from './api/course-api';
import { fetchExistingRunsByDate } from './courseRunDuplicateGuard';
import { getSSGCredentialsService } from './services/credentials-service';
import { loadTrainingProviderEmailConfig, sendGmail } from '../trainerInvitationSender';

/**
 * Nightly duplicate detector - the backstop behind the publish guard.
 *
 * The guard stops the LMS publishing a run SSG already has, but it cannot stop a
 * run being created by hand in the TPGateway portal (or by any other system) on
 * dates the LMS already published. Duplicates happened twice (Jun and Sep 2026)
 * and were found by someone looking at MySkillsFuture weeks later; this finds
 * them the next morning.
 *
 * Read-only on SSG. For every TGS code the LMS knows (current, renewed and
 * historical codes), it lists upcoming dates that hold more than one run and
 * emails them. Recipients: the task's Alert Recipients on the Scheduler page,
 * else SSG_DUPLICATE_ALERT_TO (comma-separated), else the company email.
 */

export type DuplicateRunGroup = { course_code: string; start_date: string; end_date: string; run_ids: string[] };
export type DuplicateRunScan = {
  checked: number;
  no_runs: number;
  errors: { course_code: string; error: string }[];
  duplicates: DuplicateRunGroup[];
};

const PAUSE_MS = 1500;          // SSG rate-limits bursts of ~20 calls
const RETRIES = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sgToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

async function allTgsCodes(): Promise<string[]> {
  const { rows } = await pool.query<{ code: string }>(
    `SELECT DISTINCT UPPER(TRIM(code)) AS code FROM (
       SELECT course_code AS code FROM course
       UNION SELECT NULLIF(new_course_code, '') FROM course
       UNION SELECT code FROM course_code_history
     ) c
     WHERE code ILIKE 'TGS-%'
     ORDER BY 1`,
  );
  return rows.map((r) => r.code);
}

export async function scanForDuplicateCourseRuns(): Promise<DuplicateRunScan | null> {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) return null; // tenant without SSG: nothing to check
  const api = createSSGCourseAPI(credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg', credentials);
  const today = sgToday();
  const scan: DuplicateRunScan = { checked: 0, no_runs: 0, errors: [], duplicates: [] };

  for (const code of await allTgsCodes()) {
    let byDate: Map<string, string> | null = null;
    let lastError = '';
    for (let attempt = 0; attempt < RETRIES && !byDate; attempt++) {
      if (attempt) await sleep(15_000 * attempt);
      try {
        byDate = await fetchExistingRunsByDate(api, code, credentials.uen);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (/not found/i.test(lastError)) break;               // SSG holds no runs for this code
        if (!/rate|429|timed out|socket hang up|ECONNRESET/i.test(lastError)) break;
      }
    }
    scan.checked++;
    if (!byDate) {
      if (/not found/i.test(lastError)) scan.no_runs++;
      else scan.errors.push({ course_code: code, error: lastError.slice(0, 200) });
    } else {
      for (const [key, ids] of byDate) {
        const [start_date, end_date] = key.split('|');
        const run_ids = ids.split('/').filter(Boolean);
        if (start_date > today && run_ids.length > 1) {
          scan.duplicates.push({ course_code: code, start_date, end_date, run_ids });
        }
      }
    }
    await sleep(PAUSE_MS);
  }
  scan.duplicates.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.course_code.localeCompare(b.course_code));
  return scan;
}

const TASK_ID = 'detect_duplicate_course_runs';
const splitEmails = (s?: string | null) => String(s ?? '').split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);

/** Alert Recipients on the Scheduler page, else SSG_DUPLICATE_ALERT_TO, else the company email. */
async function alertRecipients(companyEmail?: string | null): Promise<string[]> {
  const saved = await pool.query<{ alert_recipients: string | null }>(
    'SELECT alert_recipients FROM scheduler_config WHERE id = $1', [TASK_ID],
  ).then((r) => splitEmails(r.rows[0]?.alert_recipients)).catch(() => [] as string[]);
  if (saved.length) return saved;
  const env = splitEmails(process.env.SSG_DUPLICATE_ALERT_TO);
  return env.length ? env : splitEmails(companyEmail);
}

export async function runDuplicateCourseRunCheck() {
  const scan = await scanForDuplicateCourseRuns();
  if (!scan) return { ok: true, summary: 'Skipped - SSG credentials not configured for this tenant', alert: 'not needed', duplicates: [], errors: [] };
  const summary = `${scan.checked} course codes checked, ${scan.duplicates.length} upcoming duplicate date(s), ${scan.errors.length} could not be checked`;
  console.log(`🔎 [duplicate-run-check] ${summary}`);

  let alert = 'not needed';
  if (scan.duplicates.length > 0 || scan.errors.length > 0) {
    const tp = await loadTrainingProviderEmailConfig().catch(() => null);
    const to = await alertRecipients(tp?.company_email);
    if (!tp || to.length === 0) {
      alert = 'skipped - Gmail or recipients not configured';
    } else {
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
      const rows = scan.duplicates.map((d) =>
        `<tr><td>${esc(d.course_code)}</td><td>${esc(d.start_date)}</td><td>${esc(d.end_date)}</td><td>${esc(d.run_ids.join(', '))}</td></tr>`).join('');
      // Capped: if SSG is down every code errors, and 300 identical lines help nobody.
      const errs = scan.errors.slice(0, 20).map((e) => `<li>${esc(e.course_code)}: ${esc(e.error)}</li>`).join('')
        + (scan.errors.length > 20 ? `<li>...and ${scan.errors.length - 20} more</li>` : '');
      const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.5;">
  <p><strong>${scan.duplicates.length} upcoming class date(s) are listed more than once on SSG / MySkillsFuture.</strong>
  Each row is one class with two or more course runs on the same dates. Keep the run with learners
  (or the one linked in the LMS) and cancel the rest in TPGateway.</p>
  ${rows ? `<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:13px;">
    <tr><th>Course code</th><th>Start</th><th>End</th><th>Run IDs</th></tr>${rows}</table>` : ''}
  ${errs ? `<p>These course codes could not be checked tonight:</p><ul>${errs}</ul>` : ''}
  <p style="color:#6b7280;">${summary}. Sent by the LMS nightly duplicate course-run check.</p>
</div>`;
      try {
        await sendGmail(tp, to[0], `⚠ ${scan.duplicates.length} duplicate course run date(s) on SSG`, html, to.slice(1));
        alert = `sent to ${to.join(', ')}`;
      } catch (e) {
        alert = `email failed: ${e instanceof Error ? e.message : e}`;
      }
    }
  }
  return { ok: true, summary, alert, duplicates: scan.duplicates, errors: scan.errors };
}
