import { createHash } from 'node:crypto';
export class MmsSyncError extends Error {
    constructor(message: string, public readonly code = 'needs_review') { super(message); }
}
export const normalizeCode = (code: unknown): string => String(code ?? '').trim().toUpperCase();
export function assertNonFunded(code: unknown): string {
    const value = normalizeCode(code);
    if (!value)
        throw new MmsSyncError('Resolve the course code before synchronizing.');
    if (value.startsWith('TGS'))
        throw new MmsSyncError('Funded TGS courses are excluded from MMS handover.', 'funded_excluded');
    if (!/^C\d[A-Z0-9-]*$/.test(value))
        throw new MmsSyncError(`MMS delivery does not yet support ${value}.`, 'unsupported_code');
    return value;
}
export interface SyncPerson {
    source_id: string;
    email: string;
    name: string;
    phone?: string;
    active?: boolean;
}
export interface SyncTrainer extends SyncPerson {
    confirmed: boolean;
    session_keys?: string[];
}
export interface SyncSession {
    key: string;
    source_id: string;
    date: string;
    start_time: string;
    end_time: string;
    venue: string;
    virtual_link: string;
    mode: number;
}
export interface RunSnapshot {
    schema_version: 1;
    source_provider_id: string;
    source_run_key: string;
    website_id: number;
    course_code: string;
    course_title: string;
    tms_run_uuid?: string;
    calendar_id: string;
    event_occurrences: string[];
    revision: number;
    request_id: string;
    snapshot_hash: string;
    snapshot_at: string;
    roster_complete: boolean;
    cancelled: boolean;
    sessions: SyncSession[];
    trainers: SyncTrainer[];
    learners: SyncPerson[];
    feedback_url: string;
    courseware: Record<string, string>;
    handover_approval?: { approved_at: string; approved_by: string; first_session_at: string };
}
export function dateInSingapore(input: string): string {
    // TMS course_session stores SSG dates as YYYYMMDD; Calendar uses ISO.
    if (/^\d{8}$/.test(input)) input = `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(input))
        return input;
    const date = new Date(input);
    if (!Number.isFinite(date.getTime()))
        throw new MmsSyncError('Invalid class date.');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function timeInSingapore(input: string): string {
    const d = new Date(input);
    if (!Number.isFinite(d.getTime()))
        throw new MmsSyncError('A timed Calendar event or explicit session times are required.');
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}
export function sessionKey(sourceId: string): string { return `s${createHash('sha256').update(sourceId).digest('hex').slice(0, 7)}`; }
export function normalizePeople<T extends SyncPerson>(people: T[]): T[] {
    const emails = new Map<string, T>();
    const ids = new Map<string, string>();
    for (const p of people) {
        const email = p.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 128)
            throw new MmsSyncError('Each participant needs a valid unique email (maximum 128 characters).');
        const previous = emails.get(email);
        if (previous && previous.source_id !== p.source_id)
            throw new MmsSyncError(`Different people share ${email}; resolve their identity first.`);
        if (ids.has(p.source_id) && ids.get(p.source_id) !== email)
            throw new MmsSyncError('One source person has conflicting email addresses.');
        emails.set(email, { ...p, email, name: p.name.trim() || email });
        ids.set(p.source_id, email);
    }
    return [...emails.values()].sort((a, b) => a.email.localeCompare(b.email));
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
    return value;
}
export function snapshotHash(snapshot: RunSnapshot): string {
    const { revision, request_id, snapshot_hash, snapshot_at, ...content } = snapshot;
    return createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}
export function validateSnapshot(snapshot: RunSnapshot): RunSnapshot {
    snapshot.course_code = assertNonFunded(snapshot.course_code);
    const courseTitle = typeof snapshot.course_title === 'string' ? snapshot.course_title.trim() : '';
    if (!courseTitle || courseTitle.length > 255)
        throw new MmsSyncError('A valid course title is required for MMS catalogue verification.');
    snapshot.course_title = courseTitle;
    snapshot.event_occurrences = [...new Set(snapshot.event_occurrences)].sort();
    if (!snapshot.source_run_key || !snapshot.source_provider_id || !snapshot.calendar_id)
        throw new MmsSyncError('Stable source identities are required.');
    if (!snapshot.roster_complete)
        throw new MmsSyncError('An incomplete roster cannot be applied.');
    if (!snapshot.sessions.length)
        throw new MmsSyncError('The exact class sessions are required.');
    const keys = new Set<string>();
    for (const s of snapshot.sessions) {
        if (!/^s[a-f0-9]{7}$/.test(s.key) || keys.has(s.key))
            throw new MmsSyncError('Session keys are invalid or duplicated.');
        keys.add(s.key);
        const date = new Date(`${s.date}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== s.date || date.getUTCFullYear() > 2100 || date.getUTCFullYear() < 2000)
            throw new MmsSyncError('Invalid session date.');
        if (![s.start_time, s.end_time].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || s.end_time <= s.start_time)
            throw new MmsSyncError('Session end must follow start on the same class day.');
    }
    snapshot.sessions.sort((a, b) => `${a.date}${a.start_time}`.localeCompare(`${b.date}${b.start_time}`));
    snapshot.learners = normalizePeople(snapshot.learners);
    snapshot.trainers = normalizePeople(snapshot.trainers);
    const confirmed = snapshot.trainers.filter(t => t.confirmed && t.active !== false);
    if (confirmed.length > 1)
        throw new MmsSyncError('Multiple trainers need explicit delivery support before this class can be imported.');
    return snapshot;
}
