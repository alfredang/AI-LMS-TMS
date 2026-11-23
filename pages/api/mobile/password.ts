import type { NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { hashSessionToken } from '../../../lib/auth/session';
import { limited } from '../../../lib/android/auth';

// Change the signed-in user's own password. The current password is always required.
export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return res.status(405).end();
  const user = req.authUser!;
  if (user.isService) return res.status(403).end();
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return res.status(400).json({ error: 'Enter your current and new password.' });
  if (newPassword.length < 8 || newPassword.length > 200) return res.status(400).json({ error: 'Your new password must be at least 8 characters.' });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'Choose a password different from your current one.' });
  try {
    if (await limited(`mobile-password:${user.id}`, 8, 15)) return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
    const row = (await pool.query('SELECT password_hash FROM app_user WHERE id=$1', [user.id])).rows[0];
    if (!row?.password_hash || !(await bcrypt.compare(currentPassword, row.password_hash))) return res.status(401).json({ error: 'Your current password is incorrect.' });
    await pool.query(`UPDATE app_user SET password=NULL, password_hash=$2, must_change_password=false, updated_at=now() WHERE id=$1`, [user.id, await bcrypt.hash(newPassword, 10)]);
    const token = (req.headers.authorization || '').slice(7).trim();
    await pool.query('DELETE FROM user_session WHERE user_id=$1 AND token_hash<>$2', [user.id, hashSessionToken(token)]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Your password could not be changed. Please try again.' });
  }
}, { roles: ['learner', 'trainer'] });
