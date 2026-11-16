import type { NextApiRequest, NextApiResponse } from 'next';
import { limited } from '../../../lib/android/auth';
import { CHECKIN_TOKEN_RE, loadCheckinContext, lookupByPhone, publicCheckIn } from '../../../lib/attendance/checkin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID = 'This check-in link is not valid.';

/**
 * PUBLIC: the /checkin/[token] page a learner reaches by scanning the trainer's Take Attendance
 * QR code (E-Attendance page → session tabs). The token is a random value stored on one
 * course_session row, so the link marks that session only.
 *
 * GET  ?t=                                          → the class and session shown on the form
 * POST { t, action: 'lookup', phone }               → { found, name, email (masked) } — this class only
 * POST { t, action: 'checkin', name, email, phone } → mark the learner present (registering them on
 *                                                     the class on their first check-in)
 *
 * Returns nothing about anyone else on the class beyond the masked lookup. Rate limited per IP
 * (generous: a class shares the venue Wi-Fi).
 */
function clientIp(req: NextApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const token = String((req.method === 'GET' ? req.query.t : req.body?.t) || '').trim().toLowerCase();
  if (!CHECKIN_TOKEN_RE.test(token)) return res.status(400).json({ success: false, error: INVALID });

  try {
    const ctx = await loadCheckinContext(token);
    if (!ctx) return res.status(404).json({ success: false, error: INVALID });

    if (req.method === 'GET') {
      return res.status(200).json({
        success: true,
        status: ctx.status,
        course: { title: ctx.title, code: ctx.courseCode, courseRunId: ctx.runCode },
        session: { label: ctx.sessionLabel, date: ctx.sessionDate },
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    if (await limited(`checkin:ip:${clientIp(req)}`, 400, 60)) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ success: false, error: 'Too many attempts. Please ask your trainer.' });
    }

    const action = String(req.body?.action || '');
    const phone = String(req.body?.phone || '').trim().slice(0, 40);

    if (action === 'lookup') {
      if (ctx.status === 'closed') return res.status(200).json({ success: true, found: false });
      return res.status(200).json({ success: true, ...(await lookupByPhone(ctx, phone)) });
    }
    if (action !== 'checkin') return res.status(400).json({ success: false, error: 'Unknown action' });

    if (String(req.body?.website || '').trim() !== '') {
      return res.status(400).json({ success: false, error: 'Check-in failed. Please try again.' }); // honeypot
    }
    const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 255);
    const phoneDigits = phone.replace(/\D+/g, '');
    if (phone && phoneDigits.length < 8) {
      return res.status(400).json({ success: false, error: 'Please enter a valid phone number, or leave it blank.' });
    }
    if (!email && !phoneDigits) {
      return res.status(400).json({ success: false, error: 'Please enter your name and email.' });
    }
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }
    if (email && name.length < 2) {
      return res.status(400).json({ success: false, error: 'Please enter your full name.' });
    }

    const result = await publicCheckIn(ctx, { name, email, phone });
    console.log(`[checkin] class ${ctx.runCode} ${ctx.sessionLabel}: ${result.ok ? `ok${result.registered ? ' (registered)' : ''}${result.byPhone ? ' (phone)' : ''}` : `FAILED ${result.message}`}`);
    if (!result.ok) return res.status(409).json({ success: false, error: result.message });
    return res.status(200).json({
      success: true,
      message: result.message,
      name: result.name,
      registered: result.registered,
      already: result.already,
      email: result.email,
      byPhone: result.byPhone,
      session: ctx.sessionLabel,
    });
  } catch (err: any) {
    console.error('[public attendance-checkin] failed:', err?.message);
    return res.status(500).json({ success: false, error: 'Check-in failed. Please ask your trainer.' });
  }
}
