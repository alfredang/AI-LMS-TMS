import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const r = await pool.query(
    `SELECT key_value FROM training_provider_api WHERE key_name = 'GOOGLE_DRIVE_INVOICES_FOLDER_ID' LIMIT 1`
  );
  const folderId = r.rows[0]?.key_value?.trim()
    || process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID
    || '1hBhu-Mr9HPUFdjpbZhN1GrwZBTWns_WK';

  return res.status(200).json({ folderUrl: `https://drive.google.com/drive/folders/${folderId}` });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
