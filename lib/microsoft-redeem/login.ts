/**
 * Interactive Microsoft Learn sign-in.
 *
 * Ported from the original `microsoftredeemcode` Flask app (backend/login.py),
 * which opened a *headed* Chromium so a human could complete the sign-in.
 *
 * We keep that design: a real Chromium window opens on the machine running
 * the LMS server, the admin signs in themselves (this handles passwordless
 * / passkey accounts, MFA and captchas — none of which a headless server
 * can pass), and once Microsoft auth cookies appear the Playwright
 * `storageState` is persisted to the `microsoft_redeem_session` table for
 * the code generator to reuse.
 *
 * MS_EMAIL, if set, is only used to pre-fill the email field as a
 * convenience — the admin still completes the rest in the window.
 *
 * NOTE: this requires a desktop/display on the host. It works for local
 * `npm run dev`; a headless Coolify container has no display and cannot
 * open the window.
 */

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { saveSession } from './db';

/** Microsoft consumer (outlook.com / live.com) account sign-in page. */
const LIVE_LOGIN_URL = 'https://login.live.com/';
/** Visited after sign-in so learn.microsoft.com session cookies are captured. */
const LEARN_HOME_URL = 'https://learn.microsoft.com/en-us/';

/** How long to keep the window open waiting for the admin to finish. */
const SIGN_IN_TIMEOUT_MS = 4 * 60 * 1000;

export interface LoginResult {
  ok: boolean;
  email?: string;
  error?: string;
}

/** Cookie name prefixes that indicate an authenticated Microsoft session. */
const AUTH_COOKIE_PREFIXES = [
  'ESTSAUTH', // Azure AD work accounts
  'MSPAuth', // MS personal accounts (live.com)
  'MSPProf',
  'WLSSC',
  'RPSSecAuth',
  'FedAuth',
];

/** Poll the browser's cookies until a Microsoft auth cookie appears. */
async function waitForAuthCookies(
  context: BrowserContext,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const cookies = await context.cookies();
      const authed = cookies.some((c) =>
        AUTH_COOKIE_PREFIXES.some((p) => (c.name || '').startsWith(p)),
      );
      if (authed) return true;
    } catch {
      /* context not ready — retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Open an interactive Microsoft sign-in window and persist the session.
 *
 * Resolves once the admin has signed in (auth cookies detected) or the
 * window times out.
 */
export async function runMicrosoftLogin(): Promise<LoginResult> {
  const email = (process.env.MS_EMAIL || '').trim();

  let browser: Browser | null = null;
  try {
    try {
      browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized'],
      });
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/executable doesn't exist|Looks like Playwright/i.test(msg)) {
        return {
          ok: false,
          error:
            'Chromium is not installed for Playwright. Run ' +
            '`npx playwright install chromium` on the server, then retry.',
        };
      }
      return {
        ok: false,
        error:
          'Could not open a sign-in browser window. This requires a desktop ' +
          `display on the host running the LMS. Details: ${msg}`,
      };
    }

    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    await page.goto(LIVE_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Convenience: pre-fill the email so the admin only does the rest.
    if (email) {
      try {
        const input = page
          .locator("input[type='email'], input[name='loginfmt']")
          .first();
        await input.waitFor({ state: 'visible', timeout: 8000 });
        await input.fill(email);
      } catch {
        /* leave the field blank for fully-manual entry */
      }
    }

    // Wait for the admin to complete sign-in in the window.
    const authed = await waitForAuthCookies(context, SIGN_IN_TIMEOUT_MS);
    if (!authed) {
      return {
        ok: false,
        error:
          'Sign-in was not completed in time. Open the Microsoft window that ' +
          'appeared and finish signing in, then try again.',
      };
    }

    // Land on learn.microsoft.com so its session cookies are captured too.
    try {
      await page.goto(LEARN_HOME_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
    } catch {
      /* non-fatal — SSO cookies are set on first course-page visit anyway */
    }

    const storageState = (await context.storageState()) as Record<string, unknown>;
    await saveSession(storageState, email || null);
    return { ok: true, email: email || undefined };
  } catch (err: any) {
    return { ok: false, error: `Login failed: ${err?.message || err}` };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}
