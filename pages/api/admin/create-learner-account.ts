import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
// POST { email, fullName, nric?, courseRunId?, courseId?, enrolmentId? }
// Creates a Learner account if one doesn't already exist for that email.
// If courseRunId + courseId are provided, also enrolls the learner into the course run.

async function ensureEnrolmentSyncLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enrolment_sync_log (
      id               SERIAL PRIMARY KEY,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      enrolment_id     TEXT,
      email            TEXT,
      full_name        TEXT,
      nric             TEXT,
      course_run_id    TEXT,
      course_reference TEXT,
      enrolment_status TEXT,
      sponsorship_type TEXT,
      payment_status   TEXT,
      action           TEXT NOT NULL,  -- 'inserted' | 'updated' | 'skipped'
      account_action   TEXT NOT NULL,  -- 'created' | 'existed'
      source           TEXT,
      error_message    TEXT
    )
  `);
}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  await ensureEnrolmentSyncLogTable();

  const {
    email, fullName, nric, courseRunId, courseId, enrolmentId,
    enrolmentStatus, sponsorshipType, enrolmentDate, courseReference, tpCode, paymentCollectionStatus, rawData,
  } = req.body as {
    email: string;
    fullName: string;
    nric?: string;
    courseRunId?: string;
    courseId?: string;
    enrolmentId?: string;
    enrolmentStatus?: string;
    sponsorshipType?: string;
    enrolmentDate?: string;
    courseReference?: string;
    tpCode?: string;
    paymentCollectionStatus?: string;
    rawData?: any;
  };

  // Map SSG payment collection status → DB enum
  const mappedPaymentStatus = (() => {
    if (!paymentCollectionStatus) return null;
    const s = paymentCollectionStatus.toLowerCase();
    return (s === 'paid' || s === 'full payment') ? 'Paid' : 'Unpaid';
  })();

  // Map SSG sponsorship → DB enum (only 'Individual' and 'Employer' are valid)
  const mappedSponsorship = (sponsorshipType === 'Individual' || sponsorshipType === 'Employer')
    ? sponsorshipType : null;

  if (!email || !fullName) {
    return res.status(400).json({ success: false, message: 'email and fullName are required' });
  }

  const client = await pool.connect();
  const tp = await getTrainingPartnerIdentifiers();

  // Helper: enroll user into a course run, or update missing fields on an existing row
  // Returns 'inserted' | 'updated' | 'skipped'
  const ensureEnrollment = async (userId: string): Promise<'inserted' | 'updated' | 'skipped'> => {
    if (!courseRunId || !courseId) return 'skipped';
    const result = await client.query(
      `INSERT INTO enrollment
         (user_id, course_id, course_run_id, enrolment_date, enrolment_id, nric, email,
          enrolment_status, course_sponsorship, training_partner_code, course_reference, payment_status, raw_data)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7,
               $8, $9::public.course_sponsorship, $10, $11, $12::public.learner_payment_status, $13::jsonb)
       ON CONFLICT (user_id, course_run_id) DO UPDATE SET
         enrolment_id          = COALESCE(EXCLUDED.enrolment_id,          enrollment.enrolment_id),
         nric                  = COALESCE(EXCLUDED.nric,                  enrollment.nric),
         email                 = COALESCE(EXCLUDED.email,                 enrollment.email),
         enrolment_status      = COALESCE(EXCLUDED.enrolment_status,      enrollment.enrolment_status),
         course_sponsorship    = COALESCE(EXCLUDED.course_sponsorship,    enrollment.course_sponsorship),
         training_partner_code = COALESCE(EXCLUDED.training_partner_code, enrollment.training_partner_code),
         course_reference      = COALESCE(EXCLUDED.course_reference,      enrollment.course_reference),
         payment_status        = COALESCE(EXCLUDED.payment_status,        enrollment.payment_status),
         enrolment_date        = COALESCE(EXCLUDED.enrolment_date,        enrollment.enrolment_date),
         raw_data              = COALESCE(EXCLUDED.raw_data,              enrollment.raw_data),
         updated_at            = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        userId, courseId, courseRunId,
        enrolmentDate || null,
        enrolmentId || null,
        nric?.trim() || null,
        email.trim().toLowerCase(),
        enrolmentStatus || null,
        mappedSponsorship,
        tpCode || null,
        courseReference || null,
        mappedPaymentStatus,
        rawData ? JSON.stringify(rawData) : null,
      ]
    );
    const action: 'inserted' | 'updated' = result.rows[0]?.inserted ? 'inserted' : 'updated';
    if (action === 'inserted') {
      await client.query(
        `UPDATE app_user SET courses_updated_at = NOW() WHERE id = $1`,
        [userId]
      );
    }
    return action;
  };

  try {
    await client.query('BEGIN');

    // Check if user already exists
    const existing = await client.query(
      'SELECT id, full_name FROM app_user WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (existing.rows.length > 0) {
      const userId = existing.rows[0].id;
      const existingName = existing.rows[0].full_name || fullName.trim();
      await client.query(
        `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`,
        [userId]
      );
      const enrollAction = await ensureEnrollment(userId);
      await client.query('COMMIT');

      // Log the enrolment action
      await pool.query(
        `INSERT INTO enrolment_sync_log
           (enrolment_id, email, full_name, nric, course_run_id, course_reference,
            enrolment_status, sponsorship_type, payment_status, action, account_action, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'existed','e-attendance')`,
        [enrolmentId||null, email.trim().toLowerCase(), existingName, nric?.trim()||null,
         courseRunId||null, courseReference||null, enrolmentStatus||null,
         sponsorshipType||null, mappedPaymentStatus, enrollAction]
      ).catch(() => {});

      return res.status(200).json({
        success: true,
        message: 'Account already exists — Learner role and enrolment ensured.',
        userId,
        fullName: existingName,
        created: false,
      });
    }

    const passwordHash = await bcrypt.hash(tp.defaultPassword, 10);
    const insertUser = await client.query(
      `INSERT INTO app_user (email, full_name, password, password_hash, account_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
       RETURNING id`,
      [email.trim().toLowerCase(), fullName.trim(), tp.defaultPassword, passwordHash]
    );
    const userId = insertUser.rows[0].id;

    await client.query(
      `INSERT INTO learner_profile (user_id, tel, nric) VALUES ($1, '', $2)`,
      [userId, nric?.trim() || null]
    );
    await client.query(
      `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner')`,
      [userId]
    );

    const enrollAction = await ensureEnrollment(userId);
    await client.query('COMMIT');

    // Log the enrolment action
    await pool.query(
      `INSERT INTO enrolment_sync_log
         (enrolment_id, email, full_name, nric, course_run_id, course_reference,
          enrolment_status, sponsorship_type, payment_status, action, account_action, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created','e-attendance')`,
      [enrolmentId||null, email.trim().toLowerCase(), fullName.trim(), nric?.trim()||null,
       courseRunId||null, courseReference||null, enrolmentStatus||null,
       sponsorshipType||null, mappedPaymentStatus, enrollAction]
    ).catch(() => {});

    return res.status(201).json({
      success: true,
      message: `Learner account created and enrolled. Default password from Company Settings applied.`,
      userId,
      fullName: fullName.trim(),
      created: true,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error creating learner account:', error);

    // Log the error
    await pool.query(
      `INSERT INTO enrolment_sync_log
         (enrolment_id, email, full_name, nric, course_run_id, enrolment_status,
          action, account_action, source, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,'error','unknown','e-attendance',$7)`,
      [enrolmentId||null, email?.trim().toLowerCase()||null, fullName?.trim()||null,
       nric?.trim()||null, courseRunId||null, enrolmentStatus||null, msg]
    ).catch(() => {});

    return res.status(500).json({ success: false, message: msg });
  } finally {
    client.release();
  }
}
