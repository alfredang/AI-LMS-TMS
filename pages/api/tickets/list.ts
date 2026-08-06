import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { userId, role } = req.query;

    let query: string;
    let params: any[];

    if (role === 'admin') {
      // Admin sees all tickets
      query = `
        SELECT st.*, au.full_name AS learner_name, au.email AS learner_email,
               (SELECT COUNT(*) FROM support_ticket_reply WHERE ticket_id = st.id) AS reply_count
        FROM support_ticket st
        JOIN app_user au ON st.user_id = au.id
        ORDER BY st.created_at DESC
      `;
      params = [];
    } else if (userId) {
      // Learner sees only their tickets
      query = `
        SELECT st.*,
               (SELECT COUNT(*) FROM support_ticket_reply WHERE ticket_id = st.id) AS reply_count
        FROM support_ticket st
        WHERE st.user_id = $1
        ORDER BY st.created_at DESC
      `;
      params = [userId];
    } else {
      return res.status(400).json({ success: false, message: 'userId or role=admin is required' });
    }

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching support tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
