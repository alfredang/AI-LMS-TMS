import { createHash } from 'crypto';
import type { Pool } from 'pg';

/** Session locks MUST use one pinned connection, including the unlock. */
export async function withDaLock<T>(db: Pool, key: string, work: () => Promise<T>): Promise<T | null> {
  const client = await db.connect();
  const lock = createHash('sha256').update(`da:${key}`).digest().readInt32BE(0);
  let acquired = false;
  let destroy = false;
  try {
    acquired = (await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [lock])).rows[0].acquired;
    return acquired ? await work() : null;
  } finally {
    if (acquired) {
      try { await client.query('SELECT pg_advisory_unlock($1)', [lock]); }
      catch { destroy = true; }
    }
    client.release(destroy);
  }
}
