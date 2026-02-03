import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * API endpoint to fetch all DA Application data from the database.
 * 
 * GET /api/admin/fetch-all-da-applications
 * - Returns all DA application records
 * - Supports optional filtering by query parameters
 * 
 * Response: { success: true, data: [...records...], count: number }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        console.log('📊 Fetching all DA applications from database...');

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
                da.created_at,
                da.updated_at
            FROM da_application da
            LEFT JOIN course_run cr ON da.course_run_id = cr.course_run_id
            ORDER BY da.created_at DESC
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
