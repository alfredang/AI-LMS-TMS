/**
 * Store links for this tenant's mobile app, shown as badges on the login screen.
 *
 * Per-tenant by environment, never hardcoded: set MOBILE_APP_IOS_URL and / or
 * MOBILE_APP_ANDROID_URL on a deployment that has an app. Unset means no badge,
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

export function mobileAppLinks(): { mobileAppIosUrl: string | null; mobileAppAndroidUrl: string | null } {
  return {
    mobileAppIosUrl: storeLink(process.env.MOBILE_APP_IOS_URL, 'apps.apple.com'),
    mobileAppAndroidUrl: storeLink(process.env.MOBILE_APP_ANDROID_URL, 'play.google.com'),
  };
}
