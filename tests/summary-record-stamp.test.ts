import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { findSignOffTable, maskNric, stampSummaryRecord } from '../lib/assessment/summaryRecordStamp';

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

/**
 * A 2-page landscape PDF whose last page mirrors the house ASR sign-off table
 * (label positions taken from the real template).
 */
async function asrTemplate(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([792, 612]);
  p1.drawText('1.3. Assessment Summary Record', { x: 72, y: 512, size: 14, font });
  p1.drawText('Date: 01/01/2026 (a date elsewhere that must not be touched)', { x: 72, y: 400, size: 11, font });

  const p2 = pdf.addPage([792, 612]);
  const t = (s: string, x: number, y: number) => p2.drawText(s, { x, y, size: 11, font });
  t('This candidate has been assessed as', 72, 395);
  t('Candidate Name (As in NRIC)', 77, 295);   t('Assessor Name', 461, 295);
  t('NRIC (Last 3 digits & alphabet)', 75, 260); t('NRIC (Last 3 digits & alphabet)', 424, 260);
  t('Candidate Signature', 100, 226);          t('Assessor Signature', 452, 226);
  t('Date:', 137, 194);                        t('Date:', 487, 194);
  t('By signing, the candidate is agreeing to accept the assessment', 70, 166);
  t('By signing, the assessor is agreeing to have duly assessed the', 413, 166);
  return Buffer.from(await pdf.save());
}

async function pageTexts(buf: Buffer): Promise<{ str: string; x: number; y: number; width: number; size: number }[][]> {
  const { ensurePdfjsNodeGlobals } = await import('../lib/assessment/pdfjsNodePolyfill');
  ensurePdfjsNodeGlobals();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const out: { str: string; x: number; y: number; width: number; size: number }[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    out.push((c.items as any[]).filter(i => i.str?.trim()).map(i => ({
      str: i.str.trim(), x: i.transform[4], y: i.transform[5], width: i.width, size: Math.abs(i.transform[3]) || 11,
    })));
  }
  await doc.destroy();
  return out;
}

const learner = { name: 'Fung Mui Leong', nric: 'S1234567A', date: '26/09/2026', signaturePng: signaturePng() };
const trainer = { name: 'Dr. Alfred Ang', nric: 'S7654321B', date: '27/09/2026', signaturePng: signaturePng(90, 30) };

// ── maskNric ──────────────────────────────────────────────────────────────────

test('maskNric keeps the last 3 digits and letter of a Singapore NRIC', () => {
  assert.equal(maskNric('S1234567A'), '567A');
  assert.equal(maskNric('t0011223z'), '223Z');
  assert.equal(maskNric('567A'), '567A');       // already masked
  assert.equal(maskNric('AB123456'), 'AB123456'); // passport — untouched
  assert.equal(maskNric(''), '');
});

// ── geometry ──────────────────────────────────────────────────────────────────

test('findSignOffTable locates both columns on the last page and assigns wide assessor labels correctly', async () => {
  const pages = await pageTexts(await asrTemplate());
  const table = findSignOffTable(pages.map(items => ({ width: 792, height: 612, items })));
  assert.ok(table);
  assert.equal(table!.page, 1);
  for (const col of ['learner', 'trainer'] as const) {
    assert.deepEqual(Object.keys(table![col].labels).sort(), ['date', 'name', 'nric', 'signature']);
    assert.equal(table![col].labels.nric!.maskNric, true);
  }
  // The assessor's NRIC label (x=424) starts left of "Assessor Name" (x=461) but belongs to the trainer column.
  assert.equal(table!.trainer.labels.nric!.x, 424);
  assert.ok(table!.learner.xEnd < table!.trainer.labels.nric!.x);
  assert.ok(table!.trainer.xStart > table!.trainer.labels.nric!.x);
});

test('findSignOffTable returns null when there is no sign-off table', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText('Assessor Name: ____   Date: ____', { x: 72, y: 300, size: 11, font });
  const pages = await pageTexts(Buffer.from(await pdf.save()));
  assert.equal(findSignOffTable(pages.map(items => ({ width: 792, height: 612, items }))), null);
});

// ── stamping ──────────────────────────────────────────────────────────────────

test('stampSummaryRecord fills both blocks with name, masked NRIC, signature and date in the right cells', async () => {
  const tpl = await asrTemplate();
  const r = await stampSummaryRecord(tpl, { learner, trainer });
  assert.equal(r.tableNotFound, false);
  assert.equal(r.page, 1);
  assert.deepEqual(r.filled.learner, ['name', 'nric', 'signature', 'date']);
  assert.deepEqual(r.filled.trainer, ['name', 'nric', 'signature', 'date']);

  const pages = await pageTexts(r.buffer);
  assert.equal(pages.length, 2);
  const p2 = pages[1];
  const find = (s: string) => p2.find(i => i.str === s);

  const ln = find('Fung Mui Leong')!, lnric = find('567A')!, ld = find('26/09/2026')!;
  const tn = find('Dr. Alfred Ang')!, tnric = find('321B')!, td = find('27/09/2026')!;
  for (const it of [ln, lnric, ld, tn, tnric, td]) assert.ok(it, 'value missing');

  // Candidate values sit in the candidate value cell (between the two label columns), on the label's baseline.
  for (const it of [ln, lnric, ld]) { assert.ok(it.x > 230 && it.x < 410, `learner value x=${it.x}`); }
  assert.ok(Math.abs(ln.y - 295) < 1 && Math.abs(lnric.y - 260) < 1 && Math.abs(ld.y - 194) < 1);
  // Assessor values sit right of the assessor labels.
  for (const it of [tn, tnric, td]) { assert.ok(it.x > 580 && it.x < 780, `trainer value x=${it.x}`); }
  assert.ok(Math.abs(tn.y - 295) < 1 && Math.abs(tnric.y - 260) < 1 && Math.abs(td.y - 194) < 1);

  // Full NRICs never appear in the output.
  assert.ok(!p2.some(i => i.str.includes('S1234567A') || i.str.includes('S7654321B')));
  // The unrelated "Date:" on page 1 was left alone.
  assert.ok(!pages[0].some(i => i.str === '26/09/2026' || i.str === '27/09/2026'));

  // Two signature images were embedded on the sign-off page.
  const pdf = await PDFDocument.load(r.buffer);
  const xobjects = pdf.getPage(1).node.Resources()?.lookup(pdf.context.obj('XObject') as any);
  assert.ok(xobjects, 'no XObjects on the sign-off page');
  assert.equal((xobjects as any).entries().length, 2);
});

test('stampSummaryRecord with one party leaves the other block blank, and re-stamping from the template replaces rather than duplicates', async () => {
  const tpl = await asrTemplate();
  const first = await stampSummaryRecord(tpl, { learner });
  assert.deepEqual(first.filled.learner, ['name', 'nric', 'signature', 'date']);
  assert.deepEqual(first.filled.trainer, []);
  let p2 = (await pageTexts(first.buffer))[1];
  assert.ok(p2.some(i => i.str === 'Fung Mui Leong'));
  assert.ok(!p2.some(i => i.str === 'Dr. Alfred Ang'));

  // Both signed: generated from the template again (as the service does).
  const both = await stampSummaryRecord(tpl, { learner, trainer });
  p2 = (await pageTexts(both.buffer))[1];
  assert.equal(p2.filter(i => i.str === 'Fung Mui Leong').length, 1);
  assert.equal(p2.filter(i => i.str === 'Dr. Alfred Ang').length, 1);
});

test('stampSummaryRecord wraps a long name onto two lines inside the cell', async () => {
  const tpl = await asrTemplate();
  const longName = 'Muhammad Abdul Rahman bin Abdullah Al-Haj Ibrahim';
  const r = await stampSummaryRecord(tpl, { learner: { ...learner, name: longName, signaturePng: null } });
  assert.deepEqual(r.filled.learner, ['name', 'nric', 'date']);
  const p2 = (await pageTexts(r.buffer))[1];
  // Both halves are present, unabridged, in the candidate value cell around the label's baseline.
  const parts = p2.filter(i => longName.includes(i.str) && i.x > 230 && i.x < 410 && Math.abs(i.y - 295) < 12);
  assert.equal(parts.length, 2);
  assert.equal(parts.sort((a, b) => b.y - a.y).map(i => i.str).join(' '), longName);
  for (const it of parts) assert.ok(it.x + it.width <= 412, `line overflows the cell: ${it.str}`);
});

test('stampSummaryRecord returns the template untouched when no sign-off table exists', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText('Nothing to sign here', { x: 72, y: 700, size: 12, font });
  const tpl = Buffer.from(await pdf.save());
  const r = await stampSummaryRecord(tpl, { learner, trainer });
  assert.equal(r.tableNotFound, true);
  assert.equal(r.buffer, tpl);
  assert.deepEqual(r.filled, { learner: [], trainer: [] });
});
