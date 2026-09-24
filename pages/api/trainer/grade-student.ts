import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import { isStaff, requireCourseRunTrainer } from '@lib/auth/courseRunAccess';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';


const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { enrolmentId, source, isCompetent } = req.body;

    if (!enrolmentId || !source || typeof isCompetent !== 'boolean') {
        return res.status(400).json({ message: 'Missing required fields: enrolmentId, source, isCompetent' });
    }

    try {
        const newStatus = isCompetent ? 'Competent' : 'Not Yet Competent';

        if (source !== 'manual' && source !== 'ssg') {
            return res.status(400).json({ message: 'Invalid source. Must be manual or ssg.' });
        }

        // Trainers only grade classes they are assigned to — never their own enrolment
        // in a class they attend as a learner.
        const authUser = (req as AuthedApiRequest).authUser!;
        const run = await pool.query(`SELECT course_run_id, user_id FROM enrollment WHERE id::text = $1`, [String(enrolmentId)]);
        if (run.rows.length === 0) {
            return res.status(404).json({ message: 'Enrolment not found' });
        }
        if (!isStaff(authUser) && run.rows[0].user_id === authUser.id) {
            return res.status(403).json({ message: 'You cannot grade your own enrolment' });
        }
        if (!(await requireCourseRunTrainer(authUser, res, String(run.rows[0].course_run_id)))) return;

        // Unconditionally update assessment_status only (decoupled from certificates per user request)
        await pool.query(
            `UPDATE enrollment SET assessment_status = $1, updated_at = NOW() WHERE id = $2`,
            [newStatus, enrolmentId]
        );

        return res.status(200).json({ message: 'Competency updated successfully', status: newStatus });
    } catch (error: any) {
        console.error('Error updating student competency:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
