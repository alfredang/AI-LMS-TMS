import assert from 'node:assert/strict';
import test from 'node:test';
import PizZip from 'pizzip';

import { isPagesFile, normalizeFontFamilies, pagesPdfName, unclipTableRows } from '../lib/assessment/pagesToPdf';
import { listPagesImages } from '../lib/assessment/pagesIwa';

// ── tiny protobuf / IWA encoder ───────────────────────────────────────────────

function varint(n: number): Buffer {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}
const num = (f: number, v: number) => Buffer.concat([varint(f * 8), varint(v)]);
const msg = (f: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([varint(f * 8 + 2), varint(body.length), body]);
};
const str = (f: number, s: string) => msg(f, Buffer.from(s));
const ref = (f: number, id: number) => msg(f, num(1, id));

/** One IWA file: objects serialised as ArchiveInfo + payload, in one all-literal Snappy chunk. */
function iwa(objects: { id: number; type: number; payload: Buffer }[]): Buffer {
  const data = Buffer.concat(
    objects.flatMap(o => {
      const info = Buffer.concat([num(1, o.id), msg(2, num(1, o.type), num(3, o.payload.length))]);
      return [varint(info.length), info, o.payload];
    }),
  );
  // Snappy: uncompressed length, then literal runs of ≤ 60 bytes (tag = (len-1) << 2).
  const parts: Buffer[] = [varint(data.length)];
  for (let i = 0; i < data.length; i += 60) {
    const lit = data.subarray(i, i + 60);
    parts.push(Buffer.from([(lit.length - 1) << 2]), lit);
  }
  const snappy = Buffer.concat(parts);
  const header = Buffer.alloc(4);
  header.writeUIntLE(snappy.length, 1, 3);
  return Buffer.concat([header, snappy]);
}

const storage = (entries: [number, number][]) =>
  Buffer.concat([str(3, 'text'), msg(9, ...entries.map(([charIndex, att]) => msg(1, num(1, charIndex), ref(2, att))))]);

// ── tests ─────────────────────────────────────────────────────────────────────

test('unclipTableRows turns fixed row heights into minimum heights', () => {
  const xml =
    '<style:table-row-properties style:row-height="1.25in" fo:keep-together="auto"/>' +
    '<style:table-row-properties style:min-row-height="0.5in" style:row-height="2in"/>';
  assert.equal(
    unclipTableRows(xml),
    '<style:table-row-properties style:min-row-height="1.25in" fo:keep-together="auto"/>' +
      '<style:table-row-properties style:min-row-height="0.5in"/>',
  );
});

test('normalizeFontFamilies maps PostScript names to families and leaves real families alone', () => {
  const face = (fam: string) => `<style:font-face style:name="${fam}" svg:font-family="${fam}"/>`;
  assert.equal(normalizeFontFamilies(face('ArialMT')), '<style:font-face style:name="ArialMT" svg:font-family="Arial"/>');
  assert.equal(normalizeFontFamilies(face('Arial-BoldMT')), '<style:font-face style:name="Arial-BoldMT" svg:font-family="Arial"/>');
  assert.equal(normalizeFontFamilies(face('Arial-BoldItalicMT')), '<style:font-face style:name="Arial-BoldItalicMT" svg:font-family="Arial"/>');
  assert.equal(normalizeFontFamilies(face('HelveticaNeue')), '<style:font-face style:name="HelveticaNeue" svg:font-family="Helvetica Neue"/>');
  const quoted = '<style:font-face style:name="Liberation Sans" svg:font-family="&apos;Liberation Sans&apos;"/>';
  assert.equal(normalizeFontFamilies(quoted), quoted);
});

test('isPagesFile / pagesPdfName', () => {
  assert.ok(isPagesFile('Answers.pages'));
  assert.ok(isPagesFile('Answers', 'application/x-iwork-pages-sffpages'));
  assert.ok(!isPagesFile('Answers.pdf', 'application/pdf'));
  assert.equal(pagesPdfName('Tan Wei Min AI Assessment-v2.pages'), 'Tan Wei Min AI Assessment-v2.pdf');
});

test('listPagesImages returns images in reading order, including images inside table cells', () => {
  // Body text: inline logo at char 0, an answer-box table at char 3, an inline image at char 9.
  // The table's cell storage holds a pasted screenshot. Data ids are deliberately NOT in
  // reading order (the screenshot was pasted last), as in real learner submissions.
  const doc = iwa([
    { id: 1, type: 10000, payload: ref(4, 10) },
    { id: 10, type: 2001, payload: storage([[9, 22], [0, 20], [3, 21]]) },
    { id: 20, type: 2003, payload: ref(1, 30) },
    { id: 30, type: 3005, payload: Buffer.concat([msg(1, ref(2, 10)), ref(11, 31)]) }, // logo
    { id: 21, type: 2003, payload: ref(1, 40) },
    { id: 40, type: 6000, payload: Buffer.concat([msg(1, ref(2, 10)), ref(2, 41)]) }, // table → data store
    { id: 41, type: 6001, payload: ref(4, 42) },
    { id: 42, type: 2001, payload: storage([[0, 23]]) }, // cell text
    { id: 23, type: 2003, payload: ref(1, 50) },
    { id: 50, type: 3005, payload: Buffer.concat([msg(1, ref(2, 42)), ref(11, 39), ref(12, 40)]) }, // screenshot
    { id: 22, type: 2003, payload: ref(1, 60) },
    { id: 60, type: 3005, payload: Buffer.concat([msg(1, ref(2, 10)), ref(11, 33)]) }, // inline image
  ]);
  const dataInfo = (id: number, name: string) => msg(4, num(1, id), str(3, name), str(4, name));
  const metadata = iwa([
    {
      id: 2,
      type: 11006,
      payload: Buffer.concat([dataInfo(31, 'image1-31.png'), dataInfo(33, 'pasted-33.heic'), dataInfo(39, 'pasted-movie-39.png'), dataInfo(40, 'pasted-movie-small-40.png')]),
    },
  ]);

  const zip = new PizZip();
  zip.file('Index/Document.iwa', doc);
  zip.file('Index/Metadata.iwa', metadata);
  for (const f of ['image1-31.png', 'pasted-33.heic', 'pasted-movie-39.png', 'pasted-movie-small-40.png']) zip.file(`Data/${f}`, 'x');
  const bundle = new PizZip(zip.generate({ type: 'nodebuffer' }));

  assert.deepEqual(
    listPagesImages(bundle).map(i => i.path),
    ['Data/image1-31.png', 'Data/pasted-movie-39.png', 'Data/pasted-33.heic'],
  );
});

test('listPagesImages rejects a bundle without a Pages document archive', () => {
  const zip = new PizZip();
  zip.file('Index/Document.iwa', iwa([{ id: 5, type: 2001, payload: storage([]) }]));
  assert.throws(() => listPagesImages(new PizZip(zip.generate({ type: 'nodebuffer' }))), /No Pages document archive/);
});
