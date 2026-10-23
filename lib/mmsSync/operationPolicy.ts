import { assertNonFunded, MmsSyncError, type RunSnapshot } from './contract';
import { assertRunApproval, firstSessionAt, type RunApproval } from './accessPolicy';
import { getMmsRuntimeConfig } from './runtimeConfig';

// The integration remains globally default-off. Once enabled, the operator uses
// normal TMS assignments; MMS-only approval clicks are an optional legacy mode.
export const normalOperationsEnabled = () => getMmsRuntimeConfig().enabled && getMmsRuntimeConfig().automatic;
export function courseAllowed(code: unknown, configured = getMmsRuntimeConfig().courseAllowlist): boolean {
    try {
        const normalized = assertNonFunded(code);
        const entries = configured.split(',').map(v => v.trim().toUpperCase());
        return entries.includes(normalized) || entries.includes('C*');
    } catch { return false; }
}

/** Record the existing TMS operation, not a claim that a human reviewed MMS. */
export function operationalApproval(snapshot: RunSnapshot, source: RunApproval & { tms_run_uuid?: string | null; masterlist_class_id?: string | null }, now = new Date(), requireAssignment = true): RunApproval {
    assertNonFunded(snapshot.course_code);
    if (source.delivery_platform === 'tms') throw new MmsSyncError('This run is explicitly retained in TMS.', 'outside_pilot');
    if (!source.tms_run_uuid && !source.masterlist_class_id)
        throw new MmsSyncError('Save the normal TMS course run or Master List assignment first.', 'assignment_pending');
    const start = firstSessionAt(snapshot);
    if (source.approved_at && source.first_session_at && new Date(source.first_session_at).toISOString() === start) {
        assertRunApproval(source, snapshot, now);
        return source;
    }
    if (source.first_session_at && new Date(source.first_session_at).getTime() <= now.getTime())
        throw new MmsSyncError('An already-started run cannot be moved to a later first session.', 'no_midway');
    if (snapshot.cancelled || !snapshot.roster_complete || (requireAssignment && ![
        ...snapshot.learners.filter(p => p.active !== false),
        ...snapshot.trainers.filter(p => p.confirmed && p.active !== false),
    ].length)) throw new MmsSyncError('Awaiting a saved active learner or assigned trainer in TMS.', 'assignment_pending');
    const approval: RunApproval = { ...source, approved_at: now.toISOString(), approved_by: 'tms-normal-operations', first_session_at: start };
    assertRunApproval(approval, snapshot, now);
    return approval;
}
