import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { google } from 'googleapis';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';

/**
 * GET /api/admin/masterlist-learner-lookup
 *
 * Query params:
 *   course_title       — raw masterlist course title (Day N / ONE DAY prefix stripped)
 *   list_date          — YYYY-MM-DD
 *   course_run_no      — (optional) exact course_run_id match
 *   calendar_event_id  — (optional) stored as "{googleEventId}_{YYYY-MM-DD}"; used to
 *                        fetch attendee emails directly from Google Calendar
 *
 * Lookup order:
 *   1. Google Calendar event attendees (most reliable — real guest list)
 *   2. enrollment → course_run → course by fuzzy title + date range
 *   3. enrollment by exact course_run_no
 *   4. da_application fallback
 *
 * For each email found, name + contact_no are looked up in app_user + learner_profile.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { course_title, list_date, course_run_no, calendar_event_id } =
    req.query as Record<string, string>;

  if (!course_title && !calendar_event_id) {
    return res.status(400).json({ success: false, error: 'course_title or calendar_event_id is required' });
  }

  // Strip "Day N -" / "ONE DAY -" prefix for title matching
  const baseTitle = (course_title || '')
    .replace(/^(Day\s+\d+|ONE\s*DAY)\s*[-–]\s*/i, '')
    .trim();

  console.log(`[masterlist-learner-lookup] course_title="${course_title}" baseTitle="${baseTitle}" list_date="${list_date}" calendar_event_id="${calendar_event_id}"`);

  const results: { name: string; contact_no: string; email: string }[] = [];
  let trainerResult: { name: string; email: string } | null = null;
  const seenEmails = new Set<string>();
  const seenNames = new Set<string>();

  // ── Trainer lookup via course_run (most reliable) ─────────────────────────
  // If a course_run_no is provided, look up the assigned trainer directly from
  // the course_run → trainer_profile → app_user chain.
  if (course_run_no) {
    try {
      const trRes = await pool.query(
        `SELECT au.full_name AS name, COALESCE(au.email, '') AS email
         FROM course_run cr
         JOIN trainer_profile tp ON tp.user_id = cr.assigned_trainer_id
         JOIN app_user au ON au.id = tp.user_id
         WHERE cr.course_run_id = $1 OR cr.id::text = $1
         LIMIT 1`,
        [course_run_no],
      );
      if (trRes.rows.length > 0) {
        trainerResult = { name: trRes.rows[0].name || '', email: trRes.rows[0].email || '' };
        console.log(`[masterlist-learner-lookup] trainer from course_run: ${JSON.stringify(trainerResult)}`);
      }
    } catch (e) {
      console.warn('[masterlist-learner-lookup] trainer course_run lookup failed:', e);
    }
  }

  const addResult = (name: string, contact_no: string, email: string) => {
    const emailKey = (email || '').toLowerCase().trim();
    const nameKey = (name || '').toLowerCase().trim();
    if (emailKey && seenEmails.has(emailKey)) return;
    if (!emailKey && nameKey && seenNames.has(nameKey)) return;
    if (emailKey) seenEmails.add(emailKey);
    if (nameKey) seenNames.add(nameKey);
    results.push({ name: name || '', contact_no: contact_no || '', email: email || '' });
  };

  // Helper: given a list of emails, look up name + contact from DB
  async function enrichEmails(emails: string[]): Promise<void> {
    if (emails.length === 0) return;
    const lower = emails.map(e => e.toLowerCase());

    // Check app_user + learner_profile
    const userRes = await pool.query(
      `SELECT au.email, au.full_name, COALESCE(lp.tel, '') AS contact_no
       FROM app_user au
       LEFT JOIN learner_profile lp ON lp.user_id = au.id
       WHERE LOWER(au.email) = ANY($1::text[])
       ORDER BY au.full_name`,
      [lower],
    );
    const found = new Set<string>();
    for (const r of userRes.rows) {
      found.add(r.email.toLowerCase());
      addResult(r.full_name || '', r.contact_no || '', r.email || '');
    }

    // For emails not in app_user, try da_application
    const missing = lower.filter(e => !found.has(e));
    if (missing.length > 0) {
      const daRes = await pool.query(
        `SELECT DISTINCT trainee_email AS email, trainee_name AS name,
                CASE
                  WHEN trainee_phone_country_code IS NOT NULL AND trainee_phone_country_code <> ''
                  THEN trainee_phone_country_code || ' ' || COALESCE(trainee_phone, '')
                  ELSE COALESCE(trainee_phone, '')
                END AS contact_no
         FROM da_application
         WHERE LOWER(trainee_email) = ANY($1::text[])
           AND trainee_name IS NOT NULL
         ORDER BY trainee_name`,
        [missing],
      );
      for (const r of daRes.rows) {
        addResult(r.name || '', r.contact_no || '', r.email || '');
      }
      // Any email still not found — add with empty name/contact so the email column is filled
      const foundAfterDa = new Set(results.map(r => r.email.toLowerCase()));
      for (const e of missing) {
        if (!foundAfterDa.has(e)) {
          addResult('', '', emails[lower.indexOf(e)] || e);
        }
      }
    }
  }

  try {
    // ── Source 1: Google Calendar event attendees (most reliable) ─────────────
    if (calendar_event_id) {
      try {
        // calendar_event_id is stored as "{googleEventId}_{YYYY-MM-DD}"
        // Extract the Google event ID by stripping the trailing _YYYY-MM-DD
        const parts = calendar_event_id.split('_');
        // Last element is the date "YYYY-MM-DD" (contains only digits and hyphens, no underscore)
        const googleEventId = parts.slice(0, -1).join('_');

        if (googleEventId) {
          const credentials = await getGoogleCredentials(pool);
          const tpRes = await pool.query(
            'SELECT google_calendar_url FROM training_provider LIMIT 1',
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
            credentials.clientId,
            credentials.clientSecret,
            'https://developers.google.com/oauthplayground',
          );
          oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

          const evtRes = await calendar.events.get({ calendarId, eventId: googleEventId });
          const EXCLUDED_EMAILS = new Set<string>();
          // Include ALL guests regardless of responseStatus (accepted/declined/tentative/needsAction)
          const attendees: string[] = (evtRes.data.attendees || [])
            .filter((a: any) => a.email && !a.self) // exclude the calendar owner's own entry
            .map((a: any) => a.email as string)
            .filter((e: string) => !EXCLUDED_EMAILS.has(e.toLowerCase()));

          // Also include the event organizer as a candidate trainer email
          // (organizer may not appear in the attendees list at all).
          const organizerEmail = (evtRes.data.organizer?.email || '').trim();
          const allCandidates = [...attendees];
          if (organizerEmail && !EXCLUDED_EMAILS.has(organizerEmail.toLowerCase())
              && !allCandidates.map(e => e.toLowerCase()).includes(organizerEmail.toLowerCase())) {
            allCandidates.push(organizerEmail);
          }

          console.log(`[masterlist-learner-lookup] calendar attendees: ${JSON.stringify(attendees)}, organizer: ${organizerEmail}`);

          // Identify trainer emails from the candidate list.
          // Check trainer_profile first (registered trainers), then fall back to
          // trainer_invitation (freelancers not yet registered in the system).
          // Only auto-fill if exactly 1 trainer is found — if multiple, leave blank
          // so the user can manually select the correct one.
          const trainerEmails = new Set<string>();
          const allTrainers: { name: string; email: string }[] = [];
          if (allCandidates.length > 0) {
            const lower = allCandidates.map(e => e.toLowerCase());

            // Source A: trainer_profile (registered trainers with system accounts)
            const tpRes = await pool.query(
              `SELECT au.full_name AS name, au.email
               FROM trainer_profile tp
               JOIN app_user au ON au.id = tp.user_id
               WHERE LOWER(au.email) = ANY($1::text[])
               ORDER BY au.full_name`,
              [lower],
            );
            for (const r of tpRes.rows) {
              trainerEmails.add(r.email.toLowerCase());
              allTrainers.push({ name: r.name || '', email: r.email || '' });
            }

            // Source B: trainer_invitation (freelancers looked up by email)
            if (allTrainers.length === 0) {
              const tiRes = await pool.query(
                `SELECT DISTINCT ON (LOWER(trainer_email)) trainer_name AS name, trainer_email AS email
                 FROM trainer_invitation
                 WHERE LOWER(trainer_email) = ANY($1::text[])
                 ORDER BY LOWER(trainer_email), created_at DESC`,
                [lower],
              );
              for (const r of tiRes.rows) {
                trainerEmails.add(r.email.toLowerCase());
                allTrainers.push({ name: r.name || '', email: r.email || '' });
              }
            }

            // Auto-fill only if exactly 1 trainer found AND not already set via course_run
            if (!trainerResult) {
              trainerResult = allTrainers.length === 1 ? allTrainers[0] : null;
            }
            console.log(`[masterlist-learner-lookup] trainers found: ${allTrainers.length}, auto-fill: ${JSON.stringify(trainerResult)}`);
          }

          // Enrich only non-trainer, non-organizer emails as learner rows.
          // Organizer is excluded from learner rows regardless (calendar admin).
          const organizerLower = organizerEmail.toLowerCase();
          const learnerEmails = attendees.filter(e =>
            !trainerEmails.has(e.toLowerCase()) && e.toLowerCase() !== organizerLower,
          );
          await enrichEmails(learnerEmails);
        }
      } catch (calErr) {
        console.warn(`[masterlist-learner-lookup] calendar fetch failed (non-fatal):`, calErr instanceof Error ? calErr.message : calErr);
      }
    }

    // ── Source 2: enrollment → course_run → course (fuzzy title + date) ───────
    if (baseTitle && results.length === 0) {
      const params: string[] = [`%${baseTitle}%`];
      let dateFilter = '';
      if (list_date) {
        params.push(list_date);
        dateFilter = `AND cr.start_date::text <= $2
                      AND (cr.end_date IS NULL OR cr.end_date::text >= $2)`;
      }

      const enrollRes = await pool.query(
        `SELECT
           au.full_name AS name,
           COALESCE(lp.tel, '') AS contact_no,
           COALESCE(au.email, '') AS email
         FROM enrollment e
         JOIN course_run cr ON cr.id = e.course_run_id
         JOIN course c ON c.id = cr.course_id
         JOIN app_user au ON au.id = e.user_id
         LEFT JOIN learner_profile lp ON lp.user_id = au.id
         WHERE c.title ILIKE $1
           ${dateFilter}
           AND e.enrolment_status IS DISTINCT FROM 'Admin Removed'
         ORDER BY au.full_name`,
        params,
      );
      console.log(`[masterlist-learner-lookup] source2 (enrollment+course): ${enrollRes.rows.length} rows`);
      for (const r of enrollRes.rows) {
        addResult(r.name || '', r.contact_no || '', r.email || '');
      }
    }

    // ── Source 3: enrollment by exact course_run_no ────────────────────────────
    if (course_run_no && results.length === 0) {
      const enrollRes = await pool.query(
        `SELECT
           au.full_name AS name,
           COALESCE(lp.tel, '') AS contact_no,
           COALESCE(au.email, '') AS email
         FROM enrollment e
         JOIN course_run cr ON cr.id = e.course_run_id
         JOIN app_user au ON au.id = e.user_id
         LEFT JOIN learner_profile lp ON lp.user_id = au.id
         WHERE (cr.course_run_id = $1 OR cr.id::text = $1)
           AND e.enrolment_status IS DISTINCT FROM 'Admin Removed'
         ORDER BY au.full_name`,
        [course_run_no],
      );
      console.log(`[masterlist-learner-lookup] source3 (course_run_no): ${enrollRes.rows.length} rows`);
      for (const r of enrollRes.rows) {
        addResult(r.name || '', r.contact_no || '', r.email || '');
      }
    }

    // ── Source 4: da_application fallback ─────────────────────────────────────
    if (baseTitle && results.length === 0) {
      const params: string[] = [`%${baseTitle}%`];
      if (list_date) params.push(list_date);

      const daRes = await pool.query(
        `SELECT
           da.trainee_name AS name,
           CASE
             WHEN da.trainee_phone_country_code IS NOT NULL AND da.trainee_phone_country_code <> ''
             THEN da.trainee_phone_country_code || ' ' || COALESCE(da.trainee_phone, '')
             ELSE COALESCE(da.trainee_phone, '')
           END AS contact_no,
           COALESCE(da.trainee_email, '') AS email
         FROM da_application da
         WHERE da.course_title ILIKE $1
           ${list_date ? `AND da.course_start_date::date <= $2::date
             AND (da.course_end_date IS NULL OR da.course_end_date::date >= $2::date)` : ''}
           AND LOWER(COALESCE(da.application_status, '')) NOT IN ('cancelled', 'rejected', 'withdrawn')
           AND da.trainee_name IS NOT NULL
         ORDER BY da.trainee_name`,
        params,
      );
      console.log(`[masterlist-learner-lookup] source4 (da_application): ${daRes.rows.length} rows`);
      for (const r of daRes.rows) {
        addResult(r.name || '', r.contact_no || '', r.email || '');
      }
    }

    return res.status(200).json({ success: true, data: results, trainer: trainerResult });
  } catch (err) {
    console.error('[masterlist-learner-lookup] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
