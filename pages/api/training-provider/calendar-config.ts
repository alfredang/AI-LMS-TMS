import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const result = await pool.query(`
      SELECT
        sync_google_calendar,
        sync_ms_calendar,
        google_calendar_url,
        ms_calendar_url
      FROM training_provider
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          syncGoogleCalendar: false,
          syncMicrosoftCalendar: false,
          googleCalendarUrl: '',
          msCalendarUrl: '',
        },
      });
    }

    const tp = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        syncGoogleCalendar: tp.sync_google_calendar || false,
        syncMicrosoftCalendar: tp.sync_ms_calendar || false,
        googleCalendarUrl: tp.google_calendar_url || '',
        msCalendarUrl: tp.ms_calendar_url || '',
      },
    });
  } catch (error) {
    console.error('Failed to fetch calendar config:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
