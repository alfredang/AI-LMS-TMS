import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'PUT') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { userId, newPassword } = req.body;

        if (!userId || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: userId and newPassword'
            });
        }

        // Validate password strength
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }

        // Check if user exists
        const userCheckQuery = `
            SELECT id, email
            FROM app_user
            WHERE id = $1
        `;

        const userResult = await pool.query(userCheckQuery, [userId]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = userResult.rows[0];

        // Hash the new password with bcrypt
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update both password columns for compatibility
        const updateQuery = `
            UPDATE app_user
            SET password = $1, password_hash = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `;

        await pool.query(updateQuery, [newPassword, hashedPassword, userId]);

        console.log(`✅ Password updated successfully for user: ${user.email}`);

        return res.status(200).json({
            success: true,
            message: 'Password updated successfully',
            data: {
                userId: user.id,
                email: user.email
            }
        });

    } catch (error) {
        console.error('❌ Password update error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error during password update'
        });
    }
}