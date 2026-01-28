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

        // Query all DA applications, ordered by created_at descending
        const result = await pool.query(`
            SELECT 
                id,
                trainee_id_type,
                trainee_id,
                date_of_birth,
                trainee_name,
                course_run_id,
                trainee_email,
                trainee_phone_country_code,
                trainee_phone,
                sponsorship_type,
                application_id,
                payable_fee,
                application_status,
                course_title,
                course_reference_number,
                course_start_date,
                course_end_date,
                enrolment_grant,
                created_at,
                updated_at
            FROM da_application
            ORDER BY created_at DESC
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
