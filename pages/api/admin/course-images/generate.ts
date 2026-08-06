import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import pool from '../../../../lib/db';
import { renderCourseImagePng } from '../../../../lib/courseImage/renderer';

const LOCAL_DIR = path.join(process.cwd(), 'public/uploads/course-banners');

export interface GenerateResult {
  id: string;
  title: string;
  status: 'ok' | 'failed';
  bytes?: number;
  local_url?: string;
  error?: string;
}

export const config = {
  api: { responseLimit: false, bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 300,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseIds } = req.body as { courseIds?: string[] };
  if (!Array.isArray(courseIds) || courseIds.length === 0) {
    return res.status(400).json({ error: 'courseIds (string[]) required' });
  }
  if (courseIds.length > 50) {
    return res.status(400).json({ error: 'Max 50 courses per batch — call in chunks' });
  }

  fs.mkdirSync(LOCAL_DIR, { recursive: true });

  const placeholders = courseIds.map((_, i) => `$${i + 1}`).join(',');
  const dbRes = await pool.query(
    `SELECT id, title FROM course WHERE id::text IN (${placeholders})`,
    courseIds,
  );
  const byId = new Map<string, { id: string; title: string }>(
    dbRes.rows.map((r) => [String(r.id), { id: String(r.id), title: r.title || '' }]),
  );

  const results: GenerateResult[] = [];
  for (const id of courseIds) {
    const course = byId.get(id);
    if (!course) {
      results.push({ id, title: '', status: 'failed', error: 'Course not found' });
      continue;
    }
    if (!course.title.trim()) {
      results.push({ id, title: '', status: 'failed', error: 'Course has no title' });
      continue;
    }
    try {
      const png = await renderCourseImagePng(course.title);
      const filePath = path.join(LOCAL_DIR, `${id}.png`);
      fs.writeFileSync(filePath, png);
      results.push({
        id,
        title: course.title,
        status: 'ok',
        bytes: png.length,
        local_url: `/uploads/course-banners/${id}.png?t=${Date.now()}`,
      });
    } catch (err) {
      console.error(`[course-images/generate] failed for ${id}:`, err);
      results.push({ id, title: course.title, status: 'failed', error: String(err) });
    }
  }

  return res.status(200).json({ results });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
