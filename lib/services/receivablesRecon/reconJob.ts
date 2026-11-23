import pool from '@/lib/db';
import { attachAttendance, cancelledEnrolmentIds, computeOverdueBreakdown, LiveEnrolmentStatus, OverdueBreakdown } from './overdueBreakdown';
import { fetchTpgAttendance, TpgAttendance } from './tpgAttendance';
import { refreshClaimStatuses, refreshGrantStatuses } from '@/lib/services/tpgStatusRefresh';
import { createSSGEnrolmentAPI } from '@/lib/ssg/api/enrolment-api';
import { getSSGCredentialsService } from '@/lib/ssg/services/credentials-service';

/**
 * Background runner + snapshot store for Receivables Reconciliation.
 *
 * A full refresh reads several thousand QuickBooks records (and, with TPG, one TPG call per
 * enrolment / claim), which is far longer than a request should be held open. So a refresh runs
 * in the background in this process (one at a time), reports progress, and saves its result as a
 * snapshot; the page shows the latest snapshot and polls while a refresh is running. Snapshots
 * also keep the overdue history, so the trend can be shown.
 */

export type ReconJobKind = 'quickbooks' | 'tpg';

export interface ReconJobState {
  running: boolean;
  kind: ReconJobKind | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  error: string | null;
}

const KEEP_SNAPSHOTS = 90;
const TPG_BATCH = 20;
const ENROLMENT_RATE_LIMIT_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type JobGlobal = typeof globalThis & { __receivablesReconJob?: ReconJobState };
const g = globalThis as JobGlobal;
const state = (): ReconJobState =>
  (g.__receivablesReconJob ??= { running: false, kind: null, startedAt: null, finishedAt: null, message: '', error: null });

let schemaReady = false;
export async function ensureReceivablesReconSchema(): Promise<void> {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.receivables_recon_snapshot (
      id serial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      kind text NOT NULL DEFAULT 'quickbooks',
      overdue_total numeric(14,2) NOT NULL,
      invoice_count int NOT NULL,
      result jsonb NOT NULL
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_receivables_recon_snapshot_created ON public.receivables_recon_snapshot(created_at DESC)`);
  schemaReady = true;
}

export function getReconJobState(): ReconJobState {
  return { ...state() };
}

export async function getLatestSnapshot(): Promise<{ id: number; createdAt: string; kind: string; result: OverdueBreakdown } | null> {
  await ensureReceivablesReconSchema();
  const r = await pool.query(`SELECT id, created_at, kind, result FROM public.receivables_recon_snapshot ORDER BY created_at DESC LIMIT 1`);
  if (!r.rows.length) return null;
  return { id: r.rows[0].id, createdAt: new Date(r.rows[0].created_at).toISOString(), kind: r.rows[0].kind, result: r.rows[0].result };
}

export async function getSnapshotHistory(limit = 30): Promise<Array<{ createdAt: string; overdueTotal: number; invoiceCount: number }>> {
  await ensureReceivablesReconSchema();
  const r = await pool.query(
    `SELECT created_at, overdue_total, invoice_count FROM public.receivables_recon_snapshot ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows.map((x) => ({ createdAt: new Date(x.created_at).toISOString(), overdueTotal: Number(x.overdue_total), invoiceCount: x.invoice_count }));
}

async function saveSnapshot(result: OverdueBreakdown, kind: ReconJobKind, userId: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO public.receivables_recon_snapshot (created_by, kind, overdue_total, invoice_count, result) VALUES ($1, $2, $3, $4, $5)`,
    [userId, kind, result.overdueTotal, result.invoiceCount, JSON.stringify(result)]
  );
  await pool.query(
    `DELETE FROM public.receivables_recon_snapshot WHERE id NOT IN (SELECT id FROM public.receivables_recon_snapshot ORDER BY created_at DESC LIMIT $1)`,
    [KEEP_SNAPSHOTS]
  );
}

/**
 * Re-read from TPG, for the overdue invoices of the latest snapshot: the grants / SFC claims (stored
 * into ssg_grants / ssg_claims by tpgStatusRefresh) and every enrolment's current status (kept only
 * in the snapshot — the shared enrolment tables are left to their own sync jobs).
 */
async function refreshTpgForOverdue(setMessage: (m: string) => void): Promise<LiveEnrolmentStatus> {
  const latest = await getLatestSnapshot();
  const live: LiveEnrolmentStatus = { ...(latest?.result.liveEnrolmentStatus ?? {}) };
  if (!latest) return live;
  const tpgRows = latest.result.rows.filter((r) => r.source === 'grn' || r.source === 'sfc_ca' || r.source === 'sfc_tc');
  const enrolments = [...new Set(tpgRows.filter((r) => r.source === 'grn').flatMap((r) => r.enrolmentIds))];
  const claims = [...new Set(tpgRows.flatMap((r) => r.claimIds))];
  let failed = 0;
  for (let i = 0; i < enrolments.length; i += TPG_BATCH) {
    setMessage(`Checking grants on TPG… ${Math.min(i + TPG_BATCH, enrolments.length)} / ${enrolments.length} enrolments`);
    failed += (await refreshGrantStatuses(enrolments.slice(i, i + TPG_BATCH))).failures.length;
  }
  for (let i = 0; i < claims.length; i += TPG_BATCH) {
    setMessage(`Checking SFC claims on TPG… ${Math.min(i + TPG_BATCH, claims.length)} / ${claims.length} claims`);
    failed += (await refreshClaimStatuses(claims.slice(i, i + TPG_BATCH))).failures.length;
  }

  const allEnrolments = [...new Set(latest.result.rows.flatMap((r) => r.enrolmentIds))].filter(
    (e) => !/CANCEL|WITHDRAW|REMOVED/i.test(live[e]?.status || '')
  );
  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, undefined);
  if (credentials) {
    const api = createSSGEnrolmentAPI(credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg', credentials);
    for (let i = 0; i < allEnrolments.length; i++) {
      if (i % 10 === 0) setMessage(`Checking enrolment status on TPG… ${i} / ${allEnrolments.length}`);
      try {
        const result = await api.viewEnrolment(allEnrolments[i]);
        const rec = (result?.data as any)?.enrolment ?? result?.data;
        if (!result?.error && rec?.status) live[allEnrolments[i]] = { status: String(rec.status), checkedAt: new Date().toISOString() };
        else failed++;
      } catch {
        failed++;
      }
      await sleep(ENROLMENT_RATE_LIMIT_MS);
    }
  }
  if (failed) console.warn(`[receivables-recon] TPG refresh: ${failed} lookups failed (kept their previous status)`);
  return live;
}

/** Start a refresh in the background. Returns false if one is already running. */
export function startReconJob(kind: ReconJobKind, userId: string | null): boolean {
  const s = state();
  if (s.running) return false;
  Object.assign(s, { running: true, kind, startedAt: new Date().toISOString(), finishedAt: null, message: 'Starting…', error: null });
  const setMessage = (m: string) => {
    s.message = m;
  };
  void (async () => {
    try {
      await ensureReceivablesReconSchema();
      const previous = (await getLatestSnapshot())?.result;
      const live = kind === 'tpg' ? await refreshTpgForOverdue(setMessage) : previous?.liveEnrolmentStatus ?? {};
      const result = await computeOverdueBreakdown(setMessage, live);

      // TPG attendance for the cancelled rows: a TPG check re-reads all of them; a plain refresh
      // only reads enrolments that were never checked, so it stays quick.
      const attendance: Record<string, TpgAttendance> = { ...(previous?.tpgAttendance ?? {}) };
      const cancelled = cancelledEnrolmentIds(result);
      const toCheck = kind === 'tpg' ? cancelled : cancelled.filter((e) => !attendance[e]);
      if (toCheck.length) {
        try {
          Object.assign(attendance, await fetchTpgAttendance(toCheck, (d, t) => setMessage(`Checking TPG attendance… ${d} / ${t} cancelled enrolments`)));
        } catch (e) {
          console.warn('[receivables-recon] TPG attendance check failed:', e instanceof Error ? e.message : e);
        }
      }
      attachAttendance(result, attendance);
      setMessage('Saving…');
      await saveSnapshot(result, kind, userId);
      s.message = 'Done';
    } catch (e) {
      console.error('[receivables-recon] refresh failed', e);
      s.error = e instanceof Error ? e.message : String(e);
      s.message = 'Failed';
    } finally {
      s.running = false;
      s.finishedAt = new Date().toISOString();
    }
  })();
  return true;
}
