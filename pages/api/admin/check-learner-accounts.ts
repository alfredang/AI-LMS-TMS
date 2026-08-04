import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

// POST { emails: string[] }
// Returns which emails already have a Learner account
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { emails } = req.body as { emails: string[] };

  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ success: false, message: 'emails array is required' });
  }

  try {
    const result = await pool.query(
      `SELECT au.email
       FROM app_user au
       JOIN user_role_map urm ON au.id = urm.user_id
       WHERE au.email = ANY($1) AND urm.role = 'Learner'`,
      [emails]
    );

    const existingEmails = new Set(result.rows.map((r: any) => r.email.toLowerCase()));

    const results = emails.map(email => ({
      email,
      exists: existingEmails.has(email.toLowerCase()),
    }));

    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error('Error checking learner accounts:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
