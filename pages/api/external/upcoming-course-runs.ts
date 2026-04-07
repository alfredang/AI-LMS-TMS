import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { syncEnrolmentToDB } from '../../../lib/ssg/utils/sync-enrolment-to-db';
import { splitTrainerList } from '../../../lib/trainerInvitations';

/**
 * External API — Fetch TGS Enrolments & Assign Trainers
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCHEDULE: Run daily at 2:00 AM SGT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FLOW:
 *   1. Get unique TGS- course codes from local course table.
 *   2. For each code, call SSG "Search Course Runs by Course Code".
 *   3. Scan runs bottom-up; collect runs whose SSG start date falls within
 *      today → today + upcoming_classes_threshold_days. Stop early when date
 *      exceeds the threshold.
 *   4. For each in-window run, call SSG "Search Enrolments" by course run ID.
 *   5. If no enrolments → skip (do not touch course_run table).
 *   6. If enrolments exist:
 *      - enrolment_id not in DB  → insert via syncEnrolmentToDB
 *      - enrolment_id already in DB → update status + raw_data
 *      - Then upsert course_run with latest SSG start/end/vacancy data.
 *
 * POST /api/external/upcoming-course-runs
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const RATE_LIMIT_MS = 2000;

// ── Ensure log table ──────────────────────────────────────────────────────────

async function ensureLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS upcoming_course_runs_log (
      id              SERIAL PRIMARY KEY,
      run_id          TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      course_run_id   TEXT,
      course_title    TEXT,
      course_code     TEXT,
      db_start_date   TEXT,
      db_end_date     TEXT,
      ssg_start_date  TEXT,
      ssg_end_date    TEXT,
      mode_of_learning TEXT,
      vacancy_code    TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      error_message   TEXT
    )
  `);
}

// ── Parse SSG 8-digit date integer to YYYY-MM-DD ─────────────────────────────

function parseSsgDate(d: number | string | undefined): string | null {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// ── Write one log row ─────────────────────────────────────────────────────────

async function insertLog(
  runId: string, courseRunId: string, courseTitle: string, courseCode: string,
  ssgStartDate: string | null, ssgEndDate: string | null,
  modeOfLearning: string | null, vacancyCode: string | null,
  status: string, errorMessage: string | null
) {
  await pool.query(
    `INSERT INTO upcoming_course_runs_log
       (run_id, course_run_id, course_title, course_code,
        ssg_start_date, ssg_end_date, mode_of_learning, vacancy_code,
        status, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [runId, courseRunId, courseTitle, courseCode,
     ssgStartDate, ssgEndDate, modeOfLearning, vacancyCode,
     status, errorMessage]
  );
}

// ── Search SSG enrolments for a course run ID ─────────────────────────────────

async function searchEnrolmentsForRun(
  courseRunId: string,
  credentials: any,
  tp: { uen: string; code: string },
  ssgBaseUrl: string,
  httpClient: HttpClient
): Promise<any[]> {
  const payload = {
    parameters: { page: 0, pageSize: 100 },
    enrolment: {
      course: { run: { id: courseRunId } },
      trainingPartner: { uen: credentials.uen || tp.uen, code: tp.code },
    },
  };

  const encKey = Buffer.from(credentials.encryptionKey, 'base64');
  const iv = Buffer.from('SSGAPIInitVector', 'utf8');

  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, '/tpg/enrolments/search')
    .withMethod(HttpMethod.POST)
    .withBody(encrypted);

  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const response = await httpClient.request(builder.build());
  if (response.status !== 200) return [];

  const rawBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  const parsed = JSON.parse(decrypted);
  if (!parsed?.status || String(parsed.status) === '404') return [];
  if (String(parsed.status) !== '200') return [];

  return parsed?.data ?? [];
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runUpcomingCourseRuns() {
  await ensureLogTable();

  const runId = `upcoming_${Date.now()}`;
  const startedAt = new Date().toISOString();

  // Read threshold days from training_provider admin settings
  const tpResult = await pool.query(
    `SELECT upcoming_classes_threshold_days FROM training_provider LIMIT 1`
  );
  const thresholdDays = parseInt(String(tpResult.rows[0]?.upcoming_classes_threshold_days || '21'), 10) || 21;

  // Date window strings for comparison (YYYY-MM-DD)
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + thresholdDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  console.log(`📋 upcoming-course-runs: window = ${todayStr} → ${cutoffStr} (${thresholdDays} days)`);

  const codesResult = await pool.query<{ course_code: string; title: string }>(
    `SELECT DISTINCT course_code, title
     FROM course
     WHERE course_code LIKE 'TGS-%'
     ORDER BY course_code ASC`
  );

  const courses = codesResult.rows;
  console.log(`📋 upcoming-course-runs: ${courses.length} TGS- course code(s) to search`);

  if (courses.length === 0) {
    return { runId, startedAt, thresholdDays, processed: 0, success: 0, errors: 0, results: [] };
  }

  const credentials = await getSSGCredentialsService().getSSGCredentials();
  if (!credentials) throw new Error('SSG credentials not found');

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tp = await getTrainingPartnerIdentifiers();

  // SSG course API (used for searchCourseRunsByCode)
  const courseApi = createSSGCourseAPI(ssgBaseUrl, credentials);

  // HttpClient still needed for enrolment search (encrypted endpoint)
  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });

  let successCount = 0, errors = 0;
  const results: any[] = [];

  for (let i = 0; i < courses.length; i++) {
    const { course_code, title: courseTitle } = courses[i];

    try {
      // ── Step 1: Search course runs by course code (via SSGCourseAPI) ────────
      const searchResult = await courseApi.searchCourseRunsByCode(course_code, {
        pageSize: 40,
        includeExpired: false,
        uen: credentials.uen || tp.uen,
      });

      if (searchResult.error?.code || searchResult.error?.message) {
        console.warn(`  ⚠️ SSG error for ${course_code}: ${searchResult.error?.message}`);
        if (i < courses.length - 1) await sleep(RATE_LIMIT_MS);
        continue;
      }

      if (searchResult.status !== 200) {
        console.warn(`  ⚠️ SSG returned ${searchResult.status} for ${course_code}`);
        if (i < courses.length - 1) await sleep(RATE_LIMIT_MS);
        continue;
      }

      const ssgData = (searchResult.data as any)?.data ?? searchResult.data ?? {};
      const runs: any[] = ssgData?.course?.runs ?? ssgData?.runs ?? [];

      // ── Step 2: Scan bottom-up, collect runs within the date window ─────────
      const windowRuns: any[] = [];
      for (let j = runs.length - 1; j >= 0; j--) {
        const run = runs[j];
        const startDate = parseSsgDate(run.courseStartDate ?? run.courseDates?.start);
        if (!startDate) continue;
        if (startDate > cutoffStr) {
          console.log(`    ⏭️ ${course_code}: run ${run.id ?? j} start ${startDate} > ${cutoffStr}, stopping early`);
          break;
        }
        if (startDate >= todayStr) {
          windowRuns.push(run);
        }
        // past run → skip but keep scanning upward
      }

      console.log(`  📌 ${course_code}: ${runs.length} total, ${windowRuns.length} within window`);

      // ── Step 3: For each in-window run, search enrolments ──────────────────
      for (const run of windowRuns) {
        const ssgRunId     = String(run.id ?? run.courseRunId ?? '');
        const ssgStartDate = parseSsgDate(run.courseStartDate ?? run.courseDates?.start);
        const ssgEndDate   = parseSsgDate(run.courseEndDate   ?? run.courseDates?.end);
        const modeOfLearning = run.modeOfTraining ?? null;
        const vacancyCode  = run.courseVacancy?.code ?? null;
        const vacancyDesc  = run.courseVacancy?.description ?? null;

        if (!ssgRunId) continue;

        await sleep(RATE_LIMIT_MS);

        try {
          const enrolments = await searchEnrolmentsForRun(ssgRunId, credentials, tp, ssgBaseUrl, httpClient);

          if (enrolments.length === 0) {
            console.log(`    ⏭️ ${ssgRunId} | ${course_code} | no enrolments — skipping`);
            await insertLog(runId, ssgRunId, courseTitle, course_code,
              ssgStartDate, ssgEndDate, modeOfLearning, vacancyCode, 'no_enrolments', null);
            continue;
          }

          console.log(`    📋 ${ssgRunId} | ${course_code} | ${enrolments.length} enrolment(s) | start: ${ssgStartDate} | end: ${ssgEndDate}`);

          let inserted = 0, updated = 0, hasActiveEnrolment = false;
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            // ── Step 4: Insert or update each enrolment ──────────────────────
            for (const enrolmentItem of enrolments) {
              const record = enrolmentItem?.enrolment ?? enrolmentItem;
              const enrolmentId: string | undefined = record?.referenceNumber;
              if (!enrolmentId) continue;

              const isCancelled = (record.status ?? '').trim().toLowerCase() === 'cancelled';
              if (!isCancelled) hasActiveEnrolment = true;

              const existing = await client.query(
                `SELECT id FROM enrollment WHERE enrolment_id = $1 LIMIT 1`,
                [enrolmentId]
              );

              if (existing.rows.length === 0) {
                if (isCancelled) {
                  // Cancelled + not in DB — skip entirely, no account or enrollment created
                  console.log(`      🚫 ${enrolmentId} cancelled (not in DB) — skipping`);
                } else {
                  // New active enrolment — create learner account + enrollment with course run
                  await syncEnrolmentToDB(client, enrolmentItem);
                  inserted++;
                }
              } else {
                // Existing enrolment — update status and raw SSG data,
                // but never overwrite Admin Removed (admin decision takes precedence over SSG sync)
                const updateResult = await client.query(
                  `UPDATE enrollment
                   SET enrolment_status = $2,
                       raw_data = $3,
                       updated_at = NOW()
                   WHERE enrolment_id = $1
                     AND enrolment_status != 'Admin Removed'`,
                  [enrolmentId, record.status ?? null, JSON.stringify(record)]
                );
                if ((updateResult.rowCount ?? 0) > 0) {
                  updated++;
                } else {
                  console.log(`      🔒 ${enrolmentId} is Admin Removed — skipping SSG sync`);
                }
              }
            }

            // ── Step 5: Upsert course_run (only if at least one active enrolment) ─
            if (hasActiveEnrolment) {
              const crRow = await client.query(
                `SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
                [ssgRunId]
              );

              if (crRow.rows.length === 0) {
                // Insert course_run — need course_id from local course table
                const cRow = await client.query(
                  `SELECT id FROM course WHERE course_code = $1 LIMIT 1`,
                  [course_code]
                );
                const courseId = cRow.rows[0]?.id;
                if (courseId) {
                  await client.query(
                    `INSERT INTO course_run
                       (id, course_id, course_run_id, class_status,
                        start_date, end_date,
                        course_vacancy_code, course_vacancy_description,
                        created_at, updated_at)
                     VALUES (gen_random_uuid(), $1, $2, 'Confirmed',
                             $3::date, $4::date, $5, $6, NOW(), NOW())
                     ON CONFLICT (course_id, course_run_id) DO NOTHING`,
                    [courseId, ssgRunId, ssgStartDate, ssgEndDate, vacancyCode, vacancyDesc]
                  );
                }
              } else {
                // Update existing course_run with latest SSG data
                await client.query(
                  `UPDATE course_run
                   SET start_date = $2::date,
                       end_date   = $3::date,
                       course_vacancy_code        = $4,
                       course_vacancy_description = $5,
                       updated_at = NOW()
                   WHERE course_run_id = $1`,
                  [ssgRunId, ssgStartDate, ssgEndDate, vacancyCode, vacancyDesc]
                );
              }
            } else {
              console.log(`    ⏭️ ${ssgRunId} | all enrolments cancelled — skipping course_run upsert`);
            }

            await client.query('COMMIT');
          } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
          } finally {
            client.release();
          }

          const note = `${enrolments.length} enrolment(s): ${inserted} created, ${updated} updated`;
          console.log(`    ✅ ${ssgRunId} | ${course_code} | ${note}`);
          await insertLog(runId, ssgRunId, courseTitle, course_code,
            ssgStartDate, ssgEndDate, modeOfLearning, vacancyCode, 'success', note);
          results.push({ courseRunId: ssgRunId, courseCode: course_code, ssgStartDate, status: 'success' });
          successCount++;

        } catch (runErr: any) {
          console.error(`    ❌ ${ssgRunId} | ${course_code}:`, runErr.message);
          await insertLog(runId, ssgRunId, courseTitle, course_code,
            ssgStartDate, ssgEndDate, modeOfLearning, vacancyCode, 'error', runErr.message);
          errors++;
        }
      }

    } catch (err: any) {
      console.error(`  ❌ Exception for ${course_code}:`, err.message);
      errors++;
    }

    if (i < courses.length - 1) await sleep(RATE_LIMIT_MS);
  }

  // ── Trainer assignment pass ───────────────────────────────────────────────
  // For every course_run processed this batch that still has no assigned trainer,
  // check SSG linkCourseRunTrainer first, then fall back to course trainers_email_list
  // (first entry by comma order), then trainers_list (first entry by comma order).
  if (results.length > 0) {
    const processedRunIds = results.map(r => r.courseRunId);
    const unassignedResult = await pool.query<{
      id: string; course_run_id: string;
      trainers_email_list: string | null; trainers_list: string | null;
    }>(
      `SELECT cr.id, cr.course_run_id, c.trainers_email_list, c.trainers_list
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.course_run_id = ANY($1::text[])
         AND cr.assigned_trainer_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id
         )`,
      [processedRunIds]
    );

    console.log(`🎓 trainer assignment pass: ${unassignedResult.rows.length} unassigned run(s)`);

    // Ensure junction table exists (mirrors assign-trainer.ts)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS course_run_trainer (
        id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
        trainer_id    UUID,
        trainer_name  TEXT NOT NULL,
        trainer_email TEXT,
        assigned_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_crt_run_trainer
        ON course_run_trainer(course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
    `);

    for (const run of unassignedResult.rows) {
      try {
        await sleep(RATE_LIMIT_MS);

        // Resolved trainer candidates: [{id, name, email}]
        type TrainerCandidate = { id: string; name: string; email: string };
        const candidates: TrainerCandidate[] = [];
        let fromSSG = false;

        // 1. Try SSG linkCourseRunTrainer (may contain multiple trainers)
        // viewRes.data is already the unwrapped CourseRunResponse: { course: {...}, run: {...} }
        const viewRes = await courseApi.viewCourseRun(run.course_run_id);
        const trainerLinks: any[] = (viewRes.data as any)?.run?.linkCourseRunTrainer ?? [];

        for (const link of trainerLinks) {
          if (!link?.email) continue;
          const userRow = await pool.query(
            `SELECT id, full_name, email FROM app_user WHERE LOWER(email) = LOWER($1) LIMIT 1`,
            [link.email]
          );
          if (userRow.rows.length > 0) {
            candidates.push({
              id:    userRow.rows[0].id,
              name:  userRow.rows[0].full_name,
              email: userRow.rows[0].email,
            });
          }
        }
        if (candidates.length > 0) fromSSG = true;

        // 2. Fallback: trainers_email_list (all comma-separated entries, in order)
        if (candidates.length === 0 && run.trainers_email_list) {
          for (const email of splitTrainerList(run.trainers_email_list)) {
            const userRow = await pool.query(
              `SELECT id, full_name, email FROM app_user WHERE LOWER(email) = LOWER($1) LIMIT 1`,
              [email]
            );
            if (userRow.rows.length > 0) {
              candidates.push({
                id:    userRow.rows[0].id,
                name:  userRow.rows[0].full_name,
                email: userRow.rows[0].email,
              });
            }
          }
        }

        // 3. Fallback: trainers_list (all comma-separated name entries, in order)
        if (candidates.length === 0 && run.trainers_list) {
          for (const name of splitTrainerList(run.trainers_list)) {
            const userRow = await pool.query(
              `SELECT id, full_name, email FROM app_user WHERE LOWER(full_name) = LOWER($1) LIMIT 1`,
              [name]
            );
            if (userRow.rows.length > 0) {
              candidates.push({
                id:    userRow.rows[0].id,
                name:  userRow.rows[0].full_name,
                email: userRow.rows[0].email,
              });
            }
          }
        }

        if (candidates.length === 0) {
          console.log(`    ⚠️ no trainer found for run ${run.course_run_id}`);
          continue;
        }

        // Write first trainer to legacy columns (backward compat)
        // Also write tpg_assigned_trainer_name/email ONLY when trainer came from SSG linkCourseRunTrainer
        const primary = candidates[0];
        await pool.query(
          `UPDATE course_run
           SET assigned_trainer_id       = $2,
               assigned_trainer_name     = $3,
               assigned_trainer_email    = $4,
               tpg_assigned_trainer_name  = CASE WHEN $5 THEN $3 ELSE tpg_assigned_trainer_name END,
               tpg_assigned_trainer_email = CASE WHEN $5 THEN $4 ELSE tpg_assigned_trainer_email END,
               updated_at                = NOW()
           WHERE id = $1`,
          [run.id, primary.id, primary.name, primary.email, fromSSG]
        );

        // Insert all trainers into junction table (additive, no duplicates)
        for (const t of candidates) {
          await pool.query(
            `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
             DO UPDATE SET trainer_name = EXCLUDED.trainer_name, trainer_email = EXCLUDED.trainer_email`,
            [run.id, t.id, t.name, t.email]
          );
        }

        console.log(`    ✅ assigned ${candidates.length} trainer(s) → run ${run.course_run_id}: ${candidates.map(t => t.name).join(', ')}`);
      } catch (trainerErr: any) {
        console.error(`    ❌ trainer assignment failed for ${run.course_run_id}:`, trainerErr.message);
      }
    }
  }

  console.log(`✅ upcoming-course-runs done — ${successCount} run(s) processed, ${errors} error(s)`);
  return { runId, startedAt, thresholdDays, processed: successCount, successCount, errors, results };
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { successCount: sc, ...rest } = await runUpcomingCourseRuns();
    return res.status(200).json({ success: true, successCount: sc, ...rest });
  } catch (err) {
    console.error('❌ upcoming-course-runs error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
