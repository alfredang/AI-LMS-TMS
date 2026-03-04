import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';

// Maps SSG sponsorship values to the course_sponsorship DB enum
function mapSponsorshipType(ssgType: string): 'Self-Sponsored' | 'Employer-Sponsored' | 'N/A' {
  if (ssgType === 'EMPLOYER') return 'Employer-Sponsored';
  if (ssgType === 'INDIVIDUAL') return 'Self-Sponsored';
  return 'N/A';
}

// Derive a readable name from an email address as a last-resort fallback
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const {
    traineeEmail,
    courseReferenceNumber,
    courseRunId,
    sponsorshipType,
    traineeName,
    traineeNric,
  } = req.body;

  if (!traineeEmail || !courseReferenceNumber || !courseRunId) {
    return res.status(400).json({
      success: false,
      error: 'traineeEmail, courseReferenceNumber, and courseRunId are required',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── 1. Ensure learner exists in app_user ─────────────────────────────────
    let learnerRow = await client.query(
      `SELECT id FROM app_user WHERE email = $1 LIMIT 1`,
      [traineeEmail]
    );

    let learnerId: string;
    let learnerCreated = false;

    if (learnerRow.rows.length === 0) {
      // Create the app_user with a placeholder password (user must reset later)
      const fullName = traineeName || nameFromEmail(traineeEmail);
      const placeholderPwd = `ssg_import_${Date.now()}`;

      const inserted = await client.query(
        `INSERT INTO app_user (email, password, password_hash, full_name)
         VALUES ($1, $2, $2, $3)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [traineeEmail, placeholderPwd, fullName]
      );

      if (inserted.rows.length > 0) {
        learnerId = inserted.rows[0].id;
        learnerCreated = true;
      } else {
        // Race condition: another request inserted between our SELECT and INSERT
        const existing = await client.query(
          `SELECT id FROM app_user WHERE email = $1 LIMIT 1`,
          [traineeEmail]
        );
        learnerId = existing.rows[0].id;
      }

      if (learnerCreated) {
        // 1b. Create learner_profile (PK = user_id)
        await client.query(
          `INSERT INTO learner_profile (user_id, tel, nric)
           VALUES ($1, '', $2)
           ON CONFLICT (user_id) DO NOTHING`,
          [learnerId, traineeNric || null]
        );

        // 1c. Assign the Learner role
        await client.query(
          `INSERT INTO user_role_map (user_id, role)
           VALUES ($1, 'Learner')
           ON CONFLICT (user_id, role) DO NOTHING`,
          [learnerId]
        );
      }
    } else {
      learnerId = learnerRow.rows[0].id;
    }

    // ── 2. Ensure course exists ──────────────────────────────────────────────
    // course has UNIQUE (course_code), so we can upsert safely.
    // title defaults to the course code when auto-created; admins can update it later.
    let courseRow = await client.query(
      `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
      [courseReferenceNumber]
    );

    let courseId: string;
    let courseCreated = false;

    if (courseRow.rows.length === 0) {
      const inserted = await client.query(
        `INSERT INTO course (title, course_code, enrollment_status, created_at, updated_at)
         VALUES ($1, $2, 'not-enrolled', NOW(), NOW())
         ON CONFLICT (course_code) DO NOTHING
         RETURNING id`,
        [courseReferenceNumber, courseReferenceNumber]
      );

      if (inserted.rows.length > 0) {
        courseId = inserted.rows[0].id;
        courseCreated = true;
      } else {
        const existing = await client.query(
          `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
          [courseReferenceNumber]
        );
        courseId = existing.rows[0].id;
      }
    } else {
      courseId = courseRow.rows[0].id;
    }

    // ── 3. Ensure course_run exists ──────────────────────────────────────────
    // course_run has UNIQUE (course_id, course_run_id).
    // Note: course_run_id here is the external SSG varchar ID (e.g. "101"),
    //       NOT the internal UUID primary key.
    let courseRunRow = await client.query(
      `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
      [courseRunId]
    );

    let courseRunUuid: string;
    let courseRunCreated = false;

    if (courseRunRow.rows.length === 0) {
      const inserted = await client.query(
        `INSERT INTO course_run (course_id, course_run_id, class_status, created_at, updated_at)
         VALUES ($1, $2, 'Confirmed', NOW(), NOW())
         ON CONFLICT (course_id, course_run_id) DO NOTHING
         RETURNING id`,
        [courseId, courseRunId]
      );

      if (inserted.rows.length > 0) {
        courseRunUuid = inserted.rows[0].id;
        courseRunCreated = true;
      } else {
        const existing = await client.query(
          `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
          [courseRunId]
        );
        courseRunUuid = existing.rows[0].id;
      }
    } else {
      courseRunUuid = courseRunRow.rows[0].id;
    }

    // ── 4. Upsert enrollment ─────────────────────────────────────────────────
    // enrollment has UNIQUE (user_id, course_run_id).
    const sponsorship = mapSponsorshipType(sponsorshipType || 'INDIVIDUAL');

    const enrollResult = await client.query(
      `INSERT INTO enrollment
         (user_id, course_id, course_run_id, payment_status, assessment_status,
          progress_percent, course_sponsorship, enrolment_date)
       VALUES ($1, $2, $3, 'Unpaid', 'Pending', 0, $4, NOW())
       ON CONFLICT (user_id, course_run_id) DO NOTHING
       RETURNING id`,
      [learnerId, courseId, courseRunUuid, sponsorship]
    );

    await client.query('COMMIT');

    const enrollmentCreated = enrollResult.rows.length > 0;

    return res.status(200).json({
      success: true,
      enrollmentCreated,
      alreadyExisted: !enrollmentCreated,
      enrollmentId: enrollResult.rows[0]?.id ?? null,
      created: {
        learner: learnerCreated,
        course: courseCreated,
        courseRun: courseRunCreated,
      },
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in post-ssg-enrol:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  } finally {
    client.release();
  }
}
