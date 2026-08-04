import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * GET /api/admin/invoice-lookup?email=...&name=...&date=YYYY-MM-DD
 *
 * Finds the invoice number for a learner on a specific class date.
 * Matches by learner email (primary) or name, and filters by course run
 * date range that contains the given date.
 *
 * Falls back to most recent invoice if no date-specific match found.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { email, name, date } = req.query;

  if (!email && !name) {
    return res.status(400).json({ success: false, message: 'email or name is required' });
  }

  try {
    const emailVal = typeof email === 'string' ? email.trim() : '';
    const nameVal  = typeof name  === 'string' ? name.trim()  : '';
    const dateVal  = typeof date  === 'string' ? date.trim()  : '';

    // 1. Try date-specific match: invoice for an enrollment whose course run
    //    falls on (or spans) the given date.
    if (emailVal && dateVal) {
      const dateSpecific = await pool.query(
        `SELECT ij.invoice_no
         FROM public.invoice_jobs ij
         JOIN enrollment e
           ON LOWER(TRIM(COALESCE(e.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(ij.enrolment_id, '')))
         JOIN course_run cr ON cr.id = e.course_run_id
         WHERE LOWER(ij.learner_email) = LOWER($1)
           AND ij.status = 'done'
           AND ij.invoice_no IS NOT NULL
           AND ij.invoice_no <> ''
           AND $2::date BETWEEN cr.start_date AND cr.end_date
         ORDER BY ij.updated_at DESC NULLS LAST
         LIMIT 1`,
        [emailVal, dateVal],
      );

      if (dateSpecific.rows.length > 0) {
        return res.status(200).json({ success: true, invoice_no: dateSpecific.rows[0].invoice_no, matched: 'date' });
      }
    }

    // 2. Fallback: most recent invoice by email
    if (emailVal) {
      const byEmail = await pool.query(
        `SELECT ij.invoice_no
         FROM public.invoice_jobs ij
         WHERE LOWER(ij.learner_email) = LOWER($1)
           AND ij.status = 'done'
           AND ij.invoice_no IS NOT NULL
           AND ij.invoice_no <> ''
         ORDER BY ij.updated_at DESC NULLS LAST
         LIMIT 1`,
        [emailVal],
      );

      if (byEmail.rows.length > 0) {
        return res.status(200).json({ success: true, invoice_no: byEmail.rows[0].invoice_no, matched: 'email' });
      }
    }

    // 3. Fallback: match by name via app_user → invoice_jobs
    if (nameVal) {
      const byName = await pool.query(
        `SELECT ij.invoice_no
         FROM public.invoice_jobs ij
         JOIN app_user u ON u.id = ij.user_id
         WHERE LOWER(u.full_name) = LOWER($1)
           AND ij.status = 'done'
           AND ij.invoice_no IS NOT NULL
           AND ij.invoice_no <> ''
         ORDER BY ij.updated_at DESC NULLS LAST
         LIMIT 1`,
        [nameVal],
      );

      if (byName.rows.length > 0) {
        return res.status(200).json({ success: true, invoice_no: byName.rows[0].invoice_no, matched: 'name' });
      }
    }

    return res.status(200).json({ success: true, invoice_no: null });
  } catch (err) {
    console.error('[invoice-lookup] error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
