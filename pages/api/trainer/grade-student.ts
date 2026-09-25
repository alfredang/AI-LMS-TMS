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

    const { enrolmentId, enrolmentIds, source, isCompetent } = req.body;

    // A learner merged from several enrolment rows (manual + SSG-synced) is graded
    // as one: the roster sends every row's id in `enrolmentIds`.
    const ids: string[] = Array.isArray(enrolmentIds)
        ? enrolmentIds.filter((id: unknown): id is string => typeof id === 'string' && !!id)
        : (enrolmentId ? [String(enrolmentId)] : []);

    if (ids.length === 0 || !source || typeof isCompetent !== 'boolean') {
        return res.status(400).json({ message: 'Missing required fields: enrolmentId (or enrolmentIds), source, isCompetent' });
    }

    try {
        const newStatus = isCompetent ? 'Competent' : 'Not Yet Competent';

        if (source !== 'manual' && source !== 'ssg') {
            return res.status(400).json({ message: 'Invalid source. Must be manual or ssg.' });
        }

        // Trainers only grade classes they are assigned to — never their own enrolment
        // in a class they attend as a learner.
        const authUser = (req as AuthedApiRequest).authUser!;
        const run = await pool.query(`SELECT course_run_id, user_id FROM enrollment WHERE id::text = ANY($1)`, [ids]);
        if (run.rows.length !== ids.length) {
            return res.status(404).json({ message: 'Enrolment not found' });
        }
        if (!isStaff(authUser) && run.rows.some(r => r.user_id === authUser.id)) {
            return res.status(403).json({ message: 'You cannot grade your own enrolment' });
        }
        const runIds = Array.from(new Set(run.rows.map(r => String(r.course_run_id))));
        if (runIds.length !== 1) {
            return res.status(400).json({ message: 'All enrolments must belong to the same course run' });
        }
        if (!(await requireCourseRunTrainer(authUser, res, runIds[0]))) return;

        // Unconditionally update assessment_status only (decoupled from certificates per user request)
        await pool.query(
            `UPDATE enrollment SET assessment_status = $1, updated_at = NOW() WHERE id::text = ANY($2)`,
            [newStatus, ids]
        );

        return res.status(200).json({ message: 'Competency updated successfully', status: newStatus });
    } catch (error: any) {
        console.error('Error updating student competency:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
