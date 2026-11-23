import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { ensureMobileSchema } from '../../../lib/mobile/schema';
import { sendViaGmailOAuth, trySendViaGmailServiceAccount } from '../../../lib/gmailOauthSend';
import { isSmtpEnabled, sendViaSmtp, getSmtpConfig } from '../../../lib/smtp';

/**
 * The apps' Support page.
 *   GET  → {email, phone, whatsapp, address, feedback}  the academy's support contacts
 *   POST {subject, message} → emails the feedback to the academy (to + cc from its settings),
 *        with the sender's name and email; at most 5 messages an hour per account.
 * Contacts and recipients come from this tenant's training_provider.app_support (address from
 * company_address), so nothing tenant-specific is in code.
 */
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const emails = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
    .map(x => String(x).trim()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));

export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  const user = req.authUser!;
  if (user.isService) return res.status(403).end();
  try {
    await ensureMobileSchema();
    const tp = (await pool.query(
      `SELECT app_support, company_address, company_tel FROM training_provider ORDER BY created_at ASC LIMIT 1`
    )).rows[0] || {};
    const cfg = (tp.app_support && typeof tp.app_support === 'object') ? tp.app_support : {};
    const to = emails(cfg.feedbackTo), cc = emails(cfg.feedbackCc);

    if (req.method === 'GET') {
      return res.json({
        email: clean(cfg.email, 200) || null,
        phone: clean(cfg.phone, 40) || clean(tp.company_tel, 40) || null,
        whatsapp: clean(cfg.whatsapp, 40) || null,
        address: clean(tp.company_address, 300) || null,
        feedback: to.length > 0,
      });
    }
    if (req.method !== 'POST') return res.status(405).end();

    const subject = clean(req.body?.subject, 150), message = clean(req.body?.message, 5000);
    if (!subject || !message) return res.status(400).json({ error: 'Add a subject and a message.' });
    if (!to.length) return res.status(503).json({ error: 'Feedback is not set up for this academy yet. Please email or WhatsApp us instead.' });
    const recent = (await pool.query(
      `SELECT count(*)::int AS n FROM mobile_support_message WHERE user_id=$1 AND created_at > now() - interval '1 hour'`, [user.id]
    )).rows[0].n;
    if (recent >= 5) return res.status(429).json({ error: 'You have sent several messages in the last hour. Please try again later.' });

    const me = (await pool.query(`SELECT full_name, email FROM app_user WHERE id=$1`, [user.id])).rows[0] || {};
    const roles = Array.from(user.roles).join(', ');
    const logged = (await pool.query(
      `INSERT INTO mobile_support_message (user_id, subject, message) VALUES ($1,$2,$3) RETURNING id`, [user.id, subject, message]
    )).rows[0].id;
    const text = `${message}\n\n---\nFrom: ${me.full_name || 'App user'} <${me.email || 'no email'}>\nRoles: ${roles}\nSent from the TIA TMS mobile app (Support).`;
    const mail = { subject: `App feedback: ${subject}`, text, replyTo: me.email || undefined };
    // Gmail sends the cc; the SMTP fallback has no cc, so there the cc recipients join "to".
    let result: any = await trySendViaGmailServiceAccount({ ...mail, to: to.join(', '), cc });
    if (!result?.ok && await isSmtpEnabled()) result = await sendViaSmtp({ ...mail, to: [...to, ...cc].join(', ') });
    if (!result?.ok) result = await sendViaGmailOAuth({ ...mail, to: to.join(', '), cc });
    if (!result?.ok) { const c = await getSmtpConfig(); if (c?.host) result = await sendViaSmtp({ ...mail, to: [...to, ...cc].join(', ') }); }
    if (!result?.ok) return res.status(503).json({ error: 'Your message could not be sent. Please try again later, or email or WhatsApp us.' });
    await pool.query(`UPDATE mobile_support_message SET sent=true WHERE id=$1`, [logged]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Support is not available right now. Please try again.' });
  }
}, { roles: ['learner', 'trainer', 'admin', 'developer'] });
