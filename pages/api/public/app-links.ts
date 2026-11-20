import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * PUBLIC: the app-link association files that let a tenant's mobile app open
 * quiz links (https://<this site>/quiz/<courseId>/<quizId>) instead of the
 * browser. Served at /.well-known/apple-app-site-association and
 * /.well-known/assetlinks.json through rewrites in next.config.js.
 *
 * Tenant-specific and off by default: each deployment names its own app, so no
 * tenant's app is hardcoded here. Read from env, else from the tenant row
 * (training_provider.admin_settings -> 'mobileAppLinks'):
 *   MOBILE_APP_IOS_APP_IDS      / iosAppIds       <TeamID>.<bundle id>[, ...]
 *   MOBILE_APP_ANDROID_PACKAGE  / androidPackage  Android application id
 *   MOBILE_APP_ANDROID_SHA256   / androidSha256   signing certificate SHA-256 fingerprint(s)
 * Without them the files answer 404 and links simply open in the browser.
 */
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x).trim())
    .filter(Boolean);

async function loadConfig(): Promise<{ iosAppIds: string[]; androidPackage: string; androidSha256: string[] }> {
  let stored: any = {};
  try {
    const r = await pool.query(
      `SELECT admin_settings -> 'mobileAppLinks' AS links FROM training_provider ORDER BY created_at ASC LIMIT 1`
    );
    stored = r.rows[0]?.links || {};
  } catch {
    // no tenant row yet, or the DB is unreachable: env only
  }
  const env = process.env;
  return {
    iosAppIds: env.MOBILE_APP_IOS_APP_IDS ? list(env.MOBILE_APP_IOS_APP_IDS) : list(stored.iosAppIds),
    androidPackage: (env.MOBILE_APP_ANDROID_PACKAGE || stored.androidPackage || '').trim(),
    androidSha256: env.MOBILE_APP_ANDROID_SHA256 ? list(env.MOBILE_APP_ANDROID_SHA256) : list(stored.androidSha256),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const kind = req.query.kind;
  if (kind !== 'ios' && kind !== 'android') {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  const cfg = await loadConfig();
  res.setHeader('Cache-Control', 'public, max-age=600');

  if (kind === 'ios') {
    if (cfg.iosAppIds.length === 0) return res.status(404).json({ success: false, error: 'Not configured' });
    return res.status(200).json({
      applinks: { details: [{ appIDs: cfg.iosAppIds, components: [{ '/': '/quiz/*', comment: 'Quiz QR codes' }] }] },
    });
  }

  if (!cfg.androidPackage || cfg.androidSha256.length === 0) {
    return res.status(404).json({ success: false, error: 'Not configured' });
  }
  return res.status(200).json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: cfg.androidPackage, sha256_cert_fingerprints: cfg.androidSha256 },
    },
  ]);
}
