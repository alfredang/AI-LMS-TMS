import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

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
