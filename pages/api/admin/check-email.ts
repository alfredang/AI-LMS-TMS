import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
            `SELECT u.id, u.email, u.full_name,
                    EXISTS(SELECT 1 FROM trainer_profile tp WHERE tp.user_id = u.id) AS is_trainer,
                    ARRAY(SELECT role FROM user_role_map WHERE user_id = u.id) AS roles
             FROM app_user u
             WHERE LOWER(u.email) = LOWER($1)`,
            [email.trim()]
        );

        const exists = result.rows.length > 0;
        const isTrainer = exists ? result.rows[0].is_trainer : false;
        const roles: string[] = exists ? result.rows[0].roles : [];
        const fullName: string | null = exists ? result.rows[0].full_name : null;

        return res.status(200).json({
            success: true,
            data: {
                email: email,
                exists: exists,
                isTrainer: isTrainer,
                roles: roles,
                fullName: fullName
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

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
