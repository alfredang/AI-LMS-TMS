/**
 * Microsoft Learn sign-in.
 *
 * Two modes:
 *   1. Interactive (headed Chromium) — preferred. A real window opens on
 *      the host so the admin can complete passkey / MFA / captcha
 *      themselves. Works on localhost; fails on headless Coolify (no X
 *      server / DISPLAY).
 *   2. Automated headless fallback — fires when (1) can't launch because
 *      the host has no display AND a Microsoft email + password are
 *      available. Credentials are read from the `training_provider_api`
 *      table (key_name='MS_EMAIL' / 'MS_PASSWORD'), set via the existing
 *      Training Provider Profile credential manager. Env vars are a
 *      secondary fallback for setups that prefer them.
 *
 * The captured session is stored in the `microsoft_redeem_session` table
 * and reused by the (always-headless) code generator.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import pool from '../db';
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

/** Recognise the launch failure modes the headless fallback should kick in on. */
const NO_DISPLAY_RE =
  /XServer|Missing X server|\$DISPLAY|target page, context or browser has been closed|browserType\.launch/i;

/**
 * Look up Microsoft credentials saved via the Training Provider Profile UI.
 * Keys live in `training_provider_api` under key_name 'MS_EMAIL' /
 * 'MS_PASSWORD' on the most-recently-created training provider (matches
 * the same lookup pattern used by getApiKey() elsewhere for the Anthropic
 * key).
 */
async function loadStoredCredentials(): Promise<{ email: string; password: string } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT key_name, key_value FROM training_provider_api
        WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
          AND key_name IN ('MS_EMAIL', 'MS_PASSWORD')`,
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key_name] = (r.key_value || '').trim();
    if (map.MS_EMAIL && map.MS_PASSWORD) {
      return { email: map.MS_EMAIL, password: map.MS_PASSWORD };
    }
    return null;
  } catch (err) {
    console.error('[microsoft-redeem] Failed to read stored credentials:', err);
    return null;
  }
}

/**
 * Click the primary submit button on the current Microsoft form (covers
 * "Next" on the email screen and "Sign in" on the password screen).
 */
async function clickPrimary(page: Page): Promise<void> {
  const btn = page
    .locator(
      "input[type='submit'], #idSIButton9, button[type='submit'], button:has-text('Next'), button:has-text('Sign in')",
    )
    .first();
  await btn.click({ timeout: 10000 });
}

/**
 * Drive Microsoft's password form programmatically. Used when no display
 * is available on the host. Returns the same LoginResult shape as
 * runMicrosoftLogin so callers don't care which path ran.
 */
async function runHeadlessLogin(
  email: string,
  password: string,
): Promise<LoginResult> {
  let browser: Browser | null = null;
  try {
    try {
      browser = await chromium.launch({ headless: true });
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
      return { ok: false, error: `Headless browser launch failed: ${msg}` };
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    await page.goto(LIVE_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Email.
    const emailInput = page.locator("input[type='email'], input[name='loginfmt']").first();
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await emailInput.fill(email);
    await clickPrimary(page);

    // Password (or passwordless prompt).
    const pwdInput = page.locator("input[type='password'], input[name='passwd']").first();
    try {
      await pwdInput.waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      const passwordless = await page
        .locator('text=/Sign in with a passkey|Use your face|use your password instead/i')
        .count();
      return {
        ok: false,
        error: passwordless
          ? 'Microsoft is offering passwordless sign-in for this account, which automated headless sign-in can\'t complete. Use an account configured with a regular password.'
          : 'Microsoft did not show the password field. The account may require MFA, passkey, or a captcha — automated headless sign-in can\'t handle those.',
      };
    }
    await pwdInput.fill(password);
    await clickPrimary(page);

    // Outcome: auth cookies / bad password / MFA challenge.
    const result = await Promise.race([
      waitForAuthCookies(context, 45000).then((ok) => ({ kind: 'auth', ok }) as const),
      page
        .locator('text=/incorrect|wrong password|that password isn\'t correct/i')
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => ({ kind: 'badpw' }) as const)
        .catch(() => null),
      page
        .locator('text=/verify your identity|enter the code|approve sign in|set up your account|protect your account/i')
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => ({ kind: 'mfa' }) as const)
        .catch(() => null),
    ]);

    if (result?.kind === 'badpw') {
      return {
        ok: false,
        error: 'The stored Microsoft password is incorrect. Update MS_PASSWORD on the Training Provider Profile page and try again.',
      };
    }
    if (result?.kind === 'mfa') {
      return {
        ok: false,
        error:
          'Microsoft is challenging the sign-in with MFA / a verification step. Automated headless sign-in can\'t complete this. ' +
          'Use an account without MFA, or disable MFA on this account.',
      };
    }

    // "Stay signed in?" — click Yes if present.
    try {
      const yesBtn = page.locator("#idSIButton9, input[value='Yes'], button:has-text('Yes')").first();
      if (await yesBtn.isVisible({ timeout: 5000 }).catch(() => false)) await yesBtn.click();
    } catch {
      /* not shown */
    }

    const authed =
      result?.kind === 'auth' && result.ok ? true : await waitForAuthCookies(context, 20000);
    if (!authed) {
      return {
        ok: false,
        error: 'Automated sign-in did not complete in time. Microsoft may be showing an interstitial that headless mode can\'t pass.',
      };
    }

    // Land on learn.microsoft.com so its session cookies are captured.
    try {
      await page.goto(LEARN_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    } catch {
      /* non-fatal */
    }

    const storageState = (await context.storageState()) as Record<string, unknown>;
    await saveSession(storageState, email);
    return { ok: true, email };
  } catch (err: any) {
    return { ok: false, error: `Headless sign-in failed: ${err?.message || err}` };
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

/**
 * Open an interactive Microsoft sign-in window and persist the session.
 *
 * Resolves once the admin has signed in (auth cookies detected) or the
 * window times out. On a headless host (no display), falls back to
 * automated headless sign-in using credentials from the
 * `training_provider_api` table or MS_EMAIL / MS_PASSWORD env vars.
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

      // No display on this host (typical for headless Coolify). Try
      // automated headless sign-in using stored credentials.
      if (NO_DISPLAY_RE.test(msg)) {
        const stored = await loadStoredCredentials();
        const envEmail = (process.env.MS_EMAIL || '').trim();
        const envPwd = (process.env.MS_PASSWORD || '').trim();
        const creds =
          stored || (envEmail && envPwd ? { email: envEmail, password: envPwd } : null);
        if (creds) {
          return await runHeadlessLogin(creds.email, creds.password);
        }
        return {
          ok: false,
          error:
            'This server has no desktop display, so the sign-in window can\'t open. ' +
            'Save MS_EMAIL and MS_PASSWORD on the Training Provider Profile page (Settings → Credentials → Microsoft) so the server can sign in automatically.',
        };
      }

      return {
        ok: false,
        error: `Could not open a sign-in browser window. Details: ${msg}`,
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
