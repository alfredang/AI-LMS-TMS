import pool from '../db';
import { accessContext, type AccessContext } from './accessPolicy';
import { normalizeCode } from './contract';

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
    return accessContext(identity.courseCode || row?.current_code, row, !!row?.dirty);
}
