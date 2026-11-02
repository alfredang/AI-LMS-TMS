import type { Pool } from 'pg';
import { assertNonFunded, MmsSyncError, type RunSnapshot } from './contract';
import type { RunApproval } from './accessPolicy';
import { buildMasterListSnapshot } from './masterList';

export interface SourceRecord extends RunApproval {
    source_run_key: string;
    course_code: string;
    calendar_id: string;
    event_ids: string[];
    tms_run_uuid: string | null;
    masterlist_class_id: string | null;
    masterlist_class_ids?: string[];
    operational_run_id?: string | null;
    trainer_approved_email?: string;
    auto_sync_until?: string | Date | null;
    snapshot?: RunSnapshot;
    person_aliases?: Record<string, string>;
}

export async function buildSnapshot(db: Pool, source: SourceRecord): Promise<RunSnapshot> {
    assertNonFunded(source.course_code);
    if (!source.masterlist_class_id) throw new MmsSyncError('Only saved Master List classes can synchronize to MMS.', 'masterlist_required');
    return buildMasterListSnapshot(db, source);
}
