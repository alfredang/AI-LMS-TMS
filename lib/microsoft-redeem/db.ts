/**
 * Persistence for the Microsoft Certificate tool.
 *
 * Two pieces of state need to survive container redeploys (Coolify's
 * filesystem is ephemeral), so both live in Postgres rather than on disk
 * as the original Flask app did:
 *
 *   - microsoft_redeem_session — the Playwright `storageState` (Microsoft
 *     Learn auth cookies). Single-row table; replaces `storage_state.json`.
 *   - microsoft_redeem_code    — every generated achievement code, for
 *     record-keeping. Replaces `codes.csv`.
 *
 * Tables are created on first use via `ensureMsRedeemTables()` so the
 * feature works on a fresh database without a manual migration step. The
 * canonical definitions also live in `database/01-schema.sql`.
 */

import pool from '../db';

let tablesReady = false;

/** Create the redeem tables if they do not yet exist. Idempotent. */
export async function ensureMsRedeemTables(): Promise<void> {
  if (tablesReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.microsoft_redeem_session (
      id              integer PRIMARY KEY DEFAULT 1,
      storage_state   jsonb NOT NULL,
      signed_in_email text,
      updated_at      timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT microsoft_redeem_session_singleton CHECK (id = 1)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.microsoft_redeem_code (
      id            uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
      course_number text NOT NULL,
      course_title  text,
      code          text NOT NULL,
      url           text,
      students      integer NOT NULL DEFAULT 1,
      requested_by  uuid,
      created_at    timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_msredeem_code_course
       ON public.microsoft_redeem_code(course_number);`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_msredeem_code_created
       ON public.microsoft_redeem_code(created_at DESC);`,
  );

  tablesReady = true;
}

/** Playwright storage state — opaque cookie/origin bag. */
export type StorageState = Record<string, unknown>;

export interface StoredSession {
  storageState: StorageState;
  email: string | null;
  updatedAt: string;
}

/** Read the saved Microsoft Learn session, or null if never signed in. */
export async function getStoredSession(): Promise<StoredSession | null> {
  await ensureMsRedeemTables();
  const { rows } = await pool.query(
    `SELECT storage_state, signed_in_email, updated_at
       FROM public.microsoft_redeem_session
      WHERE id = 1`,
  );
  if (!rows.length) return null;
  return {
    storageState: rows[0].storage_state as StorageState,
    email: rows[0].signed_in_email ?? null,
    updatedAt: rows[0].updated_at,
  };
}

/** Upsert the Microsoft Learn session (overwrites any previous one). */
export async function saveSession(
  storageState: StorageState,
  email: string | null,
): Promise<void> {
  await ensureMsRedeemTables();
  await pool.query(
    `INSERT INTO public.microsoft_redeem_session (id, storage_state, signed_in_email, updated_at)
          VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE
            SET storage_state   = EXCLUDED.storage_state,
                signed_in_email = EXCLUDED.signed_in_email,
                updated_at      = now()`,
    [JSON.stringify(storageState), email],
  );
}

export interface CodeRow {
  courseNumber: string;
  courseTitle: string | null;
  code: string;
  url: string;
  students: number;
}

/** Append generated codes to the history table. */
export async function appendCodes(
  rows: CodeRow[],
  requestedBy: string | null,
): Promise<void> {
  if (!rows.length) return;
  await ensureMsRedeemTables();
  for (const r of rows) {
    await pool.query(
      `INSERT INTO public.microsoft_redeem_code
         (course_number, course_title, code, url, students, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.courseNumber, r.courseTitle, r.code, r.url, r.students, requestedBy],
    );
  }
}

export interface CodeHistoryEntry {
  id: string;
  courseNumber: string;
  courseTitle: string | null;
  code: string;
  url: string | null;
  students: number;
  createdAt: string;
}

/** Most-recent generated codes, newest first. */
export async function listCodes(limit = 50): Promise<CodeHistoryEntry[]> {
  await ensureMsRedeemTables();
  const { rows } = await pool.query(
    `SELECT id, course_number, course_title, code, url, students, created_at
       FROM public.microsoft_redeem_code
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r: any) => ({
    id: r.id,
    courseNumber: r.course_number,
    courseTitle: r.course_title,
    code: r.code,
    url: r.url,
    students: r.students,
    createdAt: r.created_at,
  }));
}
