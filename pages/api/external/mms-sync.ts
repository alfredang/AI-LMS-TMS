import type { NextApiRequest, NextApiResponse } from 'next';
import { withServiceAuth } from '../../../lib/auth/withAuth';
import { discover, processJobs, mmsSyncEnabled } from '../../../lib/mmsSync/service';
import { dispatchAccessNotifications, recoverAccessNotifications } from '../../../lib/mmsSync/accessNotifications';
import { loadMmsRuntimeConfig } from '../../../lib/mmsSync/runtimeConfig';
export async function runMmsSync(mode = 'discovery', dryRun = false) {
    await loadMmsRuntimeConfig();
    if (!mmsSyncEnabled())
        return { success: true, skipped: true, reason: 'MMS handover is disabled.' };
    if (mode === 'worker') {
        const sync = await processJobs();
        return { success: true, ...sync, notifications: await dispatchAccessNotifications() };
    }
    if (mode === 'notifications') {
        const { ensureSchema } = await import('../../../lib/mmsSync/service');
        await ensureSchema();
        await recoverAccessNotifications();
        return { success: true, notifications: await dispatchAccessNotifications() };
    }
    const result = await discover(dryRun);
    return { success: true, ...result };
}
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (!['GET', 'POST'].includes(req.method || ''))
        return res.status(405).json({ success: false, error: 'GET or POST required.' });
    try {
        return res.json(await runMmsSync(String(req.query.mode || 'discovery'), req.query.dry_run === 'true'));
    }
    catch {
        return res.status(500).json({ success: false, error: 'MMS handover job failed; check the synchronization log.' });
    }
}
export default withServiceAuth(handler);
