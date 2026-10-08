/**
 * Convert an Apple Pages (.pages) submission to PDF so it can be assessor-signed.
 *
 * Learners on a Mac often submit the assessment in Pages format, which none of
 * the stampers (PDF / DOCX / ODT) can edit and Google Drive cannot convert.
 *
 *   - Legacy Pages '09 files carry a full-fidelity QuickLook/Preview.pdf
 *     rendered by Pages itself — that is used as-is.
 *   - Current Pages files (Index/*.iwa) are converted with headless LibreOffice
 *     (libetonyek import), in two passes so the ODT can be repaired in between:
 *
 *       1. .pages → .odt
 *       2. repair the ODT:
 *          - Pages answer boxes import as one-cell tables with a FIXED row
 *            height, clipping every answer longer than the box (a real paper
 *            lost ~30% of its words) — fixed heights become minimum heights.
 *          - Images pasted into those boxes (the learner's screenshots) are not
 *            imported: each leaves an empty U+FFFC placeholder. The images are
 *            read from the bundle's Data/ folder in document order (see
 *            pagesIwa.ts; HEIC decoded to JPEG) and put back in place of the
 *            placeholders — or appended at the end when they can't be matched
 *            one-to-one, so no evidence is ever dropped.
 *          - Fonts arrive as PostScript names ("ArialMT", "Arial-BoldMT") that
 *            Linux can't resolve, so text reflows in a wider fallback font;
 *            they are mapped back to family names ("Arial"), which LibreOffice
 *            substitutes with the metric-compatible Liberation fonts.
 *       3. .odt → .pdf
 *
 * Needs the official LibreOffice build (its bundled libetonyek — Debian's
 * LibreOffice uses libetonyek 0.1.10, which drops the answer text entirely) and
 * `heif-convert` for HEIC screenshots; both are installed in the Dockerfile.
 * SOFFICE_PATH overrides the soffice binary location.
 */

import { execFile } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import PizZip from 'pizzip';
import { pngDimensions, xmlEscape } from './assessorStamp';
import { listPagesImages } from './pagesIwa';

const exec = promisify(execFile);

export const PAGES_MIMES = ['application/x-iwork-pages-sffpages', 'application/vnd.apple.pages'];

const SOFFICE_CANDIDATES = [
  '/usr/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
];
const CONVERT_TIMEOUT_MS = 90_000;
const OBJECT_PLACEHOLDER = '￼';
/** Usable width/height for a restored image when its container is unknown (A4 / Letter body). */
const DEFAULT_IMAGE_WIDTH_IN = 6;
const MAX_IMAGE_HEIGHT_IN = 8.5;

export function isPagesFile(fileName: string, mimeType?: string | null): boolean {
  return /\.pages$/i.test(fileName || '') || PAGES_MIMES.includes((mimeType || '').toLowerCase());
}

/** "Answers.pages" → "Answers.pdf" */
export function pagesPdfName(fileName: string): string {
  return /\.pages$/i.test(fileName) ? fileName.replace(/\.pages$/i, '.pdf') : `${fileName}.pdf`;
}

function sofficePath(): string {
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;
  return SOFFICE_CANDIDATES.find(p => existsSync(p)) || 'soffice';
}

// soffice is memory-hungry and a learner may have several files — run one
// conversion at a time per process.
let queue: Promise<unknown> = Promise.resolve();

export function convertPagesToPdf(pages: Buffer): Promise<Buffer> {
  const run = queue.then(() => convert(pages));
  queue = run.catch(() => undefined);
  return run;
}

async function convert(pages: Buffer): Promise<Buffer> {
  let bundle: PizZip;
  try {
    bundle = new PizZip(pages);
  } catch {
    throw new Error('Not a valid Pages file (expected a zipped Pages document)');
  }
  const preview = bundle.file('QuickLook/Preview.pdf');
  if (preview) return Buffer.from(preview.asUint8Array());

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pages2pdf-'));
  // A private profile per run: a shared one makes concurrent/stale soffice
  // instances hand off to each other and exit without converting.
  const profile = pathToFileURL(path.join(dir, 'profile')).href;
  const soffice = sofficePath();

  const sofficeConvert = async (input: string, to: string) => {
    try {
      await exec(
        soffice,
        [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nolockcheck', '--convert-to', to, '--outdir', dir, input],
        { timeout: CONVERT_TIMEOUT_MS },
      );
    } catch (err: any) {
      if (err?.code === 'ENOENT') throw new Error('LibreOffice (soffice) is not installed on the server — cannot convert Pages files');
      throw new Error(`LibreOffice conversion to ${to} failed: ${err?.message || err}`);
    }
  };

  try {
    const src = path.join(dir, 'submission.pages');
    await fs.writeFile(src, pages);

    await sofficeConvert(src, 'odt');
    const odtPath = path.join(dir, 'submission.odt');
    if (!existsSync(odtPath)) throw new Error('LibreOffice could not read the Pages file (no ODT produced)');
    await fs.writeFile(odtPath, await repairOdt(await fs.readFile(odtPath), bundle, dir));

    await sofficeConvert(odtPath, 'pdf');
    const pdfPath = path.join(dir, 'submission.pdf');
    if (!existsSync(pdfPath)) throw new Error('LibreOffice did not produce a PDF');
    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── ODT repair ────────────────────────────────────────────────────────────────

async function repairOdt(odt: Buffer, bundle: PizZip, tmpDir: string): Promise<Buffer> {
  const zip = new PizZip(odt);

  for (const name of ['content.xml', 'styles.xml']) {
    const file = zip.file(name);
    if (file) zip.file(name, normalizeFontFamilies(unclipTableRows(file.asText())));
  }

  const content = zip.file('content.xml');
  if (content) {
    const xml = await restoreImages(content.asText(), zip, bundle, tmpDir);
    zip.file('content.xml', xml);
  }

  // ODF: `mimetype` must be the first entry and stored uncompressed.
  const mimetype = zip.file('mimetype');
  if (mimetype) zip.file('mimetype', mimetype.asText(), { compression: 'STORE' });
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

/** Make every fixed-height table row a minimum-height row so its content is not clipped. */
export function unclipTableRows(xml: string): string {
  return xml.replace(/<style:table-row-properties\b[^>]*>/g, tag =>
    /\bstyle:min-row-height=/.test(tag)
      ? tag.replace(/\s+style:row-height="[^"]*"/, '')
      : tag.replace(/\bstyle:row-height=/, 'style:min-row-height='),
  );
}

/** svg:font-family="Arial-BoldMT" → "Arial" (weight/style are set separately on the text). */
export function normalizeFontFamilies(xml: string): string {
  return xml.replace(/(<style:font-face\b[^>]*\bsvg:font-family=")([^"]+)(")/g, (_m, pre: string, fam: string, post: string) => {
    if (/[\s']|&apos;/.test(fam)) return pre + fam + post;
    const family = fam
      .replace(/-(?:Bold|Italic|Oblique|Regular|Roman|Book|Light|Medium|Semibold|SemiBold|Heavy|Black|Condensed)+(?:MT|PS)?$/, '')
      .replace(/(?:MT|PS)$/, '')
      .replace(/^HelveticaNeue$/, 'Helvetica Neue')
      .replace(/^TimesNewRoman$/, 'Times New Roman')
      .replace(/^CourierNew$/, 'Courier New');
    return pre + family + post;
  });
}

interface BundleImage {
  bytes: Buffer;
  ext: 'png' | 'jpg' | 'gif';
  mime: string;
  width: number;
  height: number;
}

/**
 * Images in the Pages document that LibreOffice did not import. `ordered` is
 * true when they are known to be in document order (read from the IWA object
 * graph); otherwise they are every content image in the bundle, by data id.
 */
async function missingBundleImages(
  bundle: PizZip,
  odt: PizZip,
  tmpDir: string,
): Promise<{ images: BundleImage[]; ordered: boolean }> {
  const embedded = new Set(odt.file(/^Pictures\//).map(f => Buffer.from(f.asUint8Array()).toString('base64')));

  let paths: string[];
  let ordered = true;
  try {
    paths = listPagesImages(bundle).map(i => i.path);
  } catch (err) {
    console.warn('pagesToPdf: could not read Pages document structure, appending images instead:', (err as Error).message);
    ordered = false;
    // Theme preset fills, bullet glyphs and "-small-" thumbnails are not content.
    paths = bundle
      .file(/^Data\/.+$/)
      .filter(f => !/^Data\/(PresetImageFill|bullet_)|-small-/i.test(f.name))
      .sort((a, b) => Number(a.name.match(/-(\d+)\.\w+$/)?.[1] ?? 0) - Number(b.name.match(/-(\d+)\.\w+$/)?.[1] ?? 0))
      .map(f => f.name);
  }

  const images: BundleImage[] = [];
  for (const p of paths) {
    const ext = p.split('.').pop()!.toLowerCase();
    if (!/^(png|jpe?g|gif|heic|heif)$/.test(ext)) continue;
    const bytes = Buffer.from(bundle.file(p)!.asUint8Array());
    if (embedded.has(bytes.toString('base64'))) continue;
    images.push(
      ext === 'heic' || ext === 'heif'
        ? withDimensions(await heicToJpeg(bytes, tmpDir), 'jpg')
        : withDimensions(bytes, ext === 'jpeg' ? 'jpg' : (ext as BundleImage['ext'])),
    );
  }
  return { images, ordered };
}

async function restoreImages(xml: string, odt: PizZip, bundle: PizZip, tmpDir: string): Promise<string> {
  const placeholders = xml.split(OBJECT_PLACEHOLDER).length - 1;
  // No unresolved objects → nothing was dropped.
  if (placeholders === 0) return xml;

  const { images, ordered } = await missingBundleImages(bundle, odt, tmpDir);
  if (images.length === 0) return xml;

  const pictures = images.map((img, i) => {
    const href = `Pictures/pages_restored_${i + 1}.${img.ext}`;
    odt.file(href, img.bytes);
    addManifestEntry(odt, href, img.mime);
    return { ...img, href, name: `pages_restored_${i + 1}` };
  });

  if (ordered && pictures.length === placeholders) {
    // One image per placeholder — put each back where Pages had it.
    let i = 0;
    return xml.replace(new RegExp(OBJECT_PLACEHOLDER, 'g'), (_m, offset: number) => {
      const p = pictures[i++];
      return imageFrame(p, containerWidthIn(xml, offset));
    });
  }

  // Can't match them up reliably — keep every image, at the end of the document.
  const paras = pictures.map(p => `<text:p>${imageFrame(p, DEFAULT_IMAGE_WIDTH_IN)}</text:p>`).join('');
  const heading = `<text:p>${xmlEscape('Images from the original Pages document:')}</text:p>`;
  return xml.replace('</office:text>', `${heading}${paras}</office:text>`);
}

function imageFrame(p: BundleImage & { href: string; name: string }, maxWidthIn: number): string {
  let w = Math.min(maxWidthIn, p.width / 96);
  let h = (w * p.height) / p.width;
  if (h > MAX_IMAGE_HEIGHT_IN) {
    w = (w * MAX_IMAGE_HEIGHT_IN) / h;
    h = MAX_IMAGE_HEIGHT_IN;
  }
  return (
    `<draw:frame draw:name="${p.name}" text:anchor-type="as-char" svg:width="${w.toFixed(3)}in" svg:height="${h.toFixed(3)}in" draw:z-index="0">` +
    `<draw:image xlink:href="${p.href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${p.mime}"/>` +
    `</draw:frame>`
  );
}

/** Width available at `offset`: the enclosing table column (less cell padding), else the default body width. */
function containerWidthIn(xml: string, offset: number): number {
  const tableStart = xml.lastIndexOf('<table:table ', offset);
  if (tableStart >= 0 && xml.indexOf('</table:table>', tableStart) > offset) {
    const col = xml.slice(tableStart, offset).match(/<table:table-column\b[^>]*table:style-name="([^"]+)"/);
    if (col) {
      const style = xml.match(new RegExp(`<style:style style:name="${col[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*<style:table-column-properties[^>]*style:column-width="([\\d.]+)(in|cm|mm|pt)"`));
      const inches = style ? toInches(Number(style[1]), style[2]) : 0;
      if (inches > 0.5) return Math.max(inches - 0.2, 0.5);
    }
  }
  return DEFAULT_IMAGE_WIDTH_IN;
}

function toInches(v: number, unit: string): number {
  return unit === 'in' ? v : unit === 'cm' ? v / 2.54 : unit === 'mm' ? v / 25.4 : v / 72;
}

function addManifestEntry(odt: PizZip, fullPath: string, mime: string) {
  const f = odt.file('META-INF/manifest.xml');
  if (!f) return;
  const manifest = f.asText();
  if (manifest.includes(`manifest:full-path="${fullPath}"`)) return;
  odt.file(
    'META-INF/manifest.xml',
    manifest.replace('</manifest:manifest>', `<manifest:file-entry manifest:full-path="${fullPath}" manifest:media-type="${mime}"/></manifest:manifest>`),
  );
}

// ── Images ────────────────────────────────────────────────────────────────────

const IMAGE_MIME: Record<BundleImage['ext'], string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' };

function withDimensions(bytes: Buffer, ext: BundleImage['ext']): BundleImage {
  const dims = ext === 'png' ? pngDimensions(bytes) : ext === 'gif' ? gifDimensions(bytes) : jpegDimensions(bytes);
  return { bytes, ext, mime: IMAGE_MIME[ext], ...dims };
}

function gifDimensions(gif: Buffer): { width: number; height: number } {
  return { width: gif.readUInt16LE(6), height: gif.readUInt16LE(8) };
}

function jpegDimensions(jpg: Buffer): { width: number; height: number } {
  let i = 2;
  while (i + 9 < jpg.length) {
    if (jpg[i] !== 0xff) { i++; continue; }
    const marker = jpg[i + 1];
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: jpg.readUInt16BE(i + 5), width: jpg.readUInt16BE(i + 7) };
    }
    i += 2 + jpg.readUInt16BE(i + 2);
  }
  throw new Error('Could not read JPEG dimensions');
}

/** HEIC → JPEG with libheif's heif-convert (Linux) or sips (macOS dev). */
async function heicToJpeg(heic: Buffer, tmpDir: string): Promise<Buffer> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const src = path.join(tmpDir, `${stamp}.heic`);
  const out = path.join(tmpDir, `${stamp}.jpg`);
  await fs.writeFile(src, heic);
  try {
    await exec('heif-convert', ['-q', '90', src, out], { timeout: CONVERT_TIMEOUT_MS });
  } catch (err: any) {
    if (err?.code !== 'ENOENT' || process.platform !== 'darwin') {
      throw new Error(`Could not decode a HEIC image in the Pages file: ${err?.code === 'ENOENT' ? 'heif-convert is not installed' : err?.message || err}`);
    }
    await exec('sips', ['-s', 'format', 'jpeg', src, '--out', out], { timeout: CONVERT_TIMEOUT_MS });
  }
  return fs.readFile(out);
}
