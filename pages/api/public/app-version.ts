import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { mobileAppLinks, refreshMobileAppLinks } from '../../../lib/mobileAppLinks';

/**
 * PUBLIC: the mobile apps' update check, called at launch (before sign-in).
 *
 *   GET /api/public/app-version?platform=ios|android[&version=1.2.0]
 *   → { platform, minVersion, latestVersion, storeUrl, updateRequired, updateAvailable }
 *
 * An app older than minVersion must block with an "Update now" screen that opens storeUrl
 * (forced update); one older than latestVersion may offer the update and carry on.
 * Per tenant, never hardcoded: training_provider.app_support keys
 *   iosMinVersion / androidMinVersion        forced-update floor ("1.3.0")
 *   iosLatestVersion / androidLatestVersion  newest store version (optional, soft prompt)
 * Unset means no forced update. Store links come from lib/mobileAppLinks.ts.
 */

const VERSION = /^\d+(\.\d+){0,3}$/;

const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return VERSION.test(s) ? s : null;
};

/** Compares dotted numeric versions: -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const platform = req.query.platform;
  if (platform !== 'ios' && platform !== 'android') {
    return res.status(400).json({ error: 'platform must be ios or android' });
  }

  let cfg: Record<string, unknown> = {};
  try {
    const r = await pool.query(`SELECT app_support FROM training_provider ORDER BY created_at ASC LIMIT 1`);
    const v = r.rows[0]?.app_support;
    if (v && typeof v === 'object') cfg = v;
  } catch {
    // No app_support column yet, or the database is unreachable: never block the app on our fault.
  }
  await refreshMobileAppLinks();
  const links = mobileAppLinks();

  const minVersion = clean(cfg[`${platform}MinVersion`]);
  const latestVersion = clean(cfg[`${platform}LatestVersion`]) || minVersion;
  const version = clean(req.query.version);

  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    platform,
    minVersion,
    latestVersion,
    storeUrl: platform === 'ios' ? links.mobileAppIosUrl : links.mobileAppAndroidUrl,
    updateRequired: !!(version && minVersion && compareVersions(version, minVersion) < 0),
    updateAvailable: !!(version && latestVersion && compareVersions(version, latestVersion) < 0),
  });
}
