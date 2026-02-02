import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

const VALID_ROLES = ['Learner', 'Trainer', 'Developer', 'Admin', 'Training Provider'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId, roles } = req.body;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    return res.status(400).json({ success: false, error: 'roles must be a non-empty array' });
  }

  // Validate all roles
  for (const role of roles) {
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role: "${role}". Valid roles: ${VALID_ROLES.join(', ')}`,
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete all existing roles for this user
    await client.query('DELETE FROM public.user_role_map WHERE user_id = $1', [userId]);

    // Insert new roles
    for (const role of roles) {
      await client.query(
        'INSERT INTO public.user_role_map (user_id, role) VALUES ($1, $2)',
        [userId, role]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      data: { userId, roles },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user roles:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: `Failed to update user roles: ${errorMessage}`,
    });
  } finally {
    client.release();
  }
}

export default handler;
