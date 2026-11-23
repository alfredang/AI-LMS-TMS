import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import pool from '../../../lib/db';
import { createSession } from '../../../lib/auth/session';
import { limited } from '../../../lib/android/auth';

// PUBLIC: password sign-in for the learner/trainer apps (iOS and Android). Existing active
// accounts only, learner or trainer role only, never creates an account, rate limited per
// email and per IP. Returns the same opaque session token as the email-code sign-in.
const FAIL = 'Incorrect email or password.';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');
  const { email: raw, password } = req.body || {};
  if (typeof raw !== 'string' || raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())
    || typeof password !== 'string' || password.length < 1 || password.length > 200) {
    return res.status(400).json({ error: 'Enter your registered email address and password.' });
  }
  const email = raw.trim().toLowerCase();
  try {
    const fwd = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (await limited(`mobile-login:email:${email}`, 8, 15) || await limited(`mobile-login:ip:${ip}`, 200, 15)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
    }
    const u = (await pool.query(
      `SELECT id, email, full_name AS "fullName", password_hash, coalesce(must_change_password,false) AS must
         FROM app_user
        WHERE (lower(email)=$1 OR lower(secondary_email)=$1) AND lower(coalesce(account_status,'active'))='active'
        ORDER BY (lower(email)=$1) DESC LIMIT 1`, [email])).rows[0];
    // Compare against a fixed hash when the account is unknown so timing does not reveal it.
    const ok = await bcrypt.compare(password, u?.password_hash || '$2a$10$CwTycUXWue0Thq9StjUM0uJ8rQbJ9bq1Y0R7G7m4uYy3Qw6q9eW3K');
    if (!u?.password_hash || !ok) return res.status(401).json({ error: FAIL });
    const roles = (await pool.query(
      `SELECT lower(role::text) AS role FROM user_role_map WHERE user_id=$1 AND lower(role::text) IN ('learner','trainer')`, [u.id]
    )).rows.map((r: { role: string }) => r.role);
    if (!roles.length) return res.status(403).json({ error: 'This app is for learners and trainers. Your account has neither role.' });

    let forcePasswordChange = !!u.must;
    if (!forcePasswordChange) {
      const tp = (await pool.query(`SELECT force_first_password_change AS force, default_password AS pwd FROM training_provider LIMIT 1`).catch(() => ({ rows: [] as any[] }))).rows[0];
      if (tp?.force && tp.pwd) forcePasswordChange = await bcrypt.compare(String(tp.pwd), u.password_hash).catch(() => false);
    }
    const token = await createSession(u.id);
    return res.json({ data: { user: { id: u.id, email: u.email, fullName: u.fullName, role: roles[0], roles }, token, forcePasswordChange } });
  } catch {
    return res.status(500).json({ error: 'Sign in is temporarily unavailable. Please try again.' });
  }
}
