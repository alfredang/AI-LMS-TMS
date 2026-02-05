import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * API endpoint to check if a user is the last member of their training provider organization
 * GET /api/training-provider/check-last-member?userId=<uuid>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ success: false, message: 'userId is required' });
    }

    try {
        // Find the user's training provider organization
        const membershipResult = await pool.query(
            'SELECT provider_id FROM training_provider_member WHERE user_id = $1',
            [userId]
        );

        if (membershipResult.rows.length === 0) {
            // User is not a member of any training provider organization
            return res.status(200).json({
                success: true,
                isLastMember: false,
                companyName: null,
                uen: null
            });
        }

        const providerId = membershipResult.rows[0].provider_id;

        // Count total members in this organization
        const memberCountResult = await pool.query(
            'SELECT COUNT(*) as count FROM training_provider_member WHERE provider_id = $1',
            [providerId]
        );

        const memberCount = parseInt(memberCountResult.rows[0].count);

        // Get organization details
        const providerResult = await pool.query(
            'SELECT company_name, uen FROM training_provider WHERE id = $1',
            [providerId]
        );

        const isLastMember = memberCount === 1;
        const companyName = providerResult.rows[0]?.company_name || null;
        const uen = providerResult.rows[0]?.uen || null;

        return res.status(200).json({
            success: true,
            isLastMember,
            companyName,
            uen
        });

    } catch (error) {
        console.error('Error checking last member status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to check last member status',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
