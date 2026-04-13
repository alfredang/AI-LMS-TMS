import type { NextApiRequest, NextApiResponse } from 'next';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import pool from '../../../lib/db';

/**
 * Verify that a Google Drive file still exists.
 * If permanently deleted, clears the URL from the enrollment record.
 *
 * GET /api/billing/verify-drive?url=<driveUrl>&enrollmentId=<uuid>
 * Returns { valid: true } or { valid: false }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, enrollmentId } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ valid: false });
  }

  // Extract file ID from Drive URL (e.g. /file/d/FILE_ID/view)
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    return res.status(200).json({ valid: false });
  }

  const fileId = match[1];

  try {
    const drive = await getDriveClient();
    await drive.files.get({ fileId, fields: 'id' });
    return res.status(200).json({ valid: true });
  } catch (err: any) {
    // 404 = file not found (permanently deleted)
    if (err.code === 404) {
      // Clear the dead URL from the enrollment record
      if (enrollmentId && typeof enrollmentId === 'string') {
        await pool.query('UPDATE enrollment SET pro_forma_url = NULL WHERE id = $1', [enrollmentId]);
        console.log(`[verify-drive] Cleared dead URL for enrollment ${enrollmentId}`);
      }
      return res.status(200).json({ valid: false });
    }
    console.error('[verify-drive] Error checking file:', err.message);
    // If we can't verify (auth error etc), assume valid to avoid unnecessary regeneration
    return res.status(200).json({ valid: true });
  }
}
