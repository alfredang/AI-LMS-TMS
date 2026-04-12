import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { inferIdType } from '../../../lib/utils/id-type';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { isEnrolmentEligibleForAutoInvoice } from '../../../lib/services/invoiceEligibility';
import { enqueueInvoiceJob } from '../../../lib/services/invoiceJobs';

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
      traineeEmail: rawEmail,
      traineeName,
      traineeNric,
      courseCode,
      courseTitle,
      courseRunId,
      courseReferenceNumber,
      trainingPartnerCode: rawTrainingPartnerCode,
      sponsorshipType,
      enrolmentDate,
      enrolmentStatus,
      enrolmentId,
      completionDate,
      ssgData,
    } = enrolment;

    const traineeEmail = rawEmail?.toLowerCase().trim();
    const tp = await getTrainingPartnerIdentifiers();
    const trainingPartnerCode = rawTrainingPartnerCode || tp.code;

    // Map sponsorship type to valid DB enum values ('Individual' | 'Employer')
    const mapSponsorship = (type: string | undefined): 'Individual' | 'Employer' => {
      if (!type) return 'Individual';
      const t = type.toUpperCase();
      if (t.includes('EMPLOYER')) return 'Employer';
      return 'Individual';
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

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(tp.defaultPassword, salt);

      await client.query(
        `INSERT INTO app_user (
          id, email, full_name, password, password_hash, account_status, created_at
        ) VALUES ($1, $2, $3, $4, $5, 'active', NOW())`,
        [userId, traineeEmail, traineeName || traineeEmail, tp.defaultPassword, hashedPassword]
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

    // 4. Check if enrollment already exists by SSG enrolment_id
    if (enrolmentId) {
      const existingEnrolment = await client.query(
        `SELECT id FROM enrollment WHERE enrolment_id = $1 LIMIT 1`,
        [enrolmentId]
      );

      if (existingEnrolment.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: {
            message: 'Duplicate enrolment',
            details: [{ field: 'enrolment', message: 'Duplicate record found' }]
          }
        });
      }
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
        JSON.stringify({
          course: {
            run: {
              id: courseRunId,
              endDate: ssgData?.course?.run?.endDate || '',
              startDate: ssgData?.course?.run?.startDate || '',
            },
            title: ssgData?.course?.title || courseTitle || '',
            referenceNumber: courseReferenceNumber,
          },
          status: enrolmentStatus || 'Confirmed',
          trainee: {
            id: traineeNric || '',
            fees: {
              discountAmount: ssgData?.trainee?.fees?.discountAmount || '0',
              collectionStatus: ssgData?.trainee?.fees?.collectionStatus || 'Pending Payment',
            },
            email: { full: traineeEmail },
            idType: { type: inferIdType(traineeNric || '', ssgData?.trainee?.idType?.type) },
            employer: ssgData?.trainee?.employer || {
              uen: '', name: '',
              contact: { email: { full: '' }, fullName: '', contactNumber: { areaCode: '', countryCode: '', phoneNumber: '' } }
            },
            fullName: traineeName || '',
            dateOfBirth: ssgData?.trainee?.dateOfBirth || '',
            contactNumber: ssgData?.trainee?.contactNumber || { areaCode: '', countryCode: '', phoneNumber: '' },
            enrolmentDate: enrolmentDate || new Date().toISOString().split('T')[0],
            sponsorshipType: mapSponsorship(sponsorshipType),
          },
          referenceNumber: enrolmentId || '',
          trainingPartner: {
            uen: tp.uen,
            code: trainingPartnerCode,
            name: tp.name,
          },
        }),
      ]
    );

    await client.query('COMMIT');

    const st = (enrolmentStatus as string | undefined) || 'Confirmed';
    if (enrolmentId && userId && traineeEmail && courseCode && isEnrolmentEligibleForAutoInvoice(st)) {
      try {
        await enqueueInvoiceJob({
          enrolmentId,
          userId,
          learnerEmail: traineeEmail,
          courseCode,
          batchId: null,
        });
      } catch (e) {
        console.warn('[enrolments/bulk-create] Failed to enqueue invoice job (non-blocking):', e);
      }
    }

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
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error creating enrolment:', error);

    // Unique constraint violations → 400 instead of 500
    const isUniqueViolation = error.code === '23505'; // PostgreSQL unique_violation
    const isCheckViolation = error.code === '23514';  // PostgreSQL check_violation
    const isNotNullViolation = error.code === '23502'; // PostgreSQL not_null_violation

    if (isUniqueViolation) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Duplicate enrolment — trainee is already enrolled in this course run',
          details: [{ field: 'enrolment', message: error.detail || 'Duplicate record' }]
        }
      });
    }

    if (isCheckViolation || isNotNullViolation) {
      return res.status(400).json({
        success: false,
        error: {
          message: `Invalid data: ${error.message}`,
          details: [{ field: error.column || 'unknown', message: error.message }]
        }
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        message: error.message || 'Failed to create enrolment',
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
