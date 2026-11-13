import pool from './db';

// Where class documents (e.g. files a trainer attaches to an Announcement) are
// stored, per the company's preference in Company Setting → Integration:
//   - 'onedrive'     when Microsoft OneDrive is switched on and Google Drive is off
//   - 'google_drive' otherwise (the default, and the only provider wired up today)
// Documents are never kept on the app server's own disk.

export type DocumentStorageProvider = 'google_drive' | 'onedrive';

export async function getDocumentStorageProvider(): Promise<DocumentStorageProvider> {
  try {
    const r = await pool.query(
      `SELECT integrate_google_drive, integrate_ms_onedrive
         FROM training_provider
        ORDER BY created_at ASC NULLS LAST
        LIMIT 1`,
    );
    const row = r.rows[0];
    if (row?.integrate_ms_onedrive && !row?.integrate_google_drive) return 'onedrive';
  } catch {
    // Columns may not exist on a fresh schema; fall back to the default.
  }
  return 'google_drive';
}
