import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * API endpoint to update enrolment_status for DA applications.
 *
 * POST /api/admin/update-da-enrolment-status
 * Body: { updates: [{ application_id: string, enrolment_status: string }] }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { updates } = req.body;

        if (!updates || !Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request body. Expected { updates: [{ application_id, enrolment_status }] }'
            });
        }

        console.log(`📝 Updating enrolment_status for ${updates.length} application(s)...`);

        let successCount = 0;
        const errors: { application_id: string; error: string }[] = [];

        for (const update of updates) {
            if (!update.application_id || !update.enrolment_status) {
                errors.push({ application_id: update.application_id || 'unknown', error: 'Missing application_id or enrolment_status' });
                continue;
            }

            try {
                await pool.query(
                    `UPDATE da_application SET enrolment_status = $1, updated_at = NOW() WHERE application_id = $2`,
                    [update.enrolment_status, update.application_id]
                );
                successCount++;
            } catch (dbError) {
                console.error(`❌ Failed to update ${update.application_id}:`, dbError);
                errors.push({
                    application_id: update.application_id,
                    error: dbError instanceof Error ? dbError.message : 'DB update failed'
                });
            }
        }

        console.log(`✅ Updated ${successCount}/${updates.length} enrolment statuses`);

        return res.status(200).json({
            success: true,
            updated: successCount,
            errors
        });

    } catch (error) {
        console.error('❌ Error updating enrolment status:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
