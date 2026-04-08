import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface VerifyResponse {
  success: boolean;
  data?: {
    user: {
      id: string;
      email: string;
      fullName: string;
      profilePictureUrl?: string;
      role: string;
    };
  };
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerifyResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No valid authorization header'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    console.log('🔍 Auth Verify: Checking token validity...');

    // For now, we'll use a simple token validation
    // In a real application, you would validate JWT tokens or session tokens
    
    // Check if token exists in our sessions table (if you have one)
    // For this example, we'll extract user info from a simple token format
    // In production, use proper JWT validation
    
    let userId: string;
    try {
      // Simple token format: base64 encoded user ID (for demo purposes)
      // In production, use proper JWT tokens
      if (token.startsWith('user_')) {
        userId = token.replace('user_', '');
      } else {
        // Try to decode as base64
        userId = Buffer.from(token, 'base64').toString('utf-8');
      }
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token format'
      });
    }

    // Fetch user data from database
    console.log('🔍 Auth Verify: Fetching user data for ID:', userId);
    
    const userQuery = `
      SELECT
        au.id,
        au.email,
        au.full_name,
        au.profile_picture_url,
        au.account_status,
        urm.role
      FROM app_user au
      LEFT JOIN user_role_map urm ON au.id = urm.user_id
      WHERE au.id = $1
    `;

    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      console.log('❌ Auth Verify: User not found for ID:', userId);
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Check if account is not active (disabled, inactive, suspended, etc.)
    if (user.account_status && user.account_status.toLowerCase() !== 'active') {
      console.log('❌ Auth Verify: Account not active for user:', user.email, '| Status:', user.account_status);
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    console.log('✅ Auth Verify: Token verified successfully for user:', user.email);

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          profilePictureUrl: user.profile_picture_url,
          role: user.role || 'learner'
        }
      }
    });

  } catch (error) {
    console.error('❌ Auth Verify: Database error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}
