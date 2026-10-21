import pool from '../db';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNonFunded, snapshotHash, MmsSyncError, type RunSnapshot } from './contract';
import { calendarEvents, resolveEvent, buildSnapshot, type SourceRecord } from './source';
import { getCalendarReadClient } from '../calendar/calendarClient';
export const mmsSyncEnabled = (): boolean => process.env.MMS_SYNC_ENABLED === 'true';
let schemaReady: Promise<void> | undefined;
export function requireSyncEnabled(): void {
    if (!mmsSyncEnabled())
        throw new MmsSyncError('MMS handover is disabled. Configure and enable the pilot first.', 'disabled');
}
export async function ensureSchema(): Promise<void> {
    if (!schemaReady)
        schemaReady = (async () => { await pool.query(await readFile(path.join(process.cwd(), 'database/migrations/create_mms_nonfunded_sync.sql'), 'utf8')); })().catch(e => { schemaReady = undefined; throw e; });
    await schemaReady;
}
function configuration(): {
    url: string;
    key: string;
} {
    const url = process.env.MMS_SYNC_URL || '';
    const key = process.env.MMS_SYNC_API_KEY || '';
    if (!url || !key)
        throw new MmsSyncError('MMS_SYNC_URL and MMS_SYNC_API_KEY are required.', 'configuration');
    const target = new URL(url);
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)))
        throw new MmsSyncError('MMS import URL must use HTTPS.', 'configuration');
    return { url, key };
}
async function register(source: SourceRecord): Promise<void> {
    assertNonFunded(source.course_code);
    const allowlist = (process.env.MMS_SYNC_COURSE_ALLOWLIST || '').split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
    if (!allowlist.includes(source.course_code))
        throw new MmsSyncError('Course is outside the configured pilot allowlist.', 'outside_pilot');
    await pool.query(`INSERT INTO mms_sync_source(source_run_key,course_code,calendar_id,event_ids,tms_run_uuid,masterlist_class_id,operational_run_id)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT(source_run_key) DO UPDATE SET
    event_ids=(SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements(mms_sync_source.event_ids||EXCLUDED.event_ids) v),
    tms_run_uuid=COALESCE(EXCLUDED.tms_run_uuid,mms_sync_source.tms_run_uuid),
    masterlist_class_id=COALESCE(EXCLUDED.masterlist_class_id,mms_sync_source.masterlist_class_id),
    operational_run_id=COALESCE(EXCLUDED.operational_run_id,mms_sync_source.operational_run_id),updated_at=now()`, [source.source_run_key, source.course_code, source.calendar_id, JSON.stringify(source.event_ids), source.tms_run_uuid, source.masterlist_class_id, source.operational_run_id || null]);
}
async function currentEligibility(source: SourceRecord): Promise<void> {
    assertNonFunded(source.course_code);
    if (source.tms_run_uuid) {
        const rows = (await pool.query('SELECT c.course_code FROM course_run cr JOIN course c ON c.id=cr.course_id WHERE cr.id=$1', [source.tms_run_uuid])).rows;
        if (rows.length !== 1)
            throw new MmsSyncError('TMS run is missing.');
        if (assertNonFunded(rows[0].course_code) !== source.course_code)
            throw new MmsSyncError('TMS run course changed.');
    }
    const allowlist = (process.env.MMS_SYNC_COURSE_ALLOWLIST || '').split(',').map(v => v.trim().toUpperCase());
    if (!allowlist.includes(source.course_code))
        throw new MmsSyncError('Course is outside the configured pilot allowlist.', 'outside_pilot');
}
export async function queueSource(key: string, trigger: string): Promise<number> {
    requireSyncEnabled();
    const source = (await pool.query('SELECT * FROM mms_sync_source WHERE source_run_key=$1', [key])).rows[0];
    if (!source)
        throw new MmsSyncError('Class is not linked; run Calendar discovery first.');
    await currentEligibility(source);
    const job = (await pool.query(`INSERT INTO mms_sync_job(source_run_key,trigger) VALUES($1,$2)
    ON CONFLICT(source_run_key) WHERE state IN ('queued','running') DO UPDATE SET dirty=true,available_at=now(),updated_at=now() RETURNING id`, [key, trigger])).rows[0];
    return Number(job.id);
}
export async function discover(dryRun = false): Promise<Record<string, unknown>> {
    requireSyncEnabled();
    await ensureSchema();
    const { calendarId, events } = await calendarEvents(Number(process.env.MMS_SYNC_HORIZON_DAYS || 60));
    const result: Record<string, unknown> = { scanned: events.length, queued: 0, excluded: 0, exceptions: [] };
    const sources = new Map<string, SourceRecord>();
    for (const event of events) {
        try {
            const source = await resolveEvent(pool, calendarId, event);
            if (!source) {
                result.excluded = Number(result.excluded) + 1;
                continue;
            }
            const existing = sources.get(source.source_run_key);
            if (existing)
                existing.event_ids = [...new Set([...existing.event_ids, ...source.event_ids])];
            else
                sources.set(source.source_run_key, source);
        }
        catch (e) {
            if (e instanceof MmsSyncError && e.code === 'funded_excluded') {
                result.excluded = Number(result.excluded) + 1;
                continue;
            }
            (result.exceptions as unknown[]).push({ event_id: event.id, reason: e instanceof Error ? e.message : 'Discovery failed' });
        }
    }
    for (const source of sources.values()) {
        try {
            if (dryRun) {
                await currentEligibility(source);
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
            await queueSource(source.source_run_key, 'discovery');
            result.queued = Number(result.queued) + 1;
        }
        catch (e) {
            (result.exceptions as unknown[]).push({ source_run_key: source.source_run_key, reason: e instanceof Error ? e.message : 'Queue failed' });
        }
    }
    // Refresh known classes too: deleted/cancelled events may no longer be returned in the time window.
    if (!dryRun)
        for (const { source_run_key } of (await pool.query(`SELECT source_run_key FROM mms_sync_source
    WHERE snapshot IS NULL OR (SELECT max(session->>'date') FROM jsonb_array_elements(snapshot->'sessions') session)>=(now() AT TIME ZONE 'Asia/Singapore')::date::text`)).rows) {
            if (sources.has(source_run_key))
                continue;
            try {
                await queueSource(source_run_key, 'reconciliation');
            }
            catch (e) {
                (result.exceptions as unknown[]).push({ source_run_key, reason: e instanceof Error ? e.message : 'Reconciliation failed' });
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
}): Promise<{
    job_id: number;
    source_run_key: string;
}> {
    requireSyncEnabled();
    configuration();
    await ensureSchema();
    const source = await resolveManualSource(input);
    await register(source);
    await currentEligibility(source);
    if (input.confirm_trainer && source.masterlist_class_id) {
        const emails = (await pool.query(`SELECT DISTINCT lower(btrim(trainer_email)) email FROM masterlist_table WHERE class_id=$1 AND nullif(btrim(trainer_email),'') IS NOT NULL`, [source.masterlist_class_id])).rows;
        if (emails.length !== 1)
            throw new MmsSyncError('Confirm one explicit trainer email in the saved Master List first.');
        await pool.query('UPDATE mms_sync_source SET trainer_approved_email=$2 WHERE source_run_key=$1', [source.source_run_key, emails[0].email]);
    }
    return { job_id: await queueSource(source.source_run_key, 'manual'), source_run_key: source.source_run_key };
}
export async function processJobs(limit = 20, sourceKey: string | null = null): Promise<{
    processed: number;
    failed: number;
}> {
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
            await currentEligibility(source);
            const snapshot = await buildSnapshot(pool, source);
            snapshot.snapshot_hash = snapshotHash(snapshot);
            await db.query('BEGIN');
            const previous = (await db.query('SELECT revision,snapshot_hash FROM mms_sync_source WHERE source_run_key=$1 FOR UPDATE', [job.source_run_key])).rows[0];
            snapshot.revision = Number(previous.revision) + (previous.snapshot_hash === snapshot.snapshot_hash ? 0 : 1);
            snapshot.request_id = `${job.source_run_key}:${snapshot.revision}:${randomUUID()}`;
            const aliases = { ...source.person_aliases };
            for (const person of [...(source.snapshot?.learners || []), ...(source.snapshot?.trainers || []), ...snapshot.learners, ...snapshot.trainers])
                if (!person.source_id.startsWith('email:'))
                    aliases[person.email] = person.source_id;
            await db.query('UPDATE mms_sync_source SET revision=$2,snapshot_hash=$3,snapshot=$4::jsonb,person_aliases=$5::jsonb,updated_at=now() WHERE source_run_key=$1', [job.source_run_key, snapshot.revision, snapshot.snapshot_hash, JSON.stringify(snapshot), JSON.stringify(aliases)]);
            await db.query('COMMIT');
            // Eligibility is checked again immediately before the outbound operation.
            await currentEligibility(source);
            const response = await fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.key }, body: JSON.stringify(snapshot), signal: AbortSignal.timeout(55000) });
            const result = await response.json();
            if (!response.ok || !result.success)
                throw new MmsSyncError(result.error || `MMS returned HTTP ${response.status}`, response.status >= 500 || response.status === 408 || response.status === 429 ? 'retry' : 'needs_review');
            await db.query('UPDATE mms_sync_source SET target_result=$2::jsonb,last_success_at=now(),last_error=NULL WHERE source_run_key=$1', [job.source_run_key, JSON.stringify(result)]);
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
    return counts;
}
export async function syncStatus(filters: {
    run_uuid?: string;
    masterlist_class_id?: string;
    source_run_key?: string;
}): Promise<unknown[]> {
    if (!mmsSyncEnabled())
        return [];
    await ensureSchema();
    return (await pool.query(`SELECT s.source_run_key,s.course_code,s.revision,s.target_result,s.last_success_at,s.last_error,
    (SELECT state FROM mms_sync_job j WHERE j.source_run_key=s.source_run_key ORDER BY id DESC LIMIT 1) state
    FROM mms_sync_source s WHERE s.source_run_key=$1 OR s.tms_run_uuid::text=$2 OR s.masterlist_class_id::text=$3`, [filters.source_run_key || '', filters.run_uuid || '', filters.masterlist_class_id || ''])).rows;
}
export async function resolveManualSource(input: {
    source_run_key?: string;
    run_uuid?: string;
    masterlist_class_id?: string;
    event_id?: string;
}): Promise<SourceRecord> {
    const known = (await pool.query(`SELECT * FROM mms_sync_source WHERE source_run_key=$1 OR tms_run_uuid::text=$2 OR masterlist_class_id::text=$3`, [input.source_run_key || '', input.run_uuid || '', input.masterlist_class_id || ''])).rows;
    if (known.length > 1)
        throw new MmsSyncError('The class has multiple source mappings.');
    if (known.length) {
        await currentEligibility(known[0]);
        return known[0];
    }
    let eventId = input.event_id;
    if (input.run_uuid) {
        const rows = (await pool.query('SELECT c.course_code FROM course_run cr JOIN course c ON c.id=cr.course_id WHERE cr.id::text=$1', [input.run_uuid])).rows;
        if (rows.length !== 1)
            throw new MmsSyncError('TMS run not found.');
        assertNonFunded(rows[0].course_code);
        eventId = (await pool.query('SELECT google_event_id FROM course_run_calendar_event WHERE course_run_id::text=$1 ORDER BY event_date LIMIT 1', [input.run_uuid])).rows[0]?.google_event_id;
    }
    else if (input.masterlist_class_id) {
        const master = (await pool.query(`SELECT calendar_event_id FROM masterlist_table WHERE class_id::text=$1 AND nullif(calendar_event_id,'') IS NOT NULL`, [input.masterlist_class_id])).rows;
        if (master.length !== 1)
            throw new MmsSyncError('Save one linked Calendar event on this Master List class first.');
        eventId = String(master[0].calendar_event_id).replace(/_\d{4}-\d{2}-\d{2}$/, '');
    }
    if (!eventId)
        throw new MmsSyncError('A linked Calendar event is required.');
    const calendar = await getCalendarReadClient();
    if (!calendar)
        throw new MmsSyncError('TMS Calendar integration is disabled.', 'configuration');
    const event = (await calendar.calendar.events.get({ calendarId: calendar.calendarId, eventId })).data;
    const source = await resolveEvent(pool, calendar.calendarId, event);
    if (!source)
        throw new MmsSyncError('Funded or cancelled unlinked events cannot be imported.', 'funded_excluded');
    await currentEligibility(source);
    return source;
}
