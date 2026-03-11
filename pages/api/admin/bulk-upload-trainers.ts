import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';

interface TrainerRow {
  full_name: string;
  email: string;
  telephone: string;
  trainer_type: string;
  gender: string;
  status: string;
  linkedin_url?: string;
  common_name?: string;
  country?: string;
  cn_plus_email?: string;
  nric?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { trainers } = req.body as { trainers: TrainerRow[] };

  if (!Array.isArray(trainers) || trainers.length === 0) {
    return res.status(400).json({ success: false, message: 'No trainer data provided.' });
  }

  const DEFAULT_PASSWORD = 'password123';
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, saltRounds);

  const results: Array<{
    email: string;
    full_name: string;
    action: 'created' | 'updated' | 'failed';
    message: string;
  }> = [];

  let created = 0;
  let updated = 0;
  let failed = 0;

  const client = await pool.connect();

  try {
    for (const trainer of trainers) {
      const { full_name, telephone, trainer_type, gender, status, linkedin_url, common_name, country, cn_plus_email, nric } = trainer;
      // If the email cell contains multiple semicolon-separated addresses, use only the first one as the login email
      const emailParts = trainer.email ? trainer.email.split(';').map(e => e.trim().toLowerCase()).filter(Boolean) : [];
      const email = emailParts[0] || '';
      const secondaryEmail = emailParts[1] || null;

      // Basic validation — telephone, trainer_type can be empty from the template
      if (!email || !full_name) {
        results.push({
          email: email || '(unknown)',
          full_name: full_name || '(unknown)',
          action: 'failed',
          message: 'Missing required fields: Full Name and Email are required.',
        });
        failed++;
        continue;
      }

      try {
        await client.query('BEGIN');

        // Check if user already exists by matching any of the emails from the spreadsheet
        // against both email and secondary_email columns in app_user
        const existingUser = secondaryEmail
          ? await client.query(
              `SELECT id, email, secondary_email FROM app_user
               WHERE LOWER(email) = $1 OR LOWER(email) = $2
                  OR LOWER(secondary_email) = $1 OR LOWER(secondary_email) = $2`,
              [email, secondaryEmail]
            )
          : await client.query(
              `SELECT id, email, secondary_email FROM app_user
               WHERE LOWER(email) = $1 OR LOWER(secondary_email) = $1`,
              [email]
            );

        if (existingUser.rows.length > 0) {
          // UPDATE existing trainer
          const userId = existingUser.rows[0].id;
          const dbEmail = existingUser.rows[0].email.toLowerCase();
          const dbSecondary = existingUser.rows[0].secondary_email?.toLowerCase() || null;

          // Determine which email from the spreadsheet is not yet stored, and set it as secondary
          const resolvedSecondary = emailParts.find(e => e !== dbEmail && e !== dbSecondary) || dbSecondary;

          await client.query(
            `UPDATE app_user SET full_name = $1, secondary_email = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [full_name, resolvedSecondary, userId]
          );

          // Upsert trainer_profile
          const existingProfile = await client.query(
            'SELECT user_id FROM trainer_profile WHERE user_id = $1',
            [userId]
          );

          if (existingProfile.rows.length > 0) {
            await client.query(
              `UPDATE trainer_profile
               SET tel = $1, trainer_type = $2, status = $3, linkedin_url = $4, gender = $5,
                   common_name = $6, country = $7, cn_plus_email = $8, nric = $9
               WHERE user_id = $10`,
              [telephone || '', trainer_type || 'ACLP', status || 'Active', linkedin_url || null,
               gender || 'Prefer not to say', common_name || null, country || null, cn_plus_email || null, nric || null, userId]
            );
          } else {
            await client.query(
              `INSERT INTO trainer_profile (user_id, tel, trainer_type, status, linkedin_url, gender, common_name, country, cn_plus_email, nric)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [userId, telephone || '', trainer_type || 'ACLP', status || 'Active', linkedin_url || null,
               gender || 'Prefer not to say', common_name || null, country || null, cn_plus_email || null, nric || null]
            );
          }

          await client.query('COMMIT');
          results.push({ email, full_name, action: 'updated', message: 'Trainer information updated successfully.' });
          updated++;
        } else {
          // CREATE new trainer
          const userResult = await client.query(
            `INSERT INTO app_user (email, secondary_email, password, password_hash, full_name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING id`,
            [email, secondaryEmail, DEFAULT_PASSWORD, hashedPassword, full_name]
          );

          const userId = userResult.rows[0].id;

          await client.query(
            `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Trainer')`,
            [userId]
          );

          await client.query(
            `INSERT INTO trainer_profile (user_id, tel, trainer_type, status, linkedin_url, gender, common_name, country, cn_plus_email, nric)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [userId, telephone || '', trainer_type || 'ACLP', status || 'Active', linkedin_url || null,
             gender || 'Prefer not to say', common_name || null, country || null, cn_plus_email || null, nric || null]
          );

          await client.query('COMMIT');
          results.push({ email, full_name, action: 'created', message: 'Trainer account created with default password.' });
          created++;
        }
      } catch (rowError) {
        await client.query('ROLLBACK');
        const msg = rowError instanceof Error ? rowError.message : 'Unknown error';
        results.push({ email, full_name, action: 'failed', message: msg });
        failed++;
      }
    }
  } finally {
    client.release();
  }

  return res.status(200).json({
    success: true,
    data: { created, updated, failed, results },
  });
}
