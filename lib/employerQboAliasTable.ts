import pool from './db';

let ensurePromise: Promise<void> | null = null;

/**
 * Tiny lookup table that maps an employer UEN (as it appears in the Excel)
 * to the exact `DisplayName` of the matching customer in QuickBooks.
 *
 * Used by the Company Application invoice generator when the Excel's
 * `employer_org_name` doesn't match any QBO customer record (e.g. Excel says
 * "NUP" but QBO has "National University Polyclinics"). Admin populates one
 * row per awkward employer; the matcher hits this map before any QBO query.
 */
export function ensureEmployerQboAliasTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.employer_qbo_alias (
          employer_uen     text PRIMARY KEY,
          qbo_display_name text NOT NULL,
          note             text,
          created_at       timestamptz NOT NULL DEFAULT now(),
          updated_at       timestamptz NOT NULL DEFAULT now()
        )
      `);
    })();
  }
  return ensurePromise;
}

/**
 * Idempotent upsert used by the fuzzy auto-matcher to record a successful
 * UEN → QBO DisplayName resolution. Subsequent invoice runs hit the alias
 * table first and skip the QBO customer scan entirely.
 */
export async function upsertEmployerQboAlias(opts: {
  employerUen: string;
  qboDisplayName: string;
  note?: string | null;
}): Promise<void> {
  const uen = String(opts.employerUen || '').trim();
  const displayName = String(opts.qboDisplayName || '').trim();
  if (!uen || !displayName) return;
  await ensureEmployerQboAliasTable();
  await pool.query(
    `INSERT INTO public.employer_qbo_alias (employer_uen, qbo_display_name, note)
          VALUES ($1, $2, $3)
     ON CONFLICT (employer_uen) DO UPDATE SET
       qbo_display_name = EXCLUDED.qbo_display_name,
       note             = EXCLUDED.note,
       updated_at       = now()`,
    [uen, displayName, opts.note ? String(opts.note).trim() : null]
  );
}

export async function findEmployerQboDisplayNameByUen(uen: string): Promise<string | null> {
  const trimmed = (uen || '').trim();
  if (!trimmed) return null;
  await ensureEmployerQboAliasTable();
  const r = await pool.query(
    `SELECT qbo_display_name
       FROM public.employer_qbo_alias
      WHERE LOWER(TRIM(employer_uen)) = LOWER(TRIM($1))
      LIMIT 1`,
    [trimmed]
  );
  const name = r.rows[0]?.qbo_display_name;
  return name ? String(name).trim() : null;
}
