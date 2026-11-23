import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { limited } from '../../../lib/android/auth';
import { CHECKIN_TOKEN_RE, getSessionCheckinToken, loadCheckinContext, publicCheckIn } from '../../../lib/attendance/checkin';
import { canTrain, markAttendance, sessionAttendance, sessionRun } from '../../../lib/mobile/app';

// Attendance for the apps.
//  GET  ?sessionId=                         trainer: the session's check-in link and each learner's status
//  POST {action:'mark', sessionId, records} trainer: manual attendance for learners on that class
//  POST {action:'checkin', code}            learner: check in with the trainer's Take Attendance QR code
// A learner can only mark themself, and only with the session's unguessable QR token.
export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  const user = req.authUser!;
  if (user.isService) return res.status(403).end();
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST' && req.body?.action === 'checkin') {
      if (!user.roles.has('learner')) return res.status(403).json({ error: 'Learner access required' });
      const token = (String(req.body?.code || '').toLowerCase().match(/([0-9a-f]{32})\/?$/) || [])[1] || '';
      if (!CHECKIN_TOKEN_RE.test(token)) return res.status(400).json({ error: 'This is not a class check-in code. Scan the QR code your trainer is showing.' });
      if (await limited(`mobile-checkin:${user.id}`, 30, 15)) return res.status(429).json({ error: 'Too many attempts. Please ask your trainer.' });
      const ctx = await loadCheckinContext(token);
      if (!ctx) return res.status(404).json({ error: 'This check-in code is not valid.' });
      const me = (await pool.query('SELECT email, full_name FROM app_user WHERE id=$1', [user.id])).rows[0];
      const result = await publicCheckIn(ctx, { name: me.full_name || '', email: me.email, phone: '' });
      if (!result.ok) return res.status(409).json({ error: result.message });
      return res.json({ success: true, message: result.message, already: !!result.already, course: ctx.title, session: ctx.sessionLabel });
    }

    if (!user.roles.has('trainer')) return res.status(403).json({ error: 'Trainer access required' });
    const sessionId = String((req.method === 'GET' ? req.query.sessionId : req.body?.sessionId) || '');
    const runId = await sessionRun(sessionId);
    if (!runId || !(await canTrain(user.id, runId))) return res.status(404).json({ error: 'Session not found' });

    if (req.method === 'GET') {
      const t = await getSessionCheckinToken(sessionId);
      const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
      const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || `${proto}://${req.headers.host}`;
      return res.json({ data: { checkinURL: t ? `${origin}/checkin/${t.token}` : null, learners: await sessionAttendance(runId, sessionId, user.id) } });
    }
    if (req.method === 'POST' && req.body?.action === 'mark') {
      const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 500) : null;
      if (!records) return res.status(400).json({ error: 'No attendance to save.' });
      const saved = await markAttendance(runId, sessionId, user.id, records);
      return res.json({ success: true, saved, data: { learners: await sessionAttendance(runId, sessionId, user.id) } });
    }
    return res.status(405).end();
  } catch {
    return res.status(500).json({ error: 'Attendance could not be updated. Please try again.' });
  }
}, { roles: ['learner', 'trainer'] });
