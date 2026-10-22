import type { NextApiResponse } from 'next';
import { withAuth, type AuthedApiRequest } from '../../../lib/auth/withAuth';
import { ensureSchema, requireSyncEnabled, resolveManualSource } from '../../../lib/mmsSync/service';
import { buildSnapshot } from '../../../lib/mmsSync/source';
import { firstSessionAt, recipients, withApproval } from '../../../lib/mmsSync/accessPolicy';
import { snapshotHash } from '../../../lib/mmsSync/contract';
import { previewAccess, requestAccessSend } from '../../../lib/mmsSync/accessNotifications';
import pool from '../../../lib/db';
async function handler(req: AuthedApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ success: false, error: 'GET or POST required.' });
    try {
        requireSyncEnabled();
        await ensureSchema();
        const input = req.method === 'GET' ? req.query : req.body || {};
        const identity = Object.fromEntries(['source_run_key', 'run_uuid', 'masterlist_class_id', 'event_id'].map(k => [k, typeof input[k] === 'string' && input[k].length <= 255 ? input[k] : '']));
        if (!Object.values(identity).some(Boolean)) return res.status(400).json({ success: false, error: 'Provide one exact class identity.' });
        const source = await resolveManualSource(identity);
        if (req.method === 'POST') {
            if (!['send_pending', 'resend'].includes(input.action)) return res.status(400).json({ success: false, error: 'Select send_pending or resend.' });
            if (input.action === 'resend' && (typeof input.person_id !== 'string' || !['trainer', 'learner'].includes(input.role))) return res.status(400).json({ success: false, error: 'Select one current participant and role to resend.' });
            const result = await requestAccessSend(source.source_run_key, req.authUser!.id, input.action === 'resend' ? { id: input.person_id, role: input.role } : undefined);
            return res.json({ success: true, ...result });
        }
        // This preview performs no import and sends no email, including before run approval.
        const snapshot = await buildSnapshot(pool, source);
        const preview = await previewAccess(source.source_run_key, snapshot.course_code);
        if (preview.context.state === 'ready' && snapshotHash(withApproval(snapshot, source as any)) !== preview.context.snapshot?.snapshot_hash) {
            preview.context = { platform: 'mms', state: 'pending', source_run_key: source.source_run_key, reason: 'Source changed. Sync MMS before sending class access.' };
            preview.messages = [];
        }
        return res.json({ success: true, source_run_key: source.source_run_key, first_session_at: firstSessionAt(snapshot), sessions: snapshot.sessions, course_title: snapshot.course_title, course_code: snapshot.course_code,
            participants: recipients(snapshot).map(p => ({ person_id: p.source_id, name: p.name, email: p.email, role: p.role })), trainer_confirmation_pending: !snapshot.trainers.some(p => p.confirmed && p.active !== false), ...preview });
    } catch (e) {
        return res.status(409).json({ success: false, error: e instanceof Error ? e.message : 'MMS class access needs review.' });
    }
}
export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
