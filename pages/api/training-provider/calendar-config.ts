import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const result = await pool.query(`
      SELECT
        sync_google_calendar,
        google_calendar_url
      FROM training_provider
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          enabled: false,
          calendarUrl: '',
        },
      });
    }

    const tp = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        enabled: tp.sync_google_calendar || false,
        calendarUrl: tp.google_calendar_url || '',
      },
    });
  } catch (error) {
    console.error('Failed to fetch calendar config:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
