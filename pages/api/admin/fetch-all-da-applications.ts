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
                ct.course_type::text AS course_type,
                ct.current_code AS course_current_code,
                ct.previous_code AS course_previous_code,
                rn.renewed_on AS course_renewed_on,
                rn.renewed_on_exact AS course_renewed_on_exact,
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
            -- WSQ / CASL / IBF for the Type column, resolved in two steps.
            --
            -- Step one is the course the run belongs to: a primary-key lookup,
            -- and it answers 2,903 of 3,367 rows.
            LEFT JOIN course run_course ON run_course.id = cr.course_id
            -- Step two only runs for the ~464 rows the first step missed, and
            -- matches the SSG reference against the course codes instead. A
            -- renewed course carries its new TGS code in new_course_code while
            -- older rows still cite the old one, so both are checked.
            --
            -- The stored columns are compared DIRECTLY rather than wrapped in
            -- UPPER/TRIM, which is what keeps the unique index on course_code
            -- usable — every stored code is already uppercase and trimmed
            -- (verified: 0 of 312 differ from their normalised form). Wrapping
            -- them cost a full scan of the course table for every application
            -- row and added ~2.4s to this endpoint.
            LEFT JOIN LATERAL (
                SELECT c.id, c.course_type, c.course_code, c.new_course_code
                  FROM course c
                 WHERE run_course.id IS NULL
                   AND (
                        c.course_code = UPPER(TRIM(COALESCE(da.course_reference_number, '')))
                     OR c.new_course_code = UPPER(TRIM(COALESCE(da.course_reference_number, '')))
                   )
                 LIMIT 1
            ) code_course ON TRUE
            -- Whichever step matched, reduced to the two references the screen
            -- needs. LIMIT 1 above means neither step can duplicate a row.
            LEFT JOIN LATERAL (
                SELECT COALESCE(run_course.id, code_course.id) AS course_id,
                       COALESCE(run_course.course_type, code_course.course_type) AS course_type,
                       COALESCE(run_course.course_code, code_course.course_code) AS base_code,
                       COALESCE(run_course.new_course_code, code_course.new_course_code) AS renewed_code
            ) m ON TRUE
            LEFT JOIN LATERAL (
                SELECT m.course_id,
                       m.course_type,
                       -- The reference this course is registered under TODAY.
                       COALESCE(NULLIF(TRIM(m.renewed_code), ''), m.base_code) AS current_code,
                       -- The reference it held BEFORE the renewal, or null when
                       -- it has never been renewed. Both are returned so the
                       -- screen can show a renewal even for a learner who
                       -- enrolled after it and was never on the old code.
                       CASE WHEN NULLIF(TRIM(m.renewed_code), '') IS NOT NULL
                                 AND TRIM(COALESCE(m.renewed_code, '')) <> TRIM(COALESCE(m.base_code, ''))
                            THEN m.base_code END AS previous_code
            ) ct ON TRUE
            -- When the course stopped being WSQ-funded — the date that decides whether
            -- an invoice raised then SHOULD have said WSQ or CASL.
            --
            -- Two sources, in order of trust:
            --   1. the funding validity that was replaced at renewal (an exact date,
            --            logged as the old value of the fundingValidity change)
            --   2. failing that, when the new TGS code was first recorded — a proxy,
            --            flagged as approximate so nobody reads it as fact
            LEFT JOIN LATERAL (
                SELECT
                        COALESCE(
                          (SELECT l.old_value
                             FROM course_change_log l
                            WHERE l.course_id = ct.course_id
                                    AND l.field = 'fundingValidity'
                                    AND l.old_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                            ORDER BY l.changed_at DESC
                            LIMIT 1),
                          (SELECT MIN(l.changed_at)::date::text
                             FROM course_change_log l
                            WHERE l.course_id = ct.course_id
                                    AND l.field = 'newCourseCode')
                        ) AS renewed_on,
                        EXISTS (SELECT 1 FROM course_change_log l
                                       WHERE l.course_id = ct.course_id
                                         AND l.field = 'fundingValidity'
                                         AND l.old_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AS renewed_on_exact
            ) rn ON TRUE
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
            WHERE
                -- Direct Applications come only from TPG Gateway / MySkillsFuture.
                -- Rows keyed 'MANUAL-<enrolment id>' are minted by
                -- lib/services/daApplicationFromEnrolment.ts for learners enrolled
                -- through TPG Management -> Enrol Learners, who have no application
                -- at all. They live in da_application because the DA pipeline is
                -- what drives calendar sync and invoicing — not because they are
                -- Direct Applications. This view must never list them.
                -- COALESCE, not a bare NOT LIKE: a NULL application_id would make
                -- the comparison NULL and silently drop a legitimate row.
                UPPER(COALESCE(da.application_id, '')) NOT LIKE 'MANUAL-%'
              AND (
                    COALESCE(cr.end_date, da.course_end_date) >= CURRENT_DATE - INTERVAL '30 days'
                 OR COALESCE(cr.end_date, da.course_end_date) IS NULL
              )
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
