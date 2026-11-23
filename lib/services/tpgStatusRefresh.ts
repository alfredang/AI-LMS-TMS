import crypto from 'crypto';
import pool from '@/lib/db';
import { ensureColumns } from '@/lib/dbSchemaGuard';
import { refreshGrantsForEnrolments } from './billingSync';
import { getSSGCredentialsService } from '@/lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '@/lib/ssg/utils/http-utils';

/**
 * Live TPG status refresh for the Financial Dashboard (Grants + SFC Claims tabs).
 *
 * ssg_grants / ssg_claims were only written at a few moments (invoice generation, a run import,
 * an SFC report upload) and never re-read, so a stored status froze: 2026-10-16, ENR-2602-016213's
 * grants showed "Processing" for months after TPG cancelled them, and claims 2004827743 /
 * 2004815481 showed "Ready for Payout" although TPG had paid them.
 *
 * This re-reads every record that is not final yet, oldest-checked first:
 *   - grants: per enrolment via /tpg/grants/search (refreshGrantsForEnrolments, which stamps
 *     ssg_grants.imported_at — that is the "last checked" time);
 *   - SFC claims: per claim via GET /skillsFutureCredits/claims/{id} (v2). Only the app1 TPG
 *     credentials are allowed to call it (app2/3/4 get 403), so SFC_CLAIMS_SSG_APP defaults to it.
 * Final records (grant Completed/Cancelled, claim Paid/Cancelled/Rejected/Lapsed) are never re-read.
 * Only a successful TPG answer updates a record; failures are retried on the next run.
 */

export const GRANT_FINAL_STATUSES = ['Completed', 'Cancelled'];
export const CLAIM_FINAL_STATUSES = ['paid', 'cancelled', 'rejected', 'lapsed', 'withdrawn'];

export const TPG_REFRESH_GRANT_BATCH = 60;
export const TPG_REFRESH_CLAIM_BATCH = 40;
const RECHECK_AFTER_HOURS = 6;
const SFC_CLAIMS_SSG_APP = (process.env.SFC_CLAIMS_SSG_APP || 'app1').trim() || 'app1';

export interface TpgStatusRefreshResult {
  success: boolean;
  grants: { enrolmentsChecked: number; failed: number };
  claims: { checked: number; changed: number; failed: number };
  failures: Array<{ id: string; error?: string }>;
}

let claimColumnEnsured = false;
export async function ensureClaimCheckedColumn(): Promise<void> {
  if (claimColumnEnsured) return;
  // Catalog check first — a bare ADD COLUMN IF NOT EXISTS locks ssg_claims even when the column exists.
  await ensureColumns(pool, 'ssg_claims', { tpg_checked_at: 'timestamptz' });
  claimColumnEnsured = true;
}

/** Re-read the grants of these enrolments from TPG. */
export async function refreshGrantStatuses(enrolmentIds: string[]): Promise<{ checked: number; failures: Array<{ id: string; error?: string }> }> {
  const ids = Array.from(new Set(enrolmentIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (ids.length === 0) return { checked: 0, failures: [] };
  const results = await refreshGrantsForEnrolments(ids);
  return {
    checked: ids.length,
    failures: results.filter((r) => !r.success).map((r) => ({ id: r.enrolmentId, error: r.error })),
  };
}

/** Re-read these SFC claims from TPG and store their current status. */
export async function refreshClaimStatuses(claimIds: string[]): Promise<{ checked: number; changed: number; failures: Array<{ id: string; error?: string }> }> {
  const ids = Array.from(new Set(claimIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (ids.length === 0) return { checked: 0, changed: 0, failures: [] };
  await ensureClaimCheckedColumn();

  const rows = (await pool.query(
    `SELECT claim_id::text AS claim_id, individual_nric::text AS nric, claim_status::text AS claim_status
       FROM public.ssg_claims WHERE claim_id = ANY($1::text[])`,
    [ids]
  )).rows as Array<{ claim_id: string; nric: string | null; claim_status: string | null }>;

  const failures: Array<{ id: string; error?: string }> = [];
  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, SFC_CLAIMS_SSG_APP);
  if (!credentials?.encryptionKey || !credentials.certificateContent || !credentials.privateKeyContent) {
    return { checked: 0, changed: 0, failures: rows.map((r) => ({ id: r.claim_id, error: `SSG ${SFC_CLAIMS_SSG_APP} credentials not configured` })) };
  }
  const base = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const key = Buffer.from(credentials.encryptionKey, 'base64');
  const iv = Buffer.from('SSGAPIInitVector', 'utf8');

  let checked = 0;
  let changed = 0;
  for (const row of rows) {
    if (!row.nric) {
      failures.push({ id: row.claim_id, error: 'No NRIC stored for this claim' });
      continue;
    }
    try {
      const req = new HTTPRequestBuilder()
        .withEndpoint(base, `/skillsFutureCredits/claims/${encodeURIComponent(row.claim_id)}`)
        .withMethod(HttpMethod.GET)
        .withHeader('x-api-version', 'v2')
        .withParam('nric', row.nric)
        .withCertificate(credentials.certificateContent, credentials.privateKeyContent)
        .build();
      const res = await new HttpClient(base, { Accept: 'application/json' }).request(req);
      if (res.status !== 200) throw new Error(`TPG returned ${res.status}`);
      let body: any = res.data;
      if (typeof body === 'string') {
        const de = crypto.createDecipheriv('aes-256-cbc', key, iv);
        body = JSON.parse(de.update(body, 'base64', 'utf8') + de.final('utf8'));
      }
      const claim = body?.data?.claim ?? {};
      const status = String(claim.status ?? '').trim();
      if (!status) throw new Error('TPG returned no claim status');
      const amount = Number(claim.amount);
      await pool.query(
        `UPDATE public.ssg_claims
            SET claim_status = $2,
                claim_amount = COALESCE($3, claim_amount),
                tpg_checked_at = now()
          WHERE claim_id = $1`,
        [row.claim_id, status, Number.isFinite(amount) ? amount : null]
      );
      checked++;
      if (status !== row.claim_status) changed++;
    } catch (e) {
      failures.push({ id: row.claim_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { checked, changed, failures };
}

async function runNow(grantBatch: number, claimBatch: number): Promise<TpgStatusRefreshResult> {
  await ensureClaimCheckedColumn();

  const grantEnr = (await pool.query(
    `SELECT enrollment_id
       FROM public.ssg_grants
      WHERE enrollment_id IS NOT NULL
        AND COALESCE(status, '') <> ALL($2::text[])
      GROUP BY enrollment_id
     HAVING MIN(imported_at) < now() - make_interval(hours => $3)
      ORDER BY MIN(imported_at)
      LIMIT $1`,
    [grantBatch, GRANT_FINAL_STATUSES, RECHECK_AFTER_HOURS]
  )).rows.map((r: { enrollment_id: string }) => r.enrollment_id);

  const claimIds = (await pool.query(
    `SELECT claim_id
       FROM public.ssg_claims
      WHERE claim_id IS NOT NULL AND individual_nric IS NOT NULL
        AND LOWER(COALESCE(claim_status, '')) <> ALL($2::text[])
        AND (tpg_checked_at IS NULL OR tpg_checked_at < now() - make_interval(hours => $3))
      ORDER BY tpg_checked_at NULLS FIRST, claim_id DESC
      LIMIT $1`,
    [claimBatch, CLAIM_FINAL_STATUSES, RECHECK_AFTER_HOURS]
  )).rows.map((r: { claim_id: string }) => r.claim_id);

  const g = await refreshGrantStatuses(grantEnr);
  const c = await refreshClaimStatuses(claimIds);
  const failures = [...g.failures, ...c.failures];
  if (grantEnr.length || claimIds.length) {
    console.log(
      `[tpgStatusRefresh] grants: ${g.checked} enrolment(s), ${g.failures.length} failed | claims: ${c.checked} checked, ${c.changed} changed, ${c.failures.length} failed`
    );
  }
  return {
    success: failures.length === 0,
    grants: { enrolmentsChecked: g.checked, failed: g.failures.length },
    claims: { checked: c.checked, changed: c.changed, failed: c.failures.length },
    failures,
  };
}

const state = globalThis as unknown as { __tpgStatusRefreshRunning?: Promise<TpgStatusRefreshResult> };

/** Scheduled batch. One run at a time per process; a call while one is running waits for it. */
export function refreshTpgStatuses(grantBatch = TPG_REFRESH_GRANT_BATCH, claimBatch = TPG_REFRESH_CLAIM_BATCH): Promise<TpgStatusRefreshResult> {
  if (state.__tpgStatusRefreshRunning) return state.__tpgStatusRefreshRunning;
  state.__tpgStatusRefreshRunning = runNow(grantBatch, claimBatch).finally(() => {
    state.__tpgStatusRefreshRunning = undefined;
  });
  return state.__tpgStatusRefreshRunning;
}
