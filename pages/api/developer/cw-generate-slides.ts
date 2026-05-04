import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import pool from '../../../lib/db';
import { generateSlides, type CwCompanyInfo, type SlideAgentConfig } from '../../../lib/cw-slides';
import { createJob, updateJob, updateProgress, slidesOutputDir } from '../../../lib/cw-slides-jobs';
import { parseCpFile } from '../../../lib/cp-parser';

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: '100mb',
  },
  maxDuration: 1200,
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '').substring(0, 80).trim() || 'Course';
}

async function getApiKey(): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT key_value FROM training_provider_api
       WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
       AND key_name = 'ANTHROPIC_API_KEY'`,
    );
    if (result.rows.length > 0 && result.rows[0].key_value) return result.rows[0].key_value;
  } catch (e) {
    console.error('Failed to fetch API key from DB:', e);
  }
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || null;
}

async function getCompanyInfo(): Promise<CwCompanyInfo | undefined> {
  try {
    const result = await pool.query(
      `SELECT company_name, uen, email, company_url, address, company_logo
         FROM training_provider
         ORDER BY created_at DESC LIMIT 1`,
    );
    if (result.rows.length === 0) return undefined;
    const r = result.rows[0];
    return {
      name: r.company_name || '',
      uen: r.uen || '',
      email: r.email || '',
      company_url: r.company_url || '',
      address: r.address || '',
      logo: r.company_logo || '',
    };
  } catch (e) {
    console.error('Failed to fetch company info:', e);
    return undefined;
  }
}

type SlidesRequest = {
  courseData?: Record<string, unknown>;
  cpText?: string;
  extractedResult?: string;
  cpBase64?: string;
  // Manual override — number of hours user explicitly selected (1-day=8h,
  // 2-day=16h, etc.). When set, orchestrator uses this as ground truth and
  // skips all auto-detection. null/undefined = use auto-detection.
  overrideHours?: number | null;
  config?: SlideAgentConfig;
};

// Auto-detect DOCX vs XLSX from a ZIP buffer. Both formats are ZIPs, but
// XLSX has 'xl/' entries and DOCX has 'word/' entries near the start.
async function parseCpAuto(base64: string): Promise<string> {
  const buf = Buffer.from(base64, 'base64');
  // Sniff the first ~2KB for format markers
  const head = buf.subarray(0, 4096).toString('latin1');
  if (head.includes('xl/') || head.includes('xl/_rels')) {
    return parseCpFile(buf, 'cp.xlsx');
  }
  if (head.includes('word/') || head.includes('word/_rels')) {
    return parseCpFile(buf, 'cp.docx');
  }
  // Fallback: try XLSX first, then DOCX
  try {
    return await parseCpFile(buf, 'cp.xlsx');
  } catch {
    return parseCpFile(buf, 'cp.docx');
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as SlidesRequest;
  const courseData = body.courseData || {};
  let cpText = body.cpText || body.extractedResult || '';

  // If the frontend sent the raw CP base64, re-parse it server-side. This
  // gives the slide generator the full original CP text (not just the
  // markdown extraction summary) so duration/topic detection works even
  // when courseData is stale (e.g. extracted before a code deploy that
  // fixed the duration regex).
  if (body.cpBase64 && typeof body.cpBase64 === 'string') {
    try {
      const rawText = await parseCpAuto(body.cpBase64);
      console.log(`[cw-slides] re-parsed CP from base64: ${rawText.length} chars`);
      // Prefer the raw parsed text since it preserves the exact CP wording.
      // If markdown was provided too, keep it appended for backwards compat.
      cpText = rawText + (cpText ? '\n\n--- EXTRACTED MARKDOWN ---\n' + cpText : '');
    } catch (e: any) {
      console.warn('[cw-slides] cpBase64 re-parse failed, using markdown only:', e?.message);
    }
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(500).json({
      error: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY or add a row to training_provider_api.',
    });
  }

  const company = await getCompanyInfo();
  const mergedConfig: SlideAgentConfig = { ...(body.config || {}), company };
  const context: Record<string, unknown> = { ...courseData, _cp_text: cpText };
  // User-provided manual override of course hours wins over any auto-
  // detection. The orchestrator reads ctx._override_hours first.
  if (typeof body.overrideHours === 'number' && body.overrideHours >= 1) {
    context._override_hours = body.overrideHours;
    console.log(`[cw-slides] manual override: using ${body.overrideHours}h (skipping auto-detection)`);
  }
  const courseTitle = String((courseData as any)?.courseTitle ?? (courseData as any)?.Course_Title ?? 'Course');

  // Create job and return immediately — generation runs in the background.
  const job = createJob();
  res.status(202).json({ jobId: job.id });

  // Fire-and-forget generation. Any error is captured into the job state.
  (async () => {
    updateJob(job.id, { status: 'running' });
    try {
      const result = await generateSlides(context, apiKey, mergedConfig, (msg, pct) => {
        console.log(`[cw-slides job=${job.id} ${pct}%] ${msg}`);
        updateProgress(job.id, msg, pct);
      });

      const title = sanitizeFileName(courseTitle);
      const fileName = `Slides_${title}.pptx`;
      const outDir = slidesOutputDir();
      const filePath = path.join(outDir, `${job.id}.pptx`);
      fs.writeFileSync(filePath, result.buffer);

      updateJob(job.id, {
        status: 'done',
        progress: { message: 'Complete', percent: 100 },
        result: {
          fileName,
          filePath,
          slideCount: result.slideCount,
          stats: result.stats,
          message: result.message,
        },
      });
      console.log(`[cw-slides job=${job.id}] done — ${result.slideCount} slides, ${(result.buffer.length / 1024 / 1024).toFixed(2)} MB`);
    } catch (error: any) {
      console.error(`[cw-slides job=${job.id}] failed:`, error);
      updateJob(job.id, {
        status: 'failed',
        error: error?.message || String(error),
      });
    }
  })();
}
