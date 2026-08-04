import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getAuthedUser } from '../../../lib/auth/requireRole';

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
    // Validates the session token against the user_session table.
    const authed = await getAuthedUser(req);
    if (!authed || authed.isService) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

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

    const userResult = await pool.query(userQuery, [authed.id]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = userResult.rows[0];

    if (user.account_status && user.account_status.toLowerCase() !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

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
