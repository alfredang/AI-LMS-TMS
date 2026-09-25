/**
 * Assessor sign-off stamping for learner assessment submissions.
 *
 * Every Tertiary assessment paper ends with an assessor block:
 *
 *     Assessor Name: ____           Assessor NRIC: ____
 *     Date: ____                    Signature: ____
 *
 * Given the trainer's assessor details this module fills those blanks in the
 * learner's submitted file, in place, for the two formats learners upload:
 *
 *   - PDF  : text positions are located with pdfjs, the values are drawn with
 *            pdf-lib at the end of each label; the signature PNG is drawn as an
 *            image after "Signature:".
 *   - DOCX : the WordprocessingML is edited directly (PizZip). Values are added
 *            as extra <w:t> text inside the run holding the label, so they pick
 *            up the label's font; the signature is an inline <w:drawing>.
 *
 * Both formats share one planner (`planFills`): a document is reduced to an
 * ordered list of "lines" (PDF: text items on one baseline; DOCX: paragraphs),
 * the planner decides which label occurrences to fill and where, and the
 * format-specific applier does the writing.
 *
 * Rules the planner follows:
 *   - "Assessor Name:" / "Assessor NRIC:" are always eligible.
 *   - "Date:" / "Signature:" are only eligible within a few lines AFTER an
 *     assessor label, so the learner's own declaration block (which usually has
 *     its own Date/Signature) is never touched. They are also skipped when
 *     preceded by Learner/Candidate/Trainee/Student.
 *   - A label already followed by text is considered filled and left alone.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PizZip from 'pizzip';
import { ensurePdfjsNodeGlobals } from './pdfjsNodePolyfill';

export type LabelKey = 'name' | 'nric' | 'date' | 'signature';

export interface AssessorDetails {
  name: string;
  nric: string;
  /** Display string, e.g. 25/09/2026 */
  date: string;
  /** PNG bytes of the drawn signature, or null to leave "Signature:" blank */
  signaturePng: Buffer | null;
}

export interface StampResult {
  buffer: Buffer;
  /** Labels that were filled, in document order (may repeat for multi-part papers) */
  filled: LabelKey[];
  /** True when nothing in the document matched any assessor label */
  noLabelsFound: boolean;
}

// ── Label detection (shared) ───────────────────────────────────────────────────

interface LabelDef {
  key: LabelKey;
  re: RegExp;
  /** Needs a preceding assessor anchor line */
  needsAnchor: boolean;
}

// Word boundaries are hand-rolled with lookbehinds because the PDF path joins
// text items without separators ("Assessor" + "Name:" → "AssessorName:").
const LABELS: LabelDef[] = [
  { key: 'name', re: /assessor(?:['’]s)?\s*name\s*:/gi, needsAnchor: false },
  { key: 'nric', re: /assessor(?:['’]s)?\s*(?:nric|ic|nric\s*(?:no|number)\.?|id)\s*:/gi, needsAnchor: false },
  {
    key: 'date',
    re: /(?<!(?:learner|candidate|trainee|student|participant)(?:['’]s)?\s*)(?<![a-z])date(?:\s+of\s+assessment)?\s*:/gi,
    needsAnchor: true,
  },
  {
    key: 'signature',
    re: /(?<!(?:learner|candidate|trainee|student|participant)(?:['’]s)?\s*)(?<![a-z])signature\s*:/gi,
    needsAnchor: true,
  },
];

/** How many lines after an assessor label "Date:" / "Signature:" stay eligible. */
const ANCHOR_WINDOW = 8;

/** Text after a label that still counts as "blank" (underscores, dots, tabs…). */
const BLANK_RE = /^[\s_\-.·:]*$/;

export interface PlannedFill {
  line: number;
  /** Character index in the line's text right after the label's colon */
  at: number;
  /** End of the blank region that follows the label (next label or end of line) */
  blankEnd: number;
  key: LabelKey;
}

interface LabelHit {
  key: LabelKey;
  start: number;
  end: number;
  needsAnchor: boolean;
}

function findLabelHits(text: string): LabelHit[] {
  const hits: LabelHit[] = [];
  for (const def of LABELS) {
    def.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = def.re.exec(text))) {
      hits.push({ key: def.key, start: m.index, end: m.index + m[0].length, needsAnchor: def.needsAnchor });
      if (m[0].length === 0) def.re.lastIndex++;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

/**
 * Decide which labels to fill. `lines` are the document's text lines in
 * reading order; `alreadyFilled(line, key)` lets a format veto a fill it can
 * see is already done (e.g. a DOCX paragraph that already holds our drawing).
 */
export function planFills(
  lines: string[],
  alreadyFilled?: (line: number, key: LabelKey) => boolean,
): { fills: PlannedFill[]; sawAnyLabel: boolean } {
  const fills: PlannedFill[] = [];
  let sawAnyLabel = false;
  let anchorLine = -Infinity;

  lines.forEach((text, lineIdx) => {
    const hits = findLabelHits(text);
    if (hits.length === 0) return;
    sawAnyLabel = true;

    // An assessor-name/NRIC label anchors the window for Date/Signature.
    if (hits.some(h => !h.needsAnchor)) anchorLine = lineIdx;

    hits.forEach((hit, i) => {
      if (hit.needsAnchor && lineIdx - anchorLine > ANCHOR_WINDOW) return;
      const nextStart = i + 1 < hits.length ? hits[i + 1].start : text.length;
      const rest = text.slice(hit.end, nextStart);
      if (!BLANK_RE.test(rest)) return; // already has a value
      if (alreadyFilled && alreadyFilled(lineIdx, hit.key)) return;
      fills.push({ line: lineIdx, at: hit.end, blankEnd: nextStart, key: hit.key });
    });
  });

  return { fills, sawAnyLabel };
}

function valueFor(key: LabelKey, d: AssessorDetails): string {
  switch (key) {
    case 'name': return d.name;
    case 'nric': return d.nric;
    case 'date': return d.date;
    default: return '';
  }
}

// ── PNG helpers ────────────────────────────────────────────────────────────────

export function pngDimensions(png: Buffer): { width: number; height: number } {
  // IHDR is always the first chunk: width @16, height @20 (big-endian)
  if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Signature is not a PNG image');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Accepts a data URL or bare base64 and returns PNG bytes. */
export function signatureDataUrlToPng(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/s);
  const b64 = m ? m[1] : dataUrl;
  const buf = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  pngDimensions(buf); // validates
  return buf;
}

// ── PDF ────────────────────────────────────────────────────────────────────────

interface PdfSegment {
  text: string;
  start: number; // offset in the joined line text
  x: number;
  width: number;
  y: number;
  size: number;
}

interface PdfLine {
  page: number; // 0-based
  segments: PdfSegment[];
  text: string;
}

/** Signature image height on the page, in points. */
const PDF_SIGNATURE_HEIGHT = 26;
const PDF_VALUE_GAP = 4;

async function extractPdfLines(bytes: Buffer): Promise<PdfLine[]> {
  // pdfjs is ESM-only; import lazily so this module stays importable from
  // CommonJS API routes and the Next server bundle. It also reads DOMMatrix at
  // load time, which Node lacks — see pdfjsNodePolyfill.
  ensurePdfjsNodeGlobals();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // No fonts/canvas needed for text extraction; keep pdfjs quiet and offline.
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const lines: PdfLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      type Item = { str: string; transform: number[]; width: number; height: number };
      const items = (content.items as unknown as Item[]).filter(it => typeof it.str === 'string' && it.str.length > 0);

      // Group by baseline (y), 2pt tolerance; keep reading order within a line.
      const buckets: { y: number; items: Item[] }[] = [];
      for (const it of items) {
        const y = it.transform[5];
        let b = buckets.find(bk => Math.abs(bk.y - y) <= 2);
        if (!b) { b = { y, items: [] }; buckets.push(b); }
        b.items.push(it);
      }
      buckets.sort((a, b) => b.y - a.y); // top of page first

      for (const b of buckets) {
        b.items.sort((a, c) => a.transform[4] - c.transform[4]);
        const segments: PdfSegment[] = [];
        let text = '';
        for (const it of b.items) {
          const size = Math.abs(it.transform[3]) || it.height || 11;
          segments.push({ text: it.str, start: text.length, x: it.transform[4], width: it.width, y: it.transform[5], size });
          text += it.str;
        }
        lines.push({ page: p - 1, segments, text });
      }
    }
  } finally {
    await doc.destroy();
  }
  return lines;
}

/** x-coordinate (points) of character index `at` within a line. */
function pdfXAt(line: PdfLine, at: number): { x: number; y: number; size: number } {
  const idx = Math.max(0, at - 1);
  let seg = line.segments[line.segments.length - 1];
  for (const s of line.segments) {
    if (idx >= s.start && idx < s.start + s.text.length) { seg = s; break; }
  }
  const frac = seg.text.length > 0 ? Math.min(1, (at - seg.start) / seg.text.length) : 1;
  return { x: seg.x + seg.width * frac, y: seg.y, size: seg.size };
}

/** Keyword written into the PDF metadata so a stamped file is never stamped twice. */
const PDF_SIGNED_KEYWORD = 'lms-assessor-signed';

export async function stampPdf(bytes: Buffer, details: AssessorDetails): Promise<StampResult> {
  const pdf = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true, updateMetadata: false });
  const keywords = (() => { try { return pdf.getKeywords() || ''; } catch { return ''; } })();
  if (keywords.includes(PDF_SIGNED_KEYWORD)) {
    return { buffer: bytes, filled: [], noLabelsFound: false };
  }

  const lines = await extractPdfLines(bytes);
  const { fills, sawAnyLabel } = planFills(lines.map(l => l.text));

  if (fills.length === 0) {
    return { buffer: bytes, filled: [], noLabelsFound: !sawAnyLabel };
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sig = details.signaturePng ? await pdf.embedPng(new Uint8Array(details.signaturePng)) : null;
  const filled: LabelKey[] = [];

  for (const f of fills) {
    const line = lines[f.line];
    const page = pdf.getPage(line.page);
    const { x, y, size } = pdfXAt(line, f.at);

    if (f.key === 'signature') {
      if (!sig) continue;
      const h = PDF_SIGNATURE_HEIGHT;
      const w = h * (sig.width / sig.height);
      page.drawImage(sig, { x: x + PDF_VALUE_GAP + 2, y: y - h * 0.3, width: w, height: h });
      filled.push(f.key);
      continue;
    }

    const value = valueFor(f.key, details);
    if (!value) continue;
    const fontSize = Math.min(Math.max(size, 8), 14);
    page.drawText(value, { x: x + PDF_VALUE_GAP, y, size: fontSize, font, color: rgb(0.05, 0.05, 0.4) });
    filled.push(f.key);
  }

  if (filled.length > 0) {
    pdf.setKeywords([...keywords.split(/\s+/).filter(Boolean), PDF_SIGNED_KEYWORD]);
  }
  const out = await pdf.save({ useObjectStreams: false });
  return { buffer: Buffer.from(out), filled, noLabelsFound: false };
}

// ── DOCX ───────────────────────────────────────────────────────────────────────

const SIG_MEDIA_NAME = 'assessor_signature.png';
const SIG_REL_ID = 'rIdAssessorSig';
const SIG_DRAWING_NAME = 'assessor_signature';
const EMU_PER_INCH = 914400;
/** Signature image height in the document, in inches. */
const DOCX_SIGNATURE_HEIGHT_IN = 0.45;

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const xmlUnescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

interface DocxParagraph {
  start: number; // absolute offset of "<w:p"
  end: number;   // absolute offset just past "</w:p>"
}

/**
 * Leaf paragraphs (no nested <w:p>, i.e. not a text-box container) in
 * document order, as absolute offsets into the XML.
 */
function leafParagraphs(xml: string): DocxParagraph[] {
  const tokenRe = /<w:p\b(?:\s[^>]*)?(\/?)>|<\/w:p>/g;
  const stack: { start: number; hasChild: boolean }[] = [];
  const leaves: DocxParagraph[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml))) {
    if (m[0].startsWith('</')) {
      const open = stack.pop();
      if (!open) continue;
      if (!open.hasChild) leaves.push({ start: open.start, end: m.index + m[0].length });
    } else if (m[1] === '/') {
      // self-closing empty paragraph — nothing to fill
      if (stack.length) stack[stack.length - 1].hasChild = true;
    } else {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ start: m.index, hasChild: false });
    }
  }
  return leaves;
}

interface DocxSegment {
  text: string;
  start: number;      // offset in the paragraph's joined text
  insertAt: number;   // absolute XML offset right after this </w:t> (-1 if not a text node)
  elStart: number;    // absolute XML offset of "<w:t" (-1 if not a text node)
}

interface DocxLine {
  para: DocxParagraph;
  xml: string;
  text: string;
  segments: DocxSegment[];
}

function docxLines(xml: string): DocxLine[] {
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>/g;
  return leafParagraphs(xml).map(para => {
    const pxml = xml.slice(para.start, para.end);
    const segments: DocxSegment[] = [];
    let text = '';
    let m: RegExpExecArray | null;
    tokenRe.lastIndex = 0;
    while ((m = tokenRe.exec(pxml))) {
      if (m[0].startsWith('<w:t')) {
        if (m[0].endsWith('/>')) continue;
        const t = xmlUnescape(m[1]);
        segments.push({ text: t, start: text.length, insertAt: para.start + m.index + m[0].length, elStart: para.start + m.index });
        text += t;
      } else {
        const t = m[0].startsWith('<w:tab') ? '\t' : '\n';
        segments.push({ text: t, start: text.length, insertAt: -1, elStart: -1 });
        text += t;
      }
    }
    return { para, xml: pxml, text, segments };
  });
}

/** The <w:rPr> of the run that encloses absolute offset `pos` ('' if none). */
function enclosingRunProps(xml: string, pos: number): string {
  const runOpen = xml.lastIndexOf('<w:r>', pos);
  const runOpenAttr = xml.lastIndexOf('<w:r ', pos);
  const start = Math.max(runOpen, runOpenAttr);
  if (start < 0) return '';
  const openEnd = xml.indexOf('>', start) + 1;
  const m = xml.slice(openEnd, pos).match(/^\s*<w:rPr>[\s\S]*?<\/w:rPr>/);
  return m ? m[0].trim() : '';
}

function buildSignatureDrawingXml(relId: string, cx: number, cy: number): string {
  const id = 7000 + Math.floor(Math.random() * 1000);
  return (
    `<w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="${SIG_DRAWING_NAME}"/>` +
    `<wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${SIG_DRAWING_NAME}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing>`
  );
}

function installSignatureInZip(zip: PizZip, png: Buffer): string {
  zip.file(`word/media/${SIG_MEDIA_NAME}`, png);

  const ctKey = '[Content_Types].xml';
  const ctFile = zip.file(ctKey);
  if (ctFile) {
    let ct = ctFile.asText();
    if (!/<Default\s+Extension="png"/i.test(ct)) {
      ct = ct.replace('</Types>', `<Default Extension="png" ContentType="image/png"/></Types>`);
      zip.file(ctKey, ct);
    }
  }

  const relsKey = 'word/_rels/document.xml.rels';
  const relsFile = zip.file(relsKey);
  let rels = relsFile
    ? relsFile.asText()
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  if (!rels.includes(`Id="${SIG_REL_ID}"`)) {
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${SIG_REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${SIG_MEDIA_NAME}"/></Relationships>`,
    );
    zip.file(relsKey, rels);
  }
  return SIG_REL_ID;
}

export function stampDocx(bytes: Buffer, details: AssessorDetails): StampResult {
  const zip = new PizZip(bytes);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Not a Word document (word/document.xml missing)');
  let xml = docFile.asText();

  const lines = docxLines(xml);
  const { fills, sawAnyLabel } = planFills(
    lines.map(l => l.text),
    (line, key) => key === 'signature' && lines[line].xml.includes(`name="${SIG_DRAWING_NAME}"`),
  );
  if (fills.length === 0) {
    return { buffer: bytes, filled: [], noLabelsFound: !sawAnyLabel };
  }

  let sigRelId = '';
  let sigDrawing = '';
  if (details.signaturePng && fills.some(f => f.key === 'signature')) {
    const { width, height } = pngDimensions(details.signaturePng);
    const cy = Math.round(DOCX_SIGNATURE_HEIGHT_IN * EMU_PER_INCH);
    const cx = Math.round(cy * (width / height));
    sigRelId = installSignatureInZip(zip, details.signaturePng);
    sigDrawing = buildSignatureDrawingXml(sigRelId, cx, cy);
  }

  // Collect absolute edits (replacements and insertions), then apply them
  // back-to-front so earlier offsets stay valid.
  const edits: { start: number; end: number; str: string }[] = [];
  const filled: LabelKey[] = [];
  const withUnderline = (rPr: string) => {
    if (/<w:u\b/.test(rPr)) return rPr;
    return rPr ? rPr.replace('</w:rPr>', '<w:u w:val="single"/></w:rPr>') : '<w:rPr><w:u w:val="single"/></w:rPr>';
  };

  for (const f of fills) {
    const line = lines[f.line];
    const idx = Math.max(0, f.at - 1);
    const seg = line.segments.find(s => idx >= s.start && idx < s.start + s.text.length && s.insertAt >= 0);
    if (!seg) continue;

    // Templates draw the blank as a run of underscores after the label
    // ("Assessor Name: ______"). Remove them so the value takes their place
    // instead of trailing after the line and wrapping.
    let removedBlank = false;
    for (const t of line.segments) {
      if (t.elStart < 0) continue;
      const tStart = t.start, tEnd = t.start + t.text.length;
      const lo = Math.max(tStart, f.at), hi = Math.min(tEnd, f.blankEnd);
      if (lo >= hi) continue;
      const slice = t.text.slice(lo - tStart, hi - tStart);
      if (!/[_]/.test(slice)) continue;
      const cleaned = t.text.slice(0, lo - tStart) + slice.replace(/_+/g, '') + t.text.slice(hi - tStart);
      edits.push({ start: t.elStart, end: t.insertAt, str: `<w:t xml:space="preserve">${xmlEscape(cleaned)}</w:t>` });
      removedBlank = true;
    }

    const rPr = enclosingRunProps(xml, seg.insertAt);

    if (f.key === 'signature') {
      if (!sigDrawing) continue;
      edits.push({ start: seg.insertAt, end: seg.insertAt, str: `</w:r><w:r>${rPr}${sigDrawing}</w:r><w:r>${rPr}` });
      filled.push(f.key);
      continue;
    }

    const value = valueFor(f.key, details);
    if (!value) continue;
    const text = removedBlank ? ` ${value} ` : ` ${value}`;
    const valueRPr = removedBlank ? withUnderline(rPr) : rPr;
    edits.push({
      start: seg.insertAt,
      end: seg.insertAt,
      str: `</w:r><w:r>${valueRPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r><w:r>${rPr}`,
    });
    filled.push(f.key);
  }

  if (filled.length === 0) {
    return { buffer: bytes, filled: [], noLabelsFound: false };
  }

  // Back-to-front; at equal start, pure insertions go first so a replacement
  // ending at that offset is applied to the untouched original slice.
  edits.sort((a, b) => (b.start - a.start) || ((b.end - b.start) - (a.end - a.start)));
  for (const e of edits) xml = xml.slice(0, e.start) + e.str + xml.slice(e.end);
  zip.file('word/document.xml', xml);

  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return { buffer: out, filled, noLabelsFound: false };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export type StampFormat = 'pdf' | 'docx';

export function detectStampFormat(fileName: string, mimeType?: string | null): StampFormat | null {
  const ext = (fileName || '').toLowerCase().split('.').pop() || '';
  const mt = (mimeType || '').toLowerCase();
  if (ext === 'pdf' || mt === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return null;
}

export async function stampAssessment(
  bytes: Buffer,
  format: StampFormat,
  details: AssessorDetails,
): Promise<StampResult> {
  return format === 'pdf' ? stampPdf(bytes, details) : stampDocx(bytes, details);
}

/** dd/mm/yyyy for an ISO date or Date, Singapore convention. */
export function formatSignDate(d: string | Date): string {
  const dt = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d;
  if (isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}
