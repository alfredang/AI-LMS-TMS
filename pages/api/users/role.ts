import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { cors } from '../../../lib/cors';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiarydb',
  password: process.env.DB_PASSWORD || 'shuo1314520.',
  port: parseInt(process.env.DB_PORT || '5432'),
});

interface UserRoleResponse {
  success: boolean;
  data?: {
    userId: string;
    role: string;
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
    console.log(`🔍 UserRole API: Fetching role for userId: ${userId}`);

    // Get user role from user_role_map table
    const roleQuery = `
      SELECT user_id, role 
      FROM public.user_role_map
      WHERE user_id = $1
    `;
    
    const roleResult = await pool.query(roleQuery, [userId]);
    
    if (roleResult.rows.length === 0) {
      console.log(`❌ UserRole API: No role found for userId: ${userId}`);
      return res.status(404).json({ 
        success: false, 
        error: 'User role not found' 
      });
    }

    const userRole = roleResult.rows[0];
    console.log(`✅ UserRole API: Found role for userId: ${userId}, role: ${userRole.role}`);

    return res.status(200).json({
      success: true,
      data: {
        userId: userRole.user_id,
        role: userRole.role
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
