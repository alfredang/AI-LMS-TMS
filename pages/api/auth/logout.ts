import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import { revokeSession, SESSION_TOKEN_PREFIX } from '../../../lib/auth/session';

interface LogoutResponse {
  success: boolean;
  message?: string;
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<LogoutResponse>) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Revoke the server-side session for the presented token, if any.
    const header = req.headers.authorization;
    if (header && header.toLowerCase().startsWith('bearer ')) {
      const token = header.slice(7).trim();
      if (token.startsWith(SESSION_TOKEN_PREFIX)) {
        await revokeSession(token);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('❌ Logout error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: `Logout failed: ${errorMessage}`
    });
  }
}

export default handler;
