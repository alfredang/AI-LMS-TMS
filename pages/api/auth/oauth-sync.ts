import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import pool from '../../../lib/db';
import { isServiceRequest } from '../../../lib/auth/serviceKey';

interface OAuthSyncRequest {
    supabaseUserId: string;
    email: string;
    fullName?: string;
    profilePictureUrl?: string;
    provider: 'google';
}

interface OAuthSyncResponse {
    success: boolean;
    data?: {
        userId: string;
        email: string;
        fullName: string;
        profilePictureUrl?: string;
        role: string;
        roles: string[];
    };
    error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<OAuthSyncResponse>) {
    // Handle CORS
    if (cors(req, res)) {
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // This endpoint upserts user records from a caller-supplied email, so it
    // must not be internet-callable. No repo client uses it today; machine
    // callers must present the service API key.
    if (!isServiceRequest(req)) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { supabaseUserId, email, fullName, profilePictureUrl, provider }: OAuthSyncRequest = req.body;

    if (!supabaseUserId || !email || !provider) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: supabaseUserId, email, and provider'
        });
    }

    try {
        console.log(`🔐 OAuth sync for email: ${email}, provider: ${provider}`);

        // Check if DATABASE_URL is configured
        if (!process.env.DATABASE_URL) {
            console.error('❌ DATABASE_URL environment variable is not set');
            return res.status(500).json({
                success: false,
                error: 'Database configuration error. Please check environment variables.'
            });
        }

        // Start a transaction
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Check if user exists by supabase_user_id or email
            const userQuery = `
        SELECT id, email, full_name, profile_picture_url
        FROM public.app_user
        WHERE supabase_user_id = $1 OR LOWER(email) = LOWER($2)
        LIMIT 1
      `;

            const userResult = await client.query(userQuery, [supabaseUserId, email]);

            let userId: string;
            let userFullName: string;
            let userProfilePictureUrl: string | null;

            if (userResult.rows.length > 0) {
                // User exists - update their OAuth info if needed
                const existingUser = userResult.rows[0];
                userId = existingUser.id;

                console.log(`✅ Existing user found: ${existingUser.email}`);

                // Update supabase_user_id and auth_provider if not already set
                const updateQuery = `
          UPDATE public.app_user
          SET 
            supabase_user_id = COALESCE(supabase_user_id, $1),
            auth_provider = COALESCE(auth_provider, $2),
            profile_picture_url = COALESCE($3, profile_picture_url),
            full_name = COALESCE($4, full_name),
            updated_at = NOW()
          WHERE id = $5
          RETURNING full_name, profile_picture_url
        `;

                const updateResult = await client.query(updateQuery, [
                    supabaseUserId,
                    provider,
                    profilePictureUrl,
                    fullName,
                    userId
                ]);

                userFullName = updateResult.rows[0].full_name;
                userProfilePictureUrl = updateResult.rows[0].profile_picture_url;
            } else {
                // New user - create account
                console.log(`🆕 Creating new OAuth user: ${email}`);

                const insertQuery = `
          INSERT INTO public.app_user (
            email,
            full_name,
            profile_picture_url,
            supabase_user_id,
            auth_provider,
            password,
            password_hash
          )
          VALUES ($1, $2, $3, $4, $5, NULL, NULL)
          RETURNING id, full_name, profile_picture_url
        `;

                const insertResult = await client.query(insertQuery, [
                    email,
                    fullName || email.split('@')[0],
                    profilePictureUrl,
                    supabaseUserId,
                    provider
                ]);

                userId = insertResult.rows[0].id;
                userFullName = insertResult.rows[0].full_name;
                userProfilePictureUrl = insertResult.rows[0].profile_picture_url;

                // Assign default "Learner" role to new OAuth users
                const roleQuery = `
          INSERT INTO public.user_role_map (user_id, role)
          VALUES ($1, 'Learner')
          ON CONFLICT (user_id, role) DO NOTHING
        `;

                await client.query(roleQuery, [userId]);
                console.log(`✅ Assigned Learner role to new user: ${email}`);
            }

            // Get all user roles
            const rolesQuery = `
        SELECT role FROM public.user_role_map
        WHERE user_id = $1
        ORDER BY
          CASE role
            WHEN 'Learner' THEN 1
            WHEN 'Trainer' THEN 2
            WHEN 'Developer' THEN 3
            WHEN 'Admin' THEN 4
            WHEN 'Training Provider' THEN 5
            ELSE 6
          END
      `;

            const rolesResult = await client.query(rolesQuery, [userId]);

            // Convert database roles to frontend format
            const userRoles: string[] = rolesResult.rows.map((row: { role: string }) => {
                const dbRole = row.role;
                if (dbRole === 'Training Provider') return 'trainingProvider';
                return dbRole.toLowerCase();
            });

            // If no roles found, default to learner
            if (userRoles.length === 0) {
                userRoles.push('learner');
            }

            const primaryRole = userRoles[0];

            await client.query('COMMIT');

            console.log(`✅ OAuth sync successful for user: ${email}, roles: ${userRoles.join(', ')}`);

            return res.status(200).json({
                success: true,
                data: {
                    userId,
                    email,
                    fullName: userFullName,
                    profilePictureUrl: userProfilePictureUrl || undefined,
                    role: primaryRole,
                    roles: userRoles
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error: any) {
        console.error('❌ OAuth sync error:', error);

        // Check for specific database errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return res.status(500).json({
                success: false,
                error: 'Unable to connect to database. Please try again later.'
            });
        }

        if (error.code === '23505') { // Unique violation
            return res.status(409).json({
                success: false,
                error: 'User with this email or Supabase ID already exists'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Internal server error during OAuth sync'
        });
    }
}

export default handler;
