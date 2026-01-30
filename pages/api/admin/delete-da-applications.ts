import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * API endpoint to delete multiple DA Applications by their IDs.
 *
 * POST /api/admin/delete-da-applications
 * Body: { applicationIds: string[] }
 *
 * Permanently deletes the specified application rows.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { applicationIds } = req.body;

        if (!applicationIds || !Array.isArray(applicationIds) || applicationIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request body. Expected { applicationIds: [...] }'
            });
        }

        console.log(`🗑️ Deleting ${applicationIds.length} DA applications...`);

        const result = await pool.query(
            `DELETE FROM da_application
             WHERE application_id = ANY($1::text[])
             RETURNING application_id`,
            [applicationIds]
        );

        const deletedCount = result.rows.length;
        console.log(`✅ Deleted ${deletedCount} DA applications`);

        return res.status(200).json({
            success: true,
            deleted: deletedCount,
            deletedIds: result.rows.map(r => r.application_id)
        });

    } catch (error) {
        console.error('❌ Error deleting DA applications:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
