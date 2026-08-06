import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureInvoiceJobsTable } from '../../../lib/services/invoiceJobs';

/**
 * API endpoint to fetch all DA Application data from the database.
 * 
 * GET /api/admin/fetch-all-da-applications
 * - Returns all DA application records
 * - Supports optional filtering by query parameters
 * 
 * Response: { success: true, data: [...records...], count: number }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        console.log('📊 Fetching all DA applications from database...');

        await ensureInvoiceJobsTable();

        // Query all DA applications with course_run dates, ordered by created_at descending
        const result = await pool.query(`
            SELECT
                da.id,
                da.trainee_id_type,
                da.trainee_id,
                da.date_of_birth::text as date_of_birth,
                da.trainee_name,
                da.course_run_id,
                da.trainee_email,
                da.trainee_phone_country_code,
                da.trainee_phone,
                da.sponsorship_type,
                da.application_id,
                da.application_date::text as application_date,
                da.application_cancelled_by,
                da.payable_fee,
                da.full_course_fee,
                da.gst,
                da.skillsfuture_subsidy,
                da.skillsfuture_credit,
                da.skillsfuture_credit_claim_id,
                da.application_status,
                da.course_title,
                da.course_reference_number,
                COALESCE(cr.start_date, da.course_start_date) as course_start_date,
                COALESCE(cr.end_date, da.course_end_date) as course_end_date,
                da.highest_qualification,
                da.highest_relevant_certification,
                da.enrolment_status,
                da.enrolment_id,
                da.grant_id,
                da.invoice_id,
                da.invoice_doc_number,
                da.qb_customer_ref,
                da.grant_amount,
                da.auto_enrol_status,
                da.auto_enrol_error,
                da.calendar_added,
                da.invoice_drive_file_id,
                da.invoice_drive_web_view_link,
                da.grant_invoice_id,
                da.grant_invoice_drive_file_id,
                da.grant_invoice_drive_web_view_link,
                da.sfc_invoice_id,
                da.sfc_invoice_drive_file_id,
                da.sfc_invoice_drive_web_view_link,
                ij.invoice_sent_at::text AS invoice_sent_at,
                ij.invoice_sent_to,
                da.created_at,
                da.updated_at,
                sg.bl_grant_id,
                sg.bl_amount,
                sg.other_grant_id,
                sg.other_scheme_code,
                sg.other_amount,
                sg.tg_amount
            FROM da_application da
            LEFT JOIN course_run cr ON da.course_run_id = cr.course_run_id
            LEFT JOIN LATERAL (
                SELECT ij.invoice_sent_at::text AS invoice_sent_at, ij.invoice_sent_to
                FROM public.invoice_jobs ij
                WHERE (
                        NULLIF(TRIM(da.invoice_id::text), '') IS NOT NULL
                    AND TRIM(COALESCE(ij.qbo_invoice_id::text, '')) = TRIM(da.invoice_id::text)
                    )
                   OR (
                        NULLIF(TRIM(da.enrolment_id::text), '') IS NOT NULL
                    AND LOWER(TRIM(COALESCE(ij.enrolment_id::text, ''))) = LOWER(TRIM(da.enrolment_id::text))
                    AND TRIM(COALESCE(ij.qbo_invoice_id::text, '')) = ''
                    )
                ORDER BY
                    CASE
                        WHEN NULLIF(TRIM(da.invoice_id::text), '') IS NOT NULL
                         AND TRIM(COALESCE(ij.qbo_invoice_id::text, '')) = TRIM(da.invoice_id::text)
                        THEN 0 ELSE 1
                    END,
                    ij.invoice_sent_at DESC NULLS LAST
                LIMIT 1
            ) ij ON true
            LEFT JOIN (
                SELECT
                    LOWER(TRIM(enrollment_id)) AS enrolment_key,
                    MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) IN ('BL','BASELINE')
                             OR  UPPER(COALESCE(funding_scheme_code,'')) LIKE '%BASELINE%'
                        THEN grant_id END) AS bl_grant_id,
                    MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) IN ('BL','BASELINE')
                             OR  UPPER(COALESCE(funding_scheme_code,'')) LIKE '%BASELINE%'
                        THEN CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                                  ELSE COALESCE(estimated_grant_amount,0) END END) AS bl_amount,
                    MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                             AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                             AND funding_scheme_code IS NOT NULL
                        THEN grant_id END) AS other_grant_id,
                    MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                             AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                             AND funding_scheme_code IS NOT NULL
                        THEN funding_scheme_code END) AS other_scheme_code,
                    MAX(CASE WHEN UPPER(COALESCE(funding_scheme_code,'')) NOT IN ('BL','BASELINE')
                             AND UPPER(COALESCE(funding_scheme_code,'')) NOT LIKE '%BASELINE%'
                             AND funding_scheme_code IS NOT NULL
                        THEN CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                                  ELSE COALESCE(estimated_grant_amount,0) END END) AS other_amount,
                    SUM(CASE WHEN COALESCE(approved_grant_amount,0) > 0 THEN approved_grant_amount
                             ELSE COALESCE(estimated_grant_amount,0) END) AS tg_amount
                FROM ssg_grants
                GROUP BY LOWER(TRIM(enrollment_id))
            ) sg ON sg.enrolment_key = LOWER(TRIM(da.enrolment_id))
            WHERE COALESCE(cr.end_date, da.course_end_date) >= CURRENT_DATE - INTERVAL '30 days'
               OR COALESCE(cr.end_date, da.course_end_date) IS NULL
            ORDER BY COALESCE(cr.start_date, da.course_start_date) ASC NULLS LAST
        `);

        console.log(`✅ Fetched ${result.rows.length} DA applications`);

        return res.status(200).json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('❌ Error fetching DA applications:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
