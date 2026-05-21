import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { addDaLearnerToCalendar } from '../../../lib/google-calendar/da-calendar-sync';

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

    // Sync Calendar — uses the same session-aware logic as Direct Applications.
    // Skips Company-Application-originated enrolments: those have their own
    // sync path (ca-calendar-sync.ts) that NEVER auto-creates events, whereas
    // addDaLearnerToCalendar used below DOES auto-create on match failure
    // and would produce duplicate recurring events for CA learners.
    if (action === 'sync-calendar') {
      const rows = await pool.query(`
        SELECT e.id, COALESCE(au.email, e.email) as email, c.title as course_title,
               cr.id as course_run_uuid,
               TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD') as start_date_iso
        FROM enrollment e
        JOIN course_run cr ON e.course_run_id = cr.id
        JOIN course c ON cr.course_id = c.id
        LEFT JOIN app_user au ON e.user_id = au.id
        WHERE (e.calendar_added IS NULL OR e.calendar_added = false)
          AND COALESCE(au.email, e.email) IS NOT NULL
          AND COALESCE(au.email, e.email) <> ''
          AND cr.start_date >= CURRENT_DATE
          AND NOT EXISTS (
            SELECT 1 FROM company_application ca
            WHERE LOWER(ca.trainee_email) = LOWER(COALESCE(au.email, e.email))
              AND (ca.course_run_id = cr.course_run_id OR ca.course_run_id = cr.id::text)
          )
      `);
      if (rows.rows.length === 0) return res.status(200).json({ success: true, checked: 0, matched: 0 });

      console.log(`📅 [sync-calendar] Processing ${rows.rows.length} enrolments via addDaLearnerToCalendar...`);

      let matched = 0;
      for (const row of rows.rows) {
        if (!row.email || !row.course_title) continue;
        try {
          const calResult = await addDaLearnerToCalendar(
            row.email,
            row.course_run_uuid,
            row.course_title,
            row.start_date_iso
          );
          if (calResult.addedTo > 0) {
            await pool.query(`UPDATE enrollment SET calendar_added = true, updated_at = NOW() WHERE id = $1`, [row.id]);
            // Also update DA record for the tick column
            await pool.query(`UPDATE da_application SET calendar_added = true WHERE LOWER(trainee_email) = LOWER($1) AND course_title = $2`, [row.email, row.course_title]);
            matched++;
            console.log(`📅 [sync-calendar] ✓ ${row.email} added to ${calResult.addedTo}/${calResult.totalSessions} session(s)`);
          } else {
            console.log(`📅 [sync-calendar] ✗ ${row.email} — no matching calendar event found for "${row.course_title}"`);
          }
        } catch (addErr) {
          console.error(`❌ [sync-calendar] Failed to add ${row.email}:`, addErr);
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

    // Add to Calendar — uses the same session-aware logic as Direct Applications
    if (action === 'add-to-calendar') {
      const { enrollmentIds } = req.body;
      if (!Array.isArray(enrollmentIds)) return res.status(400).json({ success: false, error: 'enrollmentIds required' });

      const rows = await pool.query(`
        SELECT e.id, COALESCE(au.email, e.email) as email, c.title as course_title,
               cr.id as course_run_uuid,
               TO_CHAR(cr.start_date AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD') as start_date_iso,
               e.calendar_added
        FROM enrollment e
        JOIN course_run cr ON e.course_run_id = cr.id
        JOIN course c ON cr.course_id = c.id
        LEFT JOIN app_user au ON e.user_id = au.id
        WHERE e.id = ANY($1::uuid[])
      `, [enrollmentIds]);

      const results: any[] = [];
      for (const row of rows.rows) {
        if (row.calendar_added) { results.push({ id: row.id, success: true }); continue; }
        if (!row.email || !row.course_title) { results.push({ id: row.id, success: false, error: 'Missing email/title' }); continue; }
        try {
          const calResult = await addDaLearnerToCalendar(
            row.email,
            row.course_run_uuid,
            row.course_title,
            row.start_date_iso
          );
          if (calResult.addedTo > 0) {
            await pool.query(`UPDATE enrollment SET calendar_added = true, updated_at = NOW() WHERE id = $1`, [row.id]);
            results.push({ id: row.id, success: true });
          } else {
            results.push({ id: row.id, success: false, error: 'No matching calendar event' });
          }
        } catch (err: any) {
          results.push({ id: row.id, success: false, error: err.message });
        }
      }
      return res.status(200).json({ success: true, results });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (err: any) {
    console.error('❌ enrolment-actions error:', err);
    let msg = err instanceof Error ? err.message : 'Internal server error';
    if (msg.includes('insufficient authentication scopes')) {
        msg = 'Insufficient Google Calendar permissions. Please re-generate your Google Refresh Token with the Calendar scope enabled.';
    }
    return res.status(500).json({ success: false, error: msg });
  }
}
