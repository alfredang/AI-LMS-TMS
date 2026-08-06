import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { syncLearnerFromSSG, upsertSsgEnrolmentFromLocalEnrollment } from '../../../lib/services/billingSync';
import { ensureInvoiceJobsTable } from '../../../lib/services/invoiceJobs';
import { BILLING_CANON_ENR_SQL, BILLING_ENR_NORM_SQL } from '../../../lib/billing/canonicalEnrolmentRef';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId } = req.query;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing required parameter: userId' });
  }

  try {
    // Sync fresh SSG data for this learner before querying (never throws)
    await syncLearnerFromSSG(userId);

    await ensureInvoiceJobsTable();

    // Backfill ssg_enrolments for completed invoice jobs so consolidated finance can join; trim enrolment_id for matching.
    const backfill = await pool.query(
      `SELECT ij.enrolment_id::text AS enrolment_id
       FROM public.invoice_jobs ij
       INNER JOIN enrollment e
         ON TRIM(COALESCE(ij.enrolment_id, '')) = TRIM(COALESCE(e.enrolment_id, ''))
       WHERE e.user_id = $1
         AND ij.status = 'done'
         AND NOT EXISTS (
           SELECT 1 FROM ssg_enrolments se
           WHERE TRIM(COALESCE(se.enrolment_id, '')) = TRIM(COALESCE(ij.enrolment_id, ''))
         )`,
      [userId]
    );
    for (const row of backfill.rows) {
      try {
        if (row.enrolment_id) await upsertSsgEnrolmentFromLocalEnrollment(row.enrolment_id);
      } catch (e) {
        console.warn('[billing/history] ssg backfill:', e);
      }
    }

    // Pull from local enrollment table — now fresh after sync
    const enrolmentResult = await pool.query(
      `SELECT
        e.id,
        ${BILLING_CANON_ENR_SQL} AS enrolment_id,
        NULLIF(TRIM(e.enrolment_id::text), '') AS enrolment_id_db,
        u.full_name,
        c.title AS course_title,
        cr.course_run_id,
        c.course_code,
        e.enrolment_status,
        e.enrolment_date,
        e.payment_status,
        cr.start_date::text,
        cr.end_date::text,
        c.course_fees_exclude_gst,
        c.course_fees_include_gst,
        c.after_normal_funding,
        c.after_mces_funding,
        c.is_wsq_funded,
        c.is_mces_eligible,
        lp.pro_forma_url,
        ij.qbo_invoice_id,
        ij.invoice_no,
        ij.qbo_doc_number,
        ij.drive_file_id,
        ij.drive_web_view_link
      FROM enrollment e
      JOIN app_user u ON u.id = e.user_id
      LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c ON c.id = e.course_id
      LEFT JOIN LATERAL (
        SELECT inv.qbo_invoice_id, inv.invoice_no, inv.qbo_doc_number, inv.drive_file_id, inv.drive_web_view_link
        FROM public.invoice_jobs inv
        WHERE inv.status = 'done'
          AND inv.user_id = e.user_id
          AND LOWER(TRIM(COALESCE(inv.enrolment_id, ''))) = ${BILLING_ENR_NORM_SQL}
        ORDER BY inv.updated_at DESC
        LIMIT 1
      ) ij ON true
      WHERE e.user_id = $1
      ORDER BY e.enrolment_date DESC NULLS LAST, cr.start_date DESC`,
      [userId]
    );

    // Fetch grants from local ssg_grants (now fresh after sync)
    const enrolmentIds = [
      ...new Set(
        enrolmentResult.rows.flatMap((r: { enrolment_id?: string | null; enrolment_id_db?: string | null }) => {
          const out: string[] = [];
          if (r.enrolment_id?.trim()) out.push(r.enrolment_id.trim());
          if (r.enrolment_id_db?.trim() && r.enrolment_id_db.trim() !== r.enrolment_id?.trim()) {
            out.push(r.enrolment_id_db.trim());
          }
          return out;
        })
      ),
    ];

    const grantsByEnrolment: Record<string, Array<{
      funding_scheme: string;
      estimated_amount: string;
      approved_amount: string;
      status: string;
    }>> = {};

    if (enrolmentIds.length > 0) {
      const grantResult = await pool.query(
        `SELECT
          enrollment_id,
          funding_scheme_description AS funding_scheme,
          estimated_grant_amount AS estimated_amount,
          approved_grant_amount AS approved_amount,
          status
        FROM ssg_grants
        WHERE enrollment_id = ANY($1)
        ORDER BY enrollment_id, funding_scheme_description`,
        [enrolmentIds]
      );

      for (const grant of grantResult.rows) {
        if (!grantsByEnrolment[grant.enrollment_id]) {
          grantsByEnrolment[grant.enrollment_id] = [];
        }
        grantsByEnrolment[grant.enrollment_id].push({
          funding_scheme: grant.funding_scheme,
          estimated_amount: grant.estimated_amount,
          approved_amount: grant.approved_amount,
          status: grant.status,
        });
      }
    }

    // Merge grants into enrolment records (ssg_grants may key on older ENR before SSG refresh)
    const data = enrolmentResult.rows.map((row: Record<string, unknown> & { enrolment_id?: string | null; enrolment_id_db?: string | null, pro_forma_url?: string | null, drive_web_view_link?: string | null }) => {
      const canon = row.enrolment_id?.trim() || '';
      const local = row.enrolment_id_db?.trim() || '';
      const g1 = canon ? grantsByEnrolment[canon] || [] : [];
      const g2 = local && local !== canon ? grantsByEnrolment[local] || [] : [];
      const merged = [...g1];
      for (const g of g2) {
        if (!merged.some(m => m.funding_scheme === g.funding_scheme && m.status === g.status)) merged.push(g);
      }
      // Always provide a non-empty enrolment_id if possible
      const enrolment_id_final = canon || local || null;
      // Prefer drive_web_view_link (from invoice_jobs), fallback to pro_forma_url (from learner_profile)
      const pro_forma_url_final = row.drive_web_view_link || row.pro_forma_url || null;
      const { enrolment_id_db: _drop, ...rest } = row;
      return { ...rest, enrolment_id: enrolment_id_final, pro_forma_url: pro_forma_url_final, grants: merged };
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[billing/history] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
