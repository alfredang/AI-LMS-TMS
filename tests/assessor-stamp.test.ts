import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import PizZip from 'pizzip';

import { planFills, stampDocx, stampPdf, formatSignDate, detectStampFormat } from '../lib/assessment/assessorStamp';
import { stampOdt } from '../lib/assessment/odtStamp';

// ── helpers ───────────────────────────────────────────────────────────────────

function crc32(buf: Buffer) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A small transparent PNG with a diagonal stroke — stands in for a drawn signature. */
function signaturePng(w = 120, h = 40) {
  const raw = Buffer.alloc((w * 4 + 1) * h, 0);
  for (let x = 0; x < w; x++) {
    const y = Math.round((x / w) * (h - 1));
    const o = y * (w * 4 + 1) + 1 + x * 4;
    raw[o] = 0; raw[o + 1] = 0; raw[o + 2] = 128; raw[o + 3] = 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const details = { name: 'Dr. Alfred Ang', nric: 'S1234567A', date: '25/09/2026', signaturePng: signaturePng() };

function docxWithBody(bodyXml: string): Buffer {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
}
const p = (inner: string) => `<w:p>${inner}</w:p>`;
const r = (t: string, rpr = '<w:rPr><w:sz w:val="22"/></w:rPr>') => `<w:r>${rpr}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const docText = (buf: Buffer) => {
  const xml = new PizZip(buf).file('word/document.xml')!.asText();
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)).map(m => (m[0] === '<w:tab/>' ? '\t' : m[1])).join('');
};

// ── planner ───────────────────────────────────────────────────────────────────

test('planner fills the assessor block and leaves the learner declaration alone', () => {
  const { fills } = planFills([
    'Learner Name: John Tan',
    'Date: 01/01/2026            Signature:',
    'Grade: C / NYC (delete as appropriate)',
    'Assessor Name:\t\t\tAssessor NRIC:',
    'Date:\t\t\t\tSignature:',
  ]);
  assert.deepEqual(
    fills.map(f => [f.line, f.key]),
    [[3, 'name'], [3, 'nric'], [4, 'date'], [4, 'signature']],
  );
});

test('planner treats underscores as blank but skips labels that already hold a value', () => {
  const { fills } = planFills(['Assessor Name: Already Filled     Assessor NRIC: ______', 'Date: ____   Signature: ____']);
  assert.deepEqual(fills.map(f => f.key), ['nric', 'date', 'signature']);
  assert.equal(fills[0].blankEnd, 'Assessor Name: Already Filled     Assessor NRIC: ______'.length);
});

test('planner ignores Date/Signature that are far from any assessor label', () => {
  const lines = ['Assessor Name:', ...Array(9).fill('filler'), 'Date:'];
  const { fills } = planFills(lines);
  assert.deepEqual(fills.map(f => f.key), ['name']);
});

test('formatSignDate renders dd/mm/yyyy', () => {
  assert.equal(formatSignDate('2026-09-05'), '05/09/2026');
});

// ── DOCX ──────────────────────────────────────────────────────────────────────

test('stampDocx writes values into split runs, replaces underscore blanks, embeds the signature', () => {
  const input = docxWithBody(
    p(r('Learner Name: John Tan')) +
    p(r('Assessor ') + r('Name:', '<w:rPr><w:b/></w:rPr>') + r(' ________') + `<w:r><w:tab/></w:r>` + r('Assessor NRIC: ______')) +
    p(`<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Date:</w:t><w:tab/><w:tab/><w:t>Signature:</w:t></w:r>`),
  );
  const out = stampDocx(input, details);
  assert.deepEqual(out.filled, ['name', 'nric', 'date', 'signature']);

  const text = docText(out.buffer);
  assert.match(text, /Assessor Name:\s+Dr\. Alfred Ang\s+\t/);   // underscores gone, value in their place
  assert.match(text, /Assessor NRIC:\s+S1234567A\s/);
  assert.match(text, /Date: 25\/09\/2026\t\tSignature:/);
  assert.doesNotMatch(text, /_/);

  const zip = new PizZip(out.buffer);
  assert.ok(zip.file('word/media/assessor_signature.png'), 'signature media added');
  assert.match(zip.file('word/_rels/document.xml.rels')!.asText(), /rIdAssessorSig/);
  assert.match(zip.file('[Content_Types].xml')!.asText(), /Extension="png"/);
  const xml = zip.file('word/document.xml')!.asText();
  assert.match(xml, /<w:u w:val="single"\/>/, 'value over a blank is underlined');
  assert.match(xml, /Signature:<\/w:t><\/w:r><w:r><w:rPr><w:sz w:val="22"\/><\/w:rPr><w:drawing>/);

  // Re-stamping a stamped document is a no-op
  assert.deepEqual(stampDocx(out.buffer, details).filled, []);
});

test('stampDocx places each value after its own label when two labels share one text node', () => {
  // Word often keeps "Assessor Name:      Assessor NRIC:" as a single <w:t>.
  const input = docxWithBody(
    p(r('Grade: C / NYC (delete as appropriate)')) +
    p(r('Assessor Name:                      Assessor NRIC:')) +
    p(r('Date:                               Signature:')),
  );
  const out = stampDocx(input, details);
  assert.deepEqual(out.filled, ['name', 'nric', 'date', 'signature']);
  const text = docText(out.buffer);
  assert.match(text, /Assessor Name: Dr\. Alfred Ang\s+Assessor NRIC: S1234567A/);
  assert.match(text, /Date: 25\/09\/2026\s+Signature:$/);
  const xml = new PizZip(out.buffer).file('word/document.xml')!.asText();
  assert.match(xml, /Signature:<\/w:t><\/w:r><w:r><w:rPr><w:sz w:val="22"\/><\/w:rPr><w:drawing>/);
});

test('stampDocx reports when no assessor block exists', () => {
  const out = stampDocx(docxWithBody(p(r('Just a question paper'))), details);
  assert.deepEqual(out.filled, []);
  assert.equal(out.noLabelsFound, true);
});

// ── ODT ───────────────────────────────────────────────────────────────────────

function odtWithBody(bodyXml: string): Buffer {
  const zip = new PizZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2"><office:automatic-styles/><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`);
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
}
const tp = (inner: string) => `<text:p text:style-name="P1">${inner}</text:p>`;
const ts = (t: string) => `<text:span text:style-name="T1">${t}</text:span>`;
const odtText = (buf: Buffer) => {
  const xml = new PizZip(buf).file('content.xml')!.asText();
  const body = xml.slice(xml.indexOf('<office:text>'));
  return body
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<text:s text:c="(\d+)"\/>/g, (_, n) => ' '.repeat(+n))
    .replace(/<text:s\/>/g, ' ')
    .replace(/<\/text:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
};

test('stampOdt fills the LibreOffice-style block (tabs, text:s, underscores) and embeds the signature', () => {
  const input = odtWithBody(
    tp(ts('Learner Name: John Tan')) +
    tp(ts('Date: 01/09/2026<text:tab/>Signature: (learner)')) +
    tp(ts('Grade: ') + ts('<text:s text:c="20"/>') + ts('(C / NYC)')) +
    tp(ts('Assessor Name: _______________ <text:tab/><text:tab/>Assessor NRIC: _____________') + ts('')) +
    tp(ts('Date: _________________<text:tab/><text:tab/>Signature: <text:s/>_________________')),
  );
  const out = stampOdt(input, details);
  assert.deepEqual(out.filled, ['name', 'nric', 'date', 'signature']);

  const text = odtText(out.buffer);
  assert.match(text, /Assessor Name:\s+Dr\. Alfred Ang\s+\t\tAssessor NRIC:\s+S1234567A/);
  assert.match(text, /Date:\s+25\/09\/2026\s*\t\tSignature:/);
  assert.match(text, /^Date: 01\/09\/2026\tSignature: \(learner\)$/m, 'learner declaration untouched');
  assert.doesNotMatch(text, /_/, 'underscore blanks replaced');

  const zip = new PizZip(out.buffer);
  assert.ok(zip.file('Pictures/assessor_signature.png'), 'picture added');
  assert.match(zip.file('META-INF/manifest.xml')!.asText(), /Pictures\/assessor_signature\.png/);
  const xml = zip.file('content.xml')!.asText();
  assert.match(xml, /<office:automatic-styles><style:style style:name="LmsAssessorValue"/);
  assert.match(xml, /Signature: <draw:frame draw:style-name="LmsAssessorSig" draw:name="assessor_signature" text:anchor-type="as-char"/);
  assert.match(xml, /<text:span text:style-name="LmsAssessorValue"> Dr\. Alfred Ang <\/text:span>/);
  // mimetype must stay first and stored
  assert.equal(Object.keys(zip.files)[0], 'mimetype');
  assert.equal(out.buffer.toString('ascii', 30, 38), 'mimetype');
  assert.equal(out.buffer.readUInt16LE(8), 0, 'mimetype entry uses STORE');

  assert.deepEqual(stampOdt(out.buffer, details).filled, [], 're-stamp is a no-op');
});

test('detectStampFormat recognises odt by extension and mime type', () => {
  assert.equal(detectStampFormat('WA - Learner.odt'), 'odt');
  assert.equal(detectStampFormat('x', 'application/vnd.oasis.opendocument.text'), 'odt');
  assert.equal(detectStampFormat('x.rtf', 'application/rtf'), null);
});

// ── PDF ───────────────────────────────────────────────────────────────────────

test('stampPdf fills the assessor block on the last page and never stamps twice', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([595, 842]);
  p1.drawText('Date: 01/09/2026        Signature: (learner)', { x: 60, y: 720, size: 11, font });
  const p2 = pdf.addPage([595, 842]);
  p2.drawText('Assessor Name:', { x: 60, y: 260, size: 11, font });
  p2.drawText('Assessor NRIC:', { x: 330, y: 260, size: 11, font });
  p2.drawText('Date:', { x: 60, y: 220, size: 11, font });
  p2.drawText('Signature:', { x: 330, y: 220, size: 11, font });
  const input = Buffer.from(await pdf.save());

  const out = await stampPdf(input, details);
  assert.deepEqual(out.filled, ['name', 'nric', 'date', 'signature']);
  assert.ok(out.buffer.length > input.length);

  const reloaded = await PDFDocument.load(new Uint8Array(out.buffer), { updateMetadata: false });
  assert.equal(reloaded.getPageCount(), 2);
  assert.match(reloaded.getKeywords() || '', /lms-assessor-signed/);

  const again = await stampPdf(out.buffer, details);
  assert.deepEqual(again.filled, []);
});
