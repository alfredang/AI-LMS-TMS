import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const { userId, newStatus } = req.body;

    if (!userId || !newStatus) {
      return res.status(400).json({ success: false, message: 'Missing required fields: userId and newStatus' });
    }

    if (!['active', 'inactive'].includes(newStatus.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be "active" or "inactive"' });
    }

    const userResult = await pool.query(
      `SELECT id, full_name, account_status FROM app_user WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Learner not found' });
    }

    const user = userResult.rows[0];
    const normalizedNew = newStatus.toLowerCase();

    if (user.account_status === normalizedNew) {
      return res.status(400).json({ success: false, message: `Learner is already ${normalizedNew}` });
    }

    const updateResult = await pool.query(
      `UPDATE app_user SET account_status = $1 WHERE id = $2 RETURNING id, full_name, account_status`,
      [normalizedNew, userId]
    );

    const updated = updateResult.rows[0];

    return res.status(200).json({
      success: true,
      message: `Learner ${normalizedNew} successfully`,
      data: {
        userId: updated.id,
        fullName: updated.full_name,
        oldStatus: user.account_status,
        newStatus: updated.account_status,
      }
    });
  } catch (error) {
    console.error('Learner status update error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
