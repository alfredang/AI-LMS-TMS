import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@lib/auth/withAuth';
import pool from '@lib/db';
import { DA_AUTOMATION_TASK, DA_AUTOMATION_CRON } from '@lib/directApplicationAutomation';
import { ensureDaAutomationTable } from '@lib/directApplicationAutomationSchema';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    await ensureDaAutomationTable();
    const [config, runs, attention] = await Promise.all([
      pool.query('SELECT enabled, cron_expression FROM scheduler_config WHERE id = $1', [DA_AUTOMATION_TASK]),
      pool.query('SELECT * FROM da_automation_run ORDER BY started_at DESC LIMIT 5'),
      pool.query(`SELECT application_id, auto_enrol_status, auto_enrol_error, COUNT(*) OVER()::int AS total
        FROM da_application WHERE LOWER(TRIM(application_status)) LIKE 'confirmed%'
        AND course_start_date >= (NOW() AT TIME ZONE 'Asia/Singapore')::date
        AND (auto_enrol_status IN ('failed', 'pending_identity')
          OR NULLIF(TRIM(auto_enrol_error), '') IS NOT NULL
          OR (auto_enrol_status = 'pending' AND updated_at < NOW() - INTERVAL '30 minutes'))
        ORDER BY updated_at DESC LIMIT 10`),
    ]);
    const runtimeEnabled = process.env.ENABLE_APP_SCHEDULER === 'true'
      || (process.env.NODE_ENV === 'production' && process.env.ENABLE_APP_SCHEDULER !== 'false');
    return res.status(200).json({ success: true, enabled: !!config.rows[0]?.enabled && runtimeEnabled,
      configuredEnabled: !!config.rows[0]?.enabled, runtimeEnabled,
      cron: config.rows[0]?.cron_expression || DA_AUTOMATION_CRON, timezone: 'Asia/Singapore',
      latest: runs.rows[0] || null, recent: runs.rows, attentionCount: attention.rows[0]?.total || 0,
      attention: attention.rows.map(({ total, ...row }) => row) });
  } catch {
    return res.status(500).json({ success: false, error: 'Unable to read automation report. Check that the database migration has been applied.' });
  }
}
export default withAuth(handler, { roles: ['admin', 'developer', 'trainingProvider'] });
