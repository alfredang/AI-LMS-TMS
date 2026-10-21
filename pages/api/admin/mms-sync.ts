import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '../../../lib/auth/withAuth';
import { MmsSyncError } from '../../../lib/mmsSync/contract';
import { requestManual, processJobs } from '../../../lib/mmsSync/service';
async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST')
        return res.status(405).json({ success: false, error: 'POST required.' });
    try {
        const body = req.body || {};
        if (!['source_run_key', 'run_uuid', 'masterlist_class_id', 'event_id'].some(k => typeof body[k] === 'string' && body[k].length > 0 && body[k].length <= 255))
            return res.status(400).json({ success: false, error: 'Provide one source class identity.' });
        const job = await requestManual({ source_run_key: body.source_run_key, run_uuid: body.run_uuid, masterlist_class_id: body.masterlist_class_id, event_id: body.event_id, confirm_trainer: body.confirm_trainer === true });
        await processJobs(1, job.source_run_key);
        return res.status(200).json({ success: true, ...job });
    }
    catch (e) {
        return res.status(e instanceof MmsSyncError && e.code === 'funded_excluded' ? 422 : e instanceof MmsSyncError ? 409 : 500).json({ success: false, error: e instanceof MmsSyncError ? e.message : 'MMS synchronization failed; check the job status.' });
    }
}
export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
