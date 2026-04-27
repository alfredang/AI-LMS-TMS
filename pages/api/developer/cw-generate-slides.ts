import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import pool from '../../../lib/db';
import { generateSlides, type CwCompanyInfo, type SlideAgentConfig } from '../../../lib/cw-slides';
import { createJob, updateJob, updateProgress, slidesOutputDir } from '../../../lib/cw-slides-jobs';

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
  config?: SlideAgentConfig;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as SlidesRequest;
  const courseData = body.courseData || {};
  const cpText = body.cpText || body.extractedResult || '';

  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(500).json({
      error: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY or add a row to training_provider_api.',
    });
  }

  const company = await getCompanyInfo();
  const mergedConfig: SlideAgentConfig = { ...(body.config || {}), company };
  const context: Record<string, unknown> = { ...courseData, _cp_text: cpText };
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
