import pool from '../db';
import { getCalendarClient } from '../calendar/calendarClient';
import { getAccessContext } from './accessContext';
import { MmsSyncError } from './contract';
import { normalizeCode } from './contract';
import { extractEventCourseCode } from '../calendar/eventMatch';

export function calendarAccessDescription(description: string, classUrl: string): string {
    const origins = new Set(['https://lms-tms.tertiaryinfotech.com']);
    for (const base of [process.env.NEXT_PUBLIC_BASE_URL, process.env.NEXT_PUBLIC_APP_URL]) {
        try { if (base) origins.add(new URL(base).origin); } catch { /* malformed legacy setting is not a rewrite target */ }
    }
    // Replace login-root links only, never TMS acceptance/feedback/admin URLs.
    const clean = description.replace(/\n?\[MMS CLASS ACCESS\][\s\S]*?\[\/MMS CLASS ACCESS\]/g, '')
        .replace(/https?:\/\/[^\s<>"']+/g, value => {
            try { const url = new URL(value); return origins.has(url.origin) && url.pathname === '/' && !url.search && !url.hash ? classUrl : value; }
            catch { return value; }
        });
    return `${clean.trim()}\n\n[MMS CLASS ACCESS]\nClass delivery: MMS\nOpen MMS class: ${classUrl}\n[/MMS CLASS ACCESS]`;
}
export async function updateAccessCalendar(sourceKey: string) {
    if (process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED !== 'true') return;
    const context = await getAccessContext({ sourceKey });
    if (context.platform !== 'mms' || context.state !== 'ready' || !context.snapshot) return;
    const client = await getCalendarClient();
    if (!client || client.calendarId !== context.snapshot.calendar_id) throw new MmsSyncError('Calendar access-link update is disabled or its calendar scope changed.');
    for (const eventId of context.snapshot.event_occurrences) {
        const event = (await client.calendar.events.get({ calendarId: client.calendarId, eventId })).data;
        if (event.status === 'cancelled') continue;
        const currentCode = normalizeCode(extractEventCourseCode(event));
        if (currentCode && currentCode !== context.snapshot.course_code) throw new MmsSyncError('Calendar course classification changed; do not rewrite this event.', currentCode.startsWith('TGS') ? 'funded_excluded' : 'needs_review');
        const description = calendarAccessDescription(event.description || '', context.class_url!);
        if (description !== event.description) {
            const current = await getAccessContext({ sourceKey });
            if (current.platform !== 'mms' || current.state !== 'ready' || current.snapshot?.snapshot_hash !== context.snapshot.snapshot_hash) throw new MmsSyncError('Class changed before Calendar access update.');
            await client.calendar.events.patch({ calendarId: client.calendarId, eventId, requestBody: { description }, sendUpdates: 'none' }, event.etag ? { headers: { 'If-Match': event.etag } } : {});
        }
    }
    await pool.query('UPDATE mms_sync_source SET access_calendar_error=NULL WHERE source_run_key=$1', [sourceKey]);
}
