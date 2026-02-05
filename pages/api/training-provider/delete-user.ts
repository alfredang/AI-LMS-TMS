import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { userId } = req.body;

    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ success: false, message: 'userId is required' });
    }

    const client = await pool.connect();

    try {
        // Verify user exists and is currently active
        const userResult = await client.query(
            'SELECT id, full_name, email, account_status FROM app_user WHERE id = $1',
            [userId]
        );
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (userResult.rows[0].account_status === 'disabled') {
            return res.status(400).json({ success: false, message: 'User is already disabled' });
        }

        // Soft delete: set account_status to 'disabled'
        await client.query(
            'UPDATE app_user SET account_status = $1, updated_at = NOW() WHERE id = $2',
            ['disabled', userId]
        );

        // Clean up training provider membership when disabling user
        // This prevents disabled users from still being linked to training providers
        const deletedMemberships = await client.query(
            'DELETE FROM training_provider_member WHERE user_id = $1 RETURNING provider_id',
            [userId]
        );

        if (deletedMemberships.rows.length > 0) {
            console.log(`🗑️ Removed user ${userId} from ${deletedMemberships.rows.length} training provider organization(s)`);

            // Check if this was the last member of any training provider organization
            // If so, delete the training provider record to free up the UEN
            for (const membership of deletedMemberships.rows) {
                const providerId = membership.provider_id;

                // Count remaining members for this provider
                const remainingMembers = await client.query(
                    'SELECT COUNT(*) as count FROM training_provider_member WHERE provider_id = $1',
                    [providerId]
                );

                const memberCount = parseInt(remainingMembers.rows[0].count);

                if (memberCount === 0) {
                    // This was the last member - delete the training provider organization
                    // This will cascade delete related records (training_provider_api, etc.)
                    const providerInfo = await client.query(
                        'SELECT company_name, uen FROM training_provider WHERE id = $1',
                        [providerId]
                    );

                    if (providerInfo.rows.length > 0) {
                        const { company_name, uen } = providerInfo.rows[0];

                        await client.query(
                            'DELETE FROM training_provider WHERE id = $1',
                            [providerId]
                        );

                        console.log(`🏢 Deleted training provider organization: ${company_name} (UEN: ${uen})`);
                        console.log(`✅ UEN ${uen} is now available for reuse`);
                    }
                }
            }
        }

        // Also remove from legacy provider_admin_user if exists
        const deletedAdminLinks = await client.query(
            'DELETE FROM provider_admin_user WHERE user_id = $1 RETURNING provider_id',
            [userId]
        );

        if (deletedAdminLinks.rows.length > 0) {
            console.log(`🗑️ Removed user ${userId} from ${deletedAdminLinks.rows.length} legacy provider admin link(s)`);
        }

        return res.status(200).json({
            success: true,
            message: 'User deleted successfully',
        });

    } catch (error) {
        console.error('Error deleting user:', error);

        return res.status(500).json({
            success: false,
            message: 'Failed to delete user',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    } finally {
        client.release();
    }
}
