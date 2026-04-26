import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { triggerProformaGeneration } from '../../../lib/services/proformaInvoiceService';

/**
 * External API — Auto Create Learners
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Run daily at 6:00 PM SGT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Automatically creates learner accounts and enrolment records for all
 *   classes starting TOMORROW. This ensures learners have their login
 *   credentials ready before the class begins.
 *
 * POST /api/external/auto-create-learners
 *
 * Headers:
 *   x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 *
 * Body: (empty — no body required)
 *
 * What it does:
 *   1. Validates the API key
 *   2. Finds all course runs where start_date = TOMORROW (current date + 1)
 *   3. For each course run, fetches the enrolled learners from SSG
 *   4. For each learner:
 *      - If enrolment is Cancelled → removes learner from the course run
 *      - If account does not exist → creates a new learner account with default password
 *      - If account already exists → skips account creation, upserts enrolment only
 *   5. Logs all results to auto_create_learner_log (viewable in Admin > Automation Logging)
 *
 * Notes:
 *   - A 5-second delay is applied between each course run to avoid SSG API rate limits
 *   - Results can be viewed in the Admin panel under "Automation Logging"
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
  await pool.query(`ALTER TABLE auto_create_learner_log ADD COLUMN IF NOT EXISTS start_date DATE`);
  await pool.query(`ALTER TABLE auto_create_learner_log ADD COLUMN IF NOT EXISTS end_date DATE`);
}

// ── Fetch enrollments directly from SSG ──────────────────────────────────────

async function fetchEnrollments(courseRunId: string): Promise<any[]> {
  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) throw new Error('SSG credentials not found');

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tp = await getTrainingPartnerIdentifiers();
  const tpUen  = tp.uen || credentials.uen;
  const tpCode = tp.code;

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
    throw new Error(`SSG error ${status}: ${result.error?.message ?? 'unknown'}`);
  }

  const raw: any = result.data;
  if (Array.isArray(raw?.enrolment)) return raw.enrolment;
  if (Array.isArray(raw)) return (raw as any[]).map((item: any) => item.enrolment ?? item);
  return [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map any SSG sponsorship code to the DB enum values ('Employer' | 'Individual').
 * SSG can return 'EMPLOYER', 'Employer', 'INDIVIDUAL', 'Individual', etc.
 */
function normalizeSponsorship(raw: string | null): 'Employer' | 'Individual' | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes('EMPLOYER')) return 'Employer';
  if (upper.includes('INDIVIDUAL')) return 'Individual';
  return null; // unrecognised value — use NULL to avoid enum cast error
}

// ── Upsert learner account + enrollment ──────────────────────────────────────

async function upsertLearner(
  email: string,
  fullName: string,
  nric: string | null,
  courseRunId: string,
  courseId: string,
  enrolment: any,
): Promise<{ created: boolean; userId: string; enrollmentId: string | null }> {
  const client = await pool.connect();

  const enrolmentRef: string | null = enrolment?.referenceNumber ?? null;
  const enrolmentStatus: string | null = enrolment?.status ?? enrolment?.enrolmentStatus ?? null;
  const enrolmentDate: string | null = enrolment?.trainee?.enrolmentDate ?? enrolment?.enrolmentDate ?? enrolment?.createdDate ?? null;
  const courseRef: string | null = enrolment?.course?.referenceNumber ?? enrolment?.courseReferenceNumber ?? null;
  const tpCode: string | null = enrolment?.trainingPartner?.code ?? enrolment?.trainingPartnerCode ?? null;
  const rawSponsorship = enrolment?.trainee?.sponsorshipType;
  const rawSponsorshipCode: string | null = (typeof rawSponsorship === 'string' ? rawSponsorship : rawSponsorship?.code)
    ?? enrolment?.sponsorshipType?.code
    ?? enrolment?.traineeSponsorshipType
    ?? null;
  const sponsorship = normalizeSponsorship(rawSponsorshipCode);

  try {
    await client.query('BEGIN');

    const tp = await getTrainingPartnerIdentifiers();

    const existing = await client.query(
      'SELECT id FROM app_user WHERE email = $1',
      [email.trim().toLowerCase()],
    );

    let userId: string;
    let created = false;

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
    } else {
      const hash = await bcrypt.hash(tp.defaultPassword, 10);
      const ins = await client.query(
        `INSERT INTO app_user (email, full_name, password, password_hash, account_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
         RETURNING id`,
        [email.trim().toLowerCase(), fullName.trim(), tp.defaultPassword, hash],
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

    let enrollmentId: string | null = null;

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
         WHERE enrolment_id = $12
         RETURNING id`,
        [userId, courseId, courseRunId, enrolmentStatus, enrolmentDate || null,
          nric?.trim() || null, email.trim().toLowerCase(), courseRef, tpCode, sponsorship,
          JSON.stringify(enrolment), enrolmentRef],
      );

      if ((updated.rowCount ?? 0) === 0) {
        const inserted = await client.query(
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
             updated_at            = NOW()
           RETURNING id`,
          [userId, courseId, courseRunId, enrolmentDate || null, enrolmentRef, enrolmentStatus,
            nric?.trim() || null, email.trim().toLowerCase(), courseRef, tpCode, sponsorship,
            JSON.stringify(enrolment)],
        );
        enrollmentId = inserted.rows[0]?.id ?? null;
      } else {
        enrollmentId = updated.rows[0]?.id ?? null;
      }
    } else {
      const upserted = await client.query(
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
           updated_at            = NOW()
         RETURNING id`,
        [userId, courseId, courseRunId, enrolmentDate || null, enrolmentRef, enrolmentStatus,
          nric?.trim() || null, email.trim().toLowerCase(), courseRef, tpCode, sponsorship,
          JSON.stringify(enrolment)],
      );
      enrollmentId = upserted.rows[0]?.id ?? null;
    }

    await client.query(`UPDATE app_user SET courses_updated_at = NOW() WHERE id = $1`, [userId]);
    await client.query('COMMIT');
    return { created, userId, enrollmentId };
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
    start_date: string;
    end_date: string;
  }>(
    `SELECT cr.id AS db_id, cr.course_id, c.title AS course_title, c.course_code, cr.course_run_id,
            cr.start_date, cr.end_date
     FROM course_run cr
     JOIN course c ON c.id = cr.course_id
     WHERE cr.start_date = (NOW() AT TIME ZONE 'Asia/Singapore')::date + INTERVAL '1 day'
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
      startDate: run.start_date ?? null,
      endDate: run.end_date ?? null,
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
            // Remove learner from the course run
            if (accountExists) {
              const userId = accountCheck.rows[0].id;
              await pool.query(
                `DELETE FROM enrollment WHERE user_id = $1 AND course_run_id = $2`,
                [userId, run.db_id],
              );
              // Signal learner's UI to refresh
              await pool.query(
                `UPDATE app_user SET courses_updated_at = NOW() WHERE id = $1`,
                [userId],
              );
              console.log(`🚫 Removed cancelled enrolment for ${email} (${enrolmentRef}) from run ${run.course_run_id}`);
            } else {
              console.log(`🚫 Cancelled enrolment for ${email} (${enrolmentRef}) — no account found, nothing to remove`);
            }
            logEntry.details.push({ enrolmentRef, email, name, status: 'cancelled', accountExists });
          } catch (err) {
            logEntry.errorCount++;
            logEntry.details.push({ enrolmentRef, email, name, status: 'error', accountExists, reason: err instanceof Error ? err.message : String(err) });
          }
          continue;
        }

        try {
          const { created, enrollmentId } = await upsertLearner(email, name, nric, run.db_id, run.course_id, enrolment);
          if (enrollmentId) {
            triggerProformaGeneration(enrollmentId);
          }
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
         (run_id, course_run_id, course_title, course_code, start_date, end_date, status, total_enrolled, created_count, existing_count, error_count, details, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [runId, logEntry.courseRunId, logEntry.courseTitle, logEntry.courseCode,
        logEntry.startDate, logEntry.endDate, logEntry.status,
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
