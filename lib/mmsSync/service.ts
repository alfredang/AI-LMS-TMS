import pool from '../db';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNonFunded, snapshotHash, MmsSyncError, type RunSnapshot } from './contract';
import { buildSnapshot, type SourceRecord } from './source';
import { assertRunApproval, withApproval } from './accessPolicy';
import { courseAllowed, normalOperationsEnabled, operationalApproval } from './operationPolicy';
import { getMmsRuntimeConfig, loadMmsRuntimeConfig } from './runtimeConfig';
import { assertAutomaticSyncOpen, automaticSyncUntil } from './syncWindow';
import { masterListSources } from './masterList';
import { reconcileMmsRegistrations } from './reverseRegistration';
export const mmsSyncEnabled = (): boolean => getMmsRuntimeConfig().enabled;
let schemaReady: Promise<void> | undefined;
export function requireSyncEnabled(): void {
    if (!mmsSyncEnabled())
        throw new MmsSyncError('MMS handover is disabled. Configure and enable the pilot first.', 'disabled');
}
export async function ensureSchema(): Promise<void> {
    if (!schemaReady)
        schemaReady = (async () => {
            await loadMmsRuntimeConfig();
            for (const file of ['create_mms_nonfunded_sync.sql', 'create_mms_class_access.sql', 'add_mms_masterlist_mirroring.sql'])
                await pool.query(await readFile(path.join(process.cwd(), 'database/migrations', file), 'utf8'));
        })().catch(e => { schemaReady = undefined; throw e; });
    await schemaReady;
}
function configuration(): {
    url: string;
    key: string;
} {
    const { url, apiKey: key } = getMmsRuntimeConfig();
    if (!url || !key)
        throw new MmsSyncError('MMS_SYNC_URL and MMS_SYNC_API_KEY are required.', 'configuration');
    const target = new URL(url);
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)))
        throw new MmsSyncError('MMS import URL must use HTTPS.', 'configuration');
    return { url, key };
}
async function register(source: SourceRecord): Promise<void> {
    assertNonFunded(source.course_code);
    if (!courseAllowed(source.course_code))
        throw new MmsSyncError('Course is outside the configured pilot allowlist.', 'outside_pilot');
    await pool.query(`INSERT INTO mms_sync_source(source_run_key,course_code,calendar_id,event_ids,tms_run_uuid,masterlist_class_id,operational_run_id,masterlist_class_ids)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb) ON CONFLICT(source_run_key) DO UPDATE SET
    event_ids=EXCLUDED.event_ids,course_code=EXCLUDED.course_code,
    tms_run_uuid=EXCLUDED.tms_run_uuid,
    masterlist_class_id=COALESCE(EXCLUDED.masterlist_class_id,mms_sync_source.masterlist_class_id),
    operational_run_id=EXCLUDED.operational_run_id,masterlist_class_ids=EXCLUDED.masterlist_class_ids,updated_at=now()`, [source.source_run_key, source.course_code, source.calendar_id, JSON.stringify(source.event_ids), source.tms_run_uuid, source.masterlist_class_id, source.operational_run_id || null, JSON.stringify(source.masterlist_class_ids || (source.masterlist_class_id ? [source.masterlist_class_id] : []))]);
    // Older Calendar-era mappings may represent separate rows of this same class.
    // Their pending jobs must also read the consolidated Master List roster.
    if (source.masterlist_class_ids?.length) {
        await pool.query('UPDATE mms_sync_source SET masterlist_class_ids=$2::jsonb WHERE masterlist_class_id=ANY($1::uuid[]) AND course_code=$3', [source.masterlist_class_ids, JSON.stringify(source.masterlist_class_ids), source.course_code]);
        await pool.query("UPDATE mms_sync_source SET masterlist_class_id=NULL,masterlist_class_ids='[]'::jsonb,delivery_platform='tms' WHERE masterlist_class_id=ANY($1::uuid[]) AND course_code<>$2", [source.masterlist_class_ids, source.course_code]);
    }
}
async function currentEligibility(source: SourceRecord, _requireApproval = true): Promise<void> {
    assertNonFunded(source.course_code);
    if (!source.masterlist_class_id) throw new MmsSyncError('Only saved Master List classes can synchronize to MMS.', 'masterlist_required');
    const saved = (await pool.query('SELECT 1 FROM masterlist_table WHERE class_id=ANY($1::uuid[]) LIMIT 1', [source.masterlist_class_ids?.length ? source.masterlist_class_ids : [source.masterlist_class_id]])).rows;
    if (!saved.length) throw new MmsSyncError('Master List class no longer exists.', 'masterlist_required');
    if (!courseAllowed(source.course_code))
        throw new MmsSyncError('Course is outside the configured pilot allowlist.', 'outside_pilot');
}
async function recordOperationalApproval(source: SourceRecord, manual = false): Promise<SourceRecord> {
    const previous = (await pool.query('SELECT * FROM mms_sync_source WHERE source_run_key=$1', [source.source_run_key])).rows[0] || source;
    const snapshot = await buildSnapshot(pool, previous);
    const until = automaticSyncUntil(snapshot);
    if (!manual && new Date(until).getTime() <= Date.now() && previous.auto_sync_until)
        await pool.query('UPDATE mms_sync_source SET auto_sync_until=$2 WHERE source_run_key=$1 AND auto_sync_until>now()', [source.source_run_key, until]);
    if (!manual) assertAutomaticSyncOpen(until);
    const approval = operationalApproval(snapshot, previous);
    await pool.query(`UPDATE mms_sync_source SET approved_at=$2,approved_by=$3,first_session_at=$4,auto_sync_until=$5
        ,delivery_platform='mms' WHERE source_run_key=$1`, [source.source_run_key, approval.approved_at, approval.approved_by, approval.first_session_at, until]);
    return { ...previous, ...approval, auto_sync_until: until };
}

/** Used only by existing send workflows, not by read-only access previews. */
export async function prepareOperationalAccess(input: Parameters<typeof resolveManualSource>[0]): Promise<void> {
    await loadMmsRuntimeConfig();
    if (!normalOperationsEnabled()) return;
    configuration();
    await ensureSchema();
    const source = await resolveManualSource(input);
    await register(source);
    await recordOperationalApproval(source);
    await queueSource(source.source_run_key, 'normal-tms-mail');
    await processJobs(1, source.source_run_key);
}
export async function queueSource(key: string, trigger: string): Promise<number> {
    await loadMmsRuntimeConfig();
    requireSyncEnabled();
    const source = (await pool.query('SELECT * FROM mms_sync_source WHERE source_run_key=$1', [key])).rows[0];
    if (!source)
        throw new MmsSyncError('Class is not linked; synchronize the Master List first.');
    await currentEligibility(source);
    if (trigger !== 'manual' && !source.masterlist_class_id) assertAutomaticSyncOpen(source.auto_sync_until);
    const job = (await pool.query(`INSERT INTO mms_sync_job(source_run_key,trigger) VALUES($1,$2)
    ON CONFLICT(source_run_key) WHERE state IN ('queued','running') DO UPDATE SET dirty=true,trigger=CASE WHEN EXCLUDED.trigger='manual' THEN 'manual' ELSE mms_sync_job.trigger END,available_at=now(),updated_at=now() RETURNING id`, [key, trigger])).rows[0];
    return Number(job.id);
}
export async function discover(dryRun = false): Promise<Record<string, unknown>> {
    await loadMmsRuntimeConfig();
    requireSyncEnabled();
    await ensureSchema();
    const result: Record<string, unknown> = { scanned: 0, queued: 0, excluded: 0, exceptions: [], source: 'masterlist' };
    const sources = new Map<string, SourceRecord>();
    for (const source of await masterListSources(pool, { persistCodes: !dryRun, exceptions: result.exceptions as unknown[] })) sources.set(source.source_run_key, source);
    result.scanned = sources.size;
    for (const source of sources.values()) {
        try {
            if (!source.masterlist_class_id && source.auto_sync_until && new Date(source.auto_sync_until).getTime() <= Date.now()) {
                result.excluded = Number(result.excluded) + 1;
                continue;
            }
            if (dryRun) {
                await currentEligibility(source, false);
                const snapshot = await buildSnapshot(pool, source);
                snapshot.revision = 1;
                snapshot.request_id = `preview:${randomUUID()}`;
                snapshot.snapshot_hash = snapshotHash(snapshot);
                const config = configuration();
                const response = await fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.key }, body: JSON.stringify({ ...snapshot, dry_run: true }), signal: AbortSignal.timeout(30000) });
                const preview = await response.json();
                if (!response.ok || !preview.success)
                    throw new MmsSyncError(preview.error || 'MMS preview failed.');
                const previews = (result.previews || []) as unknown[];
                previews.push(preview);
                result.previews = previews;
                continue;
            }
            await register(source);
            await recordOperationalApproval(source);
            await queueSource(source.source_run_key, 'discovery');
            result.queued = Number(result.queued) + 1;
        }
        catch (e) {
            if (e instanceof MmsSyncError && e.code === 'sync_window_closed') {
                result.excluded = Number(result.excluded) + 1;
                continue;
            }
            (result.exceptions as unknown[]).push({ source_run_key: source.source_run_key, reason: e instanceof Error ? e.message : 'Queue failed' });
        }
    }
    await pool.query('INSERT INTO mms_sync_scan_log(result) VALUES($1::jsonb)', [JSON.stringify(result)]);
    return result;
}
export async function requestManual(input: {
    source_run_key?: string;
    run_uuid?: string;
    masterlist_class_id?: string;
    event_id?: string;
    confirm_trainer?: boolean;
    approve_run?: boolean;
    first_session_at?: string;
    actor?: string;
}): Promise<{
    job_id: number;
    source_run_key: string;
}> {
    await loadMmsRuntimeConfig();
    requireSyncEnabled();
    configuration();
    await ensureSchema();
    const source = await resolveManualSource(input);
    await register(source);
    await currentEligibility(source, false);
    await recordOperationalApproval(source, true);
    return { job_id: await queueSource(source.source_run_key, 'manual'), source_run_key: source.source_run_key };
}
export async function processJobs(limit = 20, sourceKey: string | null = null): Promise<{
    processed: number;
    failed: number;
}> {
    await loadMmsRuntimeConfig();
    requireSyncEnabled();
    const config = configuration();
    await ensureSchema();
    const counts = { processed: 0, failed: 0 };
    // Expiring leases recover a worker crash. Request retries are idempotent at MMS.
    await pool.query(`UPDATE mms_sync_job SET state='queued',leased_at=NULL WHERE state='running' AND leased_at<now()-interval '5 minutes'`);
    for (let n = 0; n < limit; n++) {
        const job = (await pool.query(`UPDATE mms_sync_job SET state='running',leased_at=now(),dirty=false,attempts=attempts+1
      WHERE id=(SELECT id FROM mms_sync_job WHERE state='queued' AND available_at<=now() AND ($1::text IS NULL OR source_run_key=$1) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [sourceKey])).rows[0];
        if (!job)
            break;
        const db = await pool.connect();
        let locked = false;
        try {
            locked = !!(await db.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [`mms:${job.source_run_key}`])).rows[0].locked;
            if (!locked) {
                await db.query("UPDATE mms_sync_job SET state='queued',available_at=now()+interval '5 seconds' WHERE id=$1", [job.id]);
                continue;
            }
            const source = (await db.query('SELECT * FROM mms_sync_source WHERE source_run_key=$1', [job.source_run_key])).rows[0] as SourceRecord;
            if (!source.masterlist_class_id) {
                await db.query("UPDATE mms_sync_job SET state='cancelled',last_error='Source no longer represents a saved Master List class',leased_at=NULL,updated_at=now() WHERE id=$1", [job.id]);
                continue;
            }
            await currentEligibility(source);
            const snapshot = withApproval(await buildSnapshot(pool, source), source as any);
            const nextUntil = automaticSyncUntil(snapshot);
            if (job.trigger !== 'manual' && new Date(nextUntil).getTime() <= Date.now()) {
                await db.query('UPDATE mms_sync_source SET auto_sync_until=$2 WHERE source_run_key=$1 AND auto_sync_until>now()', [job.source_run_key, nextUntil]);
                await db.query("UPDATE mms_sync_job SET state='cancelled',last_error='Automatic sync window closed after schedule change',leased_at=NULL,updated_at=now() WHERE id=$1", [job.id]);
                continue;
            }
            if (job.trigger !== 'manual') assertAutomaticSyncOpen(nextUntil);
            snapshot.snapshot_hash = snapshotHash(snapshot);
            await db.query('BEGIN');
            const previous = (await db.query('SELECT revision,snapshot_hash FROM mms_sync_source WHERE source_run_key=$1 FOR UPDATE', [job.source_run_key])).rows[0];
            snapshot.revision = Number(previous.revision) + (previous.snapshot_hash === snapshot.snapshot_hash ? 0 : 1);
            snapshot.request_id = `${job.source_run_key}:${snapshot.revision}:${randomUUID()}`;
            const aliases = { ...source.person_aliases };
            for (const person of [...(source.snapshot?.learners || []), ...(source.snapshot?.trainers || []), ...snapshot.learners, ...snapshot.trainers])
                if (!person.source_id.startsWith('email:'))
                    aliases[person.email] = person.source_id;
            await db.query(`UPDATE mms_sync_source SET revision=$2,snapshot_hash=$3,snapshot=$4::jsonb,person_aliases=$5::jsonb,
                auto_sync_until=CASE WHEN masterlist_class_id IS NOT NULL OR auto_sync_until>now() THEN $6 ELSE auto_sync_until END,updated_at=now() WHERE source_run_key=$1`,
                [job.source_run_key, snapshot.revision, snapshot.snapshot_hash, JSON.stringify(snapshot), JSON.stringify(aliases), nextUntil]);
            await db.query('COMMIT');
            // Eligibility is checked again immediately before the outbound operation.
            await currentEligibility(source);
            if (job.trigger !== 'manual') {
                assertAutomaticSyncOpen((await db.query('SELECT auto_sync_until FROM mms_sync_source WHERE source_run_key=$1', [job.source_run_key])).rows[0]?.auto_sync_until);
                assertAutomaticSyncOpen(nextUntil);
            }
            const response = await fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.key }, body: JSON.stringify(snapshot), signal: AbortSignal.timeout(55000) });
            const result = await response.json();
            if (!response.ok || !result.success)
                throw new MmsSyncError(result.error || `MMS returned HTTP ${response.status}`, response.status >= 500 || response.status === 408 || response.status === 429 ? 'retry' : 'needs_review');
            if (snapshot.schema_version === 2) result.reverse_reconciliation = await reconcileMmsRegistrations(pool, source, result.native_registrations || []);
            // Record class synchronization independently of participant-access readiness.
            assertRunApproval(source as any, snapshot);
            await db.query('UPDATE mms_sync_source SET target_result=$2::jsonb,last_success_at=now(),last_error=NULL,handover_at=COALESCE(handover_at,now()) WHERE source_run_key=$1', [job.source_run_key, JSON.stringify(result)]);
            await db.query(`UPDATE mms_sync_job SET state=CASE WHEN dirty THEN 'queued' ELSE 'succeeded' END,leased_at=NULL,available_at=now(),last_error=NULL WHERE id=$1`, [job.id]);
            counts.processed++;
        }
        catch (e) {
            await db.query('ROLLBACK').catch(() => { });
            const message = e instanceof Error ? e.message : 'Sync failed';
            const permanent = e instanceof MmsSyncError && e.code !== 'retry';
            await db.query(`UPDATE mms_sync_job SET state=$2,last_error=$3,leased_at=NULL,available_at=now()+($4::integer*interval '1 second') WHERE id=$1`, [job.id, permanent || job.attempts >= 5 ? 'needs_review' : 'queued', message, Math.min(300, 2 ** job.attempts * 10)]);
            await db.query('UPDATE mms_sync_source SET last_error=$2 WHERE source_run_key=$1', [job.source_run_key, message]);
            counts.failed++;
        }
        finally {
            if (locked)
                await db.query('SELECT pg_advisory_unlock(hashtext($1))', [`mms:${job.source_run_key}`]);
            db.release();
        }
    }
    // Notifications have their own outbox and switch; a mail failure must not undo a committed import.
    const { recoverAccessNotifications } = await import('./accessNotifications');
    await recoverAccessNotifications(sourceKey).catch(e => console.error('[mms-access] Notification recovery failed:', e instanceof Error ? e.message : 'unknown'));
    return counts;
}
export async function syncStatus(filters: {
    run_uuid?: string;
    masterlist_class_id?: string;
    source_run_key?: string;
}): Promise<unknown[]> {
    await loadMmsRuntimeConfig();
    if (!mmsSyncEnabled())
        return [];
    await ensureSchema();
    return (await pool.query(`SELECT s.source_run_key,s.course_code,s.revision,s.target_result,s.last_success_at,s.last_error,s.approved_at,s.first_session_at,s.handover_at,s.delivery_platform,s.access_calendar_error,
    (SELECT state FROM mms_sync_job j WHERE j.source_run_key=s.source_run_key ORDER BY id DESC LIMIT 1) state
    FROM mms_sync_source s WHERE s.source_run_key=$1 OR s.tms_run_uuid::text=$2 OR s.masterlist_class_id::text=$3 OR s.masterlist_class_ids ? $3
    ORDER BY s.last_success_at DESC NULLS LAST,s.updated_at DESC`, [filters.source_run_key || '', filters.run_uuid || '', filters.masterlist_class_id || ''])).rows;
}
export async function resolveManualSource(input: {
    source_run_key?: string;
    run_uuid?: string;
    masterlist_class_id?: string;
    event_id?: string;
}): Promise<SourceRecord> {
    const known = (await pool.query(`SELECT * FROM mms_sync_source WHERE source_run_key=$1 OR tms_run_uuid::text=$2 OR masterlist_class_id::text=$3 OR masterlist_class_ids ? $3`, [input.source_run_key || '', input.run_uuid || '', input.masterlist_class_id || ''])).rows;
    const sources = await masterListSources(pool, { persistCodes: false });
    const classIds = new Set([input.masterlist_class_id, ...known.flatMap(s => [s.masterlist_class_id, ...(s.masterlist_class_ids || [])])].filter(Boolean));
    const source = sources.find(s => s.masterlist_class_ids?.some(id => classIds.has(id))) || sources.find(s => input.run_uuid && s.tms_run_uuid === input.run_uuid);
    if (source) return source;
    throw new MmsSyncError('Only classes already saved in Master List can synchronize to MMS.', 'masterlist_required');
}
