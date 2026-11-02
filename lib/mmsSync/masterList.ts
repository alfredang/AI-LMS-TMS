import type { Pool } from 'pg';
import { assertNonFunded, dateInSingapore, sessionKey, validateSnapshot, MmsSyncError, type RunSnapshot, type SyncPerson, type SyncSession, type SyncTrainer } from './contract';
import type { SourceRecord } from './source';
import { getMmsRuntimeConfig } from './runtimeConfig';

const text = (v: unknown) => v instanceof Date ? dateInSingapore(v.toISOString()) : String(v ?? '').trim();
const emailValid = (v: string) => v.length <= 128 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
type Row = Record<string, any>;
export function masterListDates(row: Row): string[] {
    const raw = text(row.class_date) || text(row.entry_date);
    const iso = raw.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
    const local = [...raw.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)].map(m => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    const dates = [...iso, ...local];
    if (!dates.length && row.list_date) dates.push(dateInSingapore(text(row.list_date)));
    return [...new Set(dates.filter(d => { const n = new Date(`${d}T00:00:00Z`); return Number.isFinite(n.getTime()) && n.toISOString().slice(0, 10) === d; }))].sort();
}
export function masterListCode(row: Row): string {
    const explicit = text(row.course_code).toUpperCase();
    if (explicit) return explicit;
    return (text(row.course_run_no).match(/\b(?:TGS-[A-Z0-9-]+|C\d[A-Z0-9-]*)\b/i)?.[0] || text(row.course_title).match(/\b(?:TGS-[A-Z0-9-]+|C\d[A-Z0-9-]*)\b/i)?.[0] || '').toUpperCase();
}

/** Saved Master List classes are the source, including blank participant slots. */
export async function masterListSources(db: Pool, options: { persistCodes?: boolean; exceptions?: unknown[] } = {}): Promise<SourceRecord[]> {
    const rows = (await db.query('SELECT * FROM masterlist_table ORDER BY created_at,id')).rows;
    const known = (await db.query('SELECT * FROM mms_sync_source')).rows;
    const courses = (await db.query('SELECT id,course_code,title FROM course')).rows;
    const runs = (await db.query('SELECT cr.id,cr.course_run_id,c.course_code FROM course_run cr JOIN course c ON c.id=cr.course_id')).rows;
    const groups = new Map<string, SourceRecord>();
    const today = dateInSingapore(new Date().toISOString());
    for (const row of rows) {
        const eventId = text(row.calendar_event_id).replace(/_\d{4}-\d{2}-\d{2}$/, '');
        const previous = known.find(s => s.masterlist_class_id === row.class_id || s.masterlist_class_ids?.includes(row.class_id));
        const run = runs.find(r => text(r.course_run_id).toLowerCase() === text(row.course_run_no).toLowerCase() && text(row.course_run_no));
        let code = masterListCode(row) || run?.course_code || previous?.course_code || '';
        if (!code) {
            const exact = courses.filter(c => text(c.title).toLowerCase() === text(row.course_title).toLowerCase());
            if (exact.length === 1) code = exact[0].course_code;
        }
        if (!code) { options.exceptions?.push({ masterlist_class_id: row.class_id, reason: 'Master List class needs a course code; no unique LMS catalogue match exists.' }); continue; }
        try { code = assertNonFunded(code); } catch { continue; }
        const dates = masterListDates(row);
        if (dates.length && dates[dates.length - 1] < today) continue;
        if (options.persistCodes !== false && row.course_code !== code) await db.query('UPDATE masterlist_table SET course_code=$2 WHERE id=$1', [row.id, code]);
        const identity = `${code}:${dates[0] || ''}:${dates[dates.length - 1] || ''}:${dates.length ? '' : row.class_id}`;
        const grouped = groups.get(identity);
        if (grouped) {
            grouped.masterlist_class_ids = [...new Set([...(grouped.masterlist_class_ids || []), row.class_id])];
            grouped.event_ids = [...new Set([...grouped.event_ids, ...(eventId ? [eventId] : [])])];
            if (run && text(run.course_code).toUpperCase() === code && !grouped.tms_run_uuid) { grouped.tms_run_uuid=run.id; grouped.operational_run_id=run.course_run_id; }
        } else {
            const linkedRun = runs.find(r => r.id === (run?.id || previous?.tms_run_uuid) && text(r.course_code).toUpperCase() === code);
            groups.set(identity, { ...previous, source_run_key: previous?.course_code === code ? previous.source_run_key : `masterlist:${row.class_id}${previous ? `:${code}` : ''}`, course_code: code, calendar_id: previous?.calendar_id || 'masterlist',
                event_ids: eventId ? [eventId] : [], tms_run_uuid: linkedRun?.id || null, operational_run_id: linkedRun?.course_run_id || text(row.course_run_no) || null, masterlist_class_id: row.class_id, masterlist_class_ids: [row.class_id] });
        }
    }
    return [...groups.values()];
}

export async function buildMasterListSnapshot(db: Pool, source: SourceRecord): Promise<RunSnapshot> {
    const ids = source.masterlist_class_ids?.length ? source.masterlist_class_ids : [source.masterlist_class_id];
    const rows: Row[] = (await db.query('SELECT * FROM masterlist_table WHERE class_id=ANY($1::uuid[]) ORDER BY updated_at DESC,id', [ids])).rows;
    if (!rows.length) throw new MmsSyncError('Master List class no longer exists.');
    const code = assertNonFunded(source.course_code);
    for (const row of rows) if (masterListCode(row) && assertNonFunded(masterListCode(row)) !== code) throw new MmsSyncError('Master List course code changed.');
    const course = (await db.query('SELECT to_jsonb(c) AS course FROM course c WHERE upper(btrim(course_code))=$1', [code])).rows[0]?.course || {};
    const dates = [...new Set(rows.flatMap(masterListDates))].sort();
    const sessions = new Map<string, SyncSession>();
    const learners = new Map<string, SyncPerson>();
    const trainers = new Map<string, SyncTrainer>();
    const pending_learners: NonNullable<RunSnapshot['pending_learners']> = [];
    const pending_trainers: NonNullable<RunSnapshot['pending_trainers']> = [];
    const pending_sessions: Record<string, unknown>[] = [];
    const notes: string[] = [];
    for (const row of rows) {
        let entries = row.schedule_entries || [];
        if (typeof entries === 'string') { try { entries = JSON.parse(entries); } catch { entries = []; } }
        for (const entry of Array.isArray(entries) ? entries : []) {
            const date = row.list_date ? dateInSingapore(text(row.list_date)) : masterListDates(row)[0];
            const start = text(entry.startTime).slice(0, 5), end = text(entry.endTime).slice(0, 5);
            if (!date || ![start, end].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || end <= start) { pending_sessions.push({ ...entry, class_id: row.class_id, date: date || null }); continue; }
            const identity = `${date}:${start}:${end}`;
            const sourceId = `${row.class_id}:${text(entry.id) || identity}`;
            sessions.set(identity, { key: sessionKey(sourceId), source_id: sourceId, date, start_time: start, end_time: end, venue: text(row.venue), virtual_link: /^https?:\/\//i.test(text(row.zoom_id)) ? text(row.zoom_id) : '', mode: row.class_type === 'virtual' ? 2 : 1 });
        }
        if (!row.cancelled && (text(row.email) || text(row.name))) {
            const email = text(row.email).toLowerCase();
            const person = { source_id: `email:${email || row.id}`, email, name: text(row.name), phone: text(row.contact_no) };
            if (emailValid(email)) learners.set(email, person); else pending_learners.push(person);
        }
    }
    // Latest saved class header wins when repeated Master List headers differ.
    const header = rows[0];
    const trainerEmail = text(header.trainer_email).toLowerCase();
    if (trainerEmail || text(header.trainer)) {
        if (emailValid(trainerEmail)) trainers.set(trainerEmail, { source_id: `email:${trainerEmail}`, email: trainerEmail, name: text(header.trainer), confirmed: true });
        else pending_trainers.push({ name: text(header.trainer), email: trainerEmail });
    }
    // Consolidate LMS enrolments and applications with the saved Master List roster.
    if (source.tms_run_uuid) {
        const run = (await db.query('SELECT to_jsonb(cr) run FROM course_run cr JOIN course c ON c.id=cr.course_id WHERE cr.id=$1 AND upper(btrim(c.course_code))=$2', [source.tms_run_uuid, code])).rows[0]?.run;
        if (run) {
            const enrolled = (await db.query(`SELECT au.id,au.email,au.full_name FROM enrollment e JOIN app_user au ON au.id=e.user_id WHERE e.course_run_id=$1 AND COALESCE(e.enrolment_status,'') !~* 'cancel|withdraw|reject|transfer|admin removed'`, [source.tms_run_uuid])).rows;
            for (const p of enrolled) if (emailValid(text(p.email))) learners.set(text(p.email).toLowerCase(), { source_id: p.id, email: text(p.email).toLowerCase(), name: text(p.full_name) });
            trainers.clear(); pending_trainers.splice(0);
            const assignments = (await db.query('SELECT to_jsonb(t) t FROM course_run_trainer t WHERE course_run_id=$1', [source.tms_run_uuid])).rows.map(r => r.t);
            if (!assignments.length && (run.assigned_trainer_email || run.assigned_trainer_name)) assignments.push({ trainer_id: run.assigned_trainer_id, trainer_email: run.assigned_trainer_email, trainer_name: run.assigned_trainer_name });
            const sessionRows = (await db.query("SELECT to_jsonb(s) s FROM course_session s WHERE course_run_id=$1 AND COALESCE(deleted,false)=false ORDER BY start_date,start_time", [source.tms_run_uuid])).rows;
            for (const { s } of sessionRows) {
                const date = s.start_date ? dateInSingapore(text(s.start_date)) : '';
                const start = text(s.start_time).slice(0, 5), end = text(s.end_time).slice(0, 5);
                if (date && [start, end].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) && end > start) {
                    const identity = `${date}:${start}:${end}`;
                    sessions.set(identity, { key: sessionKey(String(s.id)), source_id: String(s.id), date, start_time: start, end_time: end, venue: text(s.venue?.building || run.venue_building), virtual_link: text(run.virtual_meeting_link), mode: /virtual|online/i.test(text(s.class_type || run.class_type)) ? 2 : 1 });
                }
                if (s.trainer_email) assignments.push({ trainer_id: s.trainer_id, trainer_email: s.trainer_email, trainer_name: s.trainer_name, session_keys: [sessionKey(String(s.id))] });
            }
            for (const t of assignments) {
                const email = text(t.trainer_email).toLowerCase();
                if (emailValid(email)) {
                    const existing = trainers.get(email);
                    trainers.set(email, { source_id: t.trainer_id || existing?.source_id || `email:${email}`, email, name: text(t.trainer_name), confirmed: true, ...(t.session_keys ? { session_keys: [...new Set([...(existing?.session_keys || []), ...t.session_keys])] } : {}) });
                } else pending_trainers.push({ name: text(t.trainer_name), email });
            }
            if (run.start_date) dates.push(dateInSingapore(text(run.start_date)));
            if (run.end_date) dates.push(dateInSingapore(text(run.end_date)));
            dates.sort();
        }
    }
    if (source.operational_run_id) for (const table of ['da_application', 'company_application']) {
        const applications = (await db.query(`SELECT to_jsonb(a) a FROM ${table} a WHERE lower(course_run_id)=lower($1) AND upper(btrim(course_reference_number))=$2`, [source.operational_run_id, code])).rows;
        for (const { a } of applications) if (!/cancel|withdraw|reject|transfer/i.test(`${a.application_status} ${a.enrolment_status}`)) {
            const email = text(a.trainee_email).toLowerCase();
            if (!emailValid(email)) pending_learners.push({ source_id: `${table}:${a.id}`, email, name: text(a.trainee_name), phone: text(a.trainee_phone) });
            else if (!learners.has(email)) learners.set(email, { source_id: `email:${email}`, email, name: text(a.trainee_name), phone: text(a.trainee_phone) });
        }
    }
    if (!sessions.size) notes.push('Session dates/times are pending in LMS.');
    if (pending_learners.length) notes.push('Some learner details are pending; the class is synchronized.');
    // Keep profile corrections linked to the same person across revisions.
    for (const person of [...learners.values(), ...trainers.values()]) {
        const prior = source.person_aliases?.[person.email] || source.snapshot?.learners.find(p => p.email === person.email)?.source_id || source.snapshot?.trainers.find(p => p.email === person.email)?.source_id;
        const id = !person.source_id.startsWith('email:') ? person.source_id : prior && !prior.startsWith('email:') ? prior : null;
        const users = (await db.query('SELECT id,email,full_name,account_status FROM app_user WHERE id::text=$2 OR lower(btrim(email))=$1 ORDER BY id', [person.email, id])).rows;
        if (users.length === 1 && emailValid(text(users[0].email))) {
            person.source_id = users[0].id;
            person.email = text(users[0].email).toLowerCase();
            person.name = text(users[0].full_name) || person.name;
            person.active = !/inactive|suspend|block|disabl|deactiv/i.test(text(users[0].account_status));
        } else if (users.length > 1) notes.push(`Account identity needs review for ${person.email}; class data is synchronized.`);
    }
    const courseware: Record<string, string> = {};
    for (const [target, field] of Object.entries({ learner_guide_url: 'learner_guide_url', learner_slides_url: 'slides_url', trainer_slides_url: 'trainer_slides_url', lesson_plan_url: 'lesson_plan_url', lab_url: 'activities_url', courseware_link: 'courseware_link', brochure_link: 'brochure_link' }))
        if (text(course[field])) courseware[target] = text(course[field]);
    const template = getMmsRuntimeConfig().feedbackUrlTemplate;
    return validateSnapshot({ schema_version: 2, source_provider_id: getMmsRuntimeConfig().providerId, source_run_key: source.source_run_key, website_id: getMmsRuntimeConfig().websiteId,
        course_code: code, course_title: text(header.course_title || course.title) || code, class_start_date: dates[0] || null, class_end_date: dates[dates.length - 1] || null,
        calendar_id: source.calendar_id, event_occurrences: source.event_ids, revision: 0, request_id: '', snapshot_hash: '', snapshot_at: new Date().toISOString(),
        roster_complete: !pending_learners.length, cancelled: rows.every(r => r.class_type === 'cancelled'), sessions: [...sessions.values()], trainers: [...trainers.values()], learners: [...learners.values()],
        pending_learners, pending_trainers, pending_sessions, class_details: { venue: text(header.venue), virtual_link: /^https?:\/\//i.test(text(header.zoom_id)) ? text(header.zoom_id) : '', mode: header.class_type === 'virtual' ? 2 : 1, notes: text(header.notes), zoom_id: text(header.zoom_id), meeting_id: text(header.meeting_id) }, source_notes: notes, feedback_url: !source.tms_run_uuid && template.includes('{run_uuid}') ? '' : template.replace('{run_uuid}', source.tms_run_uuid || '').replace('{source_run_key}', encodeURIComponent(source.source_run_key)), courseware });
}
