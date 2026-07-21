import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { createSSGCourseAPI } from '../../../lib/ssg/api/course-api';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { getLocalYMD } from '../../../lib/dateHelpers';
import { OptionalSelector, Vacancy, ModeOfTraining } from '../../../lib/ssg/models/course-runs';
import { AddRunInfo, AddCourseRunUtils } from '../../../lib/ssg/models/add-course-run';

/**
 * External API — Create a NEW course run (+ sessions) and submit it to SSG.
 *
 * Intended caller: OpenClaw automations acting for training staff ("create a new
 * run for course X on these dates"). The endpoint is deliberately ADD-ONLY — it
 * never updates or deletes existing rows. It clones venue / schedule / session
 * pattern from the course's most recent existing run so the submission uses
 * values SSG has already accepted for that exact course; the caller supplies
 * only the new dates.
 *
 * Auth: header  x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>   (same key as all /api/external/*)
 *
 * POST /api/external/create-course-run
 * Body:
 *   {
 *     "course_code": "TGS-2025060472",     // REQUIRED
 *     "start_date":  "2026-09-01",         // REQUIRED (YYYY-MM-DD) — new run start
 *     "end_date":    "2026-09-02",         // REQUIRED (YYYY-MM-DD) — new run end
 *
 *     // ── all optional overrides (defaults are cloned / auto-computed) ──
 *     "opening_registration_date": "2026-07-13", // default: today (SGT)
 *     "closing_registration_date": "2026-08-31", // default: day before start_date
 *     "vacancy":       "available",              // default: available
 *     "admin_email":   "admin@…",                // default: cloned run's admin email → TP support email
 *     "mode_of_training": "1",                   // SSG code; default: cloned from template run
 *     "venue": { "floor":"…","unit":"…","postalCode":"…","room":"…","block":"…","street":"…","building":"…","wheelChairAccess":false },
 *     "sessions": [ { "start_date":"…","end_date":"…","start_time":"09:30","end_time":"18:30","mode_of_training":"1" } ]
 *   }
 *
 * Behaviour:
 *   1. Validates dates (end >= start).
 *   2. Finds the course, then its most recent run WITH sessions as the clone template.
 *   3. Pulls run-level defaults (venue/schedule/mode/admin) from that run's live SSG record.
 *   4. Remaps the template's session pattern (day offsets + times) onto the new dates.
 *   5. Submits to SSG via addCourseRun.
 *   6. INSERT-ONLY persists the new course_run + course_session locally (ON CONFLICT DO NOTHING).
 *      Local persistence is best-effort: if it fails the SSG run still stands and the
 *      daily sync will pick it up — the request still returns success with a warning.
 *
 * Responses:
 *   200 { success:true, course_run_id, ssg, run, sessions, cloned_from, warnings }
 *   400 { success:false, error, details? }  — bad input / validation / SSG rejection with detail
 *   401 { success:false, error }            — bad/missing API key
 *   404 { success:false, error }            — course_code not found
 *   422 { success:false, error }            — no template run to clone and no venue supplied
 */

// ── date helpers ──────────────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts 'YYYYMMDD' or 'YYYY-MM-DD'; returns 'YYYY-MM-DD' or null. */
function normDate(d: unknown): string | null {
  if (d == null) return null;
  const s = String(d).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (DATE_RE.test(s)) return s;
  return null;
}
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** SSG modeOfTraining code → local mode_of_learning label (mirrors upcoming-course-runs). */
function modeCodeToLocal(code: string): string {
  switch (code) {
    case '1': return 'Physical';
    case '2': return 'Online';
    case '3': return 'On the Job';
    case '4': return 'Hybrid';
    case '5': return 'Practical';
    default:  return 'Physical';
  }
}

type TemplateSession = { start_date: string; end_date: string; start_time: string; end_time: string; mode: string };
type Venue = { block: string; street: string; floor: string; unit: string; building: string; postalCode: string; room: string; wheelChair: boolean };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // ── Auth ────────────────────────────────────────────────────────────────────
  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  const body = req.body ?? {};
  const warnings: string[] = [];

  // ── Validate required inputs ──────────────────────────────────────────────────
  const courseCode = String(body.course_code ?? '').trim();
  const startDate = String(body.start_date ?? '').trim();
  const endDate = String(body.end_date ?? '').trim();
  if (!courseCode) return res.status(400).json({ success: false, error: 'course_code is required' });
  if (!isValidDate(startDate)) return res.status(400).json({ success: false, error: `start_date "${startDate}" is not a valid YYYY-MM-DD date` });
  if (!isValidDate(endDate)) return res.status(400).json({ success: false, error: `end_date "${endDate}" is not a valid YYYY-MM-DD date` });
  if (endDate < startDate) return res.status(400).json({ success: false, error: `end_date (${endDate}) is before start_date (${startDate})` });

  // Registration dates: default opening=today (SGT), closing=day before start.
  const openingReg = normDate(body.opening_registration_date) ?? getLocalYMD(new Date());
  const closingReg = normDate(body.closing_registration_date) ?? addDays(startDate, -1);
  if (body.opening_registration_date && !normDate(body.opening_registration_date)) {
    return res.status(400).json({ success: false, error: 'opening_registration_date is not a valid date' });
  }
  if (body.closing_registration_date && !normDate(body.closing_registration_date)) {
    return res.status(400).json({ success: false, error: 'closing_registration_date is not a valid date' });
  }

  try {
    // ── Resolve the course ──────────────────────────────────────────────────────
    const course = (await pool.query<{ id: string; course_code: string; title: string }>(
      `SELECT id, course_code, title FROM course WHERE course_code = $1 LIMIT 1`,
      [courseCode]
    )).rows[0];
    if (!course) return res.status(404).json({ success: false, error: `Course ${courseCode} not found` });

    // ── Find the clone template: most recent run WITH sessions ──────────────────
    const template = (await pool.query<{
      id: string; course_run_id: string;
      venue_block: string | null; venue_street: string | null; venue_building: string | null;
      venue_floor: string | null; venue_unit: string | null; venue_postal_code: string | null; venue_room: string | null;
      venue_wheelchair_access: boolean | null; course_admin_email: string | null; mode_of_learning: string | null;
      n_sessions: number;
    }>(
      `SELECT cr.id, cr.course_run_id,
              cr.venue_block, cr.venue_street, cr.venue_building, cr.venue_floor, cr.venue_unit,
              cr.venue_postal_code, cr.venue_room, cr.venue_wheelchair_access,
              cr.course_admin_email, cr.mode_of_learning,
              (SELECT COUNT(*)::int FROM course_session cs
                 WHERE cs.course_run_id = cr.id AND COALESCE(cs.deleted, false) = false) AS n_sessions
         FROM course_run cr
        WHERE cr.course_id = $1
          AND cr.course_run_id IS NOT NULL AND cr.course_run_id <> ''
          AND COALESCE(cr.is_deleted, false) = false
        ORDER BY ((SELECT COUNT(*) FROM course_session cs
                     WHERE cs.course_run_id = cr.id AND COALESCE(cs.deleted, false) = false) > 0) DESC,
                 cr.start_date DESC NULLS LAST
        LIMIT 1`,
      [course.id]
    )).rows[0];

    const tp = await getTrainingPartnerIdentifiers();

    // ── Assemble venue + run-level defaults (SSG template overlaid by local + overrides) ──
    const overrideVenue = (body.venue ?? {}) as Record<string, unknown>;
    let venue: Venue = {
      block: String(template?.venue_block ?? ''),
      street: String(template?.venue_street ?? ''),
      floor: String(template?.venue_floor ?? ''),
      unit: String(template?.venue_unit ?? ''),
      building: String(template?.venue_building ?? ''),
      postalCode: String(template?.venue_postal_code ?? ''),
      room: String(template?.venue_room ?? ''),
      wheelChair: template?.venue_wheelchair_access === true,
    };

    let scheduleInfoTypeCode = '';
    let scheduleInfoTypeDescription = '';
    let scheduleInfo = '';
    let modeCode = '';
    let templateSessions: TemplateSession[] = [];

    // Pull run-level fields that aren't stored locally (schedule) + a mode fallback
    // from the template run's live SSG record.
    if (template?.course_run_id) {
      // Local session pattern (already normalised).
      templateSessions = (await pool.query<{ start_date: string; end_date: string; start_time: string; end_time: string; mode_of_training: string }>(
        `SELECT start_date, end_date, start_time, end_time, mode_of_training
           FROM course_session
          WHERE course_run_id = $1 AND COALESCE(deleted, false) = false
          ORDER BY start_date NULLS LAST, start_time NULLS LAST`,
        [template.id]
      )).rows.map(r => ({
        start_date: normDate(r.start_date) ?? '',
        end_date: normDate(r.end_date) ?? normDate(r.start_date) ?? '',
        start_time: String(r.start_time ?? '').trim(),
        end_time: String(r.end_time ?? '').trim(),
        mode: String(r.mode_of_training ?? '').trim(),
      })).filter(s => s.start_date);

      try {
        const credsForView = await getSSGCredentialsService().getSSGCredentials();
        if (credsForView) {
          const baseUrl = credsForView.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
          const viewApi = createSSGCourseAPI(baseUrl, credsForView);
          const viewRes = await viewApi.viewCourseRun(template.course_run_id, OptionalSelector.YES);
          const ssgRun = (viewRes.data as any)?.course?.run ?? (viewRes.data as any)?.run;
          if (ssgRun) {
            scheduleInfoTypeCode = String(ssgRun.scheduleInfoType?.code ?? '').trim();
            scheduleInfoTypeDescription = String(ssgRun.scheduleInfoType?.description ?? '').trim();
            scheduleInfo = String(ssgRun.scheduleInfo ?? '').trim();
            modeCode = String(ssgRun.modeOfTraining ?? '').trim();
            const v = ssgRun.venue;
            if (v) {
              // Fill any venue gaps from the SSG record (local columns win when present).
              venue = {
                block: venue.block || String(v.block ?? ''),
                street: venue.street || String(v.street ?? ''),
                floor: venue.floor || String(v.floor ?? ''),
                unit: venue.unit || String(v.unit ?? ''),
                building: venue.building || String(v.building ?? ''),
                postalCode: venue.postalCode || String(v.postalCode ?? ''),
                room: venue.room || String(v.room ?? ''),
                wheelChair: venue.wheelChair || v.wheelChairAccess === true || String(v.wheelChairAccess).toLowerCase() === 'yes',
              };
            }
          }
        }
      } catch (e) {
        warnings.push(`Could not read schedule info from template run ${template.course_run_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      warnings.push(`No existing run found for ${courseCode}; using supplied/fixed defaults.`);
    }

    // Apply explicit venue overrides last.
    venue = {
      block: overrideVenue.block != null ? String(overrideVenue.block) : venue.block,
      street: overrideVenue.street != null ? String(overrideVenue.street) : venue.street,
      floor: overrideVenue.floor != null ? String(overrideVenue.floor) : venue.floor,
      unit: overrideVenue.unit != null ? String(overrideVenue.unit) : venue.unit,
      building: overrideVenue.building != null ? String(overrideVenue.building) : venue.building,
      postalCode: overrideVenue.postalCode != null ? String(overrideVenue.postalCode) : venue.postalCode,
      room: overrideVenue.room != null ? String(overrideVenue.room) : venue.room,
      wheelChair: overrideVenue.wheelChairAccess != null ? overrideVenue.wheelChairAccess === true : venue.wheelChair,
    };

    // Resolve run-level defaults with fallbacks.
    modeCode = String(body.mode_of_training ?? '').trim() || modeCode || ModeOfTraining.CLASSROOM;
    const adminEmail = String(body.admin_email ?? '').trim() || String(template?.course_admin_email ?? '').trim() || tp.supportEmail || tp.companyEmail || '';
    const vacancy = (String(body.vacancy ?? '').trim().toLowerCase() as Vacancy) || Vacancy.AVAILABLE;
    if (!scheduleInfo) { scheduleInfo = 'Please refer to the course schedule.'; warnings.push('scheduleInfo defaulted (template had none).'); }
    if (!scheduleInfoTypeCode) scheduleInfoTypeCode = '01';
    if (!scheduleInfoTypeDescription) scheduleInfoTypeDescription = 'Full Time';

    // Must have a usable venue.
    if (!venue.floor || !venue.unit || !venue.postalCode || !venue.room) {
      return res.status(422).json({
        success: false,
        error: 'No template run to clone a venue from, and no complete venue supplied. Provide "venue" with floor, unit, postalCode and room.',
      });
    }

    // ── Build the new run's sessions ──────────────────────────────────────────
    type OutSession = { startDate: string; endDate: string; startTime: string; endTime: string; mode: string };
    let outSessions: OutSession[] = [];

    const overrideSessions = Array.isArray(body.sessions) ? body.sessions : null;
    if (overrideSessions && overrideSessions.length > 0) {
      for (let i = 0; i < overrideSessions.length; i++) {
        const s = overrideSessions[i];
        const sStart = normDate(s.start_date);
        if (!sStart) return res.status(400).json({ success: false, error: `sessions[${i}].start_date invalid` });
        const sEnd = normDate(s.end_date) ?? sStart;
        outSessions.push({
          startDate: sStart, endDate: sEnd,
          startTime: String(s.start_time ?? '09:30').trim() || '09:30',
          endTime: String(s.end_time ?? '18:30').trim() || '18:30',
          mode: String(s.mode_of_training ?? modeCode).trim() || modeCode,
        });
      }
    } else if (templateSessions.length > 0) {
      // Remap the template's day-pattern onto the new start date.
      const tplStart = templateSessions.reduce((m, s) => (s.start_date < m ? s.start_date : m), templateSessions[0].start_date);
      const newSpan = daysBetween(startDate, endDate);
      for (const s of templateSessions) {
        const off = daysBetween(tplStart, s.start_date);
        const endOff = daysBetween(tplStart, s.end_date || s.start_date);
        const ns = addDays(startDate, off);
        const ne = addDays(startDate, endOff);
        if (off > newSpan) warnings.push(`Session offset day ${off} exceeds the new run span (${newSpan} days); date ${ns} is past end_date.`);
        outSessions.push({
          startDate: ns, endDate: ne,
          startTime: s.start_time || '09:30',
          endTime: s.end_time || '18:30',
          mode: s.mode || modeCode,
        });
      }
    } else {
      // No template sessions — one full-day session per calendar day of the run.
      const span = daysBetween(startDate, endDate);
      for (let d = 0; d <= span; d++) {
        const day = addDays(startDate, d);
        outSessions.push({ startDate: day, endDate: day, startTime: '09:30', endTime: '18:30', mode: modeCode });
      }
      warnings.push('No template sessions; generated one 09:30–18:30 session per day.');
    }

    // ── Assemble AddRunInfo (same structure the admin form submits) ────────────
    const runInfo: AddRunInfo = {
      courseReferenceNumber: courseCode,
      runs: [{
        sequenceNumber: Number(body.sequence_number) || 1,
        openingRegistrationDate: openingReg,
        closingRegistrationDate: closingReg,
        courseStartDate: startDate,
        courseEndDate: endDate,
        scheduleInfoTypeCode,
        scheduleInfoTypeDescription,
        scheduleInfo,
        block: venue.block || undefined,
        street: venue.street || undefined,
        floor: venue.floor,
        unit: venue.unit,
        building: venue.building || undefined,
        postalCode: venue.postalCode,
        room: venue.room,
        wheelChairAccess: venue.wheelChair ? OptionalSelector.YES : OptionalSelector.NO,
        modeOfTraining: modeCode as ModeOfTraining,
        courseAdminEmail: adminEmail,
        courseVacancy: vacancy,
        sessions: outSessions.map(s => ({
          modeOfTraining: s.mode as ModeOfTraining,
          startDate: s.startDate,
          endDate: s.endDate,
          startTime: s.startTime,
          endTime: s.endTime,
          floor: venue.floor,
          unit: venue.unit,
          postalCode: venue.postalCode,
          room: venue.room,
          wheelChairAccess: venue.wheelChair ? OptionalSelector.YES : OptionalSelector.NO,
          primaryVenue: OptionalSelector.YES,
        })),
        linkCourseRunTrainer: [],
      }],
    };

    // Validate before hitting SSG for a clean 400.
    const validation = AddCourseRunUtils.validateAddRunInfo(runInfo);
    if (validation.errors.length > 0) {
      return res.status(400).json({ success: false, error: 'Payload validation failed', details: validation.errors, warnings });
    }
    warnings.push(...validation.warnings);

    // ── Submit to SSG ──────────────────────────────────────────────────────────
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) return res.status(500).json({ success: false, error: 'SSG credentials not configured' });
    if (!credentials.encryptionKey) return res.status(500).json({ success: false, error: 'SSG encryption key not configured' });
    if (!credentials.uen) return res.status(500).json({ success: false, error: 'SSG UEN not configured' });

    const baseUrl = credentials.ssgApiBaseUrl || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const ssgApi = createSSGCourseAPI(baseUrl, credentials);
    const ssgResult = await ssgApi.addCourseRun(runInfo, OptionalSelector.NO);

    if (ssgResult.error) {
      return res.status(ssgResult.status && ssgResult.status >= 400 ? ssgResult.status : 400).json({
        success: false, error: 'SSG rejected the course run', ssg: ssgResult.error, warnings,
      });
    }

    const newRun = ssgResult.data?.data?.course?.runs?.[0];
    const newRunId = String(newRun?.runId ?? '').trim();
    if (!newRunId) {
      return res.status(502).json({ success: false, error: 'SSG did not return a runId for the new run', ssg: ssgResult.data, warnings });
    }

    // ── Persist locally — INSERT ONLY, never update/delete existing rows ────────
    let localUuid: string | null = null;
    try {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO course_run
           (id, course_id, course_run_id, class_status, start_date, end_date,
            mode_of_learning, registration_opening_date, registration_closing_date,
            course_admin_email, course_vacancy_code,
            venue_block, venue_street, venue_building, venue_floor, venue_unit,
            venue_postal_code, venue_room, venue_wheelchair_access,
            created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'Pending', $3::date, $4::date,
                 $5, $6::date, $7::date, $8, $9,
                 $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
         ON CONFLICT (course_id, course_run_id) DO NOTHING
         RETURNING id`,
        [course.id, newRunId, startDate, endDate, modeCodeToLocal(modeCode), openingReg, closingReg,
         adminEmail || null, vacancy,
         venue.block || null, venue.street || null, venue.building || null, venue.floor, venue.unit,
         venue.postalCode, venue.room, venue.wheelChair]
      );
      localUuid = ins.rows[0]?.id ?? null;

      if (localUuid) {
        for (let i = 0; i < outSessions.length; i++) {
          const s = outSessions[i];
          await pool.query(
            `INSERT INTO course_session
               (course_run_id, session_number, start_date, end_date, start_time, end_time, mode_of_training, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
            [localUuid, String(i + 1), s.startDate, s.endDate, s.startTime, s.endTime, s.mode]
          );
        }
      } else {
        warnings.push(`Run ${newRunId} already existed locally; skipped local insert.`);
      }
    } catch (persistErr) {
      // SSG already created the run — do not fail the request. Daily sync will reconcile.
      warnings.push(`SSG run ${newRunId} created, but local persistence failed: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`);
    }

    return res.status(200).json({
      success: true,
      course_run_id: newRunId,
      cloned_from: template?.course_run_id ?? null,
      ssg: { sequenceNumber: newRun?.sequenceNumber ?? null, message: newRun?.message ?? null },
      run: {
        course_code: courseCode,
        course_run_id: newRunId,
        start_date: startDate,
        end_date: endDate,
        registration_opening_date: openingReg,
        registration_closing_date: closingReg,
        mode_of_training: modeCode,
        vacancy,
        venue,
      },
      sessions: outSessions,
      warnings,
    });
  } catch (err) {
    console.error('external/create-course-run error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
