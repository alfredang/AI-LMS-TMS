import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

        if (!isCompetent) {
            await pool.query(
                `UPDATE enrollment SET assessment_status = $1, certificate = NULL, updated_at = NOW() WHERE id = $2`,
                [newStatus, enrolmentId]
            );
        } else {
            await pool.query(
                `UPDATE enrollment SET assessment_status = $1, updated_at = NOW() WHERE id = $2`,
                [newStatus, enrolmentId]
            );
        }

        return res.status(200).json({ message: 'Competency updated successfully', status: newStatus });
    } catch (error: any) {
        console.error('Error updating student competency:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
