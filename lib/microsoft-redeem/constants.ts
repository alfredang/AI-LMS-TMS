/**
 * Shared constants for the Microsoft Certificate (achievement code) tool.
 *
 * Ported from the original `microsoftredeemcode` Flask app (backend/paths.py).
 */

/**
 * Singapore partner tracking suffix appended to every Microsoft Learn course
 * URL. `WT.mc_id` tags the visit as an ILT partner webpage and `ocid` is the
 * Singapore partner campaign id — both are required for the "Request
 * achievement code" button to render for our account.
 */
export const SG_SUFFIX = '?WT.mc_id=ilt_partner_webpage_wwl&ocid=5238477';

/** Append the Singapore tracking suffix to a Microsoft Learn course URL. */
export function singaporeUrl(baseUrl: string): string {
  return baseUrl + SG_SUFFIX;
}

/** Microsoft Learn sign-in landing page used by the headless login flow. */
export const MS_LOGIN_URL = 'https://learn.microsoft.com/en-us/?source=docs';
export const MS_LEARN_DOMAIN = 'learn.microsoft.com';
