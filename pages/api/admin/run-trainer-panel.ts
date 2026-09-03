import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';
import { normalizeTrainerName, splitTrainerList } from '@/lib/trainerInvitations';

/**
 * GET /api/admin/run-trainer-panel?courseRunUuid=<uuid>
 *
 * Everything the Class editor's Trainer tab needs for ONE course run:
 *   - trainersList            course.trainers_list (raw pipe/comma string)
 *   - nextAvailableTrainer    who the invitation cascade would invite next
 *   - trainerInvitations      latest invitation per trainer (normalized name key)
 *   - latestInvitationStatus  status of the most recent invitation
 *   - invitationPaused / invitationRepliesBlocked
 *
 * Exists because several editors (ClassDetailView "Edit Course Run", the
 * calendar day view) hand ClassManagerView a MINIMAL courseToEdit — without
 * this data the Trainer tab wrongly showed "No next available trainer in the
 * approved list" even for courses with a full approved list. ClassManagerView
 * hydrates from here when the fields are missing.
 *
 * The next-trainer preview mirrors lib/trainerInvitationSender: anchor after
 * the most recent (non-reset) invitee, skip assigned/declined/blocked and
 * names with no resolvable trainer account.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunUuid } = req.query;
  if (!courseRunUuid || typeof courseRunUuid !== 'string') {
    return res.status(400).json({ success: false, error: 'courseRunUuid query param is required' });
  }

  try {
    const runRes = await pool.query(
      `SELECT cr.id, cr.course_run_id,
              COALESCE(cr.invitation_paused, false) AS invitation_paused,
              COALESCE(cr.invitation_replies_blocked, false) AS invitation_replies_blocked,
              cr.assigned_trainer_name, cr.assigned_trainer_email,
              c.trainers_list
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id::text = $1 LIMIT 1`,
      [courseRunUuid]
    );
    const run = runRes.rows[0];
    if (!run) {
      return res.status(404).json({ success: false, error: 'Course run not found' });
    }

    const [localRes, invRes] = await Promise.all([
      pool.query(
        `SELECT trainer_name, trainer_email FROM course_run_trainer WHERE course_run_id = $1`,
        [run.id]
      ),
      pool.query(
        `SELECT trainer_name, trainer_email, status, sent_at, responded_at
           FROM trainer_invitation
          WHERE course_run_id = $1
          ORDER BY created_at DESC`,
        [run.id]
      ),
    ]);

    // Latest invitation per normalized trainer name (rows are newest-first).
    const trainerInvitations: Record<string, Array<{ status: string; sent_at: string; responded_at: string | null }>> = {};
    for (const inv of invRes.rows) {
      const key = normalizeTrainerName(inv.trainer_name);
      if (!trainerInvitations[key]) {
        trainerInvitations[key] = [{ status: inv.status, sent_at: inv.sent_at, responded_at: inv.responded_at }];
      }
    }

    const approved = splitTrainerList(run.trainers_list);

    // Resolve approved names → account emails (same query shape as the sender).
    const emailByName = new Map<string, string>();
    if (approved.length > 0) {
      const accRes = await pool.query(
        `SELECT DISTINCT ON (LOWER(au.full_name)) au.full_name,
                COALESCE(NULLIF(au.email, ''), NULLIF(au.secondary_email, '')) AS email
           FROM app_user au
           JOIN user_role_map urm ON urm.user_id = au.id
          WHERE urm.role = 'Trainer' AND LOWER(au.full_name) = ANY ($1::text[])
          ORDER BY LOWER(au.full_name), au.created_at ASC`,
        [approved.map((n) => n.toLowerCase())]
      );
      for (const r of accRes.rows) {
        if (r.email) emailByName.set(normalizeTrainerName(r.full_name), r.email);
      }
    }

    const localNames = new Set<string>(localRes.rows.map((r: any) => normalizeTrainerName(r.trainer_name)));
    const localEmails = new Set<string>(localRes.rows.map((r: any) => String(r.trainer_email || '').toLowerCase()).filter(Boolean));

    // Same preview semantics as upcoming-classes: walk the approved list,
    // skip assigned / declined / blocked, and show the first remaining
    // trainer — a PENDING invitee is shown (with their status) so the admin
    // can see who the cascade is waiting on and resend if needed.
    let nextAvailableTrainer = '';
    let nextAvailableTrainerEmail = '';
    let nextTrainerStatus = '';
    for (let i = 0; i < approved.length; i++) {
      const norm = normalizeTrainerName(approved[i]);
      if (!norm || localNames.has(norm)) continue;
      const email = emailByName.get(norm);
      if (email && localEmails.has(email.toLowerCase())) continue;
      const st = trainerInvitations[norm]?.[0]?.status;
      if (st === 'declined' || st === 'blocked' || st === 'reset' || st === 'resent') continue;
      nextAvailableTrainer = approved[i];
      nextAvailableTrainerEmail = email || '';
      nextTrainerStatus = st || '';
      break;
    }

    return res.status(200).json({
      success: true,
      data: {
        courseRunUuid: run.id,
        courseRunId: run.course_run_id,
        trainersList: run.trainers_list || '',
        nextAvailableTrainer,
        nextAvailableTrainerEmail,
        latestInvitationStatus: invRes.rows[0]?.status || '',
        trainerInvitations,
        invitationPaused: !!run.invitation_paused,
        invitationRepliesBlocked: !!run.invitation_replies_blocked,
        assignedTrainerName: run.assigned_trainer_name || '',
        assignedTrainerEmail: run.assigned_trainer_email || '',
      },
    });
  } catch (err) {
    console.error('❌ [run-trainer-panel] failed:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
