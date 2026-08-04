import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const client = await pool.connect();
  try {
    if (req.method === 'GET') {
      const { sessionId } = req.query;
      if (!sessionId) {
        return res.status(400).json({ success: false, error: 'sessionId is required' });
      }

      // Return attendance records — join app_user to get name/email for manually added learners
      const result = await client.query(
        `SELECT ca.nric, ca.user_id, ca.is_present, ca.reason_of_absence,
                au.full_name, au.email
         FROM course_attendance ca
         LEFT JOIN app_user au ON au.id = ca.user_id
         WHERE ca.session_id = $1`,
        [sessionId]
      );

      const records = result.rows.map(row => ({
        nric: row.nric || '',
        userId: row.user_id,
        isPresent: row.is_present,
        reasonOfAbsence: row.reason_of_absence || '',
        fullName: row.full_name || '',
        email: row.email || '',
      }));

      return res.status(200).json({ success: true, data: records });
    }

    if (req.method === 'POST') {
      const { sessionId, records } = req.body as {
        sessionId: string;
        records: { nric: string; isPresent: boolean; reasonOfAbsence?: string }[];
      };

      if (!sessionId || !Array.isArray(records)) {
        return res.status(400).json({ success: false, error: 'sessionId and records array are required' });
      }

      await client.query('BEGIN');
      let saved = 0;
      let skipped = 0;

      for (const r of records) {
        if (!r.nric) {
          skipped++;
          continue;
        }

        // Resolve user_id: extract from _uid_ prefix (manually added learners) or look up by NRIC
        let userId: string | null = null;
        if (r.nric.startsWith('_uid_')) {
          userId = r.nric.slice(5);
        } else {
          const lookup = await client.query(
            `SELECT user_id FROM learner_profile WHERE nric = $1 LIMIT 1`,
            [r.nric]
          );
          userId = lookup.rows[0]?.user_id ?? null;
        }

        await client.query(
          `INSERT INTO course_attendance (session_id, nric, user_id, is_present, reason_of_absence, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (session_id, nric)
           DO UPDATE SET is_present = EXCLUDED.is_present,
                         reason_of_absence = EXCLUDED.reason_of_absence,
                         user_id = COALESCE(EXCLUDED.user_id, course_attendance.user_id),
                         updated_at = NOW()`,
          [sessionId, r.nric, userId, r.isPresent, r.isPresent ? null : (r.reasonOfAbsence || null)]
        );
        saved++;
      }

      await client.query('COMMIT');

      const msg = skipped > 0
        ? `Attendance saved (${saved} saved, ${skipped} skipped — missing NRIC)`
        : `Attendance saved successfully (${saved} records).`;
      return res.status(200).json({ success: true, message: msg });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in attendance-records:', error);
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
