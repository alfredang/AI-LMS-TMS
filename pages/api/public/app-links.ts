import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * PUBLIC: the app-link association files that let a tenant's mobile app open
 * quiz links (https://<this site>/quiz/<courseId>/<quizId>) instead of the
 * browser. Served at /.well-known/apple-app-site-association and
 * /.well-known/assetlinks.json through rewrites in next.config.js.
 *
 * Tenant-specific and off by default: each deployment names its own app in
 * env, so no tenant's app is hardcoded here.
 *   MOBILE_APP_IOS_APP_IDS       <TeamID>.<bundle id>[, ...]
 *   MOBILE_APP_ANDROID_PACKAGE   Android application id
 *   MOBILE_APP_ANDROID_SHA256    signing certificate SHA-256 fingerprint(s), comma-separated
 * Without them the files answer 404 and links simply open in the browser.
 */
const list = (v: string | undefined) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (req.query.kind === 'ios') {
    const appIDs = list(process.env.MOBILE_APP_IOS_APP_IDS);
    if (appIDs.length === 0) return res.status(404).json({ success: false, error: 'Not configured' });
    return res.status(200).json({
      applinks: { details: [{ appIDs, components: [{ '/': '/quiz/*', comment: 'Quiz QR codes' }] }] },
    });
  }

  if (req.query.kind === 'android') {
    const pkg = (process.env.MOBILE_APP_ANDROID_PACKAGE || '').trim();
    const fingerprints = list(process.env.MOBILE_APP_ANDROID_SHA256);
    if (!pkg || fingerprints.length === 0) return res.status(404).json({ success: false, error: 'Not configured' });
    return res.status(200).json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
      },
    ]);
  }

  return res.status(404).json({ success: false, error: 'Not found' });
}
