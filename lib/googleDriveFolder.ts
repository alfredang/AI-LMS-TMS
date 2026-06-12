import pool from './db';

// Source of truth for the Google Drive root folder ID (used as the parent for
// trainer photos, class summaries, assessment uploads, etc.).
//
// Resolution order:
//   1. training_provider.google_drive_folder_id (DB, settable via Company
//      Setting → Google Integration)
//   2. process.env.GOOGLE_DRIVE_FOLDER_ID (Coolify env, retained for the
//      transition window until the value is saved in the DB)
//
// 60s in-memory cache. Call invalidateGoogleDriveFolderCache() after a save
// so the new value takes effect immediately instead of waiting for the TTL.

interface CachedValue {
  value: string;
  expiresAt: number;
}

let cached: CachedValue | null = null;
const CACHE_TTL_MS = 60_000;

export async function getGoogleDriveFolderId(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let dbValue = '';
  try {
    const r = await pool.query(
      `SELECT google_drive_folder_id
         FROM training_provider
        ORDER BY created_at ASC NULLS LAST
        LIMIT 1`,
    );
    dbValue = (r.rows[0]?.google_drive_folder_id || '').trim();
  } catch {
    // Column may not exist yet on a fresh schema. Fall through to env.
  }

  const value = dbValue || (process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function invalidateGoogleDriveFolderCache(): void {
  cached = null;
}
