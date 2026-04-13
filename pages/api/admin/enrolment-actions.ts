import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { google } from 'googleapis';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';

/**
 * POST /api/admin/enrolment-actions
 *
 * Body: { action: string, enrollmentIds?: string[] }
 *
 * Actions:
 *   - toggle-field: { enrollmentId, field: 'calendar'|'invoice', value: boolean }
 *   - sync-calendar: checks Google Calendar for existing attendees
 *   - sync-invoice: matches against billing_history
 *   - sync-grants: matches against ssg_grants
 *   - add-to-calendar: { enrollmentIds } — adds learner emails to calendar events
 *   - generate-invoice: { enrollmentIds } — creates QB invoices (placeholder)
 */

function stripPrefixes(title: string): string {
  return (title || '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .replace(/^\s*\[?(WSQ|VIRTUAL|EXTERNAL|HYBRID)\]?\s*/gi, '')
    .trim();
}

async function getCalendarClient() {
  const tpRes = await pool.query(`SELECT sync_google_calendar, google_calendar_url FROM training_provider LIMIT 1`);
  const tpRow = tpRes.rows[0];
  if (!tpRow?.sync_google_calendar) throw new Error('Google Calendar sync not enabled');

  const credentials = await getGoogleCredentials(pool);
  let calendarId = 'primary';
  const calUrl = tpRow.google_calendar_url || '';
  if (calUrl) {
    const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); } catch { calendarId = cidMatch[1]; }
    } else if (calUrl.includes('@')) { calendarId = calUrl; }
  }

  const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, 'https://developers.google.com/oauthplayground');
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  return { calendar: google.calendar({ version: 'v3', auth: oauth2Client }), calendarId };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { action } = req.body || {};

  try {
    // Toggle a single field
    if (action === 'toggle-field') {
      const { enrollmentId, field, value } = req.body;
      if (!enrollmentId) return res.status(400).json({ success: false, error: 'enrollmentId required' });
      const colMap: Record<string, string> = { calendar: 'calendar_added', invoice: 'personal_invoice_number' };
      const col = colMap[field];
      if (!col) return res.status(400).json({ success: false, error: 'Invalid field' });
      const dbVal = field === 'calendar' ? value : (value ? 'MANUAL' : null);
      await pool.query(`UPDATE enrollment SET ${col} = $1, updated_at = NOW() WHERE id = $2`, [dbVal, enrollmentId]);
      return res.status(200).json({ success: true });
    }

    // Sync Calendar
    if (action === 'sync-calendar') {
      const { calendar, calendarId } = await getCalendarClient();
      const rows = await pool.query(`
        SELECT e.id, COALESCE(au.email, e.email) as email, c.title as course_title,
               TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD') as start_date_iso
        FROM enrollment e
        JOIN course_run cr ON e.course_run_id = cr.id
        JOIN course c ON cr.course_id = c.id
        LEFT JOIN app_user au ON e.user_id = au.id
        WHERE (e.calendar_added IS NULL OR e.calendar_added = false)
          AND COALESCE(au.email, e.email) IS NOT NULL
          AND COALESCE(au.email, e.email) <> ''
          AND cr.start_date >= CURRENT_DATE
      `);
      if (rows.rows.length === 0) return res.status(200).json({ success: true, checked: 0, matched: 0 });

      // Use SGT-normalized dates for calendar fetch window
      const dates = rows.rows.map(r => r.start_date_iso || '').filter(Boolean).sort();
      const minD = new Date(dates[0]); minD.setDate(minD.getDate() - 1);
      const maxD = new Date(dates[dates.length - 1]); maxD.setDate(maxD.getDate() + 2);

      console.log(`📅 [sync-calendar] Fetching events from ${minD.toISOString()} to ${maxD.toISOString()} for ${rows.rows.length} enrolments`);

      const evts = await calendar.events.list({ calendarId, timeMin: minD.toISOString(), timeMax: maxD.toISOString(), singleEvents: true, maxResults: 2500 });
      const events = evts.data.items || [];
      console.log(`📅 [sync-calendar] Found ${events.length} calendar events`);

      let matched = 0;
      for (const row of rows.rows) {
        if (!row.email || !row.course_title) continue;
        const startIso = row.start_date_iso || '';
        const stripped = stripPrefixes(row.course_title).toLowerCase();
        const emailLower = row.email.trim().toLowerCase();

        // Match: event title contains course title (or vice-versa) + event date matches start date
        const evt = events.find(e => {
          const evtTitle = stripPrefixes(e.summary || '').toLowerCase();
          const titleMatch = evtTitle.includes(stripped) || stripped.includes(evtTitle);
          if (!titleMatch) return false;
          const evtDate = e.start?.dateTime?.slice(0, 10) || e.start?.date || '';
          return evtDate === startIso;
        });

        if (evt && (evt.attendees || []).some(a => (a.email || '').toLowerCase() === emailLower)) {
          await pool.query(`UPDATE enrollment SET calendar_added = true, updated_at = NOW() WHERE id = $1`, [row.id]);
          matched++;
          console.log(`📅 [sync-calendar] ✓ ${row.email} found in "${evt.summary}" on ${startIso}`);
        }
      }
      console.log(`📅 [sync-calendar] Done: checked=${rows.rows.length}, matched=${matched}`);
      return res.status(200).json({ success: true, checked: rows.rows.length, matched });
    }

    // Sync Invoice
    if (action === 'sync-invoice') {
      const result = await pool.query(`
        UPDATE enrollment e
        SET personal_invoice_number = bh.invoice_number, updated_at = NOW()
        FROM billing_history bh
        WHERE (e.personal_invoice_number IS NULL OR e.personal_invoice_number = '')
          AND bh.invoice_number IS NOT NULL AND bh.invoice_number <> ''
          AND LOWER(COALESCE(bh.email, '')) = LOWER(COALESCE((SELECT au.email FROM app_user au WHERE au.id = e.user_id), e.email))
          AND LOWER(COALESCE(bh.course_code, '')) = LOWER(COALESCE(e.course_reference, ''))
        RETURNING e.id
      `);
      return res.status(200).json({ success: true, matched: result.rows.length });
    }

    // Sync Grants
    if (action === 'sync-grants') {
      const result = await pool.query(`
        UPDATE enrollment e
        SET grant_id = sg.grant_id,
            grant_amount = CASE WHEN COALESCE(sg.approved_grant_amount, '0.00') <> '0.00' THEN sg.approved_grant_amount ELSE sg.estimated_grant_amount END,
            updated_at = NOW()
        FROM ssg_grants sg
        WHERE sg.enrollment_id = e.enrolment_id
          AND e.enrolment_id IS NOT NULL AND e.enrolment_id <> ''
          AND (e.grant_id IS NULL OR e.grant_id = '')
          AND sg.grant_id IS NOT NULL
        RETURNING e.id
      `);
      return res.status(200).json({ success: true, matched: result.rows.length });
    }

    // Add to Calendar
    if (action === 'add-to-calendar') {
      const { enrollmentIds } = req.body;
      if (!Array.isArray(enrollmentIds)) return res.status(400).json({ success: false, error: 'enrollmentIds required' });
      const { calendar, calendarId } = await getCalendarClient();
      const rows = await pool.query(`
        SELECT e.id, COALESCE(au.email, e.email) as email, c.title as course_title,
               TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD') as start_date_iso,
               e.calendar_added
        FROM enrollment e
        JOIN course_run cr ON e.course_run_id = cr.id
        JOIN course c ON cr.course_id = c.id
        LEFT JOIN app_user au ON e.user_id = au.id
        WHERE e.id = ANY($1::uuid[])
      `, [enrollmentIds]);

      const dates = rows.rows.map(r => r.start_date_iso || '').filter(Boolean).sort();
      if (dates.length === 0) return res.status(200).json({ success: true, results: [] });
      const minD = new Date(dates[0]); minD.setDate(minD.getDate() - 1);
      const maxD = new Date(dates[dates.length - 1]); maxD.setDate(maxD.getDate() + 2);
      const evts = await calendar.events.list({ calendarId, timeMin: minD.toISOString(), timeMax: maxD.toISOString(), singleEvents: true, maxResults: 500 });
      const events = evts.data.items || [];

      const results: any[] = [];
      for (const row of rows.rows) {
        if (row.calendar_added) { results.push({ id: row.id, success: true }); continue; }
        if (!row.email || !row.course_title) { results.push({ id: row.id, success: false, error: 'Missing email/title' }); continue; }
        const startIso = row.start_date_iso || '';
        const stripped = stripPrefixes(row.course_title).toLowerCase();
        const evt = events.find(e => {
          const t = stripPrefixes(e.summary || '').toLowerCase();
          return (t.includes(stripped) || stripped.includes(t)) && (e.start?.dateTime?.slice(0, 10) || e.start?.date || '') === startIso;
        });
        if (!evt || !evt.id) { results.push({ id: row.id, success: false, error: 'No matching event' }); continue; }
        const existing = evt.attendees || [];
        if (existing.some(a => (a.email || '').toLowerCase() === row.email.trim().toLowerCase())) {
          await pool.query(`UPDATE enrollment SET calendar_added = true, updated_at = NOW() WHERE id = $1`, [row.id]);
          results.push({ id: row.id, success: true }); continue;
        }
        try {
          await calendar.events.patch({ calendarId, eventId: evt.id, requestBody: { attendees: [...existing, { email: row.email, responseStatus: 'needsAction' }] }, sendUpdates: 'none' });
          await pool.query(`UPDATE enrollment SET calendar_added = true, updated_at = NOW() WHERE id = $1`, [row.id]);
          results.push({ id: row.id, success: true });
        } catch (err: any) { results.push({ id: row.id, success: false, error: err.message }); }
      }
      return res.status(200).json({ success: true, results });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (err) {
    console.error('❌ enrolment-actions error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
