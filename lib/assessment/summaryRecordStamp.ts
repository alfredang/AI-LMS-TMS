/**
 * Assessment Summary Record (ASR) e-signing.
 *
 * The last page of every Tertiary ASR template carries a four-column sign-off
 * table — a label cell and a value cell for the candidate on the left, the
 * same for the assessor on the right:
 *
 *     Candidate Name (As in NRIC)   | ____ | Assessor Name                  | ____
 *     NRIC (Last 3 digits & alphabet)| ____ | NRIC (Last 3 digits & alphabet)| ____
 *     Candidate Signature           | ____ | Assessor Signature             | ____
 *     Date:                         | ____ | Date:                          | ____
 *
 * Given the template PDF and the details of whichever parties have signed,
 * this module draws name / NRIC / date text and the signature PNG into the
 * matching value cells. It always starts from the blank template, so the
 * learner and the trainer can sign in either order and the output is simply
 * regenerated with every block that exists.
 *
 * Geometry is derived from the label text positions (pdfjs), not hard-coded:
 * a column's value cell starts a little after the widest label of that column
 * and ends just before the next column's labels (or the table's right edge),
 * so the same code serves every course's ASR as long as it keeps the house
 * layout. Nothing is stamped when the sign-off table cannot be found.
 */

import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { ensurePdfjsNodeGlobals } from './pdfjsNodePolyfill';

export type Party = 'learner' | 'trainer';
export type FieldKey = 'name' | 'nric' | 'signature' | 'date';

export interface PartyDetails {
  name: string;
  /** Full NRIC; masked to the last 3 digits + letter when the label asks for it */
  nric: string;
  /** Display string, e.g. 25/09/2026 */
  date: string;
  signaturePng: Buffer | null;
}

export interface SummaryStampInput {
  learner?: PartyDetails | null;
  trainer?: PartyDetails | null;
}

export interface SummaryStampResult {
  buffer: Buffer;
  /** Fields drawn, per party, in document order */
  filled: { learner: FieldKey[]; trainer: FieldKey[] };
  /** True when the sign-off table was not found in the template */
  tableNotFound: boolean;
  /** 0-based page index of the sign-off table (-1 when not found) */
  page: number;
}

// ── Template geometry ─────────────────────────────────────────────────────────

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

interface CellLabel extends TextItem {
  key: FieldKey;
  /** The label asks for a masked NRIC ("Last 3 digits & alphabet") */
  maskNric: boolean;
}

interface ColumnGeometry {
  labels: Partial<Record<FieldKey, CellLabel>>;
  /** Value cell x-range */
  xStart: number;
  xEnd: number;
  /** Row pitch (distance between adjacent label baselines) */
  rowHeight: number;
}

export interface SignOffTable {
  page: number;
  pageWidth: number;
  pageHeight: number;
  learner: ColumnGeometry;
  trainer: ColumnGeometry;
}

const CANDIDATE_NAME_RE = /^(candidate|learner|trainee|student|participant)(?:['’]s)?\s*name\b/i;
const ASSESSOR_NAME_RE = /^(assessor|trainer)(?:['’]s)?\s*name\b/i;
const CANDIDATE_SIG_RE = /^(candidate|learner|trainee|student|participant)(?:['’]s)?\s*signature\b/i;
const ASSESSOR_SIG_RE = /^(assessor|trainer)(?:['’]s)?\s*signature\b/i;
const NRIC_RE = /^(?:nric|ic|nric\s*(?:no|number)\.?)\b/i;
const DATE_RE = /^date\b/i;
const MASK_RE = /last\s*3/i;

/** Padding between a label cell's text and the value cell it borders. */
const CELL_PAD = 12;
/** Inset of the drawn value from the value cell's left edge. */
const VALUE_INSET = 8;
const MAX_TEXT_SIZE = 11;
const MIN_TEXT_SIZE = 7;
const MAX_SIGNATURE_HEIGHT = 28;
const INK = rgb(0.05, 0.05, 0.4);

async function extractPageItems(bytes: Buffer): Promise<{ width: number; height: number; items: TextItem[] }[]> {
  ensurePdfjsNodeGlobals();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const pages: { width: number; height: number; items: TextItem[] }[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      type Raw = { str: string; transform: number[]; width: number; height: number };
      const items = (content.items as unknown as Raw[])
        .filter(it => typeof it.str === 'string' && it.str.trim().length > 0)
        .map(it => ({
          str: it.str.trim(),
          x: it.transform[4],
          y: it.transform[5],
          width: it.width,
          size: Math.abs(it.transform[3]) || it.height || 11,
        }));
      pages.push({ width: vp.width, height: vp.height, items });
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

/**
 * Locate the sign-off table. The page must carry both a candidate-name and an
 * assessor-name label; every other label on that page is assigned to the
 * column whose name label it sits under (by x), picking the nearest row when a
 * label repeats.
 */
export function findSignOffTable(pages: { width: number; height: number; items: TextItem[] }[]): SignOffTable | null {
  for (let p = pages.length - 1; p >= 0; p--) {
    const { items, width, height } = pages[p];
    const candName = items.find(it => CANDIDATE_NAME_RE.test(it.str));
    const assName = items.find(it => ASSESSOR_NAME_RE.test(it.str));
    if (!candName || !assName) continue;

    // Column split: labels are centred in their cells and vary in width, so
    // split halfway between the centres of the two name labels.
    const split = ((candName.x + candName.width / 2) + (assName.x + assName.width / 2)) / 2;
    const learnerLabels: Partial<Record<FieldKey, CellLabel>> = {};
    const trainerLabels: Partial<Record<FieldKey, CellLabel>> = {};
    const assign = (it: TextItem, key: FieldKey) => {
      const target = it.x < split ? learnerLabels : trainerLabels;
      const label: CellLabel = { ...it, key, maskNric: key === 'nric' && MASK_RE.test(it.str) };
      // Keep the label closest (vertically) to the column's name label — the
      // sign-off block — should a page repeat "Date:" elsewhere.
      const anchor = it.x < split ? candName : assName;
      const prev = target[key];
      if (!prev || Math.abs(it.y - anchor.y) < Math.abs(prev.y - anchor.y)) target[key] = label;
    };

    for (const it of items) {
      if (CANDIDATE_NAME_RE.test(it.str) || ASSESSOR_NAME_RE.test(it.str)) assign(it, 'name');
      else if (CANDIDATE_SIG_RE.test(it.str) || ASSESSOR_SIG_RE.test(it.str)) assign(it, 'signature');
      else if (NRIC_RE.test(it.str)) assign(it, 'nric');
      else if (DATE_RE.test(it.str)) assign(it, 'date');
    }
    // A trailing "NRIC ... alphabet)" label is sometimes split into two text
    // items; merge the mask hint from any NRIC-ish item on the same baseline.
    for (const col of [learnerLabels, trainerLabels]) {
      const n = col.nric;
      if (n && !n.maskNric) {
        n.maskNric = items.some(it => Math.abs(it.y - n.y) <= 2 && it.x >= n.x && MASK_RE.test(it.str));
      }
    }

    const rightEdge = (labels: Partial<Record<FieldKey, CellLabel>>) =>
      Math.max(...Object.values(labels).map(l => l!.x + l!.width));
    const leftEdge = (labels: Partial<Record<FieldKey, CellLabel>>) =>
      Math.min(...Object.values(labels).map(l => l!.x));
    const pitch = (labels: Partial<Record<FieldKey, CellLabel>>) => {
      const ys = Object.values(labels).map(l => l!.y).sort((a, b) => b - a);
      const gaps: number[] = [];
      for (let i = 1; i < ys.length; i++) gaps.push(ys[i - 1] - ys[i]);
      return gaps.length ? Math.min(...gaps.filter(g => g > 4)) || 30 : 30;
    };

    // Table right edge: the widest text on the page (the "By signing…" note
    // spans the assessor column) plus a little breathing room.
    const pageRight = Math.min(width - 12, Math.max(...items.map(it => it.x + it.width)) + CELL_PAD);

    const learnerCol: ColumnGeometry = {
      labels: learnerLabels,
      xStart: rightEdge(learnerLabels) + CELL_PAD,
      xEnd: leftEdge(trainerLabels) - CELL_PAD,
      rowHeight: pitch(learnerLabels),
    };
    const trainerCol: ColumnGeometry = {
      labels: trainerLabels,
      xStart: rightEdge(trainerLabels) + CELL_PAD,
      xEnd: pageRight,
      rowHeight: pitch(trainerLabels),
    };
    if (learnerCol.xEnd - learnerCol.xStart < 40 || trainerCol.xEnd - trainerCol.xStart < 40) continue;

    return { page: p, pageWidth: width, pageHeight: height, learner: learnerCol, trainer: trainerCol };
  }
  return null;
}

// ── Values ────────────────────────────────────────────────────────────────────

/** "S1234567A" → "567A" as the ASR asks; anything else is returned untouched. */
export function maskNric(nric: string): string {
  const v = (nric || '').trim().toUpperCase();
  const m = v.match(/^[A-Z]\d{7}[A-Z]$/);
  return m ? v.slice(-4) : v;
}

/**
 * Draw a value inside a cell: shrink to fit, then wrap onto two lines (at a
 * word boundary) when a long name still overflows, and only cut the text short
 * as a last resort. `rowHeight` bounds the two-line layout.
 */
function drawFittedText(page: PDFPage, font: PDFFont, text: string, x: number, y: number, maxWidth: number, size: number, rowHeight: number) {
  const fits = (t: string, s: number) => font.widthOfTextAtSize(t, s) <= maxWidth;
  let s = Math.min(size, MAX_TEXT_SIZE);
  const oneLineMin = 9;
  while (s > oneLineMin && !fits(text, s)) s -= 0.5;
  if (fits(text, s)) {
    page.drawText(text, { x, y, size: s, font, color: INK });
    return;
  }

  // Two lines: split as evenly as possible at a space.
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1 && rowHeight >= 20) {
    let best: [string, string] | null = null;
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const diff = Math.abs(font.widthOfTextAtSize(a, 10) - font.widthOfTextAtSize(b, 10));
      if (diff < bestDiff) { bestDiff = diff; best = [a, b]; }
    }
    if (best) {
      let ls = Math.min(size, 9);
      while (ls > MIN_TEXT_SIZE && !(fits(best[0], ls) && fits(best[1], ls))) ls -= 0.5;
      if (fits(best[0], ls) && fits(best[1], ls)) {
        const gap = ls * 0.62;
        page.drawText(best[0], { x, y: y + gap, size: ls, font, color: INK });
        page.drawText(best[1], { x, y: y - gap, size: ls, font, color: INK });
        return;
      }
    }
  }

  // Last resort: smallest size, cut to the cell width.
  s = MIN_TEXT_SIZE;
  let t = text;
  while (t.length > 1 && !fits(t, s)) t = t.slice(0, -1);
  page.drawText(t, { x, y, size: s, font, color: INK });
}

function drawSignature(page: PDFPage, img: PDFImage, col: ColumnGeometry, label: CellLabel) {
  const cellWidth = col.xEnd - col.xStart - VALUE_INSET * 2;
  let h = Math.min(MAX_SIGNATURE_HEIGHT, Math.max(14, col.rowHeight - 6));
  let w = h * (img.width / img.height);
  if (w > cellWidth) { w = cellWidth; h = w * (img.height / img.width); }
  // Centre the image on the label's x-height so it sits in the middle of the row.
  const centreY = label.y + label.size * 0.35;
  page.drawImage(img, { x: col.xStart + VALUE_INSET, y: centreY - h / 2, width: w, height: h });
}

function stampColumn(
  page: PDFPage,
  font: PDFFont,
  col: ColumnGeometry,
  details: PartyDetails,
  sig: PDFImage | null,
): FieldKey[] {
  const filled: FieldKey[] = [];
  const maxWidth = col.xEnd - col.xStart - VALUE_INSET * 2;
  const order: FieldKey[] = ['name', 'nric', 'signature', 'date'];
  for (const key of order) {
    const label = col.labels[key];
    if (!label) continue;
    if (key === 'signature') {
      if (!sig) continue;
      drawSignature(page, sig, col, label);
      filled.push(key);
      continue;
    }
    const value = key === 'name' ? details.name
      : key === 'nric' ? (label.maskNric ? maskNric(details.nric) : details.nric)
      : details.date;
    if (!value) continue;
    drawFittedText(page, font, value, col.xStart + VALUE_INSET, label.y, maxWidth, label.size, col.rowHeight);
    filled.push(key);
  }
  return filled;
}

/**
 * Draw the signed parties into the template. Returns the template unchanged
 * (with `tableNotFound`) when the sign-off table cannot be located.
 */
export async function stampSummaryRecord(templateBytes: Buffer, input: SummaryStampInput): Promise<SummaryStampResult> {
  const pages = await extractPageItems(templateBytes);
  const table = findSignOffTable(pages);
  if (!table) {
    return { buffer: templateBytes, filled: { learner: [], trainer: [] }, tableNotFound: true, page: -1 };
  }

  const pdf = await PDFDocument.load(new Uint8Array(templateBytes), { ignoreEncryption: true, updateMetadata: false });
  const page = pdf.getPage(table.page);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const filled = { learner: [] as FieldKey[], trainer: [] as FieldKey[] };

  for (const party of ['learner', 'trainer'] as Party[]) {
    const details = input[party];
    if (!details) continue;
    const sig = details.signaturePng ? await pdf.embedPng(new Uint8Array(details.signaturePng)) : null;
    filled[party] = stampColumn(page, font, table[party], details, sig);
  }

  const out = await pdf.save({ useObjectStreams: false });
  return { buffer: Buffer.from(out), filled, tableNotFound: false, page: table.page };
}

/** Inspect a template without drawing — used to validate a course's ASR link. */
export async function inspectSummaryRecordTemplate(templateBytes: Buffer): Promise<SignOffTable | null> {
  return findSignOffTable(await extractPageItems(templateBytes));
}
