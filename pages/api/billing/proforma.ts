import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import PizZip from 'pizzip';

interface Grant {
  funding_scheme: string;
  estimated_amount: string;
  approved_amount: string;
  status: string;
}

interface ProFormaRequest {
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
const SOFFICE_PATH = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';

function getAuth() {
  const keyFile = path.join(process.cwd(), 'service-account.json');
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const data: ProFormaRequest = req.body;

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

  // Replacements — keys match {{key}} placeholders in the Google Doc template
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
    // 1. Download template as docx from Google Drive (read-only, no storage used)
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    const exportRes = await drive.files.export(
      { fileId: TEMPLATE_ID, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { responseType: 'arraybuffer' }
    );

    const docxBuffer = Buffer.from(exportRes.data as ArrayBuffer);

    // 2. Use PizZip to open the docx and do raw XML find-replace
    //    This avoids docxtemplater parsing issues with {{}} syntax
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
          // Escape special regex chars in placeholder
          const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          xml = xml.replace(new RegExp(escaped, 'g'), value);
        }
        zip.file(xmlFile, xml);
      }
    }

    const filledDocx = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

    // 3. Save filled docx to temp folder
    fs.writeFileSync(docxPath, filledDocx);

    // 4. Convert to PDF using LibreOffice
    execSync(`"${SOFFICE_PATH}" --headless --convert-to pdf --outdir "${tmpDir}" "${docxPath}"`, {
      timeout: 30000,
    });

    // 5. Read the PDF
    const orderNum = order || data.course_code || 'invoice';
    const pdfBuffer = fs.readFileSync(pdfFile);

    // 6. Clean up temp files
    try { fs.unlinkSync(docxPath); } catch (_) {}
    try { fs.unlinkSync(pdfFile); } catch (_) {}

    // 7. Return PDF to browser
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