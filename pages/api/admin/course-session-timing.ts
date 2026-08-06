import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * course_session_timing table — stores default session timings per course code.
 *
 * Day sessions:     session_1  … session_11  (start_time, end_time, mode_of_training)
 * Evening sessions: session_1_evening … session_3_evening
 *
 * GET  /api/admin/course-session-timing              → list all rows
 * GET  /api/admin/course-session-timing?courseCode=X → get single row
 * POST /api/admin/course-session-timing              → upsert row (body: { courseCode, ...fields })
 * DELETE /api/admin/course-session-timing?courseCode=X → delete row
 */

// ── Ensure table exists ───────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_session_timing (
      id                              SERIAL PRIMARY KEY,
      course_code                     TEXT UNIQUE NOT NULL,

      -- Day sessions 1-11
      session_1_start_time            TEXT,
      session_1_end_time              TEXT,
      session_1_mode_of_training      TEXT,

      session_2_start_time            TEXT,
      session_2_end_time              TEXT,
      session_2_mode_of_training      TEXT,

      session_3_start_time            TEXT,
      session_3_end_time              TEXT,
      session_3_mode_of_training      TEXT,

      session_4_start_time            TEXT,
      session_4_end_time              TEXT,
      session_4_mode_of_training      TEXT,

      session_5_start_time            TEXT,
      session_5_end_time              TEXT,
      session_5_mode_of_training      TEXT,

      session_6_start_time            TEXT,
      session_6_end_time              TEXT,
      session_6_mode_of_training      TEXT,

      session_7_start_time            TEXT,
      session_7_end_time              TEXT,
      session_7_mode_of_training      TEXT,

      session_8_start_time            TEXT,
      session_8_end_time              TEXT,
      session_8_mode_of_training      TEXT,

      session_9_start_time            TEXT,
      session_9_end_time              TEXT,
      session_9_mode_of_training      TEXT,

      session_10_start_time           TEXT,
      session_10_end_time             TEXT,
      session_10_mode_of_training     TEXT,

      session_11_start_time           TEXT,
      session_11_end_time             TEXT,
      session_11_mode_of_training     TEXT,

      -- Evening sessions 1-3
      session_1_evening_start_time    TEXT,
      session_1_evening_end_time      TEXT,
      session_1_evening_mode_of_training TEXT,

      session_2_evening_start_time    TEXT,
      session_2_evening_end_time      TEXT,
      session_2_evening_mode_of_training TEXT,

      session_3_evening_start_time    TEXT,
      session_3_evening_end_time      TEXT,
      session_3_evening_mode_of_training TEXT,

      created_at                      TIMESTAMPTZ DEFAULT NOW(),
      updated_at                      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// ── All updatable columns (excluding id, course_code, created_at, updated_at) ─

const SESSION_COLUMNS = [
  ...Array.from({ length: 11 }, (_, i) => i + 1).flatMap(n => [
    `session_${n}_start_time`,
    `session_${n}_end_time`,
    `session_${n}_mode_of_training`,
  ]),
  ...Array.from({ length: 3 }, (_, i) => i + 1).flatMap(n => [
    `session_${n}_evening_start_time`,
    `session_${n}_evening_end_time`,
    `session_${n}_evening_mode_of_training`,
  ]),
];

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await ensureTable();

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { courseCode } = req.query;

    if (courseCode && typeof courseCode === 'string') {
      const result = await pool.query(
        `SELECT * FROM course_session_timing WHERE course_code = $1 LIMIT 1`,
        [courseCode.trim().toUpperCase()]
      );
      return res.status(200).json({ success: true, data: result.rows[0] ?? null });
    }

    const result = await pool.query(
      `SELECT * FROM course_session_timing ORDER BY course_code ASC`
    );
    return res.status(200).json({ success: true, data: result.rows });
  }

  // ── POST (upsert) ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { courseCode, ...fields } = req.body ?? {};

    if (!courseCode) {
      return res.status(400).json({ success: false, error: 'courseCode is required' });
    }

    // Build SET clause from only the recognised session columns present in the body
    const updates: string[] = [];
    const values: any[] = [courseCode.trim().toUpperCase()];

    for (const col of SESSION_COLUMNS) {
      if (col in fields) {
        values.push(fields[col] || null);
        updates.push(`${col} = $${values.length}`);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No session timing fields provided' });
    }

    const query = `
      INSERT INTO course_session_timing (course_code, ${updates.map(u => u.split(' = ')[0]).join(', ')}, updated_at)
      VALUES ($1, ${values.slice(1).map((_, i) => `$${i + 2}`).join(', ')}, NOW())
      ON CONFLICT (course_code) DO UPDATE SET
        ${updates.join(',\n        ')},
        updated_at = NOW()
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return res.status(200).json({ success: true, data: result.rows[0] });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { courseCode } = req.query;

    if (!courseCode || typeof courseCode !== 'string') {
      return res.status(400).json({ success: false, error: 'courseCode is required' });
    }

    await pool.query(
      `DELETE FROM course_session_timing WHERE course_code = $1`,
      [courseCode.trim().toUpperCase()]
    );
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler);
