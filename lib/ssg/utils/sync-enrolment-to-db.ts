/**
 * Syncs a single SSG enrolment object into the local database.
 * Idempotent: skips insertion if enrolment_id already exists.
 *
 * Accepts either:
 *   - a wrapped search result:  { enrolment: EnrolmentRecord }
 *   - a direct view result:     EnrolmentRecord
 */

import { PoolClient } from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { inferIdType } from '../../utils/id-type';
import { getTrainingPartnerIdentifiers } from '../../trainingPartnerIdentifiers';

function mapSponsorship(type: string | undefined): 'Individual' | 'Employer' {
  if (!type) return 'Individual';
  if (type.toUpperCase().includes('EMPLOYER')) return 'Employer';
  return 'Individual';
}

/**
 * @param client    An already-connected pg PoolClient (caller manages transaction/release)
 * @param input     SSG enrolment — either { enrolment: EnrolmentRecord } or EnrolmentRecord directly
 * @returns 'inserted' | 'skipped'
 */
export async function syncEnrolmentToDB(
  client: PoolClient,
  input: any
): Promise<'inserted' | 'skipped'> {
  // Unwrap search-result wrapper if present
  const record = input?.enrolment ?? input;

  const enrolmentId: string | undefined = record?.referenceNumber;
  if (!enrolmentId) return 'skipped';

  // ── 0. Skip if already in DB ─────────────────────────────────────────────
  const existing = await client.query(
    `SELECT id FROM enrollment WHERE enrolment_id = $1 LIMIT 1`,
    [enrolmentId]
  );
  if (existing.rows.length > 0) return 'skipped';

  // ── Extract fields ────────────────────────────────────────────────────────
  const trainee         = record.trainee          ?? {};
  const course          = record.course           ?? {};
  const run             = course.run              ?? {};
  const tp              = record.trainingPartner  ?? {};

  const traineeEmail    = trainee.email?.full?.toLowerCase().trim() ?? '';
  const traineeName     = trainee.fullName  ?? '';
  const traineeNric     = trainee.id        ?? null;
  const courseCode      = course.referenceNumber ?? '';
  const courseTitle     = course.title      ?? courseCode;
  const courseRunId     = run.id            ?? '';
  const enrolmentDate   = trainee.enrolmentDate ?? new Date().toISOString().split('T')[0];
  const enrolmentStatus = record.status     ?? 'Confirmed';
  const sponsorship     = mapSponsorship(trainee.sponsorshipType);
  const tpIdentifiers   = await getTrainingPartnerIdentifiers();
  const tpCode          = tp.code ?? tpIdentifiers.code;
  const tpUen           = tp.uen  ?? tpIdentifiers.uen;
  const tpName          = tp.name ?? tpIdentifiers.name;
  const completionDate  = record.completionDate ?? null;

  if (!traineeEmail || !courseCode || !courseRunId) return 'skipped';

  // ── 1. Upsert learner ────────────────────────────────────────────────────
  let userRow = await client.query(
    `SELECT id FROM app_user WHERE email = $1 LIMIT 1`,
    [traineeEmail]
  );

  let userId: string;
  if (userRow.rows.length === 0) {
    const newId = crypto.randomUUID();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tpIdentifiers.defaultPassword, salt);

    const inserted = await client.query(
      `INSERT INTO app_user (id, email, full_name, password, password_hash, account_status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW())
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [newId, traineeEmail, traineeName || traineeEmail, tpIdentifiers.defaultPassword, hashedPassword]
    );

    if (inserted.rows.length > 0) {
      userId = inserted.rows[0].id;

      const traineeDob = trainee.dateOfBirth || null;
      await client.query(
        `INSERT INTO learner_profile (user_id, nric, tel, dob)
         VALUES ($1, $2, '', $3::date)
         ON CONFLICT (user_id) DO UPDATE SET
           dob = COALESCE(learner_profile.dob, EXCLUDED.dob)`,
        [userId, traineeNric, traineeDob]
      );

      await client.query(
        `INSERT INTO user_role_map (user_id, role)
         VALUES ($1, 'Learner')
         ON CONFLICT (user_id, role) DO NOTHING`,
        [userId]
      );
    } else {
      // Race condition fallback
      const race = await client.query(
        `SELECT id FROM app_user WHERE email = $1 LIMIT 1`,
        [traineeEmail]
      );
      userId = race.rows[0]?.id;
    }
  } else {
    userId = userRow.rows[0].id;
    // Update DOB on existing learner_profile if missing
    const traineeDob = trainee.dateOfBirth || null;
    if (traineeDob) {
      await client.query(
        `UPDATE learner_profile SET dob = $1::date WHERE user_id = $2 AND dob IS NULL`,
        [traineeDob, userId]
      );
    }
  }

  if (!userId!) return 'skipped';

  // ── 2. Upsert course ─────────────────────────────────────────────────────
  let courseRow = await client.query(
    `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
    [courseCode]
  );

  let courseId: string;
  if (courseRow.rows.length === 0) {
    const newId = crypto.randomUUID();
    const ins = await client.query(
      `INSERT INTO course (id, course_code, title, status, enrollment_status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Published', 'enrolled', NOW(), NOW())
       ON CONFLICT (course_code) DO NOTHING
       RETURNING id`,
      [newId, courseCode, courseTitle]
    );
    if (ins.rows.length > 0) {
      courseId = ins.rows[0].id;
    } else {
      const race = await client.query(
        `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
        [courseCode]
      );
      courseId = race.rows[0]?.id;
    }
  } else {
    courseId = courseRow.rows[0].id;
  }

  if (!courseId!) return 'skipped';

  // ── 3. Upsert course_run ─────────────────────────────────────────────────
  let courseRunRow = await client.query(
    `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
    [courseRunId]
  );

  let courseRunUuid: string;
  if (courseRunRow.rows.length === 0) {
    const newId = crypto.randomUUID();
    const ins = await client.query(
      `INSERT INTO course_run (id, course_id, course_run_id, class_status, start_date, end_date, created_at, updated_at)
       VALUES ($1, $2, $3, 'Confirmed', $4::date, $5::date, NOW(), NOW())
       ON CONFLICT (course_id, course_run_id) DO NOTHING
       RETURNING id`,
      [newId, courseId, courseRunId, run.startDate || null, run.endDate || null]
    );
    if (ins.rows.length > 0) {
      courseRunUuid = ins.rows[0].id;
    } else {
      const race = await client.query(
        `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
        [courseRunId]
      );
      courseRunUuid = race.rows[0]?.id;
    }
  } else {
    courseRunUuid = courseRunRow.rows[0].id;
    // Backfill dates if missing
    if (run.startDate || run.endDate) {
      await client.query(
        `UPDATE course_run SET
           start_date = COALESCE(start_date, $2::date),
           end_date = COALESCE(end_date, $3::date)
         WHERE id = $1 AND (start_date IS NULL OR end_date IS NULL)`,
        [courseRunUuid, run.startDate || null, run.endDate || null]
      );
    }
  }

  if (!courseRunUuid!) return 'skipped';

  // ── 4. Build raw_data matching the SSG enrolment record format ───────────
  const rawData = {
    course: {
      run: {
        id: run.id ?? '',
        endDate: run.endDate ?? '',
        startDate: run.startDate ?? '',
      },
      title: courseTitle,
      referenceNumber: courseCode,
    },
    status: enrolmentStatus,
    trainee: {
      id: traineeNric ?? '',
      fees: {
        discountAmount: trainee.fees?.discountAmount ?? '0',
        collectionStatus: trainee.fees?.collectionStatus ?? 'Pending Payment',
      },
      email: { full: trainee.email?.full ?? traineeEmail },
      idType: { type: inferIdType(traineeNric ?? '', trainee.idType?.type) },
      employer: trainee.employer ?? {
        uen: '', name: '',
        contact: {
          email: { full: '' },
          fullName: '',
          contactNumber: { areaCode: '', countryCode: '', phoneNumber: '' },
        },
      },
      fullName: traineeName,
      dateOfBirth: trainee.dateOfBirth ?? '',
      contactNumber: trainee.contactNumber ?? { areaCode: '', countryCode: '', phoneNumber: '' },
      enrolmentDate,
      sponsorshipType: sponsorship,
    },
    referenceNumber: enrolmentId,
    trainingPartner: { uen: tpUen, code: tpCode, name: tpName },
  };

  // ── 5. Insert enrollment ─────────────────────────────────────────────────
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
     ) VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
     ON CONFLICT DO NOTHING`,
    [
      crypto.randomUUID(),
      userId,
      courseId,
      courseRunUuid,
      sponsorship,
      enrolmentDate,
      'Unpaid',
      'Pending',
      enrolmentId,
      enrolmentStatus,
      traineeNric ?? null,
      traineeEmail ?? null,
      courseCode ?? null,
      tpCode,
      completionDate ?? null,
      JSON.stringify(rawData),
    ]
  );

  return 'inserted';
}
