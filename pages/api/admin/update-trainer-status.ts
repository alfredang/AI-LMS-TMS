import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'PUT') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { userId, newStatus } = req.body;

        if (!userId || !newStatus) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: userId and newStatus'
            });
        }

        // Validate status
        if (!['Active', 'Inactive'].includes(newStatus)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be either "Active" or "Inactive"'
            });
        }

        // Check if trainer exists
        const trainerCheckQuery = `
            SELECT tp.user_id, au.full_name, tp.status, au.email
            FROM trainer_profile tp
            JOIN app_user au ON tp.user_id = au.id
            WHERE tp.user_id = $1
        `;

        const trainerResult = await pool.query(trainerCheckQuery, [userId]);

        if (trainerResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Trainer not found'
            });
        }

        const trainer = trainerResult.rows[0];

        // Check if status is actually changing
        if (trainer.status === newStatus) {
            return res.status(400).json({
                success: false,
                message: `Trainer is already ${newStatus}`
            });
        }

        // Update trainer status
        const updateQuery = `
            UPDATE trainer_profile
            SET status = $1
            WHERE user_id = $2
            RETURNING 
                user_id,
                (SELECT full_name FROM app_user WHERE id = trainer_profile.user_id) AS full_name,
                status;
        `;

        const updateResult = await pool.query(updateQuery, [newStatus, userId]);

        if (updateResult.rows.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'Failed to update trainer status'
            });
        }

        const updatedTrainer = updateResult.rows[0];
        console.log("applelelele", updatedTrainer);

        console.log(`✅ Trainer status updated: ${trainer.full_name} (${trainer.email}) -> ${newStatus}`);

        return res.status(200).json({
            success: true,
            message: `Trainer ${newStatus.toLowerCase()} successfully`,
            data: {
                trainerId: updatedTrainer.trainer_id,
                fullName: updatedTrainer.full_name,
                oldStatus: trainer.status,
                newStatus: updatedTrainer.status,
                updatedAt: updatedTrainer.updated_at
            }
        });

    } catch (error) {
        console.error('❌ Trainer status update error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error during trainer status update'
        });
    }
}