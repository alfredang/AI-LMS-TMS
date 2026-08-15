import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { autoShareCourseResourcesWithTrainerByRun } from '../../../lib/google-drive/drive-helpers';

/**
 * POST /api/admin/sync-from-calendar
 *
 * Syncs Google Calendar events to local DB for a given date.
 *
 * Body: { date: 'YYYY-MM-DD', mode: 'preview' | 'apply' }
 *
 * Preview: returns matched events with trainer info + alerts.
 * Apply: upserts course runs + syncs trainers.
 */

function detectClassType(title: string): 'Virtual' | 'Hybrid' | 'External' | 'Physical' {
  const upper = (title || '').toUpperCase();
  if (/\[VIRTUAL\]/.test(upper) || /VIRTUAL\s*(CLASS|CLASSROOM)/i.test(title)) return 'Virtual';
  if (/\[HYBRID\]/.test(upper)) return 'Hybrid';
  if (/\[EXTERNAL\]/.test(upper)) return 'External';
  return 'Physical';
}

function stripTitle(title: string): string {
  return (title || '')
    .replace(/\[(?:WSQ|IBF|VIRTUAL|EXTERNAL|HYBRID)\]\s*/gi, '')
    .replace(/^\*\s*/, '')
    .replace(/^Day\s+\d+\s*[-–]\s*/i, '')
    .replace(/^(?:WSQ|IBF)\s*[-–]\s*/i, '')
    .trim();
}

function fmtSsgDate(v: number | string | undefined | null): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

interface CalendarSyncItem {
  calendarTitle: string;
  strippedTitle: string;
  courseCode: string | null;
  courseRunId: string | null;
  ssgStartDate: string | null;
  ssgEndDate: string | null;
  classType: 'Virtual' | 'Hybrid' | 'External' | 'Physical';
  localClassType: string | null;
  calendarTrainers: Array<{ name: string; email: string }>;
  calendarTrainer: { name: string; email: string } | null;
  localTrainer: { name: string; email: string } | null;
  status: 'new_cr' | 'trainer_mismatch' | 'already_synced' | 'ambiguous' | 'no_course_match' | 'no_cr_match' | 'upserted' | 'trainer_synced' | 'cancelled';
  matchCount: number;
  alert: string | null;
}

async function getCalendarClient(poolRef: typeof pool) {
  const credentials = await getGoogleCredentials(poolRef);
  const tpRes = await poolRef.query(
    'SELECT google_calendar_url FROM training_provider LIMIT 1'
  );
  const calUrl = tpRes.rows[0]?.google_calendar_url || '';
  let calendarId = 'primary';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
      catch { calendarId = cidMatch[1]; }
    } else if (calUrl.includes('@')) {
      calendarId = calUrl;
    }
  }
  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId, credentials.clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  return { calendar: google.calendar({ version: 'v3', auth: oauth2Client }), calendarId };
}

async function searchSSGCourseRuns(courseCode: string, ssgApp?: string) {
  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
  if (!credentials) return [];
  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
  const tp = await getTrainingPartnerIdentifiers();

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, '/courses/courseRuns/reference')
    .withMethod(HttpMethod.GET)
    .withParam('uen', credentials.uen || tp.uen)
    .withParam('courseReferenceNumber', courseCode)
    .withParam('pageSize', '100')
    .withParam('page', '0')
    .withParam('includeExpiredCourses', 'true');

  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });
  const httpResponse = await httpClient.request(builder.build());
  if (httpResponse.status !== 200) return [];

  const responseData = httpResponse.data as any;
  const ssgError = responseData?.error;
  if (ssgError && (ssgError.code || ssgError.message)) return [];

  const ssgData = responseData?.data ?? responseData;
  return ssgData?.course?.runs ?? ssgData?.runs ?? [];
}

async function searchSSGSessions(courseCode: string, runId: string, ssgApp?: string) {
  const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, ssgApp);
  if (!credentials) return [];
  const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

  const builder = new HTTPRequestBuilder()
    .withEndpoint(ssgBaseUrl, `/courses/runs/${runId}/sessions`)
    .withMethod(HttpMethod.GET)
    .withParam('uen', credentials.uen || (await getTrainingPartnerIdentifiers()).uen)
    .withParam('courseReferenceNumber', courseCode);

  if (credentials.certificateContent && credentials.privateKeyContent) {
    builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
  }

  const httpClient = new HttpClient(ssgBaseUrl, {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });
  const httpResponse = await httpClient.request(builder.build());
  if (httpResponse.status !== 200) return [];

  const responseData = httpResponse.data as any;
  const ssgError = responseData?.error;
  if (ssgError && (ssgError.code || ssgError.message)) return [];

  const ssgData = responseData?.data ?? responseData;
  return ssgData?.sessions ?? ssgData?.course?.run?.sessions ?? [];
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const {
    date,
    mode = 'preview',
    overrideMismatchedTrainers = false,
    confirmCancellations = [],
  } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'date (YYYY-MM-DD) is required' });
  }
  const confirmCancelSet = new Set<string>(
    Array.isArray(confirmCancellations) ? confirmCancellations.map((s: any) => String(s)) : []
  );

  try {
    // 1. Fetch Google Calendar events for the date
    const { calendar, calendarId } = await getCalendarClient(pool);
    const startOfDay = new Date(date + 'T00:00:00+08:00');
    const endOfDay = new Date(date + 'T23:59:59+08:00');

    const eventsRes = await calendar.events.list({
      calendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    });
    const events = (eventsRes.data.items || []).filter(
      e => /WSQ|IBF/i.test(e.summary || '')
    );

    // 2. Load trainer lookup (primary + secondary + additional emails)
    await pool.query('ALTER TABLE app_user ADD COLUMN IF NOT EXISTS additional_emails TEXT[] DEFAULT \'{}\'');
    const trainersRes = await pool.query(`
      SELECT au.id, au.full_name, LOWER(au.email) AS email, LOWER(au.secondary_email) AS sec,
             au.additional_emails
      FROM app_user au
      JOIN user_role_map urm ON urm.user_id = au.id
      WHERE urm.role = 'Trainer'
    `);
    const trainerByEmail = new Map<string, { id: string; name: string; email: string }>();
    for (const t of trainersRes.rows) {
      const entry = { id: t.id, name: t.full_name, email: t.email };
      if (t.email) trainerByEmail.set(t.email, entry);
      if (t.sec) trainerByEmail.set(t.sec, entry);
      if (Array.isArray(t.additional_emails)) {
        for (const ae of t.additional_emails) {
          if (ae) trainerByEmail.set(ae.toLowerCase(), entry);
        }
      }
    }

    const ssgApp = (req.headers['x-ssg-app'] as string) || undefined;
    const results: CalendarSyncItem[] = [];
    const RATE_LIMIT_MS = 1500;

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      const calTitle = evt.summary || '';
      const stripped = stripTitle(calTitle);
      const classType = detectClassType(calTitle);

      // Find ALL trainers in attendees
      const attendees = (evt.attendees || []).filter(a => !a.organizer && !a.self);
      const calTrainers: Array<{ name: string; email: string; id: string | null }> = [];
      for (const a of attendees) {
        const t = trainerByEmail.get((a.email || '').toLowerCase());
        if (t) { calTrainers.push({ name: a.displayName || t.name, email: t.email, id: t.id }); }
      }
      const calTrainer = calTrainers.length > 0 ? calTrainers[0] : null;

      // 3. Exact match course.title → course_code
      const courseMatch = await pool.query(
        'SELECT course_code FROM course WHERE LOWER(title) = LOWER($1) LIMIT 1',
        [stripped]
      );
      if (!courseMatch.rows[0]) {
        results.push({
          calendarTitle: calTitle, strippedTitle: stripped, classType,
          courseCode: null, courseRunId: null, ssgStartDate: null, ssgEndDate: null,
          localClassType: null, calendarTrainers: calTrainers, calendarTrainer: calTrainer, localTrainer: null,
          status: 'no_course_match', matchCount: 0,
          alert: `No course found for "${stripped}"`,
        });
        continue;
      }
      const courseCode = courseMatch.rows[0].course_code;

      // 4. Search SSG for course runs
      if (i > 0) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      const ssgRuns = await searchSSGCourseRuns(courseCode, ssgApp);

      // 5. Filter CRs where calendar date falls within start–end
      const matchedRuns = ssgRuns.filter((run: any) => {
        const start = fmtSsgDate(run.courseStartDate ?? run.courseDates?.start);
        const end = fmtSsgDate(run.courseEndDate ?? run.courseDates?.end);
        if (!start || !end) return false;
        return date >= start && date <= end;
      });

      if (matchedRuns.length === 0) {
        results.push({
          calendarTitle: calTitle, strippedTitle: stripped, classType,
          courseCode, courseRunId: null, ssgStartDate: null, ssgEndDate: null,
          localClassType: null, calendarTrainers: calTrainers, calendarTrainer: calTrainer, localTrainer: null,
          status: 'no_cr_match', matchCount: 0,
          alert: `Course ${courseCode}: ${ssgRuns.length} SSG runs found but none overlap ${date}`,
        });
        continue;
      }

      let finalRun: any = null;

      if (matchedRuns.length > 1) {
        // Ambiguous — check sessions to find which CR has a session on the exact date.
        // Calls GET /api/ssg/courses/{courseCode}/sessions/{runId} for each candidate.
        const sessionMatches: any[] = [];
        for (const candidate of matchedRuns) {
          const runId = String(candidate.id || candidate.courseRunId || '');
          try {
            await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
            const sessRes = await searchSSGSessions(courseCode, runId, ssgApp);
            const hasSessionOnDate = sessRes.some((s: any) => {
              const sessDate = fmtSsgDate(s.startDate);
              return sessDate === date;
            });
            if (hasSessionOnDate) {
              sessionMatches.push(candidate);
            }
          } catch {
            // Skip — session fetch failed for this candidate
          }
        }

        if (sessionMatches.length === 1) {
          finalRun = sessionMatches[0];
        } else if (sessionMatches.length === 0) {
          results.push({
            calendarTitle: calTitle, strippedTitle: stripped, classType,
            courseCode, courseRunId: null, ssgStartDate: null, ssgEndDate: null,
            localClassType: null, calendarTrainers: calTrainers, calendarTrainer: calTrainer, localTrainer: null,
            status: 'ambiguous', matchCount: matchedRuns.length,
            alert: `${matchedRuns.length} CRs overlap ${date} but none have a session on this date: ${matchedRuns.map((r: any) => r.id || r.courseRunId).join(', ')}`,
          });
          continue;
        } else {
          // Multiple CRs have sessions on this date — tiebreak by attendance + enrollment count
          const scored: Array<{ run: any; score: number }> = [];
          for (const candidate of sessionMatches) {
            const runId = String(candidate.id || candidate.courseRunId || '');
            const localCr = await pool.query('SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1', [runId]);
            if (!localCr.rows[0]) { scored.push({ run: candidate, score: 0 }); continue; }
            const uuid = localCr.rows[0].id;
            const attCount = await pool.query(
              'SELECT COUNT(*) FROM course_attendance ca JOIN course_session cs ON cs.id = ca.session_id WHERE cs.course_run_id = $1',
              [uuid]
            );
            const enrCount = await pool.query('SELECT COUNT(*) FROM enrollment WHERE course_run_id = $1', [uuid]);
            scored.push({ run: candidate, score: parseInt(attCount.rows[0].count) + parseInt(enrCount.rows[0].count) });
          }
          scored.sort((a, b) => b.score - a.score);

          if (scored[0].score > scored[1].score) {
            // Clear winner — the one with attendance/enrollment
            finalRun = scored[0].run;
            // In apply mode, cancel the losers — but NEVER auto-cancel a Confirmed
            // class or a class with enrollments, and require explicit admin
            // confirmation (confirmCancellations[] contains the CR uuid).
            if (mode === 'apply') {
              for (let si = 1; si < scored.length; si++) {
                const loserId = String(scored[si].run.id || scored[si].run.courseRunId || '');
                const loserCr = await pool.query(
                  `SELECT cr.id, cr.class_status,
                          (SELECT COUNT(*) FROM enrollment e WHERE e.course_run_id = cr.id) AS enr_count
                     FROM course_run cr WHERE cr.course_run_id = $1 LIMIT 1`,
                  [loserId]
                );
                const lr = loserCr.rows[0];
                if (!lr) continue;
                const isConfirmed = lr.class_status === 'Confirmed';
                const hasEnrollments = parseInt(lr.enr_count, 10) > 0;
                if (isConfirmed || hasEnrollments) continue;
                if (!confirmCancelSet.has(String(lr.id))) continue;
                await pool.query(
                  `UPDATE course_run SET class_status = 'Cancelled', updated_at = NOW() WHERE id = $1`,
                  [lr.id]
                );
              }
            }
          } else {
            results.push({
              calendarTitle: calTitle, strippedTitle: stripped, classType,
              courseCode, courseRunId: null, ssgStartDate: null, ssgEndDate: null,
              localClassType: null, calendarTrainers: calTrainers, calendarTrainer: calTrainer, localTrainer: null,
              status: 'ambiguous', matchCount: sessionMatches.length,
              alert: `${sessionMatches.length} CRs have sessions on ${date} with similar data: ${sessionMatches.map((r: any) => r.id || r.courseRunId).join(', ')}`,
            });
            continue;
          }
        }
      } else {
        finalRun = matchedRuns[0];
      }

      // Exactly 1 match
      const run = finalRun;
      const courseRunId = String(run.id || run.courseRunId || '');
      const ssgStart = fmtSsgDate(run.courseStartDate ?? run.courseDates?.start);
      const ssgEnd = fmtSsgDate(run.courseEndDate ?? run.courseDates?.end);

      // 6. Check local assignment
      const localCr = await pool.query(
        `SELECT cr.id AS uuid, cr.assigned_trainer_name, cr.assigned_trainer_email, COALESCE(cr.class_type, 'Physical') AS class_type
         FROM course_run cr WHERE cr.course_run_id = $1 LIMIT 1`,
        [courseRunId]
      );
      const localRow = localCr.rows[0];

      let localTrainer: { name: string; email: string } | null = null;
      if (localRow) {
        // Check junction first
        const junction = await pool.query(
          'SELECT trainer_name, trainer_email FROM course_run_trainer WHERE course_run_id = $1 LIMIT 1',
          [localRow.uuid]
        );
        if (junction.rows[0]?.trainer_email) {
          localTrainer = { name: junction.rows[0].trainer_name, email: junction.rows[0].trainer_email };
        } else if (localRow.assigned_trainer_email) {
          localTrainer = { name: localRow.assigned_trainer_name, email: localRow.assigned_trainer_email };
        }
      }

      // Determine status
      let status: CalendarSyncItem['status'];
      let alert: string | null = null;

      if (!localRow) {
        status = 'new_cr';
      } else if (
        calTrainers.length > 0 && localTrainer &&
        !calTrainers.some(ct => ct.email.toLowerCase() === localTrainer!.email.toLowerCase())
      ) {
        status = 'trainer_mismatch';
        alert = `Local: ${localTrainer.name} <${localTrainer.email}> vs Calendar: ${calTrainers.map(ct => `${ct.name} <${ct.email}>`).join(', ')}`;
      } else if (calTrainers.length > 0 && !localTrainer) {
        status = 'new_cr'; // CR exists but no trainer assigned
      } else if (calTrainers.length > 1 && localRow) {
        // Check if all calendar trainers are in junction table
        const junctionAll = await pool.query(
          'SELECT LOWER(trainer_email) AS email FROM course_run_trainer WHERE course_run_id = $1',
          [localRow.uuid]
        );
        const localEmails = new Set(junctionAll.rows.map((r: any) => r.email));
        const missing = calTrainers.filter(ct => !localEmails.has(ct.email.toLowerCase()));
        if (missing.length > 0) {
          status = 'trainer_mismatch';
          alert = `${missing.length} calendar trainer(s) not in local: ${missing.map(ct => ct.name).join(', ')}`;
        } else {
          status = 'already_synced';
        }
      } else {
        status = 'already_synced';
      }

      // 7. Apply mode — upsert CR + sync trainer
      if (mode === 'apply' && status !== 'already_synced') {
        try {
          // Upsert via existing endpoint logic (inline — single CR)
          const upsertRes = await fetch(
            `${req.headers.origin || 'http://localhost:3000'}/api/admin/upsert-from-ssg`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ courseRunIds: [courseRunId], mode: 'apply' }),
            }
          );
          const upsertJson = await upsertRes.json();
          if (!upsertJson.success) {
            alert = `Upsert failed: ${upsertJson.error || 'unknown'}`;
          } else {
            status = 'upserted';
          }

          // Sync trainers from calendar — SAFE defaults:
          //   * If local trainer exists AND is on the calendar invite, keep them as primary.
          //   * Otherwise pick the calendar trainer deterministically (sorted by email).
          //   * 'trainer_mismatch' → do NOT override unless overrideMismatchedTrainers=true.
          //   * Only delete stale junction rows when overrideMismatchedTrainers=true.
          const allowOverride = overrideMismatchedTrainers === true;
          const shouldSyncTrainers =
            calTrainers.length > 0 &&
            (status === 'upserted' || (status === 'trainer_mismatch' && allowOverride));

          if (shouldSyncTrainers) {
            const crAfter = await pool.query(
              'SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1',
              [courseRunId]
            );
            const uuid = crAfter.rows[0]?.id;
            if (uuid) {
              // Deterministic order: local trainer first (if on invite), then by email.
              const sorted = [...calTrainers].sort((a, b) => a.email.localeCompare(b.email));
              const localEmail = localTrainer?.email.toLowerCase();
              const localOnInvite = localEmail
                ? sorted.find(ct => ct.email.toLowerCase() === localEmail)
                : null;
              const orderedTrainers = localOnInvite
                ? [localOnInvite, ...sorted.filter(ct => ct.email.toLowerCase() !== localEmail)]
                : sorted;

              // Upsert all calendar trainers into junction
              for (const ct of orderedTrainers) {
                await pool.query(`
                  INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
                  VALUES ($1, $2, $3, $4)
                  ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'::uuid))
                  DO UPDATE SET trainer_name = EXCLUDED.trainer_name, trainer_email = EXCLUDED.trainer_email
                `, [uuid, ct.id, ct.name, ct.email]);

                // Auto-share courseware + assessment folders with the synced trainer (non-blocking)
                autoShareCourseResourcesWithTrainerByRun(uuid, ct.email).catch(err => {
                  console.warn(`⚠️ [sync-from-calendar] auto-share failed (non-blocking): ${err?.message}`);
                });
              }

              // Clean up stale junction rows only when admin explicitly opted into override.
              if (allowOverride) {
                const keepEmails = orderedTrainers.map(ct => ct.email.toLowerCase());
                await pool.query(
                  `DELETE FROM course_run_trainer
                    WHERE course_run_id = $1
                      AND LOWER(trainer_email) <> ALL($2::text[])`,
                  [uuid, keepEmails]
                );
              }

              // Scalar columns: prefer preserved local trainer, else deterministic primary.
              const primary = orderedTrainers[0];
              await pool.query(`
                UPDATE course_run
                SET assigned_trainer_name = $1, assigned_trainer_email = $2, assigned_trainer_id = $3, updated_at = NOW()
                WHERE id = $4
              `, [primary.name, primary.email, primary.id, uuid]);

              status = 'trainer_synced';
            }
          } else if (status === 'trainer_mismatch' && !allowOverride) {
            // Surface as alert; do NOT touch trainer columns.
            alert = (alert ? alert + ' — ' : '') +
              'trainer override skipped (set overrideMismatchedTrainers=true to apply)';
          }

        } catch (applyErr: any) {
          alert = `Apply error: ${applyErr.message}`;
        }
      }

      // Always sync class type from calendar title on apply (even if already_synced)
      if (mode === 'apply') {
        const crForType = await pool.query(
          'SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1',
          [courseRunId]
        );
        if (crForType.rows[0]?.id) {
          await pool.query(
            `UPDATE course_run SET class_type = $1, updated_at = NOW() WHERE id = $2`,
            [classType, crForType.rows[0].id]
          );
        }
      }

      results.push({
        calendarTitle: calTitle, strippedTitle: stripped, classType,
        courseCode, courseRunId, ssgStartDate: ssgStart, ssgEndDate: ssgEnd,
        localClassType: localRow?.class_type || null,
        calendarTrainers: calTrainers, calendarTrainer: calTrainer, localTrainer,
        status, matchCount: 1, alert,
      });
    }

    // Find local course runs with sessions on this date that have NO matching calendar event.
    // These are candidates for cancellation.
    const matchedCourseRunIds = new Set(results.map(r => r.courseRunId).filter(Boolean));
    const localOnDate = await pool.query(
      `SELECT DISTINCT cr.id AS uuid, cr.course_run_id, c.title AS course_title, c.course_type, cr.class_status,
              (SELECT COUNT(*) FROM enrollment e WHERE e.course_run_id = cr.id) AS enr_count
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       JOIN course_session cs ON cs.course_run_id = cr.id
       WHERE cs.deleted = false
         AND cs.start_date = $1
         AND cr.class_status NOT IN ('Cancelled', 'Confirmed')
         AND c.course_type IN ('WSQ', 'CASL', 'IBF')
       ORDER BY c.title`,
      [date.replace(/-/g, '')]
    );

    const notInCalendar: Array<{
      courseRunUuid: string;
      courseRunId: string;
      courseTitle: string;
      classStatus: string;
      enrollmentCount: number;
      cancelled: boolean;
      skipReason?: string;
    }> = [];
    for (const row of localOnDate.rows) {
      if (matchedCourseRunIds.has(row.course_run_id)) continue;
      const enrCount = parseInt(row.enr_count, 10) || 0;
      let cancelled = false;
      let skipReason: string | undefined;

      if (mode === 'apply') {
        if (enrCount > 0) {
          skipReason = `has ${enrCount} enrollment(s)`;
        } else if (!confirmCancelSet.has(String(row.uuid))) {
          skipReason = 'not explicitly confirmed for cancellation';
        } else {
          await pool.query(
            `UPDATE course_run SET class_status = 'Cancelled', updated_at = NOW() WHERE id = $1`,
            [row.uuid]
          );
          cancelled = true;
        }
      }

      notInCalendar.push({
        courseRunUuid: row.uuid,
        courseRunId: row.course_run_id,
        courseTitle: row.course_title,
        classStatus: row.class_status,
        enrollmentCount: enrCount,
        cancelled,
        skipReason,
      });
    }

    return res.status(200).json({
      success: true,
      date,
      mode,
      totalCalendarEvents: eventsRes.data.items?.length || 0,
      wsqEvents: events.length,
      results,
      notInCalendar,
    });
  } catch (err) {
    console.error('❌ sync-from-calendar error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
