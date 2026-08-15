import type { PoolClient } from 'pg';
import pool from '../db';

// Bill No (QuickBooks reference) for trainer payouts.
//
// Format — carried over from the legacy payroll spreadsheet's "QB REF Nos"
// column so the two reconcile 1:1:
//
//   TX + YYMMDD + NN
//   TX 26 03 06 05  =  a class dated 6 Mar 2026, 5th bill raised for that day
//
// The date part is the CLASS start date (first class date for a multi-date
// non-WSQ class), not the payment date — same as the spreadsheet, where the
// leading column is the class date.
//
// The suffix is a per-day sequence shared across BOTH payout tables
// (trainer_payout for WSQ, payroll_manual_class for non-WSQ), so one day's
// bills form a single continuous run regardless of which table the class
// lives in.

export const BILL_NO_PREFIX = 'TX';

// Fixed namespace id for payroll bill-number advisory locks (arbitrary, but
// must stay stable and fit in int4 so it can't collide with other lock keys).
export const BILL_NO_LOCK_NAMESPACE = 741_001;

/** TX + 6 digits (YYMMDD) + 2-or-more digits of sequence. */
export const BILL_NO_RE = /^TX\d{6}\d{2,}$/;

/** The day part (TX + YYMMDD) for a YYYY-MM-DD date, or null if unusable. */
export function billNoDayPrefix(date: string | null | undefined): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  return `${BILL_NO_PREFIX}${yyyy.slice(2)}${mm}${dd}`;
}

/**
 * Validate/normalize a user-supplied bill number.
 * Returns { ok: true, value } (value === null clears it) or { ok: false, error }.
 */
export function normalizeBillNo(raw: any): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  const v = String(raw).trim().toUpperCase();
  if (v.length > 32) return { ok: false, error: 'bill_no must be 32 characters or fewer' };
  // Deliberately permissive beyond the canonical shape: legacy/adjusted refs
  // (suffixes, letters) must still be pasteable. Reject only control chars.
  if (/[\x00-\x1f]/.test(v)) return { ok: false, error: 'bill_no contains invalid characters' };
  return { ok: true, value: v };
}

/**
 * Allocate the next unused bill number for a class date.
 *
 * Scans BOTH payout tables for refs already issued on that day and returns
 * dayPrefix + (max suffix + 1), zero-padded to 2 digits (3+ digits if a day
 * ever exceeds 99 bills). Returns null when the date is missing/unparseable —
 * callers treat that as "leave bill_no unset" rather than inventing a date.
 *
 * `floor` raises the starting point when a number is known to be taken
 * somewhere these two tables can't see — specifically QuickBooks, where Finance
 * raises bills by hand. Defaults to 0, i.e. the tables alone decide.
 *
 * Pass the transaction's client so the read participates in the caller's
 * transaction; the caller is responsible for serializing concurrent issues
 * (see acquireBillNoLock).
 */
export async function nextBillNo(
  client: PoolClient | typeof pool,
  classDate: string | null | undefined,
  floor = 0
): Promise<string | null> {
  const day = billNoDayPrefix(classDate);
  if (!day) return null;

  // Suffix = everything after the TXYYMMDD prefix. Compare numerically so
  // "TX260306100" sorts above "TX26030699".
  const r = await client.query(
    `SELECT GREATEST(COALESCE(MAX(suffix), 0), $2::bigint)::int AS max_suffix
       FROM (
         SELECT NULLIF(regexp_replace(substring(bill_no FROM 9), '\\D', '', 'g'), '')::bigint AS suffix
           FROM trainer_payout
          WHERE bill_no LIKE $1 || '%'
         UNION ALL
         SELECT NULLIF(regexp_replace(substring(bill_no FROM 9), '\\D', '', 'g'), '')::bigint AS suffix
           FROM payroll_manual_class
          WHERE bill_no LIKE $1 || '%'
       ) s`,
    [day, Math.max(0, Math.floor(Number(floor) || 0))]
  );
  const next = (Number(r.rows[0]?.max_suffix) || 0) + 1;
  return `${day}${String(next).padStart(2, '0')}`;
}

/**
 * Serialize bill-number issuance for one day across concurrent requests.
 *
 * nextBillNo reads the current max and the caller then writes max+1 — a
 * read-modify-write that two simultaneous "mark as paid" clicks would both win,
 * producing a duplicate (and, with the unique index, a failed save). A
 * transaction-scoped advisory lock makes the pair atomic; it releases
 * automatically on COMMIT/ROLLBACK.
 *
 * One GLOBAL key (namespace, 0) — not per-day — because bulk materialization
 * and the backfill number many days in one statement under this same key; a
 * per-day key would not exclude them. Issuance volume is tiny, so global
 * serialization costs nothing.
 */
export async function acquireBillNoLock(client: PoolClient, classDate: string | null | undefined): Promise<void> {
  if (!billNoDayPrefix(classDate)) return; // no date → nothing will be issued
  await client.query(`SELECT pg_advisory_xact_lock($1, 0)`, [BILL_NO_LOCK_NAMESPACE]);
}

// One-shot chronological backfill: number every existing payout that has a class
// date but no ref yet, oldest-first, restarting the NN sequence per day and
// continuing past any suffix already used that day. Mirrors
// database/migrations/backfill_payroll_bill_no.sql (kept for manual/tenant use);
// running it here means prod is covered by deploy alone — this project has no
// migration runner (db:migrate's script doesn't exist; runtime ensure* is the
// pattern). Idempotent: rows with a bill_no are never touched, so after the
// first pass this finds nothing to do.
const BACKFILL_SQL = `
WITH
unnumbered AS (
    SELECT 'wsq'::text AS src, tp.id, cr.start_date AS class_date,
           COALESCE(c.course_code, '') AS sort_a, COALESCE(cr.course_run_id, '') AS sort_b
      FROM trainer_payout tp
      JOIN course_run cr ON cr.id = tp.course_run_id
      LEFT JOIN course c ON c.id = cr.course_id
     WHERE tp.bill_no IS NULL AND cr.start_date IS NOT NULL
    UNION ALL
    SELECT 'manual', pmc.id, pmc.start_date,
           COALESCE(pmc.course_code, ''), COALESCE(pmc.class_title, '')
      FROM payroll_manual_class pmc
     WHERE pmc.bill_no IS NULL AND pmc.start_date IS NOT NULL
),
used AS (
    SELECT day_prefix, MAX(suffix) AS max_suffix FROM (
      SELECT substring(bill_no FROM 1 FOR 8) AS day_prefix,
             NULLIF(regexp_replace(substring(bill_no FROM 9), '\\D', '', 'g'), '')::bigint AS suffix
        FROM trainer_payout WHERE bill_no IS NOT NULL
      UNION ALL
      SELECT substring(bill_no FROM 1 FOR 8),
             NULLIF(regexp_replace(substring(bill_no FROM 9), '\\D', '', 'g'), '')::bigint
        FROM payroll_manual_class WHERE bill_no IS NOT NULL
    ) x GROUP BY day_prefix
),
numbered AS (
    SELECT u.src, u.id,
           'TX' || to_char(u.class_date, 'YYMMDD')
                || lpad((COALESCE(d.max_suffix, 0)
                         + row_number() OVER (PARTITION BY u.class_date
                                              ORDER BY u.sort_a, u.sort_b, u.id))::text, 2, '0') AS bill_no
      FROM unnumbered u
      LEFT JOIN used d ON d.day_prefix = 'TX' || to_char(u.class_date, 'YYMMDD')
),
upd_wsq AS (
    UPDATE trainer_payout t SET bill_no = n.bill_no
      FROM numbered n WHERE n.src = 'wsq' AND t.id = n.id
    RETURNING 1
)
UPDATE payroll_manual_class m SET bill_no = n.bill_no
  FROM numbered n WHERE n.src = 'manual' AND m.id = n.id
`;

// Idempotently ensure the bill_no columns exist and history is numbered,
// memoized so the ALTERs + backfill run at most ONCE per process (same
// pattern as ensureClassDatesColumn).
let ensured: Promise<void> | null = null;

export function ensureBillNoColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await pool.query(`ALTER TABLE public.trainer_payout ADD COLUMN IF NOT EXISTS bill_no TEXT`);
      await pool.query(`ALTER TABLE public.payroll_manual_class ADD COLUMN IF NOT EXISTS bill_no TEXT`);
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_payout_bill_no
           ON public.trainer_payout(bill_no) WHERE bill_no IS NOT NULL`
      );
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_manual_class_bill_no
           ON public.payroll_manual_class(bill_no) WHERE bill_no IS NOT NULL`
      );
      // Backfill under the global bill-number lock so it can't race a
      // concurrent issue on another instance/request.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock($1, 0)`, [BILL_NO_LOCK_NAMESPACE]);
        await client.query(BACKFILL_SQL);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    })()
      .then(() => undefined)
      .catch((err) => {
        ensured = null; // allow a retry on the next request
        console.warn('[payroll] ensureBillNoColumn failed:', err instanceof Error ? err.message : err);
      });
  }
  return ensured;
}
