/**
 * Render a trainer billing invoice to PDF, mirroring the Bill document
 * QuickBooks itself prints.
 *
 * WHY WE DRAW IT: the QBO Accounting API has no PDF resource for a supplier
 * Bill. /pdf exists for sales transactions only (Invoice, Estimate,
 * SalesReceipt, CreditMemo, RefundReceipt, PurchaseOrder). Verified against the
 * live realm on 2026-08-13: GET /v3/company/{realm}/bill/{id}/pdf returned 400
 * for a Bill id the same API had just resolved by DocNumber, while an Invoice
 * PDF fetched fine on the identical token. The "Print preview" in the QBO web
 * UI is a browser feature on an internal endpoint OAuth cannot reach.
 *
 * So the layout below deliberately follows QBO's printed Bill — letterhead,
 * Supplier / Bill Number / Bill Date / Due Date block, DESCRIPTION/QTY/RATE/
 * AMOUNT table, then TOTAL / PAYMENT PAID / BALANCE DUE — so the archived file
 * reads the same as what Finance sees in QuickBooks.
 *
 * Kept free of DB and network access so it can be rendered and eyeballed
 * offline (see scripts/preview-trainer-bill.ts). Branding is passed in.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { BillBranding } from './billBranding';

export interface TrainerBillPdfInput {
  billNo: string;
  /** YYYY-MM-DD — bill date. */
  billDate: string;
  /** YYYY-MM-DD — defaults to the bill date, as QBO does for these. */
  dueDate?: string | null;
  /** Supplier, i.e. the trainer as named in QuickBooks. */
  trainerName: string;
  courseTitle: string;
  courseCode?: string | null;
  amount: number;
  /** Already settled against the bill in QBO. Defaults to 0 (freshly raised). */
  paidAmount?: number;
  branding?: BillBranding | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;

const INK = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.78, 0.8, 0.83);
const QBO_BLUE = rgb(0.05, 0.36, 0.6);
const BAND = rgb(0.85, 0.91, 0.96);

function formatDMY(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(ymd || '');
}

function formatMoney(amount: number): string {
  const n = Number(amount);
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * pdf-lib's built-in fonts are WinAnsi-encoded and THROW on characters outside
 * that set. Trainer and course names are free text (curly quotes, en-dashes and
 * the occasional non-Latin character have all turned up), so everything is
 * sanitised before it reaches drawText — an unrenderable name must never be
 * able to fail a billing run.
 */
function sanitize(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      let chunk = '';
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    } else line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function drawRight(
  page: PDFPage, text: string, right: number, y: number, font: PDFFont, size: number, color = INK
) {
  const clean = sanitize(text);
  page.drawText(clean, { x: right - font.widthOfTextAtSize(clean, size), y, size, font, color });
}

export async function buildTrainerBillPdf(input: TrainerBillPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const right = width - MARGIN;
  let y = height - MARGIN;

  const b = input.branding || null;
  const total = Number(input.amount) || 0;
  const paid = Number(input.paidAmount) || 0;
  const balance = total - paid;

  doc.setTitle(`Bill ${sanitize(input.billNo)}`);
  doc.setSubject(`Trainer payout — ${sanitize(input.courseTitle)}`);
  doc.setProducer('Tertiary Infotech LMS/TMS');

  // ---- Letterhead: logo left, company block right ------------------------
  const headerTop = y;
  if (b?.logo) {
    try {
      const img = b.logo.kind === 'png' ? await doc.embedPng(b.logo.bytes) : await doc.embedJpg(b.logo.bytes);
      const maxW = 190;
      const maxH = 60;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: headerTop - h, width: w, height: h });
    } catch (e) {
      // A corrupt logo must not cost us the document.
      console.warn('[payroll] bill logo could not be embedded:', e instanceof Error ? e.message : e);
    }
  }

  // Company block, right-aligned against the logo — the arrangement QBO prints.
  let ry = headerTop - 2;
  drawRight(page, b?.companyName || 'Training Provider', right, ry, bold, 10);
  ry -= 13;

  const headerLines = [
    ...(b?.addressLines || []),
    ...(b?.tel ? [b.tel] : []),
    ...(b?.email ? [b.email] : []),
    ...(b?.website ? [b.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')] : []),
    ...(b?.registrationNo ? [`Company Registration No. ${b.registrationNo}`] : []),
  ];
  // Wrapped so a long address (or a tenant with a longer name) can never run
  // wide into the logo or past the right margin.
  const headerWidth = 200;
  for (const line of headerLines) {
    for (const part of wrap(line, regular, 8, headerWidth)) {
      drawRight(page, part, right, ry, regular, 8, MUTED);
      ry -= 10;
    }
  }

  y = Math.min(ry, headerTop - 72) - 26;

  // ---- "Bill" + supplier / reference block -------------------------------
  page.drawText('Bill', { x: MARGIN, y, size: 15, font: bold, color: QBO_BLUE });
  y -= 22;

  const refLabelX = width - MARGIN - 175;
  const label = (t: string, x: number, yy: number) =>
    page.drawText(t, { x, y: yy, size: 8.5, font: regular, color: MUTED });

  label('Supplier', MARGIN, y);
  label('Bill Number', refLabelX, y);
  drawRight(page, input.billNo, right, y, regular, 9);
  y -= 13;

  page.drawText(sanitize(input.trainerName || '-'), { x: MARGIN, y, size: 10, font: regular, color: INK });
  label('Bill Date', refLabelX, y);
  drawRight(page, formatDMY(input.billDate), right, y, regular, 9);
  y -= 13;

  label('Due Date', refLabelX, y);
  drawRight(page, formatDMY(input.dueDate || input.billDate), right, y, regular, 9);
  y -= 26;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 26;

  // ---- Line table --------------------------------------------------------
  const amountRight = right;
  const rateRight = right - 78;
  const qtyRight = right - 148;
  const descWidth = qtyRight - MARGIN - 60;

  page.drawRectangle({ x: MARGIN, y: y - 5, width: right - MARGIN, height: 18, color: BAND });
  page.drawText('DESCRIPTION', { x: MARGIN + 6, y, size: 8, font: bold, color: QBO_BLUE });
  drawRight(page, 'QTY', qtyRight, y, bold, 8, QBO_BLUE);
  drawRight(page, 'RATE', rateRight, y, bold, 8, QBO_BLUE);
  drawRight(page, 'AMOUNT', amountRight - 6, y, bold, 8, QBO_BLUE);
  y -= 24;

  const descLines = wrap(input.courseTitle || 'Training services', regular, 9.5, descWidth);
  const rowTop = y;
  for (const line of descLines) {
    page.drawText(line, { x: MARGIN + 6, y, size: 9.5, font: regular, color: INK });
    y -= 13;
  }
  // QTY and RATE stay blank: these are account-based expense lines, exactly as
  // QuickBooks prints them for a category-coded bill.
  drawRight(page, formatMoney(total), amountRight - 6, rowTop, regular, 9.5);

  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.6, color: RULE });
  y -= 22;

  // ---- Totals ------------------------------------------------------------
  const totalsLabelRight = right - 120;
  drawRight(page, 'TOTAL', totalsLabelRight, y, regular, 9.5, MUTED);
  drawRight(page, formatMoney(total), amountRight - 6, y, regular, 9.5);
  y -= 15;

  drawRight(page, 'PAYMENT PAID', totalsLabelRight, y, regular, 9.5, MUTED);
  drawRight(page, formatMoney(paid), amountRight - 6, y, regular, 9.5);
  y -= 20;

  drawRight(page, 'BALANCE DUE', totalsLabelRight, y, bold, 11, INK);
  drawRight(page, `SGD ${formatMoney(balance)}`, amountRight - 6, y, bold, 13, INK);
  y -= 26;

  if (input.courseCode) {
    page.drawText(sanitize(`Course code: ${input.courseCode}`), {
      x: MARGIN, y, size: 8, font: regular, color: MUTED,
    });
    y -= 12;
  }
  page.drawText('Amounts are out of scope of GST.', {
    x: MARGIN, y, size: 8, font: regular, color: MUTED,
  });

  page.drawText('Computer-generated document. No signature is required.', {
    x: MARGIN, y: MARGIN, size: 7.5, font: regular, color: MUTED,
  });

  return Buffer.from(await doc.save());
}

/**
 * Drive file name for a bill. Keyed on the bill number, which is unique among
 * live bills — the Drive upload dedups by name, so re-filing the same bill
 * finds its existing file instead of creating a second copy.
 */
export function buildTrainerBillPdfFileName(billNo: string, trainerName?: string | null): string {
  const who = sanitize(trainerName || '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const ref = sanitize(billNo).replace(/[^a-zA-Z0-9]+/g, '') || 'TRAINER_BILL';
  return who ? `${ref}_${who}.pdf` : `${ref}.pdf`;
}
