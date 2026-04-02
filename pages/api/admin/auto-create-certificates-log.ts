import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { limit = '100', offset = '0', run_id } = req.query;

        let query = `
            SELECT id, run_id, course_run_id, course_title, course_code, learner_name, nric, certificate_url, status, error_message, created_at
            FROM auto_create_certificates_log
        `;
        const params: any[] = [];
        let paramCount = 1;

        if (run_id) {
            query += ` WHERE run_id = $${paramCount}`;
            params.push(run_id);
            paramCount++;
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit as string));
        params.push(parseInt(offset as string));

        const result = await pool.query(query, params);

        return res.status(200).json({ success: true, logs: result.rows });
    } catch (error: any) {
        console.error('Error fetching auto-create certificates logs:', error);
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
}
