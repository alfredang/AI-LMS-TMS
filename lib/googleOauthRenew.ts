// Shared constants for the "Renew via Google Sign-In" flow
// (pages/api/integrations/google/oauth-start.ts + oauth-callback.ts).

// Every scope the stored refresh token serves across the app: Gmail sending
// (OTP, notifications), Drive (certificates, invoices, uploads), Slides
// (courseware) and Calendar (run sync). openid+email lets the callback read
// WHICH mailbox was authenticated so it can warn when it differs from the
// configured email_user.
export const GOOGLE_OAUTH_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/calendar',
  'openid',
  'email',
];

export function getGoogleOauthRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return `${base}/api/integrations/google/oauth-callback`;
}
