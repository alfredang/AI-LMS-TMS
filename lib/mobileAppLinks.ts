/**
 * Store links for this tenant's mobile app, shown as badges on the login screen.
 *
 * Per-tenant, never hardcoded: set MOBILE_APP_IOS_URL and / or MOBILE_APP_ANDROID_URL on a
 * deployment that has an app, or iosUrl / androidUrl in training_provider.app_support. Unset means no badge,
 * so a tenant without an app (and an app that is not live in a store yet) shows
 * nothing. Only real store links are accepted.
 */
function storeLink(value: string | undefined, host: string): string | null {
  const v = (value || '').trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === host ? u.toString() : null;
  } catch {
    return null;
  }
}

// Tenant settings (training_provider.app_support.iosUrl / androidUrl), read at most once a
// minute. The environment variables win when set.
let fromDb: { ios: string | null; android: string | null } = { ios: null, android: null };
let readAt = 0;

/** Refreshes the tenant's store links from its settings; call before mobileAppLinks(). */
export async function refreshMobileAppLinks(): Promise<void> {
  if (Date.now() - readAt < 60_000) return;
  readAt = Date.now();
  try {
    const pool = (await import('./db')).default;
    const r = await pool.query(`SELECT app_support FROM training_provider ORDER BY created_at ASC LIMIT 1`);
    const cfg = r.rows[0]?.app_support || {};
    fromDb = {
      ios: storeLink(typeof cfg.iosUrl === 'string' ? cfg.iosUrl : undefined, 'apps.apple.com'),
      android: storeLink(typeof cfg.androidUrl === 'string' ? cfg.androidUrl : undefined, 'play.google.com'),
    };
  } catch {
    // No app_support column on this tenant yet: no badges from settings.
  }
}

export function mobileAppLinks(): { mobileAppIosUrl: string | null; mobileAppAndroidUrl: string | null } {
  return {
    mobileAppIosUrl: storeLink(process.env.MOBILE_APP_IOS_URL, 'apps.apple.com') || fromDb.ios,
    mobileAppAndroidUrl: storeLink(process.env.MOBILE_APP_ANDROID_URL, 'play.google.com') || fromDb.android,
  };
}
