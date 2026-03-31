import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  try {
    // Get the default password from training_provider
    const tpResult = await pool.query('SELECT default_password FROM training_provider LIMIT 1');
    if (tpResult.rows.length === 0 || !tpResult.rows[0].default_password) {
      return res.status(400).json({
        success: false,
        error: 'No default password configured. Please set a default password in Company Settings first.'
      });
    }

    const defaultPassword = tpResult.rows[0].default_password;

    // Check user exists
    const userResult = await pool.query('SELECT id, email, full_name FROM app_user WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Hash the default password
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // Update user's password to the default password
    await pool.query(
      'UPDATE app_user SET password = $1, password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [defaultPassword, hashedPassword, userId]
    );

    // Set per-user flag to force password change on next login
    try {
      await pool.query('UPDATE app_user SET must_change_password = TRUE WHERE id = $1', [userId]);
    } catch (e) {
      // Column may not exist yet, create it
      await pool.query('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE');
      await pool.query('UPDATE app_user SET must_change_password = TRUE WHERE id = $1', [userId]);
    }

    console.log(`✅ Password reset to default for user: ${user.email}`);

    return res.status(200).json({
      success: true,
      message: `Password has been reset to the default password for ${user.full_name || user.email}. They will be required to change it on next login.`
    });
  } catch (error) {
    console.error('❌ Admin reset password error:', error);
    return res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
}
