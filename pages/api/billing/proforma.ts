import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import PizZip from 'pizzip';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import pool from '../../../lib/db';

interface Grant {
  funding_scheme: string;
  estimated_amount: string;
  approved_amount: string;
  status: string;
}

interface ProFormaRequest {
  enrollment_id: string | null;
  enrolment_id: string | null;
  full_name: string;
  course_title: string;
  course_code: string | null;
  course_fees_exclude_gst: string | null;
  start_date: string | null;
  grants: Grant[];
  sponsorship_type?: 'Self-Sponsored' | 'Employer-Sponsored' | 'Organisation-Sponsored';
  eligibility?: 'above' | 'below';
}

const TEMPLATE_ID = '1KbvgGpNsirzmCvLZOuMv7SY5IWxX0XfTSbnNF_pjZYY';
const DRIVE_FOLDER_ID = '1cqA3G1c4Nez-9XKpUO2h31rBhkZhAfw3';
const SOFFICE_PATH = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';

function getAuth() {
  const keyFile = path.join(process.cwd(), 'service-account.json');
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',  // needed to upload
    ],
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let data: ProFormaRequest = req.body;

  // If only enrollment_id is provided (e.g. regenerate flow), look up data from DB
  if ((!data.full_name || !data.course_title) && data.enrollment_id) {
    try {
      const dbRes = await pool.query(
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
        WHERE e.id = $1
        LIMIT 1`,
        [data.enrollment_id]
      );
      if (dbRes.rows.length === 0) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }
      const row = dbRes.rows[0];
      data = {
        ...data,
        full_name: row.full_name,
        course_title: row.course_title,
        course_code: row.course_code,
        course_fees_exclude_gst: row.course_fees_exclude_gst,
        start_date: row.start_date,
        enrolment_id: row.enrolment_id,
        grants: data.grants ?? [],
      };
    } catch (dbErr) {
      console.error('[proforma] DB lookup error:', dbErr);
      return res.status(500).json({ error: 'Failed to look up enrollment data' });
    }
  }

  if (!data.full_name || !data.course_title) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + 25);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-SG', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const order = (data.enrolment_id ?? '').replace('#', '');
  const amount1 = parseFloat((data.course_fees_exclude_gst ?? '0').replace(/,/g, ''));

  let subTotal = amount1;
  let amount2 = 0;

  if (data.sponsorship_type === 'Self-Sponsored') {
    amount2 = amount1 * -0.5;
    subTotal += amount2;
  }

  let amount3: number | string = '';
  let mces = '';
  let qty = '';

  const enhancedGrant = data.grants?.find(g =>
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
  } else if (data.eligibility === 'above') {
    mces = 'Less: WSQ funding (Mid-Career Enhanced Subsidy)';
    qty = '1';
    amount3 = amount1 * -0.2;
    subTotal += amount3;
  }

  const gst = amount1 * 0.09;
  const total = subTotal + gst;

  const courseDate = data.start_date
    ? new Date(data.start_date).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
    : '-';

  const replacements: Record<string, string> = {
    '{{order}}': order,
    '{{date}}': fmtDate(today),
    '{{due_date}}': fmtDate(dueDate),
    '{{course_start}}': courseDate,
    '{{name}}': data.full_name,
    '{{course_name}}': data.course_title,
    '{{code}}': data.course_code ?? '',
    '{{amount1}}': amount1.toFixed(2),
    '{{amount2}}': amount2 !== 0 ? amount2.toFixed(2) : '',
    '{{mces}}': mces,
    '{{qty}}': qty,
    '{{amount3}}': typeof amount3 === 'number' ? amount3.toFixed(2) : '',
    '{{sub_total}}': subTotal.toFixed(2),
    '{{gst}}': gst.toFixed(2),
    '{{total}}': total.toFixed(2),
  };

  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const docxPath = path.join(tmpDir, `invoice_${timestamp}.docx`);
  const pdfFile = path.join(tmpDir, `invoice_${timestamp}.pdf`);

  try {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // 1. Download template as docx
    const exportRes = await drive.files.export(
      { fileId: TEMPLATE_ID, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { responseType: 'arraybuffer' }
    );

    const docxBuffer = Buffer.from(exportRes.data as ArrayBuffer);

    // 2. Fill in placeholders via PizZip
    const zip = new PizZip(docxBuffer);

    const xmlFiles = [
      'word/document.xml',
      'word/header1.xml',
      'word/header2.xml',
      'word/footer1.xml',
      'word/footer2.xml',
    ];

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

    // 3. Save filled docx and convert to PDF via LibreOffice
    fs.writeFileSync(docxPath, filledDocx);
    execSync(`"${SOFFICE_PATH}" --headless --convert-to pdf --outdir "${tmpDir}" "${docxPath}"`, {
      timeout: 30000,
    });

    const orderNum = order || data.course_code || 'invoice';
    const pdfBuffer = fs.readFileSync(pdfFile);

    // 4. Cleanup temp files
    try { fs.unlinkSync(docxPath); } catch (_) {}
    try { fs.unlinkSync(pdfFile); } catch (_) {}

    // 5. Upload PDF to Google Drive as backup
    try {
      const { Readable } = await import('stream');
      const uploadDrive = await getDriveClient();
      const pdfStream = Readable.from(pdfBuffer);

      const uploadRes = await uploadDrive.files.create({
        requestBody: {
          name: `ProFormaInvoice_${orderNum}.pdf`,
          parents: [DRIVE_FOLDER_ID],
          mimeType: 'application/pdf',
        },
        media: {
          mimeType: 'application/pdf',
          body: pdfStream,
        },
        fields: 'id, webViewLink',
      });

      const driveUrl = uploadRes.data.webViewLink ?? null;
      console.log(`[proforma] Uploaded to Drive: ${driveUrl}`);

      // Save Drive URL to the enrollment record
      if (driveUrl) {
        if (data.enrolment_id) {
          const rawId = data.enrolment_id.replace('#', '');
          await pool.query('UPDATE enrollment SET pro_forma_url = $1 WHERE enrolment_id = $2', [driveUrl, rawId]);
        } else if (data.enrollment_id) {
          await pool.query('UPDATE enrollment SET pro_forma_url = $1 WHERE id = $2', [driveUrl, data.enrollment_id]);
        }
      }
    } catch (uploadErr) {
      console.error(`[proforma] Drive upload failed (PDF still returned): ${uploadErr}`);
    }

    // 7. Return PDF to browser as usual
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ProFormaInvoice_${orderNum}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).end(pdfBuffer);

  } catch (err) {
    console.error('[proforma] Error:', err);
    try { fs.unlinkSync(docxPath); } catch (_) {}
    try { fs.unlinkSync(pdfFile); } catch (_) {}
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
}