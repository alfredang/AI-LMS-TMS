import crypto from 'crypto';
import pool from '../db';

/**
 * DB-backed opaque session tokens.
 *
 * The raw token (returned to the client once, at login) is `lms_` + 64 hex
 * chars of CSPRNG output. Only its SHA-256 hash is stored, so a DB read can
 * never be replayed as a live credential. Legacy `mock-jwt-token-<id>`
 * values are rejected everywhere — they were forgeable by construction.
 */

const SESSION_TTL_DAYS = 30;
export const SESSION_TOKEN_PREFIX = 'lms_';

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function createSession(userId: string): Promise<string> {
  const rawToken = SESSION_TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO user_session (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [userId, hashSessionToken(rawToken), String(SESSION_TTL_DAYS)]
  );
  return rawToken;
}

export async function revokeSession(rawToken: string): Promise<void> {
  await pool.query(`DELETE FROM user_session WHERE token_hash = $1`, [
    hashSessionToken(rawToken),
  ]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await pool.query(`DELETE FROM user_session WHERE user_id = $1`, [userId]);
}

/** Opportunistic cleanup of expired rows; callers fire-and-forget. */
export function pruneExpiredSessions(): void {
  pool
    .query(`DELETE FROM user_session WHERE expires_at < now() - interval '7 days'`)
    .catch(() => {});
}
