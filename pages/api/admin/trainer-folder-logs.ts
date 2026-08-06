import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const limit = parseInt(req.query.limit as string) || 100;
        
        // Fetch logs
        const result = await pool.query(`
            SELECT 
                id, 
                run_id, 
                created_at, 
                course_run_id, 
                course_title, 
                course_code, 
                start_date, 
                end_date, 
                trainer_name,
                trainer_source,
                folder_name,
                status, 
                error_message
            FROM auto_create_trainer_folder_log
            ORDER BY created_at DESC
            LIMIT $1
        `, [limit]);

        return res.status(200).json({
            success: true,
            data: result.rows
        });
    } catch (error: any) {
        console.error('Error fetching trainer folder logs:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch logs',
            error: error.message
        });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
