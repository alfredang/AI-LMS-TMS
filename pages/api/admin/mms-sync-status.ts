import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '../../../lib/auth/withAuth';
import { MmsSyncError } from '../../../lib/mmsSync/contract';
import { mmsSyncEnabled, ensureSchema, resolveManualSource, syncStatus } from '../../../lib/mmsSync/service';
import pool from '../../../lib/db';
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET')
        return res.status(405).json({ success: false, error: 'GET required.' });
    if (!mmsSyncEnabled())
        return res.json({ success: true, enabled: false, eligible: false, data: [] });
    try {
        await ensureSchema();
        if (req.query.list === 'true') {
            const data = (await pool.query(`SELECT s.source_run_key,s.course_code,s.last_success_at,s.last_error,s.revision,s.target_result,s.approved_at,s.access_calendar_error,
                (SELECT count(*)::int FROM mms_access_notification n WHERE n.source_run_key=s.source_run_key AND n.state IN ('failed','review')) access_failures
                FROM mms_sync_source s ORDER BY updated_at DESC LIMIT 100`)).rows;
            const scan = (await pool.query('SELECT created_at,result FROM mms_sync_scan_log ORDER BY id DESC LIMIT 1')).rows[0] || null;
            return res.json({ success: true, enabled: true, notifications_enabled: process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED === 'true', data, scan });
        }
        const input = { run_uuid: String(req.query.run_uuid || ''), masterlist_class_id: String(req.query.masterlist_class_id || ''), source_run_key: String(req.query.source_run_key || '') };
        const source = await resolveManualSource(input);
        return res.json({ success: true, enabled: true, eligible: true, course_code: source.course_code, data: await syncStatus(input) });
    }
    catch (e) {
        return res.json({ success: true, enabled: true, eligible: false, reason: e instanceof MmsSyncError ? e.message : 'Cannot resolve class synchronization status.', data: [] });
    }
}
export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
