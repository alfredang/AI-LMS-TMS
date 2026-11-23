import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import { isStaff, requireCourseRunTrainer } from '@lib/auth/courseRunAccess';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// Manual TRAQOM tick from the trainer's Student Grading Roster.
// SSG exposes only "survey sent" on the attendance feed, never per-learner
// completion, so the trainer confirms it here.
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { enrolmentId, enrolmentIds, completed } = req.body;

    const ids: string[] = Array.isArray(enrolmentIds)
        ? enrolmentIds.filter((id: unknown): id is string => typeof id === 'string' && !!id)
        : (typeof enrolmentId === 'string' && enrolmentId ? [enrolmentId] : []);

    if (ids.length === 0 || typeof completed !== 'boolean') {
        return res.status(400).json({ message: 'Missing required fields: enrolmentId (or enrolmentIds) and completed' });
    }

    try {
        // Only a trainer of the class (or staff) may tick it, never on their own enrolment,
        // and all rows must belong to one class — as for grade-student.
        const authUser = (req as AuthedApiRequest).authUser!;
        const rows = (await pool.query(`SELECT course_run_id, user_id FROM enrollment WHERE id::text = ANY($1)`, [ids])).rows;
        if (rows.length !== ids.length) {
            return res.status(404).json({ message: 'Enrolment not found' });
        }
        if (!isStaff(authUser) && rows.some((r: any) => r.user_id === authUser.id)) {
            return res.status(403).json({ message: 'You cannot update your own enrolment' });
        }
        const runIds = Array.from(new Set(rows.map((r: any) => String(r.course_run_id))));
        if (runIds.length !== 1) {
            return res.status(400).json({ message: 'All enrolments must belong to the same course run' });
        }
        if (!(await requireCourseRunTrainer(authUser, res, runIds[0]))) return;

        const result = await pool.query(
            `UPDATE enrollment
             SET traqom_completed = $1,
                 traqom_completed_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
                 updated_at = NOW()
             WHERE id = ANY($2::uuid[])`,
            [completed, ids]
        );

        return res.status(200).json({ message: 'TRAQOM status updated', updated: result.rowCount, completed });
    } catch (error: any) {
        console.error('Error updating TRAQOM status:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
