import type { calendar_v3 } from 'googleapis';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import type { CalendarClient } from '../calendar/calendarClient';
import { extractEventCourseCode, extractEventRunId } from '../calendar/eventMatch';
import { assertNonFunded, dateInSingapore, timeInSingapore, sessionKey, validateSnapshot, MmsSyncError, type RunSnapshot, type SyncPerson, type SyncSession, type SyncTrainer } from './contract';
export interface SourceRecord {
    source_run_key: string;
    course_code: string;
    calendar_id: string;
    event_ids: string[];
    tms_run_uuid: string | null;
    masterlist_class_id: string | null;
    operational_run_id?: string | null;
    trainer_approved_email?: string;
    snapshot?: RunSnapshot;
    person_aliases?: Record<string, string>;
}
const text = (v: unknown): string => String(v ?? '').trim();
const active = (s: unknown): boolean => !/cancel|withdraw|admin removed|reject|transfer/i.test(text(s));
const confirmed = (s: unknown): boolean => /^(confirm application|confirmed|registered|enrolled|active|completed)$/i.test(text(s));
function eventCode(event: calendar_v3.Schema$Event): string | null {
    const description = text(event.description);
    return extractEventCourseCode(event) || (/^C\d[A-Z0-9-]*$/i.test(description) ? description.toUpperCase() : null);
}
async function getCalendarReadClient(): Promise<CalendarClient | null> {
    const client = await import('../calendar/calendarClient');
    return client.getCalendarReadClient();
}
export function calendarIdentity(calendarId: string, eventId: string): string {
    return `calendar:${createHash('sha256').update(calendarId).digest('hex').slice(0, 16)}:${eventId}`;
}
export async function calendarEvents(days = 60): Promise<{
    calendarId: string;
    events: calendar_v3.Schema$Event[];
}> {
    const client = await getCalendarReadClient();
    if (!client)
        throw new MmsSyncError('TMS Google Calendar integration is not configured.', 'configuration');
    const now = new Date();
    const lo = new Date(now.getTime() - 60 * 86400000);
    const hi = new Date(now.getTime() + days * 86400000);
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
        const response = await client.calendar.events.list({ calendarId: client.calendarId, timeMin: lo.toISOString(), timeMax: hi.toISOString(), singleEvents: true, showDeleted: true, maxResults: 1000, pageToken });
        events.push(...(response.data.items || []));
        pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
    return { calendarId: client.calendarId, events };
}
export async function resolveEvent(db: Pool, calendarId: string, event: calendar_v3.Schema$Event): Promise<SourceRecord | null> {
    if (!event.id || !event.start || event.status === 'cancelled')
        return null;
    const eventDate = dateInSingapore(event.start.dateTime || event.start.date || '');
    const explicitCode = eventCode(event);
    if (explicitCode?.startsWith('TGS'))
        return null;
    const externalRunId = extractEventRunId(event);
    const runResult = await db.query(`SELECT cr.id,c.course_code,to_char(cr.end_date,'YYYY-MM-DD') end_date FROM course_run cr JOIN course c ON c.id=cr.course_id
    WHERE ($1::text IS NOT NULL AND lower(cr.course_run_id)=lower($1))
       OR cr.id IN (SELECT course_run_id FROM course_run_calendar_event WHERE google_event_id=$2)`, [externalRunId, event.id]);
    if (runResult.rows.length > 1)
        throw new MmsSyncError('Calendar event matches multiple TMS runs.');
    const run = runResult.rows[0];
    const today = dateInSingapore(new Date().toISOString());
    const eventEnd = event.end?.dateTime || event.end?.date || event.start.dateTime || event.start.date || '';
    if (dateInSingapore(eventEnd) < today && (!run?.end_date || run.end_date < today))
        return null;
    if (run && explicitCode && text(run.course_code).toUpperCase() !== explicitCode)
        throw new MmsSyncError('Calendar course code conflicts with its TMS run.');
    let code = run?.course_code || explicitCode;
    if (!code)
        throw new MmsSyncError('Calendar event needs an explicit course code or exact TMS run mapping.');
    code = assertNonFunded(code);
    const master = await db.query(`SELECT DISTINCT class_id FROM masterlist_table WHERE calendar_event_id=ANY($1::text[])`, [[event.id, `${event.id}_${eventDate}`]]);
    if (master.rows.length > 1)
        throw new MmsSyncError('Calendar event matches multiple Master List classes.');
    const known = await db.query(`SELECT * FROM mms_sync_source WHERE calendar_id=$1 AND (event_ids ? $2 OR ($3::uuid IS NOT NULL AND tms_run_uuid=$3))`, [calendarId, event.id, run?.id || null]);
    if (known.rows.length > 1)
        throw new MmsSyncError('Resolve duplicate stored source mappings.');
    return { source_run_key: known.rows[0]?.source_run_key || (run ? `tms:${run.id}` : calendarIdentity(calendarId, event.id)), course_code: code, calendar_id: calendarId, event_ids: [event.id], tms_run_uuid: run?.id || known.rows[0]?.tms_run_uuid || null, masterlist_class_id: master.rows[0]?.class_id || known.rows[0]?.masterlist_class_id || null, operational_run_id: externalRunId || known.rows[0]?.operational_run_id, trainer_approved_email: known.rows[0]?.trainer_approved_email, snapshot: known.rows[0]?.snapshot, person_aliases: known.rows[0]?.person_aliases };
}
function sessionFromEvent(event: calendar_v3.Schema$Event): SyncSession {
    if (!event.start?.dateTime || !event.end?.dateTime || !event.id)
        throw new MmsSyncError('All-day Calendar entries need explicit session dates/times in TMS.');
    const date = dateInSingapore(event.start.dateTime);
    if (dateInSingapore(event.end.dateTime) !== date)
        throw new MmsSyncError('Split an overnight Calendar event into explicit class sessions.');
    return { key: sessionKey(event.id), source_id: event.id, date, start_time: timeInSingapore(event.start.dateTime), end_time: timeInSingapore(event.end.dateTime), venue: text(event.location), virtual_link: text(event.hangoutLink) || text(event.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri), mode: /virtual|online/i.test(text(event.summary)) || !!event.hangoutLink ? 2 : 1 };
}
export async function buildSnapshot(db: Pool, source: SourceRecord, readClient?: CalendarClient): Promise<RunSnapshot> {
    const code = assertNonFunded(source.course_code);
    const client = readClient || await getCalendarReadClient();
    if (!client || client.calendarId !== source.calendar_id)
        throw new MmsSyncError('Configured Calendar changed; review the stored mapping.');
    const events = await Promise.all(source.event_ids.map(eventId => client.calendar.events.get({ calendarId: source.calendar_id, eventId }).then(r => r.data)));
    const liveEvents = events.filter(e => e.status !== 'cancelled');
    for (const e of liveEvents) {
        const currentCode = eventCode(e);
        if (currentCode && assertNonFunded(currentCode) !== code)
            throw new MmsSyncError('Calendar course code changed; review mapping.');
    }
    const run = source.tms_run_uuid ? (await db.query(`SELECT to_jsonb(cr) AS run,to_jsonb(c) AS course FROM course_run cr JOIN course c ON c.id=cr.course_id WHERE cr.id=$1`, [source.tms_run_uuid])).rows[0] : null;
    if (source.tms_run_uuid && !run)
        throw new MmsSyncError('The linked TMS run is missing.');
    if (run && assertNonFunded(run.course.course_code) !== code)
        throw new MmsSyncError('TMS run code conflicts with its source mapping.');
    const course = run?.course || (await db.query('SELECT to_jsonb(c) AS course FROM course c WHERE upper(btrim(course_code))=$1', [code])).rows[0]?.course || {};
    const master = source.masterlist_class_id ? (await db.query('SELECT * FROM masterlist_table WHERE class_id=$1 ORDER BY created_at,id', [source.masterlist_class_id])).rows : [];
    if (source.masterlist_class_id && !master.length)
        throw new MmsSyncError('The linked Master List is missing; resolve its deletion before applying a roster.');
    const sessions: SyncSession[] = [];
    if (run) {
        const rows = (await db.query('SELECT to_jsonb(s) AS s FROM course_session s WHERE course_run_id=$1 AND COALESCE(deleted,false)=false ORDER BY start_date,start_time', [source.tms_run_uuid])).rows;
        for (const { s } of rows) {
            const date = dateInSingapore(text(s.start_date));
            sessions.push({ key: sessionKey(s.id), source_id: s.id, date, start_time: text(s.start_time).slice(0, 5), end_time: text(s.end_time).slice(0, 5), venue: text(s.venue?.building || run.run.venue_building), virtual_link: text(run.run.virtual_meeting_link), mode: /virtual|online/i.test(text(s.class_type || run.run.class_type)) ? 2 : 1 });
        }
    }
    if (!sessions.length)
        for (const event of (liveEvents.length ? liveEvents : events)) {
            // A cancelled event can omit its dates. Retain the last validated session list instead.
            if (event.start)
                sessions.push(sessionFromEvent(event));
        }
    if (!run && master.length && liveEvents.length === 1) {
        const entries = master.find(row => Array.isArray(row.schedule_entries) && row.schedule_entries.length)?.schedule_entries || [];
        if (entries.length) {
            const base = sessionFromEvent(liveEvents[0]);
            const exact = entries.map((s: Record<string, any>) => ({ ...base, key: sessionKey(`${source.masterlist_class_id}:${s.id}`), source_id: String(s.id), start_time: text(s.startTime).slice(0, 5), end_time: text(s.endTime).slice(0, 5) })).sort((a: SyncSession, b: SyncSession) => a.start_time.localeCompare(b.start_time));
            if (exact[0].start_time !== base.start_time || exact[exact.length - 1].end_time !== base.end_time)
                throw new MmsSyncError('Saved Master List session times conflict with Calendar; reconcile the schedule first.');
            sessions.splice(0, sessions.length, ...exact);
        }
    }
    if (!sessions.length) {
        const previous = (await db.query('SELECT snapshot FROM mms_sync_source WHERE source_run_key=$1', [source.source_run_key])).rows[0]?.snapshot;
        sessions.push(...(previous?.sessions || []));
    }
    const people = new Map<string, SyncPerson>();
    const insertPerson = async (row: Record<string, any>, emailField = 'email', nameField = 'name') => {
        const email = text(row[emailField]).toLowerCase();
        if (!email)
            throw new MmsSyncError('A confirmed learner has no email address.');
        const previousId = row.user_id || source.person_aliases?.[email] || source.snapshot?.learners.find(p => p.email === email)?.source_id;
        const personId = previousId && !String(previousId).startsWith('email:') ? previousId : null;
        const users = (await db.query(`SELECT au.id,au.full_name,au.email,au.account_status,lp.tel FROM app_user au LEFT JOIN learner_profile lp ON lp.user_id=au.id
            WHERE au.id::text=$2 OR lower(btrim(au.email))=$1`, [email, personId])).rows;
        if (users.length > 1)
            throw new MmsSyncError('Multiple TMS accounts share a learner email.');
        if (personId && (!users.length || users[0].id !== personId))
            throw new MmsSyncError('Linked TMS learner account is missing; resolve its identity before import.');
        const currentEmail = text(users[0]?.email || email).toLowerCase();
        people.set(currentEmail, { source_id: users[0]?.id || `email:${email}`, email: currentEmail, name: text(users[0]?.full_name || row[nameField]) || currentEmail, phone: text(users[0]?.tel || row.contact_no || row.trainee_phone), active: !users[0] || !/inactive|suspend|block|disabl|deactiv/i.test(text(users[0].account_status)) });
    };
    let complete = false;
    if (run) {
        const enrollments = (await db.query(`SELECT to_jsonb(e) AS e,au.email,au.full_name FROM enrollment e JOIN app_user au ON au.id=e.user_id WHERE e.course_run_id=$1`, [source.tms_run_uuid])).rows;
        for (const row of enrollments)
            if (active(row.e.enrolment_status))
                await insertPerson({ email: row.email, name: row.full_name, user_id: row.e.user_id });
        for (const table of ['da_application', 'company_application']) {
            const rows = (await db.query(`SELECT to_jsonb(a) AS a FROM ${table} a WHERE course_run_id=$1`, [run.run.course_run_id])).rows;
            for (const { a } of rows)
                if (confirmed(a.application_status) && active(a.enrolment_status))
                    await insertPerson(a, 'trainee_email', 'trainee_name');
        }
        complete = true;
    }
    else if (master.length) {
        // Persisted Master List is the explicit operational roster for calendar-only classes.
        for (const row of master)
            if (!row.cancelled && (text(row.email) || text(row.name)))
                await insertPerson(row);
        complete = true;
    }
    else if (source.operational_run_id) {
        // Explicit source run reference + exact code; never use a fuzzy title/date roster match.
        for (const table of ['da_application', 'company_application']) {
            const rows = (await db.query(`SELECT to_jsonb(a) AS a FROM ${table} a WHERE lower(course_run_id)=lower($1) AND upper(btrim(course_reference_number))=$2`, [source.operational_run_id, code])).rows;
            if (rows.length)
                complete = true;
            for (const { a } of rows)
                if (confirmed(a.application_status) && active(a.enrolment_status))
                    await insertPerson(a, 'trainee_email', 'trainee_name');
        }
    }
    const trainers: SyncTrainer[] = [];
    if (run) {
        const assignments = (await db.query('SELECT to_jsonb(t) AS t FROM course_run_trainer t WHERE course_run_id=$1', [source.tms_run_uuid])).rows.map(r => r.t);
        if (!assignments.length && run.run.assigned_trainer_email)
            assignments.push({ trainer_email: run.run.assigned_trainer_email, trainer_name: run.run.assigned_trainer_name, trainer_id: run.run.assigned_trainer_id });
        for (const t of assignments)
            trainers.push({ source_id: t.trainer_id || `email:${text(t.trainer_email).toLowerCase()}`, email: text(t.trainer_email), name: text(t.trainer_name), confirmed: true });
        const perSession = (await db.query(`SELECT DISTINCT lower(btrim(trainer_email)) email FROM course_session WHERE course_run_id=$1 AND COALESCE(deleted,false)=false AND nullif(btrim(trainer_email),'') IS NOT NULL`, [source.tms_run_uuid])).rows;
        if (perSession.some(r => !trainers.some(t => t.email.toLowerCase() === r.email)))
            throw new MmsSyncError('Per-session trainer overrides require review before delivery support is enabled.');
    }
    else {
        const emails = [...new Set(master.map(r => text(r.trainer_email).toLowerCase()).filter(Boolean))];
        if (emails.length > 1)
            throw new MmsSyncError('Master List contains conflicting trainers.');
        if (emails.length)
            trainers.push({ source_id: `email:${emails[0]}`, email: emails[0], name: text(master[0]?.trainer), confirmed: source.trainer_approved_email === emails[0] });
    }
    for (const trainer of trainers) {
        const priorId = source.person_aliases?.[trainer.email.toLowerCase()] || source.snapshot?.trainers.find(p => p.email === trainer.email.toLowerCase())?.source_id;
        const personId = !trainer.source_id.startsWith('email:') ? trainer.source_id : priorId && !priorId.startsWith('email:') ? priorId : null;
        const rows = (await db.query(`SELECT au.id,au.full_name,au.email,au.account_status,tp.tel,EXISTS (SELECT 1 FROM user_role_map r WHERE r.user_id=au.id AND r.role='Trainer') AS is_trainer FROM app_user au LEFT JOIN trainer_profile tp ON tp.user_id=au.id
            WHERE au.id::text=$2 OR lower(btrim(au.email))=$1`, [trainer.email.toLowerCase(), personId])).rows;
        if (rows.length !== 1 || personId && rows[0].id !== personId)
            throw new MmsSyncError('Trainer needs one verified TMS account with the Trainer role.');
        trainer.source_id = rows[0].id;
        trainer.name = rows[0].full_name;
        trainer.email = rows[0].email;
        trainer.active = rows[0].is_trainer !== false && !/inactive|suspend|block|disabl|deactiv/i.test(text(rows[0].account_status));
        trainer.phone = text(rows[0].tel);
    }
    const courseware: Record<string, string> = {};
    for (const [target, field] of Object.entries({ learner_guide_url: 'learner_guide_url', learner_slides_url: 'slides_url', trainer_slides_url: 'trainer_slides_url', lesson_plan_url: 'lesson_plan_url', lab_url: 'activities_url', courseware_link: 'courseware_link', brochure_link: 'brochure_link' }))
        if (text(course[field]))
            courseware[target] = text(course[field]);
    const feedbackTemplate = text(process.env.MMS_SYNC_FEEDBACK_URL_TEMPLATE);
    const feedback = (!source.tms_run_uuid && feedbackTemplate.includes('{run_uuid}')) ? '' : feedbackTemplate.replace('{run_uuid}', source.tms_run_uuid || '').replace('{source_run_key}', encodeURIComponent(source.source_run_key));
    return validateSnapshot({ schema_version: 1, source_provider_id: process.env.MMS_SYNC_PROVIDER_ID || 'tertiary-sg', source_run_key: source.source_run_key, website_id: Number(process.env.MMS_SYNC_WEBSITE_ID || 1), course_code: code, course_title: text(course.title || master[0]?.course_title || events[0]?.summary), tms_run_uuid: source.tms_run_uuid || undefined, calendar_id: source.calendar_id, event_occurrences: source.event_ids, revision: 0, request_id: '', snapshot_hash: '', snapshot_at: new Date().toISOString(), roster_complete: complete, cancelled: liveEvents.length === 0 || !!run?.run.is_deleted || /cancel/i.test(text(run?.run.class_status)) || !!master.length && master.every(r => r.cancelled), sessions, trainers, learners: [...people.values()], feedback_url: feedback, courseware });
}
