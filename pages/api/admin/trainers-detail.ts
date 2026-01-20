import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const client = await pool.connect();

        try {
            // SQL query to get detailed trainer information
            const query = `
                SELECT 
                    au.full_name AS trainer_name,
                    au.email,
                    au.profile_picture_url AS profile_picture,
                    tp.tel AS telephone,
                    tp.trainer_type,
                    tp.status,
                    tp.linkedin_url,
                    tp.user_id,
                    STRING_AGG(DISTINCT c.title, ', ') AS courses_taught
                FROM trainer_profile tp
                JOIN app_user au 
                    ON tp.user_id = au.id
                LEFT JOIN course_run cr 
                    ON cr.assigned_trainer_email = au.email
                LEFT JOIN course c 
                    ON c.id = cr.course_id
                GROUP BY 
                    au.full_name, au.email, au.profile_picture_url, 
                    tp.tel, tp.trainer_type, tp.status, tp.linkedin_url, tp.user_id
                ORDER BY au.full_name;
            `;

            console.log('Executing trainers detail query...');
            const result = await client.query(query);
            console.log('Trainers detail fetched:', result.rows.length);

            res.status(200).json({
                success: true,
                data: {
                    trainers: result.rows
                }
            });

        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error fetching trainers detail:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch trainers detail',
            error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
        });
    }
}