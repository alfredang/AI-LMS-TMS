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
            // SQL query to get all trainer names
            const query = `
                SELECT 
                    au.full_name AS trainer_name
                FROM trainer_profile tp
                JOIN app_user au 
                    ON tp.user_id = au.id
                ORDER BY au.full_name;
            `;

            console.log('Executing trainers query...');
            const result = await client.query(query);
            console.log('Trainers fetched:', result.rows.length);

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
        console.error('Error fetching trainers:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
}