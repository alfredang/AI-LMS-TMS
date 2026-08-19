import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';
import { createSSGAttendanceAPI } from '../../../lib/ssg/api/attendance-api';
import { extractRecordsFromViewAttendance, normalizeAttendanceRecord } from '../../../lib/ssg/utils/attendance-decrypt';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { COURSE_ID_BY_ANY_CODE_SQL } from '../../../lib/courseCode';

/**
 * POST /api/admin/sync-completed-classes
 *
 * Pulls completed class data from SSG:
 * - Only classes (course runs) with at least 1 confirmed enrollment
 * - Fetches: course run details, enrollments, attendance for all sessions, trainer info
 * - Syncs all data to local database (upsert — no duplicates)
 *
 * Modes:
 *   1. Specific IDs: Pass { courseRunIds: ["1322309", ...] } in body → pulls those from SSG directly
 *   2. Date range: Pass ?month=4&year=2026 → pulls from local DB course runs in that month
 *
 * Query params:
 *   month (default: 4)
 *   year (default: 2026)
 *   limit (default: 100, max 500) — only for date-range mode
 *   app (default: app1) — SSG app credentials
 */

const RATE_LIMIT_MS = 3000;
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function parseDate(raw: string | number | undefined): string | null {
  if (!raw && raw !== 0) return null;
  const s = String(raw);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mapSponsorship(s: string | undefined): string | null {
  if (s === 'Individual' || s === 'Employer') return s;
  if (s === 'INDIVIDUAL') return 'Individual';
  if (s === 'EMPLOYER') return 'Employer';
  return null;
}

interface CourseRunInfo {
  uuid: string;
  ssg_run_id: string;
  course_title: string;
  course_code: string;
  course_uuid: string;
  start_date: string | null;
  end_date: string | null;
  class_status: string | null;
  enrolment_count: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  const month = Number(req.query.month) || 4;
  const year = Number(req.query.year) || 2026;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const ssgApp = (req.query.app as string) || 'app1';

  // Parse specific course run IDs from body
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const specificIds: string[] = Array.isArray(body.courseRunIds)
    ? [...new Set(body.courseRunIds.map((id: any) => String(id)))] // deduplicate
    : [];

  const isSpecificMode = specificIds.length > 0;

  console.log(isSpecificMode
    ? `\n🔄 Syncing ${specificIds.length} specific course run IDs from SSG\n`
    : `\n🔄 Syncing completed classes for ${year}-${String(month).padStart(2, '0')}\n`
  );

  // Step 1: Load SSG credentials
  const credentialsService = getSSGCredentialsService();
  const credentials = await credentialsService.getSSGCredentials(undefined, ssgApp);
  if (!credentials) {
    return res.status(500).json({ success: false, error: `SSG credentials not found for app: ${ssgApp}` });
  }
  console.log(`🔑 Using SSG app: ${ssgApp}`);

  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tp = await getTrainingPartnerIdentifiers();
  const enrolmentAPI = createSSGEnrolmentAPI(ssgBaseUrl, credentials);
  const courseAPI = createSSGCourseAPI(ssgBaseUrl, credentials);
  const attendanceAPI = createSSGAttendanceAPI(ssgBaseUrl, credentials);

  // Step 2: Determine course runs to process
  let courseRuns: CourseRunInfo[] = [];

  const debugErrors: any[] = [];

  const skipExisting = req.query.skipExisting !== '0'; // default: skip
  const skippedExisting: { courseRunId: string; courseTitle: string }[] = [];

  if (isSpecificMode) {
    let idsToFetch: string[] = specificIds;

    if (skipExisting) {
      // ── Check which IDs already exist in the DB (with enrollments) ──
      const existingResult = await pool.query(
        `SELECT cr.course_run_id AS ssg_run_id, c.title AS course_title,
                (SELECT COUNT(*) FROM enrollment e WHERE e.course_run_id = cr.id AND LOWER(COALESCE(e.enrolment_status, '')) NOT IN ('admin removed', 'cancelled', 'withdrawn')) AS enrol_count
         FROM course_run cr
         JOIN course c ON c.id = cr.course_id
         WHERE cr.course_run_id = ANY($1)`,
        [specificIds]
      );
      const existingMap = new Map<string, { title: string; enrolCount: number }>();
      for (const row of existingResult.rows) {
        existingMap.set(row.ssg_run_id, { title: row.course_title, enrolCount: Number(row.enrol_count) });
      }

      // Filter: only call SSG for IDs not already in DB with enrollments
      idsToFetch = [];
      for (const id of specificIds) {
        const existing = existingMap.get(id);
        if (existing && existing.enrolCount > 0) {
          skippedExisting.push({ courseRunId: id, courseTitle: existing.title });
          console.log(`  ⏩ ${id} already in DB with ${existing.enrolCount} enrollments — skipping SSG fetch`);
        } else {
          idsToFetch.push(id);
        }
      }
    }

    console.log(`📊 skipExisting=${skipExisting} | ${skippedExisting.length} already in DB, ${idsToFetch.length} to fetch from SSG`);

    // ── Fetch only new IDs from SSG ──
    for (const ssgRunId of idsToFetch) {
      console.log(`\n🔍 Fetching course run ${ssgRunId} from SSG...`);

      try {
        const runResult = await courseAPI.viewCourseRun(ssgRunId, 'Y' as any);
        console.log(`  📦 viewCourseRun(${ssgRunId}) status=${runResult.status} error=${JSON.stringify(runResult.error)} hasData=${!!runResult.data}`);
        if (runResult.data) {
          console.log(`  📦 Data keys: ${Object.keys(runResult.data).join(', ')}`);
          console.log(`  📦 Data preview: ${JSON.stringify(runResult.data).slice(0, 500)}`);
        }
        const hasRealError = runResult.error && Object.keys(runResult.error).length > 0 && runResult.error.message;
        if (hasRealError || !runResult.data) {
          debugErrors.push({ runId: ssgRunId, error: runResult.error, status: runResult.status, dataKeys: runResult.data ? Object.keys(runResult.data) : null, dataPreview: runResult.data ? JSON.stringify(runResult.data).slice(0, 300) : null });
          console.log(`  ⚠️ Could not fetch run ${ssgRunId}: ${runResult.error?.message || 'no data'}`);
          continue;
        }

        const runData = runResult.data;
        // Return raw SSG data for debugging if ?debug=1
        if (req.query.debug === '1' && specificIds.length === 1) {
          return res.status(200).json({ ssgRaw: runData });
        }

        const courseData = runData?.course || runData;
        const run = courseData?.run || runData?.run || runData;

        const courseTitle = courseData?.title || courseData?.courseTitle || '';
        const courseCode = courseData?.referenceNumber || courseData?.courseReferenceNumber || run?.courseReferenceNumber || '';
        // SSG returns dates as YYYYMMDD integers (e.g. 20260408)
        const runStartDate = parseDate(run?.courseStartDate || run?.courseDates?.start || run?.startDate);
        const runEndDate = parseDate(run?.courseEndDate || run?.courseDates?.end || run?.endDate);

        if (!courseCode && !courseTitle) {
          console.log(`  ⚠️ Run ${ssgRunId}: no course code or title found, skipping`);
          continue;
        }

        // ── Check enrollments FIRST — only create DB records if enrollments exist ──
        await sleep(RATE_LIMIT_MS);
        let enrolments: any[] = [];
        try {
          const enrolResult = await enrolmentAPI.searchEnrolment({
            parameters: { page: 0, pageSize: 100 },
            enrolment: {
              course: { run: { id: ssgRunId } },
              trainingPartner: { uen: tp.uen, code: tp.code }
            }
          } as any);

          if (!enrolResult.error) {
            enrolments = Array.isArray(enrolResult.data) ? enrolResult.data : [];
          }
        } catch (err) {
          console.log(`  ⚠️ Enrolment check failed for ${ssgRunId}: ${err instanceof Error ? err.message : 'unknown'}`);
        }

        if (enrolments.length === 0) {
          console.log(`  ⏭️ Skipping ${ssgRunId} — no enrollments, will not create in DB`);
          debugErrors.push({ runId: ssgRunId, error: 'No enrollments — skipped', status: 0 });
          continue;
        }

        console.log(`  ✅ ${ssgRunId} has ${enrolments.length} enrollments — creating/updating DB records`);

        // Ensure course + course_run exist in DB
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          let courseRow = await client.query(
            COURSE_ID_BY_ANY_CODE_SQL,
            [courseCode]
          );
          let courseUuid: string;
          if (courseRow.rows.length === 0) {
            const ins = await client.query(
              `INSERT INTO course (title, course_code) VALUES ($1, $2)
               ON CONFLICT DO NOTHING RETURNING id`,
              [courseTitle, courseCode]
            );
            courseUuid = ins.rows[0]?.id || (await client.query(COURSE_ID_BY_ANY_CODE_SQL, [courseCode])).rows[0].id;
            console.log(`  📚 Created course: ${courseCode} — ${courseTitle}`);
          } else {
            courseUuid = courseRow.rows[0].id;
            // Update title if blank
            await client.query(
              `UPDATE course SET title = COALESCE(NULLIF(course.title, ''), $1) WHERE id = $2`,
              [courseTitle, courseUuid]
            );
          }

          // Ensure course_run exists in DB (unique on course_run_id)
          let crRow = await client.query(
            `SELECT id, course_id FROM course_run WHERE course_run_id = $1 LIMIT 1`,
            [ssgRunId]
          );
          let crUuid: string;
          if (crRow.rows.length === 0) {
            const ins = await client.query(
              `INSERT INTO course_run (course_id, course_run_id, start_date, end_date, class_status)
               VALUES ($1, $2, $3::date, $4::date, 'Confirmed') RETURNING id`,
              [courseUuid, ssgRunId, runStartDate, runEndDate]
            );
            crUuid = ins.rows[0].id;
            console.log(`  📋 Created course run: ${ssgRunId}`);
          } else {
            crUuid = crRow.rows[0].id;
            // Update dates and status from SSG
            await client.query(
              `UPDATE course_run SET
                 start_date = COALESCE($1::date, course_run.start_date),
                 end_date = COALESCE($2::date, course_run.end_date),
                 class_status = COALESCE(course_run.class_status, 'Confirmed')
               WHERE id = $3`,
              [runStartDate, runEndDate, crUuid]
            );
          }

          await client.query('COMMIT');

          courseRuns.push({
            uuid: crUuid,
            ssg_run_id: ssgRunId,
            course_title: courseTitle,
            course_code: courseCode,
            course_uuid: courseUuid,
            start_date: runStartDate,
            end_date: runEndDate,
            class_status: null,
            enrolment_count: enrolments.length,
            _prefetchedEnrolments: enrolments, // pass to avoid re-fetching
          } as any);
        } catch (dbErr) {
          await client.query('ROLLBACK');
          console.error(`  ❌ DB error for run ${ssgRunId}:`, dbErr);
        } finally {
          client.release();
        }
      } catch (fetchErr) {
        console.error(`  ❌ Fetch error for run ${ssgRunId}:`, fetchErr);
      }

      await sleep(RATE_LIMIT_MS);
    }
  } else {
    // ── Date-range mode: query local DB for course runs ending in the month ──
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().slice(0, 10);

    console.log(`📅 Date range: ${startOfMonth} to ${endOfMonth}`);

    const courseRunsResult = await pool.query(
      `SELECT
         cr.id AS uuid,
         cr.course_run_id AS ssg_run_id,
         c.title AS course_title,
         c.course_code,
         c.id AS course_uuid,
         cr.start_date,
         cr.end_date,
         cr.class_status,
         COUNT(e.id) AS enrolment_count
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       LEFT JOIN enrollment e ON e.course_run_id = cr.id AND e.enrolment_status != 'Admin Removed'
       WHERE cr.end_date >= $1::date
         AND cr.end_date <= $2::date
       GROUP BY cr.id, cr.course_run_id, c.title, c.course_code, c.id, cr.start_date, cr.end_date, cr.class_status
       HAVING COUNT(e.id) > 0
       ORDER BY cr.end_date ASC
       LIMIT $3`,
      [startOfMonth, endOfMonth, limit]
    );
    courseRuns = courseRunsResult.rows;
  }

  if (courseRuns.length === 0) {
    return res.status(200).json({
      success: true,
      message: isSpecificMode
        ? (skippedExisting.length > 0
          ? `All ${skippedExisting.length} course runs already exist in the database.`
          : 'No valid course runs found from the provided IDs.')
        : `No completed classes with enrollments found for ${year}-${String(month).padStart(2, '0')}.`,
      summary: {
        alreadyInDb: skippedExisting.length,
        pulledFromSsg: 0,
        totalCourseRuns: 0,
        totalEnrolmentsFetched: 0,
        totalEnrolmentsInserted: 0,
      },
      total: 0,
      results: [],
      skippedExisting,
      ...(debugErrors.length > 0 && { debugErrors }),
    });
  }

  console.log(`📋 Processing ${courseRuns.length} course runs`);

  const results: any[] = [];

  for (const cr of courseRuns) {
    const ssgRunId = cr.ssg_run_id;
    console.log(`\n📋 Processing: ${ssgRunId} — ${cr.course_title}`);
    const result: any = {
      courseRunId: ssgRunId,
      courseTitle: cr.course_title,
      courseCode: cr.course_code,
      startDate: cr.start_date,
      endDate: cr.end_date,
      ssgEnrolmentsFetched: 0,
      ssgEnrolmentsInserted: 0,
      sessionsFetched: 0,
      sessionsSynced: 0,
      attendanceFetched: 0,
      trainerUpdated: false,
      errors: [] as string[],
    };

    // ── 3a. Fetch SSG enrollments (or use pre-fetched from specific mode) ──
    const prefetched = (cr as any)._prefetchedEnrolments;
    try {
      let enrolments: any[] = [];

      // In specific mode, enrollments were already fetched during the pre-check
      if (prefetched) {
        enrolments = prefetched;
      } else {
        const enrolResult = await enrolmentAPI.searchEnrolment({
          parameters: { page: 0, pageSize: 100 },
          enrolment: {
            course: { run: { id: ssgRunId } },
            trainingPartner: { uen: tp.uen, code: tp.code }
          }
        } as any);

        if (!enrolResult.error) {
          enrolments = Array.isArray(enrolResult.data) ? enrolResult.data : [];
        } else {
          const code = String(enrolResult.status);
          if (code !== '404') {
            result.errors.push(`SSG enrolment error ${code}: ${enrolResult.error?.message ?? ''}`);
          }
        }
      }

      result.ssgEnrolmentsFetched = enrolments.length;

      if (enrolments.length > 0) {
        // Upsert enrollments
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          let inserted = 0;
          for (const record of enrolments) {
            const enrolment = record?.enrolment ?? {};
            const trainee = enrolment?.trainee ?? {};
            const email = trainee?.email?.full ?? trainee?.emailAddress ?? null;
            const fullName = trainee?.fullName ?? null;
            const nric = trainee?.id ?? null;
            const enrolmentId = enrolment?.referenceNumber ?? null;
            const enrolStatus = enrolment?.status ?? null;
            const contactNum = trainee?.contactNumber ?? {};
            const tel = [contactNum.countryCode, contactNum.phoneNumber].filter(Boolean).join('') || '';

            if (!email) continue;

            // Find or create user
            let userRow = await client.query(`SELECT id FROM app_user WHERE email = $1 LIMIT 1`, [email]);
            let userId: string;
            if (userRow.rows.length === 0) {
              const ins = await client.query(
                `INSERT INTO app_user (email, password, password_hash, full_name) VALUES ($1, $3, $3, $2) ON CONFLICT (email) DO NOTHING RETURNING id`,
                [email, fullName || email, tp.defaultPassword]
              );
              userId = ins.rows[0]?.id || (await client.query(`SELECT id FROM app_user WHERE email = $1 LIMIT 1`, [email])).rows[0].id;
              await client.query(`INSERT INTO learner_profile (user_id, nric, tel) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`, [userId, nric, tel]);
              await client.query(`INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Learner') ON CONFLICT (user_id, role) DO NOTHING`, [userId]);
            } else {
              userId = userRow.rows[0].id;
            }

            const enrolDate = parseDate(trainee?.enrolmentDate);
            const sponsorship = mapSponsorship(trainee?.sponsorshipType);

            const upsertRes = await client.query(
              `INSERT INTO enrollment
                 (user_id, course_id, course_run_id, enrolment_id, nric, email,
                  enrolment_status, course_sponsorship, enrolment_date, raw_data)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::public.course_sponsorship, $9::date, $10::jsonb)
               ON CONFLICT (user_id, course_run_id) DO UPDATE SET
                 enrolment_id = COALESCE(EXCLUDED.enrolment_id, enrollment.enrolment_id),
                 nric = COALESCE(EXCLUDED.nric, enrollment.nric),
                 email = COALESCE(EXCLUDED.email, enrollment.email),
                 enrolment_status = COALESCE(EXCLUDED.enrolment_status, enrollment.enrolment_status),
                 course_sponsorship = COALESCE(EXCLUDED.course_sponsorship, enrollment.course_sponsorship),
                 enrolment_date = COALESCE(EXCLUDED.enrolment_date, enrollment.enrolment_date),
                 raw_data = COALESCE(EXCLUDED.raw_data, enrollment.raw_data),
                 updated_at = NOW()
               RETURNING (xmax = 0) AS is_new`,
              [userId, cr.course_uuid, cr.uuid, enrolmentId, nric, email, enrolStatus, sponsorship, enrolDate || null, JSON.stringify(enrolment)]
            );
            if (upsertRes.rows[0]?.is_new) inserted++;
          }
          await client.query('COMMIT');
          result.ssgEnrolmentsInserted = inserted;
        } catch (dbErr) {
          await client.query('ROLLBACK');
          result.errors.push(`DB enrolment error: ${dbErr instanceof Error ? dbErr.message : 'unknown'}`);
        } finally {
          client.release();
        }
      }
    } catch (err) {
      result.errors.push(`Enrolment fetch error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    if (!prefetched) await sleep(RATE_LIMIT_MS);

    // ── 3b. Fetch SSG sessions and attendance ────────────────────────────
    try {
      // For specific-IDs mode: include expired and don't filter by month (fetch all sessions)
      // For date-range mode: filter by target month
      const sessionsResult = await courseAPI.viewCourseSessions(
        cr.course_code, ssgRunId, 'Y' as any,
        isSpecificMode ? undefined : month,
        isSpecificMode ? undefined : year
      );

      console.log(`  📅 viewCourseSessions(${cr.course_code}, ${ssgRunId}) status=${sessionsResult.status} error=${JSON.stringify(sessionsResult.error)} hasData=${!!sessionsResult.data}`);
      if (sessionsResult.data) {
        console.log(`  📅 Sessions data keys: ${Object.keys(sessionsResult.data).join(', ')}`);
        console.log(`  📅 Sessions data preview: ${JSON.stringify(sessionsResult.data).slice(0, 500)}`);
      }

      if (!sessionsResult.error && sessionsResult.data) {
        const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : (sessionsResult.data?.sessions || []);
        result.sessionsFetched = sessions.length;
        console.log(`  📅 ${sessions.length} sessions found`);

        // Upsert sessions to local DB
        let sessionsSynced = 0;
        for (const session of sessions) {
          const sessionId = session?.id || session?.sessionId;
          if (!sessionId) continue;

          // Upsert session into course_session
          const sessionStartDate = session?.startDate || session?.modeOfTraining?.startDate || null;
          const sessionEndDate = session?.endDate || session?.modeOfTraining?.endDate || null;
          const sessionStartTime = session?.startTime || null;
          const sessionEndTime = session?.endTime || null;
          const modeOfTraining = session?.modeOfTraining?.code || session?.modeOfTraining || null;
          const sessionTitle = session?.title || null;

          await pool.query(
            `INSERT INTO course_session (course_run_id, ssg_session_id, title, start_date, end_date, start_time, end_time, mode_of_training)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (course_run_id, ssg_session_id) DO UPDATE SET
               title = COALESCE(EXCLUDED.title, course_session.title),
               start_date = COALESCE(EXCLUDED.start_date, course_session.start_date),
               end_date = COALESCE(EXCLUDED.end_date, course_session.end_date),
               start_time = COALESCE(EXCLUDED.start_time, course_session.start_time),
               end_time = COALESCE(EXCLUDED.end_time, course_session.end_time),
               mode_of_training = COALESCE(EXCLUDED.mode_of_training, course_session.mode_of_training),
               updated_at = NOW()`,
            [cr.uuid, sessionId, sessionTitle, sessionStartDate, sessionEndDate, sessionStartTime, sessionEndTime, modeOfTraining]
          );
          sessionsSynced++;

          // Fetch attendance for this session
          try {
            const attResult = await attendanceAPI.viewAttendance(ssgRunId, cr.course_code, sessionId);
            if (!attResult.error && attResult.data) {
              let records: any[] = [];
              try {
                records = extractRecordsFromViewAttendance(attResult.data, credentials.encryptionKey, sessionId);
              } catch (decErr) {
                result.errors.push(`Decrypt failed for session ${sessionId}: ${decErr instanceof Error ? decErr.message : 'unknown'}`);
              }
              result.attendanceFetched += records.length;

              for (const att of records) {
                const normalized = normalizeAttendanceRecord(att);
                if (!normalized) continue;
                const { nric: traineeId, isPresent } = normalized;

                // Find the local session ID
                const localSession = await pool.query(
                  `SELECT id FROM course_session WHERE course_run_id = $1 AND ssg_session_id = $2 LIMIT 1`,
                  [cr.uuid, sessionId]
                );
                if (localSession.rows.length > 0) {
                  // Find the user by NRIC
                  const userByNric = await pool.query(
                    `SELECT au.id FROM app_user au JOIN learner_profile lp ON lp.user_id = au.id WHERE lp.nric = $1 LIMIT 1`,
                    [traineeId]
                  );
                  const userId = userByNric.rows[0]?.id || null;

                  await pool.query(
                    `INSERT INTO course_attendance (session_id, user_id, nric, is_present)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (session_id, nric) DO UPDATE SET
                       is_present = EXCLUDED.is_present,
                       user_id = COALESCE(EXCLUDED.user_id, course_attendance.user_id),
                       updated_at = NOW()`,
                    [localSession.rows[0].id, userId, traineeId, isPresent]
                  );
                }
              }
            }
          } catch (attErr) {
            result.errors.push(`Attendance error for session ${sessionId}: ${attErr instanceof Error ? attErr.message : 'unknown'}`);
          }
          await sleep(1500); // Rate limit between attendance calls
        }
        result.sessionsSynced = sessionsSynced;
      }
    } catch (sessErr) {
      result.errors.push(`Sessions fetch error: ${sessErr instanceof Error ? sessErr.message : 'unknown'}`);
    }
    await sleep(RATE_LIMIT_MS);

    // ── 3c. Fetch SSG trainer info ───────────────────────────────────────
    try {
      const runResult = await courseAPI.viewCourseRun(ssgRunId, 'N');
      if (!runResult.error && runResult.data) {
        const trainers = runResult.data?.run?.linkCourseRunTrainer || runResult.data?.course?.run?.linkCourseRunTrainer || [];
        if (trainers.length > 0) {
          const tpgName = trainers[0]?.trainer?.name || '';
          const tpgEmail = trainers[0]?.trainer?.email || '';
          if (tpgName) {
            await pool.query(
              `UPDATE course_run SET tpg_assigned_trainer_name = $1, tpg_assigned_trainer_email = $2 WHERE id = $3`,
              [tpgName, tpgEmail, cr.uuid]
            );
            result.trainerUpdated = true;
            console.log(`  👨‍🏫 TPG trainer: ${tpgName}`);
          }
        }
      }
    } catch (trErr) {
      result.errors.push(`Trainer fetch error: ${trErr instanceof Error ? trErr.message : 'unknown'}`);
    }
    await sleep(RATE_LIMIT_MS);

    results.push(result);
    console.log(`  ✅ Done: ${result.ssgEnrolmentsFetched} enrolments, ${result.sessionsFetched} sessions, ${result.attendanceFetched} attendance records`);
  }

  const summary = {
    mode: isSpecificMode ? 'specific-ids' : 'date-range',
    ...(isSpecificMode ? { requestedIds: specificIds.length } : { month: `${year}-${String(month).padStart(2, '0')}` }),
    alreadyInDb: skippedExisting.length,
    pulledFromSsg: courseRuns.length,
    totalCourseRuns: courseRuns.length,
    totalEnrolmentsFetched: results.reduce((s, r) => s + r.ssgEnrolmentsFetched, 0),
    totalEnrolmentsInserted: results.reduce((s, r) => s + r.ssgEnrolmentsInserted, 0),
    totalSessionsFetched: results.reduce((s, r) => s + r.sessionsFetched, 0),
    totalSessionsSynced: results.reduce((s, r) => s + r.sessionsSynced, 0),
    totalAttendanceFetched: results.reduce((s, r) => s + r.attendanceFetched, 0),
    totalTrainersUpdated: results.filter(r => r.trainerUpdated).length,
    totalErrors: results.filter(r => r.errors.length > 0).length,
    skippedNoEnrolments: results.filter(r => r.errors.some((e: string) => e.includes('no enrollments'))).length,
  };

  console.log(`\n📊 Summary:`, JSON.stringify(summary, null, 2));

  return res.status(200).json({
    success: true,
    message: isSpecificMode
      ? `Synced ${summary.pulledFromSsg} from SSG, ${summary.alreadyInDb} already in DB`
      : `Synced ${summary.totalCourseRuns} completed classes for ${summary.month}`,
    summary,
    results,
    skippedExisting,
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
