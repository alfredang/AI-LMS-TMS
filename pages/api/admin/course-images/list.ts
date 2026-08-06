import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import pool from '../../../../lib/db';

const LOCAL_DIR = path.join(process.cwd(), 'public/uploads/course-banners');

export interface CourseImageRow {
  id: string;
  course_code: string | null;
  title: string;
  image_url: string | null;
  has_local: boolean;
  local_url: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await pool.query(`
      SELECT id, course_code, title, image_url
      FROM course
      WHERE title IS NOT NULL AND title <> ''
      ORDER BY course_code NULLS LAST, title
    `);

    let localFiles: Set<string> = new Set();
    if (fs.existsSync(LOCAL_DIR)) {
      localFiles = new Set(fs.readdirSync(LOCAL_DIR));
    }

    const rows: CourseImageRow[] = result.rows.map((r) => {
      const localFile = `${r.id}.png`;
      const hasLocal = localFiles.has(localFile);
      return {
        id: r.id,
        course_code: r.course_code,
        title: r.title,
        image_url: r.image_url,
        has_local: hasLocal,
        local_url: hasLocal ? `/uploads/course-banners/${localFile}?t=${Date.now()}` : null,
      };
    });

    return res.status(200).json({ courses: rows, total: rows.length });
  } catch (err) {
    console.error('[course-images/list] error:', err);
    return res.status(500).json({ error: 'Failed to list courses', detail: String(err) });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
