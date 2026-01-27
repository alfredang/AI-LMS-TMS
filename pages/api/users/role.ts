import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

interface UserRoleResponse {
  success: boolean;
  data?: {
    userId: string;
    role: string;
    roles: string[]; // All roles the user has
  };
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<UserRoleResponse>) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId } = req.query;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ 
      success: false, 
      error: 'User ID is required' 
    });
  }

  try {
    console.log(`🔍 UserRole API: Fetching roles for userId: ${userId}`);

    // Get ALL user roles from user_role_map table
    const roleQuery = `
      SELECT user_id, role
      FROM public.user_role_map
      WHERE user_id = $1
      ORDER BY
        CASE role
          WHEN 'Admin' THEN 1
          WHEN 'Training Provider' THEN 2
          WHEN 'Developer' THEN 3
          WHEN 'Trainer' THEN 4
          WHEN 'Learner' THEN 5
          ELSE 6
        END
    `;

    const roleResult = await pool.query(roleQuery, [userId]);

    if (roleResult.rows.length === 0) {
      console.log(`❌ UserRole API: No roles found for userId: ${userId}`);
      return res.status(404).json({
        success: false,
        error: 'User role not found'
      });
    }

    // Convert database roles to lowercase for consistency
    const roles: string[] = roleResult.rows.map((row: { role: string }) => {
      const dbRole = row.role;
      // Convert "Training Provider" to "trainingProvider" for frontend compatibility
      if (dbRole === 'Training Provider') return 'trainingProvider';
      return dbRole.toLowerCase();
    });

    // Primary role is the first one (highest priority based on ORDER BY)
    const primaryRole = roles[0];

    console.log(`✅ UserRole API: Found roles for userId: ${userId}, roles: ${roles.join(', ')}`);

    return res.status(200).json({
      success: true,
      data: {
        userId: userId,
        role: primaryRole,
        roles: roles
      }
    });

  } catch (error) {
    console.error('❌ UserRole API: Error fetching user role:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: `Failed to fetch user role: ${errorMessage}`
    });
  }
}

export default handler;
