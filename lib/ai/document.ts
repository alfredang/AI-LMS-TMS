import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AiImage } from './codex';
const exec = promisify(execFile);

/** Preserve scanned-PDF vision by rendering each page; never silently truncate. */
export async function documentImages(data: Buffer, mime: string): Promise<AiImage[]> {
  if (mime !== 'application/pdf') {
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as const)[mime];
    if (!extension) throw new Error('Unsupported reference image format.');
    return [{ data, extension }];
  }
  const dir = await mkdtemp(join(tmpdir(), 'lms-ai-pdf-'));
  try {
    const source = join(dir, 'document.pdf');
    await writeFile(source, data, { mode: 0o600 });
    const { stdout } = await exec('pdfinfo', [source], { timeout: 20000, maxBuffer: 100000 });
    const count = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!count || count > 12) throw new Error('Supporting-document analysis accepts up to 12 PDF pages.');
    await exec('pdftoppm', ['-jpeg', '-scale-to', '1600', source, join(dir, 'page')], { timeout: 40000, maxBuffer: 100000 });
    const paths = (await readdir(dir)).filter(p => /^page-\d+\.jpg$/.test(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (paths.length !== count) throw new Error('Unable to render every PDF page for AI analysis.');
    return await Promise.all(paths.map(async path => ({ data: await readFile(join(dir, path)), extension: 'jpg' as const })));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
