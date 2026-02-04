import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { email, full_name, telephone, roles, password } = req.body;

    // Basic validation
    if (!email || !full_name || !telephone || !roles || roles.length === 0 || !password) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: email, full_name, telephone, roles, password'
        });
    }

    const client = await pool.connect();

    try {
        // Check if user already exists
        const checkUserQuery = 'SELECT id, account_status FROM app_user WHERE email = $1';
        const checkUserResult = await client.query(checkUserQuery, [email]);

        // If user exists and is active, reject
        if (checkUserResult.rows.length > 0 && checkUserResult.rows[0].account_status !== 'disabled') {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Start transaction
        await client.query('BEGIN');

        let newUserId: string;

        // If user exists but is disabled, reactivate them
        if (checkUserResult.rows.length > 0 && checkUserResult.rows[0].account_status === 'disabled') {
            newUserId = checkUserResult.rows[0].id;

            // Update existing user
            await client.query(
                `UPDATE app_user 
                 SET full_name = $1, password = $2, password_hash = $3, account_status = 'active', updated_at = NOW() 
                 WHERE id = $4`,
                [full_name, password, hashedPassword, newUserId]
            );

            // Update learner_profile telephone
            await client.query(
                `UPDATE learner_profile SET tel = $1 WHERE user_id = $2`,
                [telephone, newUserId]
            );

            // Delete existing roles
            await client.query('DELETE FROM user_role_map WHERE user_id = $1', [newUserId]);

            // Insert new roles
            const insertRoleQuery = `INSERT INTO user_role_map (user_id, role) VALUES ($1, $2)`;
            for (const role of roles) {
                await client.query(insertRoleQuery, [newUserId, role]);
            }

        } else {
            // Create new user
            const insertUserQuery = `
                INSERT INTO app_user (email, full_name, password, password_hash, created_at, updated_at)
                VALUES ($1, $2, $3, $4, NOW(), NOW())
                RETURNING id
            `;
            const insertUserResult = await client.query(insertUserQuery, [
                email,
                full_name,
                password,
                hashedPassword
            ]);
            newUserId = insertUserResult.rows[0].id;

            // Insert into learner_profile
            const insertProfileQuery = `INSERT INTO learner_profile (user_id, tel) VALUES ($1, $2)`;
            await client.query(insertProfileQuery, [newUserId, telephone]);

            // Insert roles
            const insertRoleQuery = `INSERT INTO user_role_map (user_id, role) VALUES ($1, $2)`;
            for (const role of roles) {
                await client.query(insertRoleQuery, [newUserId, role]);
            }
        }

        // Commit transaction
        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'User added successfully',
            data: {
                id: newUserId,
                email,
                full_name,
                telephone,
                roles,
                created_at: new Date().toISOString()
            }
        });

    } catch (error) {
        // Rollback transaction on error
        await client.query('ROLLBACK');
        console.error('Error adding user:', error);

        return res.status(500).json({
            success: false,
            message: 'Failed to add user',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    } finally {
        // Release client back to pool
        client.release();
    }
}
