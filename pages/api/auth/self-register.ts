import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { normalizedEmail, limited } from '../../../lib/android/auth';
import { autoShareLearnerMaterials } from '@lib/google-drive/drive-helpers';
import { emailService } from '@lib/services/emailService';
import { getTrainingPartnerIdentifiers } from '@lib/trainingPartnerIdentifiers';
import {
  findCourseRun, enrolLearner, logEnrolmentAttempt, ensureSigninRequestTable, SIGNIN_REQUEST_REASONS,
  sendWelcomeSigninEmail, loginUrlFrom,
} from '@lib/learner/selfEnrolment';
import { validateRegistrationEmail, validateCourseRunId } from '@lib/learner/registrationValidation';

// POST { fullName, email, courseRunId, phone? }
// PUBLIC (login screen): a learner who can't get their OTP or can't see their class
// fixes it themselves — the system creates their account and enrols them into the
// class by Course Run ID, emails them a welcome (Email Templates → Learner Welcome
// Email) with the sign-in link, and the login page sends their OTP straight away.
// Anything it can't fix on its own (unknown/expired run, disabled account, withdrawn
// enrolment) becomes an 'open' sign-in request for staff: stored in
// signin_help_request, emailed to the support inbox, listed on Admin → Sign-in Requests.
//
// Safeguards: per-IP (generous: a whole class may share the venue Wi-Fi) and per-email
// rate limits; live runs only; new accounts get an emailed strong password they must
// change at first password login (OTP preferred); no reactivation of
// disabled accounts or admin-removed enrolments; no calendar / SSG push.

const SOURCE = 'self-registration';

function clientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || req.socket.remoteAddress || 'unknown';
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

async function notifySupport(req: NextApiRequest, r: { fullName: string; email: string; phone: string | null; courseRunId: string; reason: string }) {
  const tp = await getTrainingPartnerIdentifiers();
  const to = tp.supportEmail || tp.companyEmail;
  if (!to) return;
  const link = req.headers.host ? `https://${req.headers.host}/?adminPage=signinRequests` : '';
  const rows: [string, string][] = [
    ['Name', r.fullName], ['Email', r.email], ['Mobile', r.phone || 'Not provided'],
    ['Course Run ID', r.courseRunId], ['Why it needs you', r.reason],
  ];
  await emailService.sendEmail({
    to,
    replyTo: r.email,
    subject: `Sign-in request: ${r.fullName} (Course Run ${r.courseRunId})`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (link ? `\n\nResolve it: ${link}` : ''),
    html: `<div style="font-family:Arial,sans-serif;max-width:600px">
      <h2 style="color:#1e40af">A learner needs help signing in</h2>
      <p>The system could not enrol this learner automatically.</p>
      <table style="border-collapse:collapse">${rows.map(([k, v]) =>
        `<tr><td style="padding:6px 12px;font-weight:bold;vertical-align:top">${k}</td><td style="padding:6px 12px">${escapeHtml(v)}</td></tr>`).join('')}
      </table>
      ${link ? `<p><a href="${link}">Open Admin → Sign-in Requests</a> to enrol them in one click.</p>` : ''}
    </div>`,
  }).catch((e) => console.warn('[self-register] support email failed (non-blocking):', e instanceof Error ? e.message : e));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().replace(/\s+/g, ' ') : '';
  const email = normalizedEmail(req.body?.email);
  const courseRunId = typeof req.body?.courseRunId === 'string' ? req.body.courseRunId.trim() : '';
  const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';

  if (fullName.length < 2 || fullName.length > 120) {
    return res.status(400).json({ success: false, error: 'Please enter your full name as shown on your NRIC / passport.' });
  }
  const emailError = validateRegistrationEmail(typeof req.body?.email === 'string' ? req.body.email : '');
  if (!email || emailError) {
    return res.status(400).json({ success: false, error: emailError || 'Please enter a valid email address.' });
  }
  const runIdError = validateCourseRunId(courseRunId);
  if (runIdError) {
    return res.status(400).json({ success: false, error: runIdError });
  }
  if (rawPhone && !/^\+?[0-9 ()-]{6,20}$/.test(rawPhone)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid mobile number, or leave it blank.' });
  }
  const phone = rawPhone || null;

  if (await limited(`self-register:ip:${clientIp(req)}`, 60, 60) || await limited(`self-register:email:${email}`, 5, 60)) {
    res.setHeader('Retry-After', '3600');
    return res.status(429).json({ success: false, error: 'Too many attempts. Please try again in an hour.' });
  }

  await ensureSigninRequestTable();

  const record = (status: 'auto_enrolled' | 'open', courseRunUuid: string | null, reason: string | null) =>
    pool.query(
      `INSERT INTO signin_help_request (full_name, email, phone, course_run_id, course_run_uuid, status, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [fullName, email, phone, courseRunId, courseRunUuid, status, reason]
    );

  // Hand the case to staff: store it (once per learner + run while open), email support.
  const escalate = async (reasonKey: string, courseRunUuid: string | null, learnerMessage: string) => {
    const reason = SIGNIN_REQUEST_REASONS[reasonKey] || reasonKey;
    const open = await pool.query(
      `SELECT 1 FROM signin_help_request WHERE status = 'open' AND email = $1 AND LOWER(course_run_id) = LOWER($2) LIMIT 1`,
      [email, courseRunId]
    );
    if (open.rows.length === 0) {
      await record('open', courseRunUuid, reason);
      await notifySupport(req, { fullName, email, phone, courseRunId, reason });
    }
    await logEnrolmentAttempt({ email, fullName, courseRunId, action: 'skipped', accountAction: 'unknown', source: SOURCE, error: reason });
    return res.status(200).json({
      success: false,
      requestLogged: true,
      error: `${learnerMessage} We've passed your request to our team — they'll email you at ${email} once it's sorted.`,
    });
  };

  const found = await findCourseRun(courseRunId, { enforceWindow: true });
  if (found.status === 'not_found') {
    return escalate('not_found', null, `We couldn't find an open class with Course Run ID ${courseRunId}.`);
  }
  if (found.status === 'ambiguous') {
    return escalate('ambiguous', null, 'That Course Run ID matches more than one class.');
  }
  const run = found.run;

  let result;
  try {
    result = await enrolLearner({ fullName, email, run, source: SOURCE });
  } catch (error) {
    console.error('[self-register] failed:', error instanceof Error ? error.message : error);
    return escalate('error', run.id, "We couldn't enrol you automatically.");
  }

  if (result.outcome === 'account_inactive') {
    return escalate('account_inactive', run.id, 'Your account is inactive.');
  }
  if (result.outcome === 'enrolment_withdrawn') {
    return escalate('enrolment_withdrawn', run.id, 'Your enrolment in this class was withdrawn.');
  }

  const alreadyEnrolled = result.outcome === 'already_enrolled';
  await record('auto_enrolled', run.id, alreadyEnrolled ? 'Already enrolled' : null).catch(() => {});
  await logEnrolmentAttempt({
    email, fullName, courseRunId: run.course_run_id,
    action: alreadyEnrolled ? 'skipped' : 'inserted', accountAction: result.accountAction, source: SOURCE,
  });
  const proto = typeof req.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'].split(',')[0].trim() : undefined;
  sendWelcomeSigninEmail({ fullName, email, run, loginUrl: loginUrlFrom(req.headers.host, proto), tempPassword: result.tempPassword })
    .then((r) => { if (!r.success) console.warn('[self-register] welcome email failed:', r.error); })
    .catch((e) => console.warn('[self-register] welcome email failed (non-blocking):', e instanceof Error ? e.message : e));
  if (!alreadyEnrolled) {
    autoShareLearnerMaterials(run.id).catch((e) =>
      console.warn('[self-register] learner material share failed (non-blocking):', e instanceof Error ? e.message : e)
    );
  }

  return res.status(200).json({
    success: true,
    alreadyEnrolled,
    courseTitle: run.title,
    startDate: run.start_date,
    endDate: run.end_date,
    message: alreadyEnrolled
      ? 'You are already enrolled in this class.'
      : 'You are enrolled.',
  });
}

export default handler;
