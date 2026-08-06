import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function ensureTables(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.course_session (
      id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
      course_run_id uuid NOT NULL,
      session_number text,
      ssg_session_id text,
      title text,
      start_date text,
      end_date text,
      start_time text,
      end_time text,
      mode_of_training text,
      attendance_taken boolean DEFAULT false,
      deleted boolean DEFAULT false,
      venue jsonb,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      UNIQUE(course_run_id, ssg_session_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.course_attendance (
      id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
      session_id uuid NOT NULL,
      nric text,
      user_id uuid,
      is_present boolean DEFAULT false NOT NULL,
      reason_of_absence text,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      UNIQUE(session_id, nric)
    )
  `);
  await client.query(`DROP TABLE IF EXISTS public.manual_attendance`).catch(() => {});
  await client.query(`DROP TABLE IF EXISTS public.attendance_session`).catch(() => {});
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const client = await pool.connect();
  try {
    await ensureTables(client);

    // GET: list sessions for a course run
    if (req.method === 'GET') {
      const { courseRunId } = req.query;
      if (!courseRunId) {
        return res.status(400).json({ success: false, error: 'courseRunId is required' });
      }
      const result = await client.query(
        `SELECT id, session_number, ssg_session_id, title,
                start_date, end_date, start_time, end_time,
                mode_of_training, attendance_taken, deleted, venue
         FROM course_session
         WHERE course_run_id = $1
         ORDER BY CAST(NULLIF(regexp_replace(session_number, '[^0-9]', '', 'g'), '') AS integer) ASC NULLS LAST, start_date ASC NULLS LAST`,
        [courseRunId]
      );
      return res.status(200).json({ success: true, data: result.rows });
    }

    // POST: bulk sync SSG sessions OR create a manual session
    if (req.method === 'POST') {
      const { courseRunId, sessionDate, title, ssgSessions } = req.body;
      if (!courseRunId) {
        return res.status(400).json({ success: false, error: 'courseRunId is required' });
      }

      // Bulk sync from SSG — upsert all sessions
      if (Array.isArray(ssgSessions) && ssgSessions.length > 0) {
        await client.query('BEGIN');
        const inserted: any[] = [];
        for (let i = 0; i < ssgSessions.length; i++) {
          const s = ssgSessions[i];
          const r = await client.query(
            `INSERT INTO course_session
               (course_run_id, session_number, ssg_session_id, title,
                start_date, end_date, start_time, end_time,
                mode_of_training, attendance_taken, deleted, venue)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (course_run_id, ssg_session_id) DO UPDATE
               SET session_number    = EXCLUDED.session_number,
                   start_date        = EXCLUDED.start_date,
                   end_date          = EXCLUDED.end_date,
                   start_time        = EXCLUDED.start_time,
                   end_time          = EXCLUDED.end_time,
                   mode_of_training  = EXCLUDED.mode_of_training,
                   attendance_taken  = EXCLUDED.attendance_taken,
                   deleted           = EXCLUDED.deleted,
                   venue             = EXCLUDED.venue,
                   updated_at        = NOW()
             RETURNING id, session_number, ssg_session_id, title,
                       start_date, end_date, start_time, end_time,
                       mode_of_training, attendance_taken, deleted, venue`,
            [
              courseRunId,
              `S${i + 1}`,
              s.id || null,
              `Session S${i + 1}`,
              s.startDate || null,
              s.endDate || null,
              s.startTime || null,
              s.endTime || null,
              s.modeOfTraining || null,
              s.attendanceTaken ?? false,
              s.deleted ?? false,
              s.venue ? JSON.stringify(s.venue) : null,
            ]
          );
          inserted.push(...r.rows);
        }
        await client.query('COMMIT');
        return res.status(200).json({ success: true, data: inserted });
      }

      // Single manual session
      const countResult = await client.query(
        `SELECT COALESCE(MAX(session_number), 0) + 1 AS next_num
         FROM course_session WHERE course_run_id = $1`,
        [courseRunId]
      );
      const sessionNumber = countResult.rows[0].next_num;
      const sessionTitle = title || `Session ${sessionNumber}`;
      const insertResult = await client.query(
        `INSERT INTO course_session (course_run_id, session_number, start_date, title)
         VALUES ($1, $2, $3, $4)
         RETURNING id, session_number, start_date, end_date, start_time, end_time,
                   mode_of_training, attendance_taken, deleted, venue, ssg_session_id, title`,
        [courseRunId, sessionNumber, sessionDate || null, sessionTitle]
      );
      return res.status(201).json({ success: true, data: insertResult.rows[0] });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in attendance-sessions:', error);
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
