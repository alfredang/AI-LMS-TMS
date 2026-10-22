import { createHash, randomUUID } from 'node:crypto';
import pool from '../db';
import { accessMessage, recipients, withApproval, type AccessContext } from './accessPolicy';
import { getAccessContext } from './accessContext';
import { MmsSyncError, snapshotHash } from './contract';
import { buildSnapshot } from './source';
import { emailService } from '../services/emailService';
import { getMmsRuntimeConfig, loadMmsRuntimeConfig } from './runtimeConfig';

export const notificationsEnabled = () => getMmsRuntimeConfig().enabled && getMmsRuntimeConfig().notificationsEnabled;
export async function accessSupport(): Promise<string> {
    const row = (await pool.query('SELECT to_jsonb(tp) tp FROM training_provider tp ORDER BY created_at ASC NULLS LAST LIMIT 1')).rows[0]?.tp || {};
    const support = getMmsRuntimeConfig().accessSupport || row.support_email || row.company_email || row.company_tel;
    if (!support || /[\r\n]/.test(support)) throw new MmsSyncError('Configure the MMS access support contact.');
    return String(support);
}
export async function previewAccess(sourceKey: string, courseCode?: string) {
    const context = await getAccessContext({ sourceKey, courseCode });
    const source = (await pool.query('SELECT * FROM mms_sync_source WHERE source_run_key=$1', [sourceKey])).rows[0];
    const status = (await pool.query('SELECT id,person_id,role,email,kind,state,attempts,sent_at,last_error,created_at FROM mms_access_notification WHERE source_run_key=$1 ORDER BY id DESC LIMIT 300', [sourceKey])).rows;
    const support = context.state === 'ready' ? await accessSupport() : '';
    return { enabled: notificationsEnabled(), context, status, messages: context.snapshot ? recipients(context.snapshot).map(person => ({ person_id: person.source_id, email: person.email, role: person.role, ...accessMessage(context, person, support) })) : [], approval: source ? { approved_at: source.approved_at, first_session_at: source.first_session_at, handover_at: source.handover_at } : null };
}
async function enqueue(context: AccessContext, actor = 'automatic', resendPerson?: { id: string; role: string }) {
    if (context.state !== 'ready' || !context.snapshot || !context.source_run_key) return;
    if (!resendPerson && context.snapshot.sessions.every(s => new Date(`${s.date}T${s.end_time}:00+08:00`).getTime() < Date.now())) return;
    for (const person of recipients(context.snapshot)) {
        if (resendPerson && (person.source_id !== resendPerson.id || person.role !== resendPerson.role)) continue;
        const previous = (await pool.query(`SELECT email FROM mms_access_notification WHERE source_run_key=$1 AND person_id=$2 AND role=$3 AND kind='initial' ORDER BY id LIMIT 1`, [context.source_run_key, person.source_id, person.role])).rows[0];
        const generation = resendPerson ? randomUUID() : previous && previous.email !== person.email ? `email:${createHash('sha256').update(person.email).digest('hex')}` : 'initial';
        await pool.query(`INSERT INTO mms_access_notification(source_run_key,person_id,role,email,kind,generation,actor,revision,destination)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
            [context.source_run_key, person.source_id, person.role, person.email, resendPerson ? 'resend' : 'initial', generation, actor, context.snapshot.revision, context.class_url]);
    }
}
export async function recoverAccessNotifications(sourceKey: string | null = null): Promise<void> {
    await loadMmsRuntimeConfig();
    if (!getMmsRuntimeConfig().enabled) return;
    const sources = (await pool.query(`SELECT * FROM mms_sync_source WHERE approved_at IS NOT NULL AND ($1::text IS NULL OR source_run_key=$1)`, [sourceKey])).rows;
    for (const source of sources) {
        const people = source.delivery_platform === 'mms' && source.snapshot ? recipients(source.snapshot) : [];
        const pending = (await pool.query("SELECT id,person_id,role,email FROM mms_access_notification WHERE source_run_key=$1 AND state IN ('pending','failed')", [source.source_run_key])).rows;
        for (const row of pending) if (!people.some(p => p.source_id === row.person_id && p.role === row.role && p.email === row.email))
            await pool.query("UPDATE mms_access_notification SET state='cancelled',last_error='Participant, email or delivery platform changed',updated_at=now() WHERE id=$1 AND state IN ('pending','failed')", [row.id]);
        const context = await getAccessContext({ sourceKey: source.source_run_key, courseCode: source.course_code });
        if (context.platform === 'tms') {
            await pool.query("UPDATE mms_access_notification SET state='cancelled',last_error='Run uses the existing TMS workflow; MMS access is excluded',updated_at=now() WHERE source_run_key=$1 AND state IN ('pending','failed')", [source.source_run_key]);
            continue;
        }
        await enqueue(context);
        if (notificationsEnabled() && context.state === 'ready') {
            try { const { updateAccessCalendar } = await import('./accessCalendar'); await updateAccessCalendar(source.source_run_key); }
            catch (e) { await pool.query('UPDATE mms_sync_source SET access_calendar_error=$2 WHERE source_run_key=$1', [source.source_run_key, e instanceof Error ? e.message : 'Calendar access update failed']); }
        }
    }
}
export async function requestAccessSend(sourceKey: string, actor: string, resend?: { id: string; role: string }) {
    const context = await getAccessContext({ sourceKey });
    if (context.platform !== 'mms' || context.state !== 'ready') throw new MmsSyncError(context.reason || 'MMS class access is not ready.');
    if (!notificationsEnabled()) throw new MmsSyncError('MMS access sending is disabled. Preview remains available.');
    if (resend && !recipients(context.snapshot!).some(p => p.source_id === resend.id && p.role === resend.role)) throw new MmsSyncError('The selected recipient is no longer assigned.');
    await enqueue(context, actor, resend);
    return dispatchAccessNotifications(20, sourceKey);
}
export async function dispatchAccessNotifications(limit = 20, sourceKey: string | null = null) {
    await loadMmsRuntimeConfig();
    if (!notificationsEnabled()) return { sent: 0, skipped: true, reason: 'MMS access sending is disabled.' };
    // A worker crash after sending cannot be retried automatically: delivery may have succeeded.
    await pool.query("UPDATE mms_access_notification SET state='review',last_error='Worker stopped during send; check mail-service acceptance before resending',updated_at=now() WHERE state='sending' AND leased_at<now()-interval '5 minutes'");
    let sent = 0;
    for (let index = 0; index < limit; index++) {
        const db = await pool.connect();
        let key: string | undefined;
        let locked = false;
        let id: string | undefined;
        let attemptedSend = false;
        try {
            const candidate = (await db.query(`SELECT * FROM mms_access_notification WHERE state='pending' AND available_at<=now() AND ($1::text IS NULL OR source_run_key=$1) ORDER BY id LIMIT 1`, [sourceKey])).rows[0];
            if (!candidate) break;
            key = candidate.source_run_key;
            locked = !!(await db.query('SELECT pg_try_advisory_lock(hashtext($1)) locked', [`mms:${key}`])).rows[0].locked;
            if (!locked) break;
            const context = await getAccessContext({ sourceKey: key });
            if (context.platform !== 'mms' || context.state !== 'ready') {
                await db.query("UPDATE mms_access_notification SET state=$3,available_at=now()+interval '1 minute',last_error=$2 WHERE id=$1 AND state='pending'", [candidate.id, context.reason || 'MMS access is awaiting readiness or is excluded for this run', context.platform === 'tms' ? 'cancelled' : 'pending']);
                continue;
            }
            const source = (await db.query('SELECT * FROM mms_sync_source WHERE source_run_key=$1', [key])).rows[0];
            const fresh = withApproval(await buildSnapshot(pool, source), source);
            fresh.snapshot_hash = snapshotHash(fresh);
            if (snapshotHash(fresh) !== source.snapshot_hash) {
                const { queueSource } = await import('./service');
                await queueSource(key!, 'access-readiness');
                await db.query("UPDATE mms_access_notification SET available_at=now()+interval '1 minute',last_error='Source changed; waiting for MMS reconciliation' WHERE id=$1", [candidate.id]);
                continue;
            }
            const person = recipients(fresh).find(p => p.source_id === candidate.person_id && p.role === candidate.role && p.email === candidate.email);
            if (!person || candidate.kind === 'initial' && fresh.sessions.every(s => new Date(`${s.date}T${s.end_time}:00+08:00`).getTime() < Date.now())) {
                await db.query("UPDATE mms_access_notification SET state='cancelled',last_error='Participant is no longer eligible',updated_at=now() WHERE id=$1 AND state='pending'", [candidate.id]);
                continue;
            }
            const message = accessMessage(context, person, await accessSupport());
            const claimed = (await db.query("UPDATE mms_access_notification SET state='sending',leased_at=now(),attempts=attempts+1,rendered=$2::jsonb,revision=$3,destination=$4,updated_at=now() WHERE id=$1 AND state='pending' RETURNING id", [candidate.id, JSON.stringify(message), source.revision, context.class_url])).rows[0];
            if (!claimed) continue;
            id = String(claimed.id);
            // Final queue/classification check after rendering, immediately before the outbound operation.
            const current = await getAccessContext({ sourceKey: key });
            if (current.state !== 'ready' || current.platform !== 'mms' || current.snapshot?.snapshot_hash !== fresh.snapshot_hash) {
                await db.query("UPDATE mms_access_notification SET state='pending',available_at=now()+interval '1 minute',last_error='Source changed before send' WHERE id=$1", [id]);
                continue;
            }
            if (!notificationsEnabled()) {
                await db.query("UPDATE mms_access_notification SET state='pending',last_error='Sending disabled before dispatch' WHERE id=$1", [id]);
                break;
            }
            attemptedSend = true;
            const result = await emailService.sendEmail({ to: person.email, ...message, avoidDuplicateRetry: true, messageId: `<mms-access-${id}@${new URL(current.login_url!).hostname}>` });
            const state = result.success ? 'sent' : result.uncertain ? 'review' : result.retryable && candidate.attempts < 4 ? 'pending' : 'failed';
            await db.query(`UPDATE mms_access_notification SET state=$2,message_id=$3,last_error=$4,sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END,available_at=now()+interval '1 minute',updated_at=now() WHERE id=$1`, [id, state, result.messageId || null, result.error?.slice(0, 1000) || null]);
            if (result.success) sent++;
        } catch (e) {
            if (id) await db.query("UPDATE mms_access_notification SET state=$2,last_error=$3,updated_at=now() WHERE id=$1", [id, attemptedSend ? 'review' : 'failed', e instanceof Error ? e.message.slice(0, 1000) : 'Access notification failed']);
            else if (key) await db.query("UPDATE mms_access_notification SET available_at=now()+interval '1 minute',last_error=$2 WHERE source_run_key=$1 AND state='pending'", [key, e instanceof Error ? e.message.slice(0, 1000) : 'Access readiness failed']);
        } finally {
            if (locked) await db.query('SELECT pg_advisory_unlock(hashtext($1))', [`mms:${key}`]);
            db.release();
        }
    }
    return { sent };
}
