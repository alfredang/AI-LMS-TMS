import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import pool from '../../../../lib/db';
import { uploadToR2, isR2Configured } from '../../../../lib/r2';

const LOCAL_DIR = path.join(process.cwd(), 'public/uploads/course-banners');

export interface SyncResult {
  id: string;
  status: 'ok' | 'failed' | 'skipped';
  r2_url?: string;
  error?: string;
}

export const config = {
  api: { responseLimit: false, bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 300,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isR2Configured()) {
    return res.status(500).json({
      error: 'R2 not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL in .env.local',
    });
  }

  const { courseIds } = req.body as { courseIds?: string[] };
  if (!Array.isArray(courseIds) || courseIds.length === 0) {
    return res.status(400).json({ error: 'courseIds (string[]) required' });
  }
  if (courseIds.length > 50) {
    return res.status(400).json({ error: 'Max 50 courses per batch — call in chunks' });
  }

  const results: SyncResult[] = [];
  for (const id of courseIds) {
    const filePath = path.join(LOCAL_DIR, `${id}.png`);
    if (!fs.existsSync(filePath)) {
      results.push({ id, status: 'skipped', error: 'No local file — generate first' });
      continue;
    }
    try {
      const buf = fs.readFileSync(filePath);
      const key = `course-banners/${id}.png`;
      const r2Url = await uploadToR2(key, buf, 'image/png');
      await pool.query('UPDATE course SET image_url = $1 WHERE id = $2', [r2Url, id]);
      results.push({ id, status: 'ok', r2_url: r2Url });
    } catch (err) {
      console.error(`[course-images/sync-r2] failed for ${id}:`, err);
      results.push({ id, status: 'failed', error: String(err) });
    }
  }

  return res.status(200).json({ results });
}
