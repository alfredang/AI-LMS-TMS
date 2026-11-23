import type { Pool, QueryResult } from 'pg';

/**
 * Runtime schema guards that never queue the site behind a lock.
 *
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (and `CREATE INDEX IF NOT EXISTS`) take their table lock
 * BEFORE checking whether there is anything to do. ALTER's ACCESS EXCLUSIVE lock waits for every
 * running query on the table, and every later query then waits behind the ALTER. On 2026-11-23 a
 * 9-minute Consolidated Finance read on ssg_claims / da_application held a Bulk SFC upload at
 * "Reading file" with 30 sessions queued behind it.
 *
 * So: look in the catalog first and only touch the table when something is really missing; when
 * it is, give up after LOCK_TIMEOUT_MS instead of waiting (the next call retries).
 *
 * Table / column / index names are code constants, never user input; they are checked against
 * IDENT before being placed in DDL.
 */

const LOCK_TIMEOUT_MS = 5000;
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`dbSchemaGuard: invalid identifier "${name}"`);
  return name;
}

/** Add the columns of `table` (public schema) that do not exist yet. `columns`: name → type + defaults DDL. */
export async function ensureColumns(db: Pool, table: string, columns: Record<string, string>): Promise<void> {
  const names = Object.keys(columns).map(ident);
  const found: QueryResult<{ column_name: string }> = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])`,
    [ident(table), names]
  );
  const have = new Set(found.rows.map((r) => r.column_name));
  const missing = names.filter((n) => !have.has(n));
  if (missing.length === 0) return;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await client.query(`ALTER TABLE public.${table} ${missing.map((n) => `ADD COLUMN IF NOT EXISTS ${n} ${columns[n]}`).join(', ')}`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Create an index if no valid index of that name exists. `createSql` is the full CREATE INDEX
 * statement. A plain build blocks writes, so it gets the lock timeout. A CONCURRENTLY build blocks
 * neither reads nor writes but must wait for transactions already running on the table, so it gets
 * no lock timeout (run it in the background); one that failed earlier leaves an INVALID index
 * behind, which is dropped and rebuilt.
 */
export async function ensureIndex(db: Pool, indexName: string, createSql: string): Promise<void> {
  const r: QueryResult<{ valid: boolean }> = await db.query(
    `SELECT i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [ident(indexName)]
  );
  if (r.rows[0]?.valid) return;

  const concurrently = /\bCONCURRENTLY\b/i.test(createSql);
  const client = await db.connect();
  try {
    if (concurrently) {
      if (r.rows.length > 0) await client.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${indexName}`);
      await client.query(createSql);
    } else {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      await client.query(createSql);
      await client.query('COMMIT');
    }
  } catch (e) {
    if (!concurrently) await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** pg error code for "canceling statement due to statement timeout". */
export const STATEMENT_TIMEOUT_CODE = '57014';

/**
 * Run one read query with a server-side statement_timeout, so a slow page view cannot hold its
 * table locks for minutes (which is what queued the ALTERs above).
 */
export async function queryWithTimeout<T extends Record<string, any> = any>(
  db: Pool,
  sql: string,
  params: unknown[],
  timeoutMs: number
): Promise<QueryResult<T>> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(timeoutMs))}`);
    const result = await client.query<T>(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
