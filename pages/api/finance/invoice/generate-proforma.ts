import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import PizZip from 'pizzip';
import { Readable } from 'stream';
import { getDriveClient } from '../../../../lib/google-drive/drive-helpers';
import pool from '../../../../lib/db';

export const config = {
  maxDuration: 300,
  api: { responseLimit: false },
};

const TEMPLATE_ID = '1KbvgGpNsirzmCvLZOuMv7SY5IWxX0XfTSbnNF_pjZYY';
const DRIVE_FOLDER_ID = '1cqA3G1c4Nez-9XKpUO2h31rBhkZhAfw3';
const SOFFICE_PATH = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';

function getAuth() {
  const keyFile = path.join(process.cwd(), 'service-account.json');
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

interface Grant {
  funding_scheme: string;
  estimated_amount: string;
  approved_amount: string;
  status: string;
}

/**
 * POST /api/finance/invoice/generate-proforma
 * Bulk-generates pro forma PDFs for enrollments missing a pro_forma_url.
 * Filename format: PRFM_{course_code}_{learner_name}.pdf
 * Saves proforma_invoice_number to enrollment table.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseTitle, startDate, endDate, courseRun, courseCode, name, enrollmentIds } = req.body || {};

  try {
    const conditions: string[] = ['e.pro_forma_url IS NULL'];
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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
        e.id AS enrollment_id,
        e.enrolment_id,
        u.full_name,
        c.title AS course_title,
        c.course_code,
        c.course_fees_exclude_gst,
        cr.start_date::text
      FROM enrollment e
      JOIN app_user u ON u.id = e.user_id
      JOIN course_run cr ON cr.id = e.course_run_id
      JOIN course c ON c.id = e.course_id
      ${whereClause}
      ORDER BY e.enrolment_date DESC NULLS LAST`,
      params
    );

    const enrollments = result.rows;
    const isStream = req.query.stream === 'true';

    if (enrollments.length === 0) {
      if (isStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        res.write(`data: ${JSON.stringify({ type: 'complete', generated: 0, errors: 0, total: 0, message: 'No enrollments need syncing.' })}\n\n`);
        (res as any).flush?.();
        res.end();
        return;
      }
      return res.status(200).json({ success: true, generated: 0, skipped: 0, errors: 0, message: 'No enrollments need syncing.' });
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Content-Encoding', 'none');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: 'start', total: enrollments.length })}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    }

    // Fetch grants
    const enrolmentIds = enrollments.map((e: any) => e.enrolment_id).filter(Boolean);
    const grantsByEnrolment: Record<string, Grant[]> = {};

    if (enrolmentIds.length > 0) {
      const grantResult = await pool.query(
        `SELECT
          enrollment_id,
          funding_scheme_description AS funding_scheme,
          estimated_grant_amount AS estimated_amount,
          approved_grant_amount AS approved_amount,
          status
        FROM ssg_grants
        WHERE enrollment_id = ANY($1)`,
        [enrolmentIds]
      );
      for (const grant of grantResult.rows) {
        if (!grantsByEnrolment[grant.enrollment_id]) {
          grantsByEnrolment[grant.enrollment_id] = [];
        }
        grantsByEnrolment[grant.enrollment_id].push({
          funding_scheme: grant.funding_scheme,
          estimated_amount: grant.estimated_amount,
          approved_amount: grant.approved_amount,
          status: grant.status,
        });
      }
    }

    // Download template once
    const auth = getAuth();
    const serviceDrive = google.drive({ version: 'v3', auth });
    const exportRes = await serviceDrive.files.export(
      { fileId: TEMPLATE_ID, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { responseType: 'arraybuffer' }
    );
    const templateBuffer = Buffer.from(exportRes.data as ArrayBuffer);

    // Get OAuth Drive client
    const uploadDrive = await getDriveClient();

    // Ensure invoice number column exists
    await pool.query('ALTER TABLE enrollment ADD COLUMN IF NOT EXISTS proforma_invoice_number TEXT');

    let generated = 0;
    let errored = 0;
    const tmpDir = os.tmpdir();

    for (const enr of enrollments) {
      try {
        const grants: Grant[] = enr.enrolment_id ? (grantsByEnrolment[enr.enrolment_id] || []) : [];
        const order = (enr.enrolment_id ?? '').replace('#', '');
        const amount1 = parseFloat((enr.course_fees_exclude_gst ?? '0').replace(/,/g, ''));

        let subTotal = amount1;
        let amount2 = amount1 * -0.5;
        subTotal += amount2;

        let amount3: number | string = '';
        let mces = '';
        let qty = '';

        const enhancedGrant = grants.find(g =>
          g.funding_scheme === 'Mid-Career Enhanced Subsidy' ||
          g.funding_scheme === 'Enhanced Training Support for SMEs' ||
          g.funding_scheme === 'IBF STS'
        );
        const enhancedAmt = enhancedGrant
          ? parseFloat(enhancedGrant.approved_amount !== '0.00' ? enhancedGrant.approved_amount : enhancedGrant.estimated_amount)
          : 0;

        if (enhancedAmt > 0) {
          mces = enhancedGrant!.funding_scheme;
          qty = '1';
          amount3 = -enhancedAmt;
          subTotal += amount3;
        }

        const gst = amount1 * 0.09;
        const total = subTotal + gst;
        const today = new Date();
        const dueDate = new Date(today);
        dueDate.setDate(dueDate.getDate() + 25);
        const fmtDate = (d: Date) => d.toLocaleDateString('en-SG', { day: '2-digit', month: '2-digit', year: 'numeric' });

        const courseDate = enr.start_date
          ? new Date(enr.start_date).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
          : '-';

        const replacements: Record<string, string> = {
          '{{order}}': order,
          '{{date}}': fmtDate(today),
          '{{due_date}}': fmtDate(dueDate),
          '{{course_start}}': courseDate,
          '{{name}}': enr.full_name,
          '{{course_name}}': enr.course_title,
          '{{code}}': enr.course_code ?? '',
          '{{amount1}}': amount1.toFixed(2),
          '{{amount2}}': amount2 !== 0 ? amount2.toFixed(2) : '',
          '{{mces}}': mces,
          '{{qty}}': qty,
          '{{amount3}}': typeof amount3 === 'number' ? amount3.toFixed(2) : '',
          '{{sub_total}}': subTotal.toFixed(2),
          '{{gst}}': gst.toFixed(2),
          '{{total}}': total.toFixed(2),
        };

        const zip = new PizZip(templateBuffer);
        const xmlFiles = ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml'];
        for (const xmlFile of xmlFiles) {
          if (zip.files[xmlFile]) {
            let xml = zip.files[xmlFile].asText();
            for (const [placeholder, value] of Object.entries(replacements)) {
              const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              xml = xml.replace(new RegExp(escaped, 'g'), value);
            }
            zip.file(xmlFile, xml);
          }
        }
        const filledDocx = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

        const timestamp = Date.now();
        const docxPath = path.join(tmpDir, `sync_${timestamp}_${generated}.docx`);
        const pdfPath = path.join(tmpDir, `sync_${timestamp}_${generated}.pdf`);

        fs.writeFileSync(docxPath, filledDocx);
        execSync(`"${SOFFICE_PATH}" --headless --convert-to pdf --outdir "${tmpDir}" "${docxPath}"`, { timeout: 30000 });

        const pdfBuffer = fs.readFileSync(pdfPath);
        try { fs.unlinkSync(docxPath); } catch (_) {}
        try { fs.unlinkSync(pdfPath); } catch (_) {}

        // Build invoice number: PRFM_{course_code}_{learner_name}
        const safeCourseCode = (enr.course_code || order || 'invoice').replace(/[^a-zA-Z0-9-]/g, '_');
        const safeName = enr.full_name.replace(/[^a-zA-Z0-9]/g, '_');
        const invoiceNumber = `PRFM_${safeCourseCode}_${safeName}`;

        // Upload to Drive
        const uploadRes = await uploadDrive.files.create({
          requestBody: {
            name: `${invoiceNumber}.pdf`,
            parents: [DRIVE_FOLDER_ID],
            mimeType: 'application/pdf',
          },
          media: {
            mimeType: 'application/pdf',
            body: Readable.from(pdfBuffer),
          },
          fields: 'id, webViewLink',
        });

        const driveUrl = uploadRes.data.webViewLink ?? null;

        // Save URL and invoice number to DB
        if (driveUrl) {
          if (enr.enrolment_id) {
            const rawId = enr.enrolment_id.replace('#', '');
            await pool.query(
              'UPDATE enrollment SET pro_forma_url = $1, proforma_invoice_number = $2 WHERE enrolment_id = $3',
              [driveUrl, invoiceNumber, rawId]
            );
          } else {
            await pool.query(
              'UPDATE enrollment SET pro_forma_url = $1, proforma_invoice_number = $2 WHERE id = $3',
              [driveUrl, invoiceNumber, enr.enrollment_id]
            );
          }
        }

        generated++;
        console.log(`[generate-proforma] Generated ${generated}/${enrollments.length}: ${invoiceNumber}`);

        if (isStream) {
          res.write(`data: ${JSON.stringify({ type: 'progress', current: generated + errored, total: enrollments.length, generated, errors: errored, name: enr.full_name })}\n\n`);
          (res as any).flush?.();
        }
      } catch (err) {
        errored++;
        console.error(`[generate-proforma] Failed for ${enr.enrolment_id || enr.enrollment_id}:`, err);
        if (isStream) {
          res.write(`data: ${JSON.stringify({ type: 'progress', current: generated + errored, total: enrollments.length, generated, errors: errored, name: enr.full_name })}\n\n`);
          (res as any).flush?.();
        }
      }
    }

    if (isStream) {
      res.write(`data: ${JSON.stringify({ type: 'complete', generated, errors: errored, total: enrollments.length, message: `Generated ${generated} invoice(s), ${errored} error(s).` })}\n\n`);
      (res as any).flush?.();
      res.end();
      return;
    }

    return res.status(200).json({
      success: true, generated, skipped: 0, errors: errored, total: enrollments.length,
      message: `Generated ${generated} invoice(s), ${errored} error(s).`,
    });
  } catch (error: any) {
    console.error('[generate-proforma] Error:', error);
    if (req.query.stream === 'true') {
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: error?.message || 'Generation failed' })}\n\n`); res.end(); } catch (_) {}
      return;
    }
    return res.status(500).json({ success: false, error: error?.message || 'Generation failed' });
  }
}