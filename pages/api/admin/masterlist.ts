import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS public.masterlist_table (
    id              uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    class_id        uuid NOT NULL,
    class_type      text NOT NULL,
    list_date       date,
    course_title    text,
    course_run_no   text,
    trainer         text,
    trainer_email   text,
    qr_attendance   text,
    zoom_id         text,
    meeting_id      text,
    name            text,
    contact_no      text,
    email           text,
    magento_order_no text,
    virtual_reschedule text,
    comments        text,
    entry_date      text,
    "grant"         text,
    invoice_no      text,
    payment_mode    text,
    course_fee      text,
    nett_fee        text,
    payment_status  text,
    followup_by     text,
    remark          text,
    invoice_no_color   text,
    payment_mode_color text,
    schedule_entries jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at      timestamp with time zone DEFAULT now() NOT NULL,
    updated_at      timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_masterlist_class_id   ON public.masterlist_table(class_id);
  CREATE INDEX IF NOT EXISTS idx_masterlist_class_type ON public.masterlist_table(class_type);
  CREATE INDEX IF NOT EXISTS idx_masterlist_list_date  ON public.masterlist_table(list_date);
`;

// Run each ALTER separately — node-postgres can silently drop statements after
// the first when multiple are batched into one pool.query() call.
const MIGRATE_COLUMNS = [
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS qr_attendance   text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS zoom_id         text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS meeting_id      text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS schedule_entries jsonb DEFAULT '[]'::jsonb`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS course_run_no   text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS class_date      text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS venue           text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS notes           text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS cancelled       boolean DEFAULT false`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS calendar_event_id text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS invoice_no_color   text`,
  `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS payment_mode_color text`,
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await pool.query(ENSURE_TABLE);
    for (const sql of MIGRATE_COLUMNS) await pool.query(sql);
  } catch (e) {
    console.error('[masterlist] table ensure error:', e);
  }

  // ── GET — fetch all rows for a date + class_type ──────────────────────────
  if (req.method === 'GET') {
    const { date, class_type } = req.query;
    if (!date || !class_type) {
      return res.status(400).json({ success: false, error: 'date and class_type are required' });
    }

    try {
      const result = await pool.query(
        `SELECT * FROM public.masterlist_table
         WHERE list_date = $1 AND class_type = $2
         ORDER BY class_id, created_at`,
        [date, class_type],
      );
      return res.status(200).json({ success: true, data: result.rows });
    } catch (e) {
      console.error('[masterlist] GET error:', e);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  // ── POST — upsert rows for a class block ──────────────────────────────────
  // Body: { rows: MasterlistRow[] }
  // Each row must include class_id, class_type, list_date.
  // Existing rows with the same class_id are deleted and replaced (full replace per class).
  if (req.method === 'POST') {
    const { rows } = req.body as { rows: Record<string, any>[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'rows array is required' });
    }

    const classId = rows[0].class_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing rows for this class_id
      await client.query(
        'DELETE FROM public.masterlist_table WHERE class_id = $1',
        [classId],
      );

      // Insert all rows
      for (const row of rows) {
        await client.query(
          `INSERT INTO public.masterlist_table
            (class_id, class_type, list_date, course_title, course_run_no, trainer, trainer_email,
             qr_attendance, zoom_id, meeting_id,
             name, contact_no, email, magento_order_no, virtual_reschedule, comments,
             entry_date, "grant", invoice_no, payment_mode, course_fee, nett_fee,
             payment_status, followup_by, remark, schedule_entries, class_date, venue, notes, cancelled,
             calendar_event_id, invoice_no_color, payment_mode_color)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
           ON CONFLICT (calendar_event_id) WHERE calendar_event_id IS NOT NULL
           DO UPDATE SET
             class_id = EXCLUDED.class_id,
             class_type = EXCLUDED.class_type,
             list_date = EXCLUDED.list_date,
             course_title = EXCLUDED.course_title,
             course_run_no = EXCLUDED.course_run_no,
             trainer = EXCLUDED.trainer,
             trainer_email = EXCLUDED.trainer_email,
             qr_attendance = EXCLUDED.qr_attendance,
             zoom_id = EXCLUDED.zoom_id,
             meeting_id = EXCLUDED.meeting_id,
             name = EXCLUDED.name,
             contact_no = EXCLUDED.contact_no,
             email = EXCLUDED.email,
             magento_order_no = EXCLUDED.magento_order_no,
             virtual_reschedule = EXCLUDED.virtual_reschedule,
             comments = EXCLUDED.comments,
             entry_date = EXCLUDED.entry_date,
             "grant" = EXCLUDED."grant",
             invoice_no = EXCLUDED.invoice_no,
             payment_mode = EXCLUDED.payment_mode,
             course_fee = EXCLUDED.course_fee,
             nett_fee = EXCLUDED.nett_fee,
             payment_status = EXCLUDED.payment_status,
             followup_by = EXCLUDED.followup_by,
             remark = EXCLUDED.remark,
             schedule_entries = EXCLUDED.schedule_entries,
             class_date = EXCLUDED.class_date,
             venue = EXCLUDED.venue,
             notes = EXCLUDED.notes,
             cancelled = EXCLUDED.cancelled,
             invoice_no_color = EXCLUDED.invoice_no_color,
             payment_mode_color = EXCLUDED.payment_mode_color,
             updated_at = now()`,
          [
            row.class_id, row.class_type, row.list_date || null,
            row.course_title || null, row.course_run_no || null,
            row.trainer || null, row.trainer_email || null,
            row.qr_attendance || null, row.zoom_id || null, row.meeting_id || null,
            row.name || null, row.contact_no || null, row.email || null,
            row.magento_order_no || null, row.virtual_reschedule || null, row.comments || null,
            row.entry_date || null, row.grant || null, row.invoice_no || null,
            row.payment_mode || null, row.course_fee || null, row.nett_fee || null,
            row.payment_status || null, row.followup_by || null, row.remark || null,
            row.schedule_entries ?? '[]',
            row.class_date || null, row.venue || null, row.notes || null,
            row.cancelled ?? false,
            row.calendar_event_id || null,
            row.invoice_no_color || null,
            row.payment_mode_color || null,
          ],
        );
      }

      await client.query('COMMIT');
      return res.status(200).json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[masterlist] POST error:', e);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
      client.release();
    }
  }

  // ── DELETE — remove an entire class block ─────────────────────────────────
  if (req.method === 'DELETE') {
    const { class_id } = req.query;
    if (!class_id) {
      return res.status(400).json({ success: false, error: 'class_id is required' });
    }

    try {
      await pool.query(
        'DELETE FROM public.masterlist_table WHERE class_id = $1',
        [class_id],
      );
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error('[masterlist] DELETE error:', e);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
