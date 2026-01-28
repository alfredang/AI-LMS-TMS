import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * API endpoint to fetch all DA Application data from the database.
 * This endpoint is designed to be called by n8n for filtering and merging operations.
 * 
 * GET /api/admin/fetch-all-da-applications
 * - Returns all DA application records
 * - Supports optional filtering by query parameters
 * 
 * Response: { success: true, data: [...records...], count: number }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Handle CORS
    if (cors(req, res)) {
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        console.log('📊 Fetching all DA applications from database...');

        // Query optional filters
        const {
            application_id,
            trainee_id,
            course_run_id,
            trainee_email,
            application_status,
            limit = 1000,
            offset = 0
        } = req.query;

        // Build the query
        let query = supabase
            .from('da_application')
            .select('*')
            .order('created_at', { ascending: false });

        // Apply optional filters
        if (application_id) {
            query = query.eq('application_id', application_id as string);
        }
        if (trainee_id) {
            query = query.eq('trainee_id', trainee_id as string);
        }
        if (course_run_id) {
            query = query.eq('course_run_id', course_run_id as string);
        }
        if (trainee_email) {
            query = query.eq('trainee_email', trainee_email as string);
        }
        if (application_status) {
            query = query.eq('application_status', application_status as string);
        }

        // Apply pagination
        const limitNum = parseInt(limit as string, 10) || 1000;
        const offsetNum = parseInt(offset as string, 10) || 0;
        query = query.range(offsetNum, offsetNum + limitNum - 1);

        const { data, error, count } = await query;

        if (error) {
            console.error('❌ Error fetching DA applications:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch DA applications',
                details: error.message
            });
        }

        console.log(`✅ Fetched ${data?.length || 0} DA applications`);

        return res.status(200).json({
            success: true,
            data: data || [],
            count: data?.length || 0,
            pagination: {
                limit: limitNum,
                offset: offsetNum
            }
        });

    } catch (error) {
        console.error('❌ Error in fetch-all-da-applications:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

export default handler;
