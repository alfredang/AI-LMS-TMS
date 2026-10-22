import { getAccessContext, type ClassIdentity } from './accessContext';
import { accessInstruction, accessMessage, recipients } from './accessPolicy';
import { MmsSyncError } from './contract';
/** Scoped templates: never rewrite a stored/global funded-course template. */
export async function learnerMail(identity: ClassIdentity, opts: { name: string; email: string; support: string; title: string; dates: string; venue: string; confirmation?: boolean }) {
    const context = await getAccessContext(identity);
    if (context.platform === 'tms') return null;
    if (context.platform === 'review') throw new MmsSyncError(context.reason || 'Class access needs review.');
    if (context.state === 'ready' && process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED === 'true') {
        if (!recipients(context.snapshot!).some(p => p.role === 'learner' && p.email === opts.email.toLowerCase())) throw new MmsSyncError('This learner is awaiting MMS enrolment reconciliation.');
        return accessMessage(context, { name: opts.name, role: 'learner' }, opts.support, opts.confirmation ? 'Course confirmation' : 'Course-day reminder');
    }
    if (!opts.confirmation) throw new MmsSyncError(context.reason || 'Hold course-day mail until MMS access is ready.');
    const text = `Dear ${opts.name},\n\nYour enrolment in ${opts.title} is confirmed.\n${opts.dates}\n${opts.venue}\n\n${accessInstruction({ ...context, state: 'pending' })}\nFor registration, payment or class enquiries, contact ${opts.support}.`;
    return { subject: `Course confirmation — ${opts.title.replace(/[\r\n]/g, ' ')}`, text, html: `<div style="white-space:pre-wrap">${text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</div>` };
}
export async function reminderAccess(identity: ClassIdentity) {
    const context = await getAccessContext(identity);
    if (context.platform === 'tms') return null;
    const ready = context.state === 'ready' && process.env.MMS_ACCESS_NOTIFICATIONS_ENABLED === 'true';
    return { delivery_platform: context.platform, access_state: ready ? 'ready' : 'pending', lms_login_url: ready ? context.login_url : null, class_access_url: ready ? context.class_url : null,
        e_attendance_url: ready ? context.class_url : null, attendance_code: null, access_instruction: context.platform === 'mms' ? accessInstruction({ ...context, state: ready ? 'ready' : 'pending' }) : context.reason };
}
