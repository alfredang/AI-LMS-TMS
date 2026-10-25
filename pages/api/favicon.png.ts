import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import { promises as fs } from 'fs';
import sharp from 'sharp';
import pool from '../../lib/db';

/**
 * GET /api/favicon.png
 * Returns the tenant's favicon, resized to a square. Defaults to 32x32; pass
 * ?size=16 for the 16x16 variant. Source order:
 *   1. app_config 'favicon_url' — a dedicated per-tenant favicon (URL or
 *      /uploads path), for tenants whose company logo isn't icon-shaped
 *   2. the active training provider's company logo
 *   3. the static /favicon.ico bytes
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  const requested = Number(req.query.size);
  const size = requested === 16 ? 16 : 32;

  try {
    let buffer: Buffer | null = null;

    const faviconUrl = await getConfiguredFaviconUrl();
    if (faviconUrl) buffer = await loadLogoBytes(faviconUrl);

    if (!buffer) {
      const result = await pool.query<{ logo_url: string | null }>(
        `SELECT company_logo_url AS logo_url
         FROM training_provider
         WHERE company_logo_url IS NOT NULL AND company_logo_url <> ''
         ORDER BY created_at ASC
         LIMIT 1`
      );

      const logoUrl = result.rows[0]?.logo_url;
      if (!logoUrl) return sendFallback(res);

      buffer = await loadLogoBytes(logoUrl);
    }
    if (!buffer) return sendFallback(res);

    const resized = await sharp(buffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).send(resized);
  } catch (err) {
    console.warn('[favicon] failed to render dynamic favicon:', err);
    return sendFallback(res);
  }
}

async function getConfiguredFaviconUrl(): Promise<string | null> {
  try {
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM app_config WHERE key = 'favicon_url'`
    );
    return result.rows[0]?.value?.trim() || null;
  } catch {
    // Older tenant schemas may lack app_config — fall through to the logo.
    return null;
  }
}

async function loadLogoBytes(logoUrl: string): Promise<Buffer | null> {
  if (/^https?:\/\//i.test(logoUrl)) {
    try {
      const response = await fetch(logoUrl);
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  // Local upload — files live under public/uploads/... on the same volume as
  // the running app (Coolify keeps them in the uploads_data volume).
  const cleaned = logoUrl.replace(/^\//, '');
  const onDisk = path.join(process.cwd(), 'public', cleaned);
  try {
    return await fs.readFile(onDisk);
  } catch {
    return null;
  }
}

async function sendFallback(res: NextApiResponse) {
  try {
    const fallbackPath = path.join(process.cwd(), 'public', 'favicon.ico');
    const buffer = await fs.readFile(fallbackPath);
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(buffer);
  } catch {
    return res.status(404).end();
  }
}
