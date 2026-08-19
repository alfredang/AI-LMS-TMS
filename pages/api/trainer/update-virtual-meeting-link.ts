import { withAuth, type AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * Lets a trainer put in the virtual meeting link for their own class when the
 * calendar sync never produced one (ad-hoc Meet/Zoom/Teams links created by
 * hand). Staff roles may set it on any run; a trainer only on runs they are
 * assigned to.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const { courseRunId, link } = req.body || {};
    if (!courseRunId || typeof courseRunId !== 'string') {
        return res.status(400).json({ success: false, error: 'courseRunId is required' });
    }
    if (typeof link !== 'string') {
        return res.status(400).json({ success: false, error: 'link is required' });
    }

    // Empty string clears the link; anything else must be a plain http(s) URL.
    const trimmed = link.trim();
    if (trimmed) {
        let parsed: URL;
        try {
            parsed = new URL(trimmed);
        } catch {
            return res.status(400).json({ success: false, error: 'Enter a valid URL starting with https://' });
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return res.status(400).json({ success: false, error: 'Enter a valid URL starting with https://' });
        }
    }

    const authUser = (req as AuthedApiRequest).authUser;
    const isStaff = !!authUser?.isService
        || ['admin', 'trainingProvider', 'developer'].some(r => authUser?.roles.has(r));

    try {
        if (!isStaff) {
            // Trainers may only touch classes they are actually assigned to.
            const owns = await pool.query(
                `SELECT 1
                   FROM course_run cr
                   JOIN app_user au ON au.id = $1
                  WHERE cr.id::text = $2
                    AND (
                        cr.assigned_trainer_id = au.id
                        OR cr.tpg_assigned_trainer_id = au.id
                        OR cr.assigned_trainer_email ILIKE au.email
                        OR cr.tpg_assigned_trainer_email ILIKE au.email
                        OR EXISTS (
                            SELECT 1 FROM course_run_trainer crt
                             WHERE crt.course_run_id = cr.id
                               AND (crt.trainer_id = au.id OR crt.trainer_email ILIKE au.email)
                        )
                    )
                  LIMIT 1`,
                [authUser!.id, courseRunId]
            );
            if (owns.rows.length === 0) {
                return res.status(403).json({ success: false, error: 'You are not assigned to this class' });
            }
        }

        // Clearing the link clears the provider with it; otherwise keep any
        // provider already configured (e.g. a Zoom-integrated run) and only
        // fall back to what the URL itself implies.
        const result = trimmed
            ? await pool.query(
                `UPDATE course_run
                    SET virtual_meeting_link = $2,
                        virtual_meeting_provider = COALESCE($3, virtual_meeting_provider),
                        updated_at = now()
                  WHERE id::text = $1
                  RETURNING virtual_meeting_link, virtual_meeting_provider`,
                [courseRunId, trimmed, inferProvider(trimmed)]
            )
            : await pool.query(
                `UPDATE course_run
                    SET virtual_meeting_link = NULL,
                        virtual_meeting_provider = NULL,
                        updated_at = now()
                  WHERE id::text = $1
                  RETURNING virtual_meeting_link, virtual_meeting_provider`,
                [courseRunId]
            );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Class not found' });
        }

        return res.status(200).json({
            success: true,
            data: {
                virtualMeetingLink: result.rows[0].virtual_meeting_link,
                virtualMeetingProvider: result.rows[0].virtual_meeting_provider,
            },
        });
    } catch (error: any) {
        console.error('Error updating virtual meeting link:', error);
        return res.status(500).json({ success: false, error: 'Failed to save the meeting link' });
    }
}

function inferProvider(link: string): string | null {
    const l = link.toLowerCase();
    if (l.includes('meet.google.com')) return 'google_meet';
    if (l.includes('zoom.us') || l.includes('zoom.com')) return 'zoom';
    if (l.includes('teams.microsoft.com') || l.includes('teams.live.com')) return 'teams';
    return null;
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
