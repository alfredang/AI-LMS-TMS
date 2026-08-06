import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { normalizeTrainerName, splitTrainerList } from '@/lib/trainerInvitations';

/**
 * GET /api/admin/preview-bulk-trainer-invitations
 *
 * Returns a preview of which course runs would receive trainer invitations
 * if the bulk send were triggered. Shows the next eligible trainer per run
 * without actually sending anything.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Read window from scheduler_config (same as the auto-send sweep)
    let windowDays = 30;
    try {
      const cfgRes = await pool.query(
        `SELECT days_in_advance FROM scheduler_config WHERE id = 'auto_send_trainer_invitations' LIMIT 1`
      );
      const n = cfgRes.rows[0]?.days_in_advance;
      if (typeof n === 'number' && n > 0) windowDays = n;
    } catch { /* table may not exist */ }

    // Optional date range from query params (override the default window)
    const dateFrom = typeof req.query.dateFrom === 'string' && req.query.dateFrom ? req.query.dateFrom : null;
    const dateTo = typeof req.query.dateTo === 'string' && req.query.dateTo ? req.query.dateTo : null;

    // Eligible course runs: upcoming, no local trainer assigned
    const eligibleRes = await pool.query(
      `SELECT cr.id, cr.course_run_id, cr.start_date, cr.end_date,
              c.title AS course_title, c.course_code, c.trainers_list,
              COALESCE(enr.cnt, 0)::int AS confirmed_enrolments
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt FROM enrollment e WHERE e.course_run_id = cr.id AND e.enrolment_status = 'Confirmed'
       ) enr ON true
       WHERE cr.start_date >= COALESCE($2::date, CURRENT_DATE)
         AND cr.start_date <= COALESCE($3::date, CURRENT_DATE + ($1::int * INTERVAL '1 day'))
         AND NOT EXISTS (
           SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id
         )
       ORDER BY cr.start_date ASC`,
      [windowDays, dateFrom, dateTo]
    );

    if (eligibleRes.rows.length === 0) {
      return res.status(200).json({ success: true, preview: [], windowDays });
    }

    const courseRunIds = eligibleRes.rows.map(r => r.id);

    // Load declined + pending trainers per course run
    let hasInvitationTable = false;
    try {
      await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'trainer_invitation' LIMIT 1`);
      hasInvitationTable = true;
    } catch { /* */ }

    const declinedMap = new Map<string, Set<string>>();
    const pendingMap = new Map<string, Set<string>>();
    if (hasInvitationTable) {
      const invRes = await pool.query(
        `SELECT course_run_id, trainer_name, status FROM trainer_invitation
         WHERE course_run_id = ANY($1::uuid[]) AND status IN ('declined', 'pending')`,
        [courseRunIds]
      );
      for (const row of invRes.rows) {
        const norm = normalizeTrainerName(row.trainer_name);
        if (row.status === 'declined') {
          if (!declinedMap.has(row.course_run_id)) declinedMap.set(row.course_run_id, new Set());
          declinedMap.get(row.course_run_id)!.add(norm);
        } else {
          if (!pendingMap.has(row.course_run_id)) pendingMap.set(row.course_run_id, new Set());
          pendingMap.get(row.course_run_id)!.add(norm);
        }
      }
    }

    // Resolve trainer emails in bulk
    const allTrainerNames = new Set<string>();
    for (const row of eligibleRes.rows) {
      for (const name of splitTrainerList(row.trainers_list)) {
        allTrainerNames.add(name.toLowerCase());
      }
    }

    const trainerEmailMap = new Map<string, { full_name: string; email: string }>();
    if (allTrainerNames.size > 0) {
      const trainerRes = await pool.query(
        `SELECT DISTINCT ON (LOWER(au.full_name))
                au.full_name,
                COALESCE(NULLIF(au.email, ''), NULLIF(au.secondary_email, '')) AS email
         FROM app_user au
         JOIN user_role_map urm ON urm.user_id = au.id
         WHERE urm.role = 'Trainer'
           AND LOWER(au.full_name) = ANY($1::text[])
         ORDER BY LOWER(au.full_name), au.created_at ASC`,
        [Array.from(allTrainerNames)]
      );
      for (const row of trainerRes.rows) {
        if (row.email) {
          trainerEmailMap.set(normalizeTrainerName(row.full_name), {
            full_name: row.full_name,
            email: row.email,
          });
        }
      }
    }

    // For each eligible run, find the next trainer that would be picked
    const preview = eligibleRes.rows.map(row => {
      const approvedTrainers = splitTrainerList(row.trainers_list);
      const declined = declinedMap.get(row.id) || new Set();
      const pending = pendingMap.get(row.id) || new Set();

      let nextTrainer = '';
      let nextEmail = '';
      let reason = '';

      if (approvedTrainers.length === 0) {
        reason = 'No approved trainers on course';
      } else {
        for (const name of approvedTrainers) {
          const norm = normalizeTrainerName(name);
          if (declined.has(norm)) continue;
          if (pending.has(norm)) continue;
          const resolved = trainerEmailMap.get(norm);
          if (!resolved) {
            continue; // skip unresolvable names
          }
          nextTrainer = resolved.full_name;
          nextEmail = resolved.email;
          break;
        }
        if (!nextTrainer) {
          reason = pending.size > 0 ? 'Already has pending invitation' : 'All trainers declined or unresolvable';
        }
      }

      return {
        courseRunUuid: row.id,
        courseRunId: row.course_run_id,
        courseTitle: row.course_title,
        courseCode: row.course_code,
        startDate: row.start_date,
        nextTrainer,
        nextEmail,
        reason,
        confirmedEnrolments: row.confirmed_enrolments,
        canSend: !!nextTrainer && !!nextEmail,
      };
    });

    return res.status(200).json({ success: true, preview, windowDays });
  } catch (err) {
    console.error('❌ preview-bulk-trainer-invitations error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
