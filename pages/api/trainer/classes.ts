import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { email } = req.query;

    if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: 'Trainer email is required' });
    }

    try {
        const query = `
            SELECT 
                c.id as course_id, 
                c.title as course_title, 
                c.course_code,
                cr.id as run_id, 
                cr.course_run_id as run_code,
                cr.start_date, 
                cr.end_date, 
                cr.class_status,
                cr.assigned_trainer_name
            FROM course_run cr
            JOIN course c ON cr.course_id = c.id
            WHERE (
                cr.assigned_trainer_email ILIKE $1
                OR cr.tpg_assigned_trainer_email ILIKE $1
                OR EXISTS (
                    SELECT 1 FROM course_run_trainer crt
                    WHERE crt.course_run_id = cr.id AND crt.trainer_email ILIKE $1
                )
            )
              AND (cr.end_date IS NULL OR cr.end_date >= CURRENT_DATE)
            ORDER BY cr.start_date DESC
        `;
        
        const values = [`%${email.trim()}%`];
        const result = await pool.query(query, values);

        return res.status(200).json(result.rows);
    } catch (error: any) {
        console.error('Error fetching trainer classes:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
