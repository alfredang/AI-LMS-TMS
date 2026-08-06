import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../../lib/db';
import { getTrainingPartnerIdentifiers } from '../../../../lib/trainingPartnerIdentifiers';

export const config = {
  maxDuration: 300,
  api: { responseLimit: false },
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * POST /api/finance/invoice/send-proforma-email
 *
 * Sends proforma invoice emails to learners whose enrollments match the
 * provided filters (or specific enrollmentIds). Each email includes the
 * learner's individual pro_forma_url from the DB as a clickable link.
 *
 * Body: {
 *   enrollmentIds?: string[]   // specific UUIDs — takes priority over filters
 *   courseRun?: string
 *   courseCode?: string
 *   courseTitle?: string
 *   startDate?: string
 *   endDate?: string
 *   name?: string
 * }
 *
 * Supports SSE streaming via ?stream=true query param.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { enrollmentIds, courseRun, courseCode, courseTitle, startDate, endDate, name } = req.body || {};
  const isStream = req.query.stream === 'true';

  try {
    // 1. Fetch training provider settings + proforma email template
    await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS proforma_invoice_email_subject TEXT');
    await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS proforma_invoice_email_body TEXT');
    await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS proforma_invoice_email_cc TEXT');

    const tpResult = await pool.query(`
      SELECT email_user, google_client_id, google_client_secret, google_refresh_token,
             contact_person_name, company_email, company_name, company_shortname, company_website,
             proforma_invoice_email_subject AS email_subject,
             proforma_invoice_email_body    AS email_body,
             proforma_invoice_email_cc      AS email_cc
      FROM training_provider LIMIT 1
    `);

    if (tpResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Training provider not configured.' });
    }

    const tpRow = tpResult.rows[0];
    const tp = await getTrainingPartnerIdentifiers();

    if (!tpRow.email_user || !tpRow.google_client_id || !tpRow.google_client_secret || !tpRow.google_refresh_token) {
      return res.status(400).json({ success: false, error: 'Google Integration settings are incomplete. Configure them in Company Settings.' });
    }

    if (!tpRow.email_subject || !tpRow.email_body) {
      return res.status(400).json({ success: false, error: 'Proforma invoice email template is not configured. Set it up in Templates > Proforma Invoice Email.' });
    }

    // 2. Build enrollment query with filters
    const conditions: string[] = ['e.pro_forma_url IS NOT NULL'];
    const params: (string | string[])[] = [];
    let paramIndex = 1;

    if (Array.isArray(enrollmentIds) && enrollmentIds.length > 0) {
      conditions.push(`e.id = ANY($${paramIndex}::uuid[])`);
      params.push(enrollmentIds);
      paramIndex++;
    } else {
      if (courseRun && typeof courseRun === 'string' && courseRun.trim()) {
        conditions.push(`cr.course_run_id ILIKE $${paramIndex}`);
        params.push(`%${courseRun.trim()}%`);
        paramIndex++;
      }
      if (courseCode && typeof courseCode === 'string' && courseCode.trim()) {
        conditions.push(`c.course_code ILIKE $${paramIndex}`);
        params.push(`%${courseCode.trim()}%`);
        paramIndex++;
      }
      if (courseTitle && typeof courseTitle === 'string' && courseTitle.trim()) {
        conditions.push(`c.title ILIKE $${paramIndex}`);
        params.push(`%${courseTitle.trim()}%`);
        paramIndex++;
      }
      if (startDate && typeof startDate === 'string') {
        conditions.push(`cr.start_date >= $${paramIndex}::date`);
        params.push(startDate);
        paramIndex++;
      }
      if (endDate && typeof endDate === 'string') {
        conditions.push(`cr.end_date <= $${paramIndex}::date`);
        params.push(endDate);
        paramIndex++;
      }
      if (name && typeof name === 'string' && name.trim()) {
        conditions.push(`u.full_name ILIKE $${paramIndex}`);
        params.push(`%${name.trim()}%`);
        paramIndex++;
      }
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
        e.id            AS enrollment_id,
        e.enrolment_id,
        e.pro_forma_url,
        u.full_name,
        COALESCE(u.email, e.email) AS learner_email,
        c.title         AS course_title,
        c.course_code,
        cr.course_run_id,
        cr.start_date::text,
        cr.end_date::text,
        c.course_fees_exclude_gst,
        c.course_fees_include_gst
      FROM enrollment e
      JOIN app_user u  ON u.id = e.user_id
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c   ON c.id = e.course_id
      ${whereClause}
      ORDER BY e.enrolment_date DESC NULLS LAST`,
      params
    );

    const enrollments = result.rows;

    if (enrollments.length === 0) {
      if (isStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        res.write(`data: ${JSON.stringify({ type: 'complete', sent: 0, errors: 0, skipped: 0, total: 0, message: 'No enrollments with proforma invoices found.' })}\n\n`);
        (res as any).flush?.();
        res.end();
        return;
      }
      return res.status(200).json({ success: true, sent: 0, skipped: 0, errors: 0, message: 'No enrollments with proforma invoices found.' });
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Content-Encoding', 'none');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: 'start', total: enrollments.length })}\n\n`);
      (res as any).flush?.();
    }

    // 3. Set up Gmail OAuth client once
    const oauth2Client = new google.auth.OAuth2(
      tpRow.google_client_id,
      tpRow.google_client_secret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: tpRow.google_refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const senderName = tpRow.contact_person_name || '';
    const companyName = tpRow.company_name || tp.name || 'Training Provider';
    const companyShortName = tpRow.company_shortname || companyName;
    const companyWebsite = tpRow.company_website || '';
    const companyEmail = tpRow.company_email || '';
    const emailCc = tpRow.email_cc || '';

    let sent = 0;
    let skipped = 0;
    let errored = 0;

    // 4. Send each learner their email
    for (const enr of enrollments) {
      if (!enr.learner_email) {
        skipped++;
        if (isStream) {
          res.write(`data: ${JSON.stringify({ type: 'progress', current: sent + skipped + errored, total: enrollments.length, sent, errors: errored, skipped, name: enr.full_name })}\n\n`);
          (res as any).flush?.();
        }
        continue;
      }

      try {
        const courseDate = enr.start_date
          ? new Date(enr.start_date).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
          : '-';

        const invoiceNumber = (enr.enrolment_id ?? '').replace('#', '') || enr.enrollment_id;
        const today = new Date();
        const dueDate = new Date(today);
        dueDate.setDate(dueDate.getDate() + 25);
        const fmtDate = (d: Date) => d.toLocaleDateString('en-SG', { day: '2-digit', month: '2-digit', year: 'numeric' });

        // Fee calculations matching generate-proforma logic
        const feesExclGst = parseFloat((enr.course_fees_exclude_gst ?? '0').replace(/,/g, '')) || 0;
        const gstAmount = feesExclGst * 0.09;
        const totalCourseFee = feesExclGst + gstAmount;
        const netFee = feesExclGst * 0.5 + gstAmount; // default self-sponsored 50% subsidy

        const endDate = enr.end_date
          ? new Date(enr.end_date).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
          : '-';

        const replacePlaceholders = (text: string) => text
          // Names used in the template editor
          .replace(/\{PARTICIPANT_NAME\}/g, enr.full_name || 'Learner')
          .replace(/\{LEARNER_NAME\}/g, enr.full_name || 'Learner')
          .replace(/\{STUDENT_NAME\}/g, enr.full_name || 'Learner')
          // Course info
          .replace(/\{COURSE_NAME\}/g, enr.course_title || '')
          .replace(/\{COURSE_TITLE\}/g, enr.course_title || '')
          .replace(/\{COURSE_CODE\}/g, enr.course_code || '')
          .replace(/\{COURSE_RUN_ID\}/g, enr.course_run_id || '')
          .replace(/\{COURSE_START_DATE\}/g, courseDate)
          .replace(/\{START_DATE\}/g, courseDate)
          .replace(/\{END_DATE\}/g, endDate)
          .replace(/\{COURSE_END_DATE\}/g, endDate)
          // Invoice details
          .replace(/\{INVOICE_NUMBER\}/g, invoiceNumber)
          .replace(/\{INVOICE_DATE\}/g, fmtDate(today))
          .replace(/\{PAYMENT_DUE_DATE\}/g, fmtDate(dueDate))
          .replace(/\{AMOUNT_DUE\}/g, `SGD ${totalCourseFee.toFixed(2)}`)
          // Fee breakdown
          .replace(/\{FEES_EXCL_GST\}/g, `SGD ${feesExclGst.toFixed(2)}`)
          .replace(/\{COURSE_FEES_EXCL_GST\}/g, `SGD ${feesExclGst.toFixed(2)}`)
          .replace(/\{GST_AMOUNT\}/g, `SGD ${gstAmount.toFixed(2)}`)
          .replace(/\{TOTAL_COURSE_FEE\}/g, `SGD ${totalCourseFee.toFixed(2)}`)
          .replace(/\{TOTAL_PAYABLE\}/g, `SGD ${totalCourseFee.toFixed(2)}`)
          .replace(/\{NET_FEE\}/g, `SGD ${netFee.toFixed(2)}`)
          .replace(/\{FUNDING_TYPE\}/g, 'Self-Sponsored (SkillsFuture Funding)')
          // Invoice URL — replace placeholder with actual Drive link
          .replace(/\{PROFORMA_INVOICE_URL\}/g, enr.pro_forma_url || '')
          .replace(/\{INVOICE_URL\}/g, enr.pro_forma_url || '')
          // Company
          .replace(/\{COMPANY_NAME\}/g, companyName)
          .replace(/\{COMPANY_SHORT_NAME\}/g, companyShortName)
          .replace(/\{COMPANY_WEBSITE\}/g, companyWebsite)
          .replace(/\{COMPANY_EMAIL\}/g, companyEmail);

        const subject = replacePlaceholders(tpRow.email_subject);
        const bodyText = replacePlaceholders(tpRow.email_body);

        // Build the invoice attachment link block
        const invoiceLinkBlock = enr.pro_forma_url
          ? `
<div style="margin: 20px 0; padding: 14px 16px; background: #f0f7ff; border: 1px solid #c7dff7; border-radius: 8px; font-family: Arial, sans-serif;">
  <p style="margin: 0 0 6px 0; font-weight: bold; color: #1a56db; font-size: 14px;">📎 Your Proforma Invoice</p>
  <p style="margin: 0 0 10px 0; font-size: 13px; color: #374151;">Click the button below to view or download your proforma invoice:</p>
  <a href="${enr.pro_forma_url}"
     target="_blank"
     style="display: inline-block; padding: 10px 20px; background: #1a56db; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600;">
    View Proforma Invoice
  </a>
</div>`
          : '';

        const isHtml = /<[a-z][\s\S]*>/i.test(bodyText);
        const bodyHtml = isHtml
          ? bodyText
          : bodyText.split('\n').map((line: string) => line.trim() ? `<p style="margin:0 0 2px 0;">${line}</p>` : '<br/>').join('\n');

        const htmlBody = `<div style="font-family: Arial, sans-serif; color: #333;">${bodyHtml}${invoiceLinkBlock}</div>`;

        const headers = [
          `From: ${senderName ? `${senderName} <${tpRow.email_user}>` : tpRow.email_user}`,
          `To: ${enr.learner_email}`,
          ...(emailCc ? [`Cc: ${emailCc}`] : []),
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset="UTF-8"',
          '',
          htmlBody,
        ].join('\r\n');

        const encodedMessage = Buffer.from(headers)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });

        sent++;
        console.log(`[send-proforma-email] Sent to ${enr.learner_email} (${sent}/${enrollments.length})`);
      } catch (err: any) {
        errored++;
        console.error(`[send-proforma-email] Failed for ${enr.learner_email}:`, err.message);
      }

      if (isStream) {
        res.write(`data: ${JSON.stringify({ type: 'progress', current: sent + skipped + errored, total: enrollments.length, sent, errors: errored, skipped, name: enr.full_name })}\n\n`);
        (res as any).flush?.();
      }

      await sleep(1000);
    }

    if (isStream) {
      res.write(`data: ${JSON.stringify({ type: 'complete', sent, errors: errored, skipped, total: enrollments.length, message: `Sent ${sent} email(s), ${skipped} skipped (no email), ${errored} error(s).` })}\n\n`);
      (res as any).flush?.();
      res.end();
      return;
    }

    return res.status(200).json({
      success: true,
      sent,
      skipped,
      errors: errored,
      total: enrollments.length,
      message: `Sent ${sent} email(s), ${skipped} skipped (no email), ${errored} error(s).`,
    });

  } catch (error: any) {
    console.error('[send-proforma-email] Error:', error);
    if (isStream) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error?.message || 'Failed to send emails.' })}\n\n`);
        res.end();
      } catch (_) {}
      return;
    }
    return res.status(500).json({ success: false, error: error?.message || 'Failed to send emails.' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
