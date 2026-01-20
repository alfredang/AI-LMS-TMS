import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        // Check if email exists in database
        const result = await pool.query(
            'SELECT id, email FROM app_user WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        const exists = result.rows.length > 0;

        return res.status(200).json({
            success: true,
            data: {
                email: email,
                exists: exists
            }
        });

    } catch (error) {
        console.error('❌ Email check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error during email check'
        });
    }
}