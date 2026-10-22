import pool from '../db';
import { accessContext, type AccessContext } from './accessPolicy';
import { dateInSingapore, MmsSyncError, normalizeCode } from './contract';
import { courseAllowed, normalOperationsEnabled, operationalApproval } from './operationPolicy';

export interface ClassIdentity { courseCode?: string; runUuid?: string; operationalRunId?: string; sourceKey?: string; masterlistClassId?: string; }
export async function getAccessContext(identity: ClassIdentity): Promise<AccessContext> {
    // Default-off and funded paths do not query/migrate the integration schema.
    if (normalizeCode(identity.courseCode).startsWith('TGS') || process.env.MMS_SYNC_ENABLED !== 'true')
        return { platform: 'tms', state: 'legacy' };
    const exists = (await pool.query("SELECT to_regclass('mms_access_notification') AS name")).rows[0]?.name;
    if (!exists) throw new Error('Deploy the MMS access migration before enabling MMS synchronization.');
    const rows = (await pool.query(`SELECT s.*,
        COALESCE(c.course_code,s.course_code) current_code,
        EXISTS(SELECT 1 FROM mms_sync_job j WHERE j.source_run_key=s.source_run_key AND j.state IN ('queued','running')) dirty
        FROM mms_sync_source s LEFT JOIN course_run cr ON cr.id=s.tms_run_uuid LEFT JOIN course c ON c.id=cr.course_id
        WHERE s.source_run_key=$1 OR s.tms_run_uuid::text=$2 OR s.masterlist_class_id::text=$3
           OR ($4<>'' AND lower(s.operational_run_id)=lower($4))`,
        [identity.sourceKey || '', identity.runUuid || '', identity.masterlistClassId || '', identity.operationalRunId || ''])).rows;
    if (rows.length > 1) return { platform: 'review', state: 'pending', reason: 'Multiple source runs match this message.' };
    const row = rows[0];
    if (row && normalizeCode(row.current_code).startsWith('TGS')) return { platform: 'tms', state: 'legacy' };
    if (row && identity.courseCode && normalizeCode(identity.courseCode) !== normalizeCode(row.current_code))
        return { platform: 'review', state: 'pending', reason: 'Course classification changed; review the message.' };
    if (!row?.approved_at && identity.runUuid && normalOperationsEnabled()) {
        const run = (await pool.query('SELECT to_jsonb(cr) run,c.course_code FROM course_run cr JOIN course c ON c.id=cr.course_id WHERE cr.id::text=$1', [identity.runUuid])).rows[0];
        if (normalizeCode(run?.course_code).startsWith('TGS')) return { platform: 'tms', state: 'legacy' };
        const start = String(run?.run?.start_date || '');
        if (start && (start < (process.env.MMS_PILOT_START_DATE || '2026-10-23') || start < dateInSingapore(new Date().toISOString())))
            return { platform: 'tms', state: 'legacy' };
    }
    if ((!row?.approved_at || !row) && normalOperationsEnabled() && courseAllowed(identity.courseCode || row?.current_code)) {
        try {
            const { resolveManualSource } = await import('./service');
            const { buildSnapshot } = await import('./source');
            const source = await resolveManualSource({ source_run_key: identity.sourceKey, run_uuid: identity.runUuid, masterlist_class_id: identity.masterlistClassId });
            if (source.delivery_platform === 'tms') return { platform: 'tms', state: 'legacy' };
            const snapshot = await buildSnapshot(pool, source);
            // Invitations must still work before the trainer accepts or any
            // learner signs up; this read does not authorize/import the run.
            operationalApproval(snapshot, source, new Date(), false);
            return { platform: 'mms', state: 'pending', source_run_key: source.source_run_key, reason: 'Normal TMS assignments are awaiting MMS synchronization.' };
        } catch (e) {
            if (e instanceof MmsSyncError && ['no_midway', 'outside_pilot', 'funded_excluded'].includes(e.code))
                return { platform: 'tms', state: 'legacy' };
            return { platform: 'review', state: 'pending', reason: e instanceof Error ? e.message : 'MMS handover needs attention.' };
        }
    }
    return accessContext(identity.courseCode || row?.current_code, row, !!row?.dirty);
}

// Sending/accepting a trainer invitation is still a TMS operation. A missing
// MMS connection may delay teaching access but must not stop that invitation.
export async function invitationAccess(identity: ClassIdentity): Promise<AccessContext> {
    try { return await getAccessContext(identity); }
    catch (e) {
        if (!normalOperationsEnabled()) throw e;
        return { platform: 'review', state: 'pending', reason: e instanceof Error ? e.message : 'MMS access needs attention.' };
    }
}

export async function prepareClassAccess(identity: ClassIdentity): Promise<AccessContext> {
    let context = await invitationAccess(identity);
    if (!normalOperationsEnabled() || context.platform === 'tms' || context.state === 'ready') return context;
    try {
        const { prepareOperationalAccess } = await import('./service');
        await prepareOperationalAccess({ source_run_key: identity.sourceKey, run_uuid: identity.runUuid, masterlist_class_id: identity.masterlistClassId });
        context = await getAccessContext(identity);
    } catch (e) {
        return { ...context, platform: 'review', state: 'pending', reason: e instanceof Error ? e.message : 'MMS synchronization failed; mail is held.' };
    }
    return context;
}
