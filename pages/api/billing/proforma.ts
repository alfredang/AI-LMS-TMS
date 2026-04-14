import type { NextApiRequest, NextApiResponse } from 'next';
import PizZip from 'pizzip';
import { Readable } from 'stream';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';

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
  if (!Number.isFinite(amount1) || amount1 < 0) {
    return res.status(400).json({
      error: 'Invalid course fee',
      detail: 'course_fees_exclude_gst is missing or not a number. Set course fees on the course in admin.',
    });
  }

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

  try {
    // 1. Download template as docx — same OAuth Drive client as invoice PDF uploads (Company Settings)
    const drive = await getDriveClient();

    const exportRes = await drive.files.export(
      { fileId: TEMPLATE_ID, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { responseType: 'arraybuffer' }
    );

    const docxBuffer = Buffer.from(exportRes.data as ArrayBuffer);

    // 2. Use PizZip to open the docx and do raw XML find-replace
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

    // 3. Upload filled docx to Drive as a Google Doc (Drive converts automatically)
    const tempDocRes = await drive.files.create({
      requestBody: {
        name: '_temp_proforma_convert',
        mimeType: 'application/vnd.google-apps.document',
      },
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: Readable.from(filledDocx),
      },
      fields: 'id',
    });

    const tempDocId = tempDocRes.data.id!;

    // 4. Export the Google Doc as PDF
    const pdfExport = await drive.files.export(
      { fileId: tempDocId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    const pdfBuffer = Buffer.from(pdfExport.data as ArrayBuffer);

    // 5. Delete the temp Google Doc
    await drive.files.delete({ fileId: tempDocId }).catch((e: any) => {
      console.warn(`[proforma] Failed to delete temp doc ${tempDocId}: ${e?.message}`);
    });

    // 6. Return PDF to browser
    const orderNum = order || data.course_code || 'invoice';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ProFormaInvoice_${orderNum}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).end(pdfBuffer);

  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[proforma] Error:', err);
    res.status(500).json({
      error: 'Failed to generate PDF',
      detail,
    });
  }
}