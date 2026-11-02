/** Emit one pending-class snapshot for the MMS stdin contract/hash check. */
import type { Pool } from 'pg';
import { buildSnapshot } from '../lib/mmsSync/source';
import { snapshotHash } from '../lib/mmsSync/contract';
const db = { query: async (sql: string) => {
    if (sql.includes('FROM masterlist_table')) return { rows: [{ id: 'pending', class_id: '00000000-0000-0000-0000-000000000001', course_code: 'C916', course_title: 'Pending class — 学习', class_date: '2099-11-10~2099-11-11', class_type: 'virtual', venue: 'Room 1', name: 'Pending learner', email: '', schedule_entries: [{ id: 'partial', startTime: '09:30', endTime: '' }] }] };
    if (sql.includes('FROM course c WHERE')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
} } as unknown as Pool;
buildSnapshot(db, { source_run_key: 'masterlist:contract-fixture', course_code: 'C916', calendar_id: 'masterlist', event_ids: [], masterlist_class_id: '00000000-0000-0000-0000-000000000001', tms_run_uuid: null }).then(snapshot => {
    snapshot.revision = 1; snapshot.snapshot_hash = snapshotHash(snapshot);
    process.stdout.write(JSON.stringify(snapshot));
}).catch(error => { console.error(error); process.exitCode = 1; });
