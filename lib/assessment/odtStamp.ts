/**
 * Assessor sign-off stamping for OpenDocument Text (.odt — LibreOffice /
 * OpenOffice, also what Google Docs "Download as ODT" produces).
 *
 * Same planner and rules as the PDF / DOCX paths (see assessorStamp.ts). The
 * ODT writer edits content.xml directly:
 *   - a "line" is a leaf <text:p> / <text:h>; its text is the raw character
 *     data between tags plus <text:tab/>, <text:s/> and <text:line-break/>;
 *   - values are inserted inside the text node at the label's exact character
 *     offset, wrapped in a <text:span> (underlined when they replace an
 *     underscore blank) — nested spans are valid ODF;
 *   - the signature is an as-char <draw:frame> pointing at Pictures/…png,
 *     registered in META-INF/manifest.xml;
 *   - the two automatic styles the inserts use are added to
 *     <office:automatic-styles>;
 *   - the `mimetype` entry is kept first and uncompressed, as ODF requires.
 */

import PizZip from 'pizzip';
import {
  planFills,
  pngDimensions,
  valueFor,
  xmlEscape,
  xmlUnescape,
  type AssessorDetails,
  type LabelKey,
  type StampResult,
} from './assessorStamp';

const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const SIG_PICTURE = 'Pictures/assessor_signature.png';
const SIG_FRAME_NAME = 'assessor_signature';
const STYLE_UNDERLINE = 'LmsAssessorValue';
const STYLE_FRAME = 'LmsAssessorSig';
/** Signature image height in the document, in cm (≈ the DOCX 0.45in). */
const SIGNATURE_HEIGHT_CM = 1.15;

interface OdtParagraph { start: number; end: number }

/** Leaf <text:p>/<text:h> ranges (no nested paragraph, e.g. not a frame container). */
function leafParagraphs(xml: string): OdtParagraph[] {
  const tokenRe = /<text:(p|h)\b(?:\s[^>]*)?(\/?)>|<\/text:(?:p|h)>/g;
  const stack: { start: number; hasChild: boolean }[] = [];
  const leaves: OdtParagraph[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml))) {
    if (m[0].startsWith('</')) {
      const open = stack.pop();
      if (!open) continue;
      if (!open.hasChild) leaves.push({ start: open.start, end: m.index + m[0].length });
    } else if (m[2] === '/') {
      if (stack.length) stack[stack.length - 1].hasChild = true;
    } else {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ start: m.index, hasChild: false });
    }
  }
  return leaves;
}

interface OdtSegment {
  text: string;
  start: number;    // offset in the paragraph's joined text
  elStart: number;  // absolute XML offset of the raw text node (-1 for tab/space/break elements)
  elEnd: number;    // absolute XML offset just past it
}

interface OdtLine { xml: string; text: string; segments: OdtSegment[] }

/**
 * Tokenise a paragraph into raw text nodes (editable) and whitespace elements
 * (<text:tab/>, <text:s text:c="n"/>, <text:line-break/>). Any other tag
 * (span open/close, frames, bookmarks…) contributes no text.
 */
function odtLines(xml: string): OdtLine[] {
  const tagRe = /<[^>]+>/g;
  return leafParagraphs(xml).map(para => {
    const pxml = xml.slice(para.start, para.end);
    const segments: OdtSegment[] = [];
    let text = '';
    let pos = 0;
    let m: RegExpExecArray | null;
    tagRe.lastIndex = 0;
    const pushText = (from: number, to: number) => {
      if (to <= from) return;
      const raw = pxml.slice(from, to);
      const t = xmlUnescape(raw);
      segments.push({ text: t, start: text.length, elStart: para.start + from, elEnd: para.start + to });
      text += t;
    };
    while ((m = tagRe.exec(pxml))) {
      pushText(pos, m.index);
      const tag = m[0];
      let ws = '';
      if (/^<text:tab\b/.test(tag)) ws = '\t';
      else if (/^<text:line-break\b/.test(tag)) ws = '\n';
      else if (/^<text:s\b/.test(tag)) {
        const c = tag.match(/text:c="(\d+)"/);
        ws = ' '.repeat(c ? parseInt(c[1], 10) : 1);
      }
      if (ws) {
        segments.push({ text: ws, start: text.length, elStart: -1, elEnd: -1 });
        text += ws;
      }
      pos = m.index + tag.length;
    }
    pushText(pos, pxml.length);
    return { xml: pxml, text, segments };
  });
}

function ensureAutomaticStyles(xml: string): string {
  const styles =
    `<style:style style:name="${STYLE_UNDERLINE}" style:family="text">` +
    `<style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/>` +
    `</style:style>` +
    `<style:style style:name="${STYLE_FRAME}" style:family="graphic">` +
    `<style:graphic-properties style:vertical-pos="middle" style:vertical-rel="text" style:wrap="none" ` +
    `fo:padding="0cm" fo:border="none" style:mirror="none" fo:clip="rect(0cm, 0cm, 0cm, 0cm)"/>` +
    `</style:style>`;
  if (xml.includes(`style:name="${STYLE_UNDERLINE}"`)) return xml;
  if (/<office:automatic-styles\s*\/>/.test(xml)) {
    return xml.replace(/<office:automatic-styles\s*\/>/, `<office:automatic-styles>${styles}</office:automatic-styles>`);
  }
  if (xml.includes('</office:automatic-styles>')) {
    return xml.replace('</office:automatic-styles>', `${styles}</office:automatic-styles>`);
  }
  // No automatic-styles block at all — add one before the body.
  return xml.replace(/<office:body\b/, `<office:automatic-styles>${styles}</office:automatic-styles><office:body`);
}

function buildFrameXml(widthCm: number, heightCm: number): string {
  return (
    `<draw:frame draw:style-name="${STYLE_FRAME}" draw:name="${SIG_FRAME_NAME}" text:anchor-type="as-char" ` +
    `svg:width="${widthCm.toFixed(3)}cm" svg:height="${heightCm.toFixed(3)}cm" draw:z-index="0">` +
    `<draw:image xlink:href="${SIG_PICTURE}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="image/png"/>` +
    `</draw:frame>`
  );
}

function installPicture(zip: PizZip, png: Buffer): void {
  zip.file(SIG_PICTURE, png);
  const key = 'META-INF/manifest.xml';
  const f = zip.file(key);
  let manifest = f
    ? f.asText()
    : `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"></manifest:manifest>`;
  if (!manifest.includes(`manifest:full-path="${SIG_PICTURE}"`)) {
    manifest = manifest.replace(
      '</manifest:manifest>',
      `<manifest:file-entry manifest:full-path="${SIG_PICTURE}" manifest:media-type="image/png"/></manifest:manifest>`,
    );
    zip.file(key, manifest);
  }
}

export function stampOdt(bytes: Buffer, details: AssessorDetails): StampResult {
  const zip = new PizZip(bytes);
  const contentFile = zip.file('content.xml');
  if (!contentFile) throw new Error('Not an OpenDocument text file (content.xml missing)');
  let xml = contentFile.asText();

  const lines = odtLines(xml);
  const { fills, sawAnyLabel } = planFills(
    lines.map(l => l.text),
    (line, key) => key === 'signature' && lines[line].xml.includes(`draw:name="${SIG_FRAME_NAME}"`),
  );
  if (fills.length === 0) {
    return { buffer: bytes, filled: [], noLabelsFound: !sawAnyLabel };
  }

  let frameXml = '';
  if (details.signaturePng && fills.some(f => f.key === 'signature')) {
    const { width, height } = pngDimensions(details.signaturePng);
    const h = SIGNATURE_HEIGHT_CM;
    const w = h * (width / height);
    installPicture(zip, details.signaturePng);
    frameXml = buildFrameXml(w, h);
  }

  // Same node-model approach as stampDocx: per raw text node keep a char mask
  // (underscore blanks removed) and raw-XML insertions by offset.
  interface NodeModel { seg: OdtSegment; chars: (string | null)[]; inserts: Map<number, string[]> }
  const models = new Map<OdtSegment, NodeModel>();
  const modelFor = (seg: OdtSegment): NodeModel => {
    let m = models.get(seg);
    if (!m) { m = { seg, chars: Array.from(seg.text), inserts: new Map() }; models.set(seg, m); }
    return m;
  };
  const filled: LabelKey[] = [];

  for (const f of fills) {
    const line = lines[f.line];
    const idx = Math.max(0, f.at - 1);
    const seg = line.segments.find(s => idx >= s.start && idx < s.start + s.text.length && s.elStart >= 0);
    if (!seg) continue;

    let removedBlank = false;
    for (const t of line.segments) {
      if (t.elStart < 0) continue;
      const lo = Math.max(t.start, f.at), hi = Math.min(t.start + t.text.length, f.blankEnd);
      if (lo >= hi) continue;
      const m = modelFor(t);
      for (let i = lo - t.start; i < hi - t.start; i++) {
        if (m.chars[i] === '_') { m.chars[i] = null; removedBlank = true; }
      }
    }

    let insert: string;
    if (f.key === 'signature') {
      if (!frameXml) continue;
      insert = ` ${frameXml}`;
    } else {
      const value = valueFor(f.key, details);
      if (!value) continue;
      insert = removedBlank
        ? ` <text:span text:style-name="${STYLE_UNDERLINE}">${xmlEscape(` ${value} `)}</text:span>`
        : `<text:span>${xmlEscape(` ${value}`)}</text:span>`;
    }
    const m = modelFor(seg);
    const off = f.at - seg.start;
    const list = m.inserts.get(off) || [];
    list.push(insert);
    m.inserts.set(off, list);
    filled.push(f.key);
  }

  if (filled.length === 0) {
    return { buffer: bytes, filled: [], noLabelsFound: false };
  }

  // Render touched text nodes. Runs of 2+ spaces must become <text:s/> or ODF
  // collapses them; a leading/trailing single space is preserved as-is.
  const renderText = (t: string) =>
    xmlEscape(t).replace(/ {2,}/g, run => ` <text:s text:c="${run.length - 1}"/>`);
  const edits: { start: number; end: number; str: string }[] = [];
  for (const m of models.values()) {
    let out = '';
    let buf = '';
    for (let i = 0; i <= m.chars.length; i++) {
      const ins = m.inserts.get(i);
      if (ins) { out += renderText(buf); buf = ''; out += ins.join(''); }
      if (i < m.chars.length && m.chars[i] !== null) buf += m.chars[i];
    }
    out += renderText(buf);
    edits.push({ start: m.seg.elStart, end: m.seg.elEnd, str: out });
  }
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) xml = xml.slice(0, e.start) + e.str + xml.slice(e.end);

  xml = ensureAutomaticStyles(xml);
  zip.file('content.xml', xml);
  // ODF: `mimetype` must be the first entry and stored uncompressed.
  zip.file('mimetype', ODT_MIME, { compression: 'STORE' });

  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return { buffer: out, filled, noLabelsFound: false };
}
