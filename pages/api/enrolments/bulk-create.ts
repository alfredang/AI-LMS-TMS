import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import crypto from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await pool.connect();

  try {
    const { enrolment } = req.body;

    if (!enrolment) {
      return res.status(400).json({ error: 'Enrolment data is required' });
    }

    await client.query('BEGIN');

    // Extract enrolment data
    const {
      traineeEmail,
      traineeName,
      traineeNric,
      courseCode,
      courseTitle,
      courseRunId,
      courseReferenceNumber,
      trainingPartnerCode,
      sponsorshipType,
      enrolmentDate,
      enrolmentStatus,
      enrolmentId,
      completionDate,
    } = enrolment;

    // Map sponsorship type to valid DB enum values
    const mapSponsorship = (type: string | undefined): 'Self-Sponsored' | 'Employer-Sponsored' | 'N/A' => {
      if (!type) return 'Self-Sponsored';
      const t = type.toUpperCase();
      if (t === 'EMPLOYER' || t === 'EMPLOYER-SPONSORED' || t === 'EMPLOYER SPONSORED') return 'Employer-Sponsored';
      if (t === 'INDIVIDUAL' || t === 'SELF-SPONSORED' || t === 'SELF SPONSORED' || t === 'SELF-FUNDED' || t === 'SELF FUNDED') return 'Self-Sponsored';
      return 'Self-Sponsored';
    };

    // 1. Check if course exists by course_code
    let courseResult = await client.query(
      'SELECT id FROM course WHERE course_code = $1',
      [courseCode]
    );

    let courseId: string;

    if (courseResult.rows.length === 0) {
      // Course doesn't exist, create it
      courseId = crypto.randomUUID();
      await client.query(
        `INSERT INTO course (
          id, course_code, title, status, enrollment_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [courseId, courseCode, courseTitle || 'Untitled Course', 'Published', 'enrolled']
      );
      console.log(`✅ Created new course with code: ${courseCode}`);
    } else {
      courseId = courseResult.rows[0].id;
      console.log(`✅ Found existing course: ${courseId}`);
    }

    // 2. Check if learner account exists
    let userResult = await client.query(
      'SELECT id FROM app_user WHERE email = $1',
      [traineeEmail]
    );

    let userId: string;

    if (userResult.rows.length === 0) {
      // Create learner account
      userId = crypto.randomUUID();

      await client.query(
        `INSERT INTO app_user (
          id, email, full_name, password, password_hash, account_status, created_at
        ) VALUES ($1, $2, $3, $4, $4, 'active', NOW())`,
        [userId, traineeEmail, traineeName || traineeEmail, 'password123']
      );

      // Assign Learner role
      await client.query(
        `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`,
        [userId]
      );

      // Create learner profile
      await client.query(
        `INSERT INTO learner_profile (user_id, nric, tel) VALUES ($1, $2, '')`,
        [userId, traineeNric || null]
      );

      console.log(`✅ Created new learner account: ${traineeEmail}`);
    } else {
      userId = userResult.rows[0].id;
      console.log(`✅ Found existing learner: ${userId}`);
    }

    // 3. Check if course_run exists
    let courseRunResult = await client.query(
      'SELECT id FROM course_run WHERE course_run_id = $1',
      [courseRunId]
    );

    let courseRunUuid: string;

    if (courseRunResult.rows.length === 0) {
      // Create course run
      courseRunUuid = crypto.randomUUID();
      await client.query(
        `INSERT INTO course_run (
          id, course_id, course_run_id, class_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [courseRunUuid, courseId, courseRunId, 'Confirmed']
      );
      console.log(`✅ Created new course run: ${courseRunId}`);
    } else {
      courseRunUuid = courseRunResult.rows[0].id;
      console.log(`✅ Found existing course run: ${courseRunUuid}`);
    }

    // 4. Check if enrollment already exists
    const existingEnrolment = await client.query(
      `SELECT id FROM enrollment 
       WHERE user_id = $1 AND course_id = $2 AND course_run_id = $3`,
      [userId, courseId, courseRunUuid]
    );

    if (existingEnrolment.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: {
          message: 'Duplicate enrolment',
          details: [
            {
              field: 'enrolment',
              message: 'Duplicate record found'
            }
          ]
        }
      });
    }

    // 5. Insert enrollment
    const enrolmentUuid = crypto.randomUUID();
    await client.query(
      `INSERT INTO enrollment (
        id, user_id, course_id, course_run_id,
        course_sponsorship, enrolment_date,
        progress_percent, payment_status, assessment_status,
        enrolment_id, enrolment_status,
        nric, email,
        course_reference, training_partner_code,
        completion_date, raw_data,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())`,
      [
        enrolmentUuid,
        userId,
        courseId,
        courseRunUuid,
        mapSponsorship(sponsorshipType),
        enrolmentDate || new Date().toISOString().split('T')[0],
        'Unpaid',
        'Pending',
        enrolmentId || null,
        enrolmentStatus || null,
        traineeNric || null,
        traineeEmail || null,
        courseReferenceNumber || null,
        trainingPartnerCode || null,
        completionDate || null,
        enrolment ? JSON.stringify(enrolment) : null,
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      data: {
        enrolment: {
          referenceNumber: enrolmentId || `ENR-${Date.now()}`,
          status: enrolmentStatus || 'Confirmed'
        }
      }
    });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating enrolment:', error);
    
    return res.status(500).json({
      success: false,
      error: {
        message: 'Failed to create enrolment',
        details: [
          {
            field: 'server',
            message: error.message || 'Internal server error'
          }
        ]
      }
    });
  } finally {
    client.release();
  }
}
