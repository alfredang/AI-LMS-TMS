import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const limit = parseInt(req.query.limit as string, 10) || 500;
        const result = await pool.query(`
            SELECT * FROM auto_send_confirmation_log
            ORDER BY created_at DESC
            LIMIT $1
        `, [limit]);
        return res.status(200).json({ success: true, data: result.rows });
    } catch (error: any) {
        // Table may not exist yet
        if (error.code === '42P01') {
            return res.status(200).json({ success: true, data: [] });
        }
        console.error('Error fetching course confirmation email logs:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
