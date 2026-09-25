import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import PizZip from 'pizzip';

import { planFills, stampDocx, stampPdf, formatSignDate } from '../lib/assessment/assessorStamp';

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

test('stampDocx reports when no assessor block exists', () => {
  const out = stampDocx(docxWithBody(p(r('Just a question paper'))), details);
  assert.deepEqual(out.filled, []);
  assert.equal(out.noLabelsFound, true);
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
