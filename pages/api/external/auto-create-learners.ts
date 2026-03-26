import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';

/**
 * External API — Auto Create Learners
 *
 * POST /api/external/auto-create-learners
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Flow:
 *   1. Validate API key
 *   2. Find all course runs where start_date = today
 *   3. Fetch SSG enrollments via n8n webhook for each run
 *   4. Create learner accounts (skip if already exists)
 *   5. Upsert enrollment records
 *   6. Log results to auto_create_learner_log
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── Ensure log table exists ───────────────────────────────────────────────────

async function ensureAutomationTable() {
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'automation_log')
         AND NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'auto_create_learner_log')
      THEN
        ALTER TABLE automation_log RENAME TO auto_create_learner_log;
      END IF;
    END $$
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_create_learner_log (
      id             SERIAL PRIMARY KEY,
      run_id         TEXT NOT NULL,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      course_run_id  TEXT,
      course_title   TEXT,
      course_code    TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      total_enrolled INT  DEFAULT 0,
      created_count  INT  DEFAULT 0,
      existing_count INT  DEFAULT 0,
      error_count    INT  DEFAULT 0,
      details        JSONB,
      error_message  TEXT
    )
  `);
  await pool.query(`ALTER TABLE auto_create_learner_log ADD COLUMN IF NOT EXISTS course_code TEXT`);
}

// ── Fetch enrollments directly from SSG ──────────────────────────────────────

async function fetchEnrollments(courseRunId: string): Promise<any[]> {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) throw new Error('SSG credentials not found');

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tpUen  = process.env.TRAINING_PARTNER_UEN  || credentials.uen;
  const tpCode = process.env.TRAINING_PARTNER_CODE || `${tpUen}-01`;

  const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);
  const result = await api.searchEnrolment({
    enrolment: {
      course: { run: { id: courseRunId } },
      trainingPartner: { uen: tpUen, code: tpCode },
    },
    parameters: { page: 0, pageSize: 20 },
  } as any);

  if (result.error) {
    const status = Number(result.status) || 0;
    if (status === 404) return [];
    throw new Error(`SSG error ${status}: ${result.error.message ?? 'unknown'}`);
  }

  const raw: any = result.data;
  if (Array.isArray(raw?.enrolment)) return raw.enrolment;
  if (Array.isArray(raw)) return (raw as any[]).map((item: any) => item.enrolment ?? item);
  return [];
}

// ── Upsert learner account + enrollment ──────────────────────────────────────

async function upsertLearner(
  email: string,
  fullName: string,
  nric: string | null,
  courseRunId: string,
  courseId: string,
  enrolment: any,
): Promise<{ created: boolean; userId: string }> {
  const client = await pool.connect();

  const enrolmentRef: string | null = enrolment?.referenceNumber ?? null;
  const enrolmentStatus: string | null = enrolment?.status ?? enrolment?.enrolmentStatus ?? null;
  const enrolmentDate: string | null = enrolment?.trainee?.enrolmentDate ?? enrolment?.enrolmentDate ?? enrolment?.createdDate ?? null;
  const courseRef: string | null = enrolment?.course?.referenceNumber ?? enrolment?.courseReferenceNumber ?? null;
  const tpCode: string | null = enrolment?.trainingPartner?.code ?? enrolment?.trainingPartnerCode ?? null;
  const rawSponsorship = enrolment?.trainee?.sponsorshipType;
  const sponsorship: string | null = (typeof rawSponsorship === 'string' ? rawSponsorship : rawSponsorship?.code)
    ?? enrolment?.sponsorshipType?.code
    ?? enrolment?.traineeSponsorshipType
    ?? null;

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM app_user WHERE email = $1',
      [email.trim().toLowerCase()],
    );

    let userId: string;
    let created = false;

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
    } else {
      const hash = await bcrypt.hash('password123', 10);
      const ins = await client.query(
        `INSERT INTO app_user (email, full_name, password, password_hash, account_status, created_at, updated_at)
         VALUES ($1, $2, 'password123', $3, 'active', NOW(), NOW())
         RETURNING id`,
        [email.trim().toLowerCase(), fullName.trim(), hash],
      );
      userId = ins.rows[0].id;
      await client.query(
        `INSERT INTO learner_profile (user_id, tel, nric) VALUES ($1, '', $2)
         ON CONFLICT (user_id) DO UPDATE SET nric = EXCLUDED.nric`,
        [userId, nric?.trim() || null],
      );
      created = true;
    }

    await client.query(
      `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT DO NOTHING`,
      [userId],
    );

    if (enrolmentRef) {
      const updated = await client.query(
        `UPDATE enrollment SET
           user_id               = $1,
           course_id             = $2,
           course_run_id         = $3,
           enrolment_status      = $4,
           enrolment_date        = COALESCE($5, enrolment_date),
           nric                  = COALESCE($6, nric),
           email                 = $7,
           course_reference      = COALESCE($8, course_reference),
           training_partner_code = COALESCE($9, training_partner_code),
           course_sponsorship    = COALESCE($10::public.course_sponsorship, course_sponsorship),
           raw_data              = $11,
           updated_at            = NOW()
         WHERE enrolment_id = $12`,
        [userId, courseId, courseRunId, enrolmentStatus, enrolmentDate || null,
          nric?.trim() || null, email.trim().toLowerCase(), courseRef, tpCode, sponsorship,
          JSON.stringify(enrolment), enrolmentRef],
      );

      if ((updated.rowCount ?? 0) === 0) {
        await client.query(
          `INSERT INTO enrollment (
             user_id, course_id, course_run_id,
             enrolment_date, enrolment_id, enrolment_status,
             nric, email, course_reference, training_partner_code, course_sponsorship,
             raw_data, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::public.course_sponsorship,$12,NOW())
           ON CONFLICT (user_id, course_run_id) DO UPDATE SET
             enrolment_id          = EXCLUDED.enrolment_id,
             enrolment_status      = EXCLUDED.enrolment_status,
             enrolment_date        = COALESCE(EXCLUDED.enrolment_date, enrollment.enrolment_date),
             nric                  = COALESCE(EXCLUDED.nric, enrollment.nric),
             email                 = EXCLUDED.email,
             course_reference      = COALESCE(EXCLUDED.course_reference, enrollment.course_reference),
             training_partner_code = COALESCE(EXCLUDED.training_partner_code, enrollment.training_partner_code),
             course_sponsorship    = COALESCE(EXCLUDED.course_sponsorship, enrollment.course_sponsorship),
             raw_data              = EXCLUDED.raw_data,
             updated_at            = NOW()`,
          [userId, courseId, courseRunId, enrolmentDate || null, enrolmentRef, enrolmentStatus,
            nric?.trim() || null, email.trim().toLowerCase(), courseRef, tpCode, sponsorship,
            JSON.stringify(enrolment)],
        );
      }
    } else {
      await client.query(
        `INSERT INTO enrollment (
           user_id, course_id, course_run_id,
           enrolment_date, enrolment_id, enrolment_status,
           nric, email, course_reference, training_partner_code, course_sponsorship,
           raw_data, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::public.course_sponsorship,$12,NOW())
         ON CONFLICT (user_id, course_run_id) DO UPDATE SET
           enrolment_id          = COALESCE(EXCLUDED.enrolment_id, enrollment.enrolment_id),
           enrolment_status      = EXCLUDED.enrolment_status,
           enrolment_date        = COALESCE(EXCLUDED.enrolment_date, enrollment.enrolment_date),
           nric                  = COALESCE(EXCLUDED.nric, enrollment.nric),
           email                 = EXCLUDED.email,
           course_reference      = COALESCE(EXCLUDED.course_reference, enrollment.course_reference),
           training_partner_code = COALESCE(EXCLUDED.training_partner_code, enrollment.training_partner_code),
           course_sponsorship    = COALESCE(EXCLUDED.course_sponsorship, enrollment.course_sponsorship),
           raw_data              = EXCLUDED.raw_data,
           updated_at            = NOW()`,
        [userId, courseId, courseRunId, enrolmentDate || null, enrolmentRef, enrolmentStatus,
          nric?.trim() || null, email.trim().toLowerCase(), courseRef, tpCode, sponsorship,
          JSON.stringify(enrolment)],
      );
    }

    await client.query(`UPDATE app_user SET courses_updated_at = NOW() WHERE id = $1`, [userId]);
    await client.query('COMMIT');
    return { created, userId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Main automation runner ────────────────────────────────────────────────────

export async function runAutomation() {
  await ensureAutomationTable();

  const runId = `run_${Date.now()}`;
  const startedAt = new Date().toISOString();

  const runsResult = await pool.query<{
    db_id: string;
    course_id: string;
    course_title: string;
    course_code: string;
    course_run_id: string;
  }>(
    `SELECT cr.id AS db_id, cr.course_id, c.title AS course_title, c.course_code, cr.course_run_id
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     WHERE DATE(cr.start_date) = CURRENT_DATE
     ORDER BY cr.start_date ASC`,
  );

  const runs = runsResult.rows;
  const results: any[] = [];

  for (const run of runs) {
    console.log(`📋 Processing: "${run.course_title}" [${run.course_code}] | SSG course_run_id: "${run.course_run_id}" | DB id: ${run.db_id}`);

    const logEntry: any = {
      runId,
      courseRunId: run.course_run_id,
      courseTitle: run.course_title,
      courseCode: run.course_code,
      status: 'pending',
      totalEnrolled: 0,
      createdCount: 0,
      existingCount: 0,
      errorCount: 0,
      details: [],
      errorMessage: null,
    };

    try {
      const enrollees = await fetchEnrollments(run.course_run_id);
      console.log(`📥 SSG returned ${enrollees.length} enrollee(s) for run "${run.course_run_id}"`);
      if (enrollees.length > 0) console.log('📄 First enrollee sample:', JSON.stringify(enrollees[0], null, 2));
      logEntry.totalEnrolled = enrollees.length;

      for (const enrolment of enrollees) {
        const trainee = enrolment?.trainee ?? enrolment;
        const email: string = (
          trainee?.email?.full ?? trainee?.emailAddress ?? trainee?.email ?? enrolment?.traineeEmail ?? ''
        ).trim().toLowerCase();
        const name: string = (
          trainee?.fullName ?? trainee?.name ?? enrolment?.traineeName ?? email
        ).trim();
        const nric: string | null = trainee?.id ?? trainee?.nric ?? enrolment?.traineeNric ?? null;

        const enrolmentRef: string | null = enrolment?.referenceNumber ?? null;
        const enrolmentStatus: string = (enrolment?.status ?? '').trim();

        if (!email) {
          logEntry.errorCount++;
          logEntry.details.push({ enrolmentRef, email: '(none)', status: 'skipped', reason: 'no email' });
          continue;
        }

        const accountCheck = await pool.query(
          'SELECT id FROM app_user WHERE email = $1',
          [email],
        );
        const accountExists = accountCheck.rows.length > 0;

        if (enrolmentStatus === 'Cancelled') {
          try {
            await pool.query(
              `UPDATE enrollment
               SET enrolment_status = 'Cancelled',
                   raw_data         = $1,
                   updated_at       = NOW()
               WHERE enrolment_id = $2
                  OR (email = $3 AND course_run_id = $4)`,
              [JSON.stringify(enrolment), enrolmentRef, email, run.db_id],
            );
            console.log(`🚫 Cancelled enrolment for ${email} (${enrolmentRef}) in run ${run.course_run_id}`);
            logEntry.details.push({ enrolmentRef, email, name, status: 'cancelled', accountExists });
          } catch (err) {
            logEntry.errorCount++;
            logEntry.details.push({ enrolmentRef, email, name, status: 'error', accountExists, reason: err instanceof Error ? err.message : String(err) });
          }
          continue;
        }

        try {
          const { created } = await upsertLearner(email, name, nric, run.db_id, run.course_id, enrolment);
          if (created) {
            logEntry.createdCount++;
            logEntry.details.push({ enrolmentRef, email, name, status: 'created', accountExists: false });
          } else {
            logEntry.existingCount++;
            logEntry.details.push({ enrolmentRef, email, name, status: 'existing', accountExists: true });
          }
        } catch (err) {
          logEntry.errorCount++;
          logEntry.details.push({ enrolmentRef, email, name, status: 'error', accountExists, reason: err instanceof Error ? err.message : String(err) });
        }
      }

      logEntry.status = logEntry.errorCount === 0 ? 'success' : 'partial';
    } catch (err) {
      logEntry.status = 'error';
      logEntry.errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`❌ Failed to process course run ${run.db_id} (${run.course_run_id}):`, err);
    }

    await pool.query(
      `INSERT INTO auto_create_learner_log
         (run_id, course_run_id, course_title, course_code, status, total_enrolled, created_count, existing_count, error_count, details, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [runId, logEntry.courseRunId, logEntry.courseTitle, logEntry.courseCode, logEntry.status,
        logEntry.totalEnrolled, logEntry.createdCount, logEntry.existingCount,
        logEntry.errorCount, JSON.stringify(logEntry.details), logEntry.errorMessage],
    );

    results.push(logEntry);

    if (runs.indexOf(run) < runs.length - 1) {
      await sleep(5000);
    }
  }

  console.log(`✅ auto-create-learners done. runId=${runId}, runs=${runs.length}`);
  return { runId, startedAt, processed: runs.length, results };
}

// ── API Handler ───────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;

  if (!validKey) {
    console.error('❌ EXTERNAL_API_KEY_FOR_CLAWDBOT is not configured');
    return res.status(500).json({ success: false, error: 'API key not configured on server' });
  }
  if (!apiKey || apiKey !== validKey) {
    console.warn(`⚠️ Unauthorized attempt — key: ${apiKey ? '[wrong key]' : '[missing]'}`);
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  try {
    const result = await runAutomation();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ auto-create-learners error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
