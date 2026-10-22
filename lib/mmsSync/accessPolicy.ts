import { assertNonFunded, MmsSyncError, normalizeCode, type RunSnapshot, type SyncPerson } from './contract';

export interface RunApproval {
    approved_at?: string | Date | null;
    approved_by?: string | null;
    first_session_at?: string | Date | null;
    handover_at?: string | Date | null;
    delivery_platform?: 'mms' | 'tms';
}
export type AccessContext = {
    platform: 'tms' | 'mms' | 'review';
    state: 'ready' | 'pending' | 'legacy';
    reason?: string;
    source_run_key?: string;
    login_url?: string;
    class_url?: string;
    class_id?: string;
    snapshot?: RunSnapshot;
};
export function firstSessionAt(snapshot: RunSnapshot): string {
    const first = [...snapshot.sessions].sort((a, b) => `${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`))[0];
    if (!first) throw new MmsSyncError('Verify the entire run and its first teaching session.');
    return new Date(`${first.date}T${first.start_time}:00+08:00`).toISOString();
}
export function withApproval(snapshot: RunSnapshot, approval: RunApproval): RunSnapshot {
    assertRunApproval(approval, snapshot);
    return { ...snapshot, handover_approval: {
        approved_at: new Date(approval.approved_at!).toISOString(), approved_by: String(approval.approved_by),
        first_session_at: new Date(approval.first_session_at!).toISOString(),
    } };
}
export function assertRunApproval(approval: RunApproval, snapshot: RunSnapshot, now = new Date()): void {
    assertNonFunded(snapshot.course_code);
    const start = firstSessionAt(snapshot);
    if (!approval.approved_at || !approval.approved_by || !approval.first_session_at || approval.delivery_platform === 'tms')
        throw new MmsSyncError('Approve this exact full course run for MMS before importing.', 'approval_required');
    const first = new Date(start).getTime();
    const approved = new Date(approval.approved_at).getTime();
    const reviewed = new Date(approval.first_session_at).getTime();
    const minimum = new Date(`${process.env.MMS_PILOT_START_DATE || '2026-10-23'}T00:00:00+08:00`).getTime();
    if (![first, approved, reviewed, minimum].every(Number.isFinite) || first < minimum || first !== reviewed || approved >= first || approved > now.getTime())
        throw new MmsSyncError('The full run start changed or is outside the approved pilot. Review it before it starts.', 'no_midway');
    // An approved future run may be retried, but its INITIAL handover cannot start midway.
    if (approval.handover_at ? new Date(approval.handover_at).getTime() >= first : now.getTime() >= first)
        throw new MmsSyncError('Initial MMS handover must finish before the full run starts.', 'no_midway');
}
export function participantUrls(result: any, origin = process.env.MMS_PUBLIC_ORIGIN || ''): { login_url: string; class_url: string } {
    const base = new URL(origin);
    if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
        (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))))
        throw new MmsSyncError('Configure the canonical MMS participant HTTPS origin.');
    const login = new URL(String(result?.participant_login_url || ''));
    const entry = new URL(String(result?.participant_class_url || ''));
    if (login.origin !== base.origin || entry.origin !== base.origin || login.pathname !== '/lmslogin/' ||
        entry.pathname !== '/lmslogin/index/class/' || login.search || login.hash || entry.hash ||
        login.username || login.password || entry.username || entry.password ||
        !/^\?run_id=[1-9]\d*$/.test(entry.search) || entry.searchParams.get('run_id') !== String(result.run_id))
        throw new MmsSyncError('MMS returned an invalid participant class/login link.');
    return { login_url: login.href, class_url: entry.href };
}
export function accessContext(code: unknown, source: any, dirty: boolean, origin?: string): AccessContext {
    const normalized = normalizeCode(code);
    if (normalized.startsWith('TGS')) return { platform: 'tms', state: 'legacy' };
    if (!normalized) return { platform: 'review', state: 'pending', reason: 'Course code needs review.' };
    if (!source?.approved_at || source.delivery_platform === 'tms') return { platform: 'tms', state: 'legacy' };
    const pending: AccessContext = { platform: 'mms', state: 'pending', source_run_key: source.source_run_key, reason: 'MMS access is awaiting a current, ready handover.' };
    try {
        const snapshot: RunSnapshot = source.snapshot;
        assertRunApproval(source, snapshot);
        if (normalizeCode(source.course_code) !== normalized || normalizeCode(snapshot.course_code) !== normalized || dirty || source.last_error ||
            snapshot.cancelled || !snapshot.roster_complete || !source.handover_at || !source.last_success_at || Date.now() - new Date(source.last_success_at).getTime() > 5 * 60000 || source.target_result?.readiness !== 'ready' ||
            Number(source.target_result?.revision) !== Number(source.revision) || source.snapshot_hash !== snapshot.snapshot_hash ||
            source.target_result?.snapshot_hash !== source.snapshot_hash) return pending;
        return { platform: 'mms', state: 'ready', source_run_key: source.source_run_key, class_id: String(source.target_result.class_id), snapshot, ...participantUrls(source.target_result, origin) };
    } catch (e) {
        return { ...pending, reason: e instanceof Error ? e.message : pending.reason };
    }
}
export function recipients(snapshot: RunSnapshot): (SyncPerson & { role: 'trainer' | 'learner' })[] {
    if (!snapshot.roster_complete || snapshot.cancelled) return [];
    return [
        ...snapshot.trainers.filter(p => p.confirmed && p.active !== false).map(p => ({ ...p, role: 'trainer' as const })),
        ...snapshot.learners.filter(p => p.active !== false).map(p => ({ ...p, role: 'learner' as const })),
    ];
}
const escapeHtml = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function accessMessage(context: AccessContext, person: { name: string; role: 'trainer' | 'learner' }, support: string, purpose = 'Class access') {
    if (context.platform !== 'mms' || context.state !== 'ready' || !context.snapshot)
        throw new MmsSyncError(context.reason || 'MMS access is not ready.');
    const snapshot = context.snapshot;
    const sessions = snapshot.sessions.map(s => `${s.date}, ${s.start_time}–${s.end_time} SGT${s.venue ? ` — ${s.venue}` : ''}${s.virtual_link ? ` — ${s.virtual_link}` : ''}`).join('\n');
    const subject = `${purpose}: ${snapshot.course_title.replace(/[\r\n]/g, ' ')} — MMS ${context.class_id}`;
    const text = `Dear ${person.name},\n\n${person.role === 'trainer' ? 'Please conduct' : 'Please attend'} this class using MMS.\n\n${snapshot.course_title} (${snapshot.course_code})\nClass: ${context.class_id}\n${sessions}\n\nOpen MMS class: ${context.class_url}\nMMS login: ${context.login_url}\n\nUse the email registered for this class. Request an email OTP or use your existing MMS password. Select ${person.role === 'trainer' ? 'Trainer' : 'Learner'} if asked to choose a role. Your TMS password is not automatically your MMS password. Course materials and attendance are available in your MMS class.${snapshot.feedback_url ? `\nClass feedback: ${snapshot.feedback_url}` : ''}\n\nSupport: ${support}`;
    return { subject, text, html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</div>` };
}
export function accessInstruction(context: AccessContext): string {
    return context.state === 'ready' ? `Class delivery: MMS\nOpen MMS class: ${context.class_url}\nMMS login: ${context.login_url}` : 'Class delivery: MMS. Class-access instructions will follow after your assignment and MMS access are confirmed.';
}
