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
