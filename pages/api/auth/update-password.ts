import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import { hashSessionToken, SESSION_TOKEN_PREFIX } from '../../../lib/auth/session';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'PUT') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { userId, newPassword } = req.body;
        const authUser = (req as AuthedApiRequest).authUser!;

        if (!userId || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: userId and newPassword'
            });
        }

        // A user may only change their own password; admins may change anyone's.
        const isAdmin =
            authUser.isService ||
            authUser.roles.has('admin') ||
            authUser.roles.has('trainingProvider');
        if (!isAdmin && authUser.id !== userId) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
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

        // Store only the bcrypt hash; the legacy plaintext column is cleared.
        const updateQuery = `
            UPDATE app_user
            SET password = NULL, password_hash = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `;

        await pool.query(updateQuery, [hashedPassword, userId]);

        // Clear the must_change_password flag if it exists
        try {
            await pool.query('UPDATE app_user SET must_change_password = FALSE WHERE id = $1', [userId]);
        } catch (e) {
            // Column may not exist yet, that's fine
        }

        // Kill every other session for this user (the current one stays alive).
        try {
            const header = req.headers.authorization || '';
            const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
            if (token.startsWith(SESSION_TOKEN_PREFIX)) {
                await pool.query(
                    'DELETE FROM user_session WHERE user_id = $1 AND token_hash <> $2',
                    [userId, hashSessionToken(token)]
                );
            } else {
                await pool.query('DELETE FROM user_session WHERE user_id = $1', [userId]);
            }
        } catch (e) {
            console.error('Session revocation after password change failed:', e);
        }

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

export default withAuth(handler);
