import pool from '@/lib/db';
import { getTrainingPartnerIdentifiers } from '@/lib/trainingPartnerIdentifiers';
import { upsertSsgEnrolmentFromLocalEnrollment } from '@/lib/services/billingSync';
import { isEnrolmentEligibleForAutoInvoice } from '@/lib/services/invoiceEligibility';
import { enqueueInvoiceJob } from '@/lib/services/invoiceJobs';
import { ensureDaApplicationForEnrolment } from '@/lib/services/daApplicationFromEnrolment';
import { COURSE_ID_BY_ANY_CODE_SQL } from '../courseCode';

export interface PostSsgEnrolSyncInput {
  traineeEmail: string;
  courseReferenceNumber: string;
  courseRunId: string;
  sponsorshipType?: string;
  traineeName?: string;
  traineeNric?: string;
  enrolmentId?: string | null;
  enrolmentStatus?: string | null;
}

export interface PostSsgEnrolSyncResult {
  enrollmentCreated: boolean;
  dbEnrollmentId: string | null;
  alreadyExisted: boolean;
  created: { learner: boolean; course: boolean; courseRun: boolean };
}

function mapSponsorshipType(ssgType: string): 'Individual' | 'Employer' {
  if (ssgType?.toUpperCase().includes('EMPLOYER')) return 'Employer';
  return 'Individual';
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * SSG create-enrolment responses sometimes put referenceNumber/status on `data`,
 * sometimes under `data.enrolment`. Normalize so clients always read `data.enrolment.*`.
 */
export function normalizeSsgCreateEnrolmentData(raw: unknown): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object') {
    return { enrolment: {} };
  }
  const inner = raw as Record<string, unknown>;
  const en = inner.enrolment;
  const enObj = en && typeof en === 'object' ? (en as Record<string, unknown>) : {};
  const ref =
    (typeof enObj.referenceNumber === 'string' ? enObj.referenceNumber : undefined) ??
    (typeof inner.referenceNumber === 'string' ? inner.referenceNumber : undefined) ??
    (typeof inner.enrolmentReferenceNumber === 'string' ? inner.enrolmentReferenceNumber : undefined);
  const status =
    (typeof enObj.status === 'string' ? enObj.status : undefined) ??
    (typeof inner.status === 'string' ? inner.status : undefined);

  return {
    ...inner,
    enrolment: {
      ...enObj,
      referenceNumber: ref ?? enObj.referenceNumber,
      status: status ?? enObj.status,
    },
  };
}

/**
 * Upsert local learner / course / course_run / enrollment and enqueue QBO invoice when eligible.
 * Shared by POST /api/enrolments/post-ssg-enrol and POST /api/enrolment/create (server-side).
 */
export async function runPostSsgEnrolSync(input: PostSsgEnrolSyncInput): Promise<PostSsgEnrolSyncResult> {
  const {
    traineeEmail,
    courseReferenceNumber,
    courseRunId,
    sponsorshipType,
    traineeName,
    traineeNric,
    enrolmentId,
    enrolmentStatus,
  } = input;

  const tp = await getTrainingPartnerIdentifiers();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let learnerRow = await client.query(`SELECT id FROM app_user WHERE LOWER(email) = LOWER($1) LIMIT 1`, [traineeEmail]);

    let learnerId: string;
    let learnerCreated = false;

    if (learnerRow.rows.length === 0) {
      const fullName = traineeName || nameFromEmail(traineeEmail);
      const placeholderPwd = `ssg_import_${Date.now()}`;

      const inserted = await client.query(
        `INSERT INTO app_user (email, password, password_hash, full_name)
         VALUES ($1, $2, $2, $3)
         ON CONFLICT ((LOWER(email))) DO NOTHING
         RETURNING id`,
        [traineeEmail, placeholderPwd, fullName]
      );

      if (inserted.rows.length > 0) {
        learnerId = inserted.rows[0].id;
        learnerCreated = true;
      } else {
        const existing = await client.query(`SELECT id FROM app_user WHERE LOWER(email) = LOWER($1) LIMIT 1`, [traineeEmail]);
        learnerId = existing.rows[0].id;
      }

      if (learnerCreated) {
        await client.query(
          `INSERT INTO learner_profile (user_id, tel, nric)
           VALUES ($1, '', $2)
           ON CONFLICT (user_id) DO NOTHING`,
          [learnerId, traineeNric || null]
        );

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

    let courseRow = await client.query(COURSE_ID_BY_ANY_CODE_SQL, [courseReferenceNumber]);

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
        const existing = await client.query(COURSE_ID_BY_ANY_CODE_SQL, [courseReferenceNumber]);
        courseId = existing.rows[0].id;
      }
    } else {
      courseId = courseRow.rows[0].id;
    }

    let courseRunRow = await client.query(`SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`, [courseRunId]);

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
        const existing = await client.query(`SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`, [courseRunId]);
        courseRunUuid = existing.rows[0].id;
      }
    } else {
      courseRunUuid = courseRunRow.rows[0].id;
    }

    const sponsorship = mapSponsorshipType(sponsorshipType || 'INDIVIDUAL');
    const resolvedEnrolmentStatus = ((enrolmentStatus as string | undefined) || '').trim() || 'Confirmed';

    const rawData = JSON.stringify({
      course: {
        run: { id: courseRunId },
        referenceNumber: courseReferenceNumber,
      },
      status: resolvedEnrolmentStatus,
      trainee: {
        id: traineeNric || '',
        email: { full: traineeEmail },
        fullName: traineeName || '',
        sponsorshipType: sponsorship,
        fees: { collectionStatus: 'Pending Payment', discountAmount: '0' },
      },
      referenceNumber: enrolmentId || '',
      trainingPartner: {
        uen: tp.uen,
        code: tp.code,
        name: tp.name,
      },
    });

    // Same SSG enrolment may already exist under a different app_user (email
    // corrected upstream). Update that row instead of inserting a duplicate.
    let enrollResult;
    const dupe = enrolmentId
      ? await client.query(
          `SELECT id, user_id FROM enrollment WHERE course_run_id = $1 AND enrolment_id = $2 LIMIT 1`,
          [courseRunUuid, enrolmentId]
        )
      : { rows: [] as any[] };
    if (dupe.rows.length > 0 && dupe.rows[0].user_id !== learnerId) {
      enrollResult = await client.query(
        `UPDATE enrollment SET
           enrolment_status = COALESCE($2, enrolment_status),
           nric             = COALESCE($3, nric),
           raw_data         = COALESCE($4::jsonb, raw_data),
           updated_at       = NOW()
         WHERE id = $1
         RETURNING id`,
        [dupe.rows[0].id, resolvedEnrolmentStatus, traineeNric || null, rawData]
      );
    } else enrollResult = await client.query(
      `INSERT INTO enrollment
         (user_id, course_id, course_run_id, payment_status, assessment_status,
          progress_percent, course_sponsorship, enrolment_date,
          enrolment_id, enrolment_status, nric, email, course_reference,
          training_partner_code, raw_data)
       VALUES ($1, $2, $3, 'Unpaid', 'Pending', 0, $4, NOW(),
               $5, $6, $7, $8, $9, $11, $10)
       ON CONFLICT (user_id, course_run_id) DO UPDATE SET
         enrolment_id     = COALESCE(EXCLUDED.enrolment_id,     enrollment.enrolment_id),
         enrolment_status = COALESCE(EXCLUDED.enrolment_status, enrollment.enrolment_status),
         raw_data         = COALESCE(EXCLUDED.raw_data,         enrollment.raw_data),
         updated_at       = NOW()
       RETURNING id`,
      [
        learnerId,
        courseId,
        courseRunUuid,
        sponsorship,
        enrolmentId || null,
        resolvedEnrolmentStatus,
        traineeNric || null,
        traineeEmail,
        courseReferenceNumber,
        rawData,
        tp.code,
      ]
    );

    await client.query('COMMIT');

    const enrollmentCreated = enrollResult.rows.length > 0;
    const dbEnrollmentId: string | null = enrollResult.rows[0]?.id ?? null;

    const trimmedEnrolmentId = (enrolmentId || '').trim();
    const statusForInvoice = resolvedEnrolmentStatus;
    if (trimmedEnrolmentId && dbEnrollmentId && isEnrolmentEligibleForAutoInvoice(statusForInvoice)) {
      // Hand the learner to the Direct Application pipeline: it is the only path
      // that does calendar sync plus the full invoice set (main tax + Grant +
      // SFC), and rows it owns are covered by the nightly DA sweep if anything
      // fails. Enrolling here used to stop at a main-invoice-only queue job.
      let handedToDaPipeline = false;
      try {
        const daRow = await ensureDaApplicationForEnrolment({
          enrolmentId: trimmedEnrolmentId,
          userId: learnerId,
          learnerEmail: traineeEmail,
          courseReferenceNumber,
          courseRunId,
          traineeName,
          traineeNric,
          sponsorshipType,
        });

        if (daRow) {
          handedToDaPipeline = true;
          console.log(
            `[post-ssg-enrol] ${trimmedEnrolmentId} → DA application ${daRow.applicationId} (${daRow.created ? 'created' : 'refreshed'}); running DA pipeline`
          );
          // Fire-and-forget, and imported lazily: the DA pipeline makes slow SSG
          // and QuickBooks calls, and the caller is an interactive enrol action.
          void import('../autoEnrolDirectApplications')
            .then(({ processDirectApplication }) =>
              processDirectApplication(daRow.daApplicationId, undefined, { sendInvoiceEmail: true })
            )
            .catch((e: unknown) =>
              console.warn('[post-ssg-enrol] DA pipeline run failed (non-blocking):', e)
            );
        }
      } catch (e) {
        console.warn('[post-ssg-enrol] DA application bridge failed (non-blocking):', e);
      }

      // Fallback only. Running both would cut two invoices for one learner —
      // the DA pipeline creates its own, so the queue job is skipped whenever
      // the bridge took ownership.
      if (!handedToDaPipeline) {
        try {
          await enqueueInvoiceJob({
            enrolmentId: trimmedEnrolmentId,
            userId: learnerId,
            learnerEmail: traineeEmail,
            courseCode: courseReferenceNumber,
            batchId: null,
          });
        } catch (e) {
          console.warn('[post-ssg-enrol] Failed to enqueue invoice job (non-blocking):', e);
        }
      }
    }

    if (trimmedEnrolmentId) {
      void upsertSsgEnrolmentFromLocalEnrollment(trimmedEnrolmentId).catch((e: unknown) =>
        console.warn('[post-ssg-enrol] ssg_enrolments mirror failed (non-blocking):', e)
      );
    }

    return {
      enrollmentCreated,
      dbEnrollmentId,
      alreadyExisted: !enrollmentCreated,
      created: {
        learner: learnerCreated,
        course: courseCreated,
        courseRun: courseRunCreated,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
