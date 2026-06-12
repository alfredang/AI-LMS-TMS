import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';

/**
 * External API — Create Learner Account
 *
 * POST /api/external/learners
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Body (JSON):
 *   {
 *     "learner_name": "Jane Doe",
 *     "learner_email": "jane@example.com",
 *     "nric": "S1234567A",          (optional)
 *     "contact": "91234567",         (optional)
 *     "company": "Acme Pte Ltd",     (optional)
 *     "password": "Welcome@123"      (optional — auto-generated if omitted)
 *   }
 *
 * Returns the created (or existing) learner.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const { learner_name, learner_email, nric, contact, company, password } = req.body ?? {};

  if (!learner_name || !learner_email) {
    return res.status(400).json({ success: false, error: 'learner_name and learner_email are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const emailLower = learner_email.trim().toLowerCase();

    // Check if user already exists
    const existing = await client.query(
      `SELECT id, full_name, email, account_status FROM app_user WHERE LOWER(email) = $1`,
      [emailLower]
    );

    let userId: string;
    let created = false;

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;

      // Reactivate if disabled
      if (existing.rows[0].account_status !== 'active') {
        await client.query(
          `UPDATE app_user SET account_status = 'active', full_name = $1, updated_at = NOW() WHERE id = $2`,
          [learner_name.trim(), userId]
        );
      }
    } else {
      // Create new user
      const plainPassword = password || `Learn@${Date.now().toString(36)}`;
      const passwordHash = await bcrypt.hash(plainPassword, 10);

      const result = await client.query(
        `INSERT INTO app_user (email, full_name, password, password_hash, account_status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id`,
        [emailLower, learner_name.trim(), plainPassword, passwordHash]
      );
      userId = result.rows[0].id;
      created = true;
    }

    // Ensure Learner role
    await client.query(
      `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`,
      [userId]
    );

    // Ensure learner_profile
    await client.query(
      `INSERT INTO learner_profile (user_id, tel, nric, company)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         tel = COALESCE(NULLIF($2, ''), learner_profile.tel),
         nric = COALESCE(NULLIF($3, ''), learner_profile.nric),
         company = COALESCE(NULLIF($4, ''), learner_profile.company)`,
      [userId, contact || '', nric || null, company || null]
    );

    await client.query('COMMIT');

    return res.status(created ? 201 : 200).json({
      success: true,
      created,
      message: created ? 'Learner account created' : 'Learner already exists',
      data: {
        learner_id: userId,
        learner_name: learner_name.trim(),
        learner_email: emailLower,
        nric: nric || null,
        contact: contact || null,
        company: company || null,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('external/learners error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
}
