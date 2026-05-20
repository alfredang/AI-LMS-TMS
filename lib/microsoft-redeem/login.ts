/**
 * Microsoft Learn sign-in.
 *
 * Two modes:
 *   1. Interactive (headed Chromium) — preferred. A real window opens on
 *      the host so the admin can complete passkey / MFA / captcha
 *      themselves. Works on localhost; fails on headless Coolify (no X
 *      server / DISPLAY).
 *   2. Automated headless fallback — fires only when (1) can't launch
 *      because the host has no display AND MS_EMAIL + MS_PASSWORD are
 *      both set in env. Fills the email + password forms programmatically
 *      and persists the session. Can't survive MFA / passkey / captcha;
 *      if Microsoft challenges the flow, returns a clear error.
 *
 * The captured session is stored in the `microsoft_redeem_session` table
 * and reused by the (always-headless) code generator.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
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
 * Drive the Microsoft password form programmatically. Used when no display
 * is available on the host. Returns the same shape as runMicrosoftLogin.
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

    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
    });
    const page = await context.newPage();

    await page.goto(LIVE_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Step 1: email.
    const emailInput = page.locator("input[type='email'], input[name='loginfmt']").first();
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await emailInput.fill(email);
    await clickPrimary(page);

    // Step 2: password. Microsoft sometimes shows a passwordless option
    // first — if the password field never appears, we can't continue.
    const pwdInput = page.locator("input[type='password'], input[name='passwd']").first();
    try {
      await pwdInput.waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      const passwordless = await page.locator('text=/Sign in with a passkey|Use your face|use your password instead/i').count();
      return {
        ok: false,
        error: passwordless
          ? 'Microsoft is offering passwordless sign-in for this account, which automated headless sign-in can\'t complete. Use an account configured with a regular password.'
          : 'Microsoft did not show the password field. The account may require MFA, passkey, or a captcha — automated headless sign-in can\'t handle those.',
      };
    }
    await pwdInput.fill(password);
    await clickPrimary(page);

    // Step 3: MFA / "Stay signed in?" / errors. Race them against the
    // auth-cookies poll so we exit as soon as we know the outcome.
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
        error: 'MS_PASSWORD is incorrect for MS_EMAIL. Update the env var on the server and try again.',
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

    // "Stay signed in?" page — try clicking Yes once, then poll for cookies again.
    try {
      const yesBtn = page.locator("#idSIButton9, input[value='Yes'], button:has-text('Yes')").first();
      if (await yesBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await yesBtn.click();
      }
    } catch {
      /* not shown */
    }

    const authed =
      result?.kind === 'auth' && result.ok
        ? true
        : await waitForAuthCookies(context, 20000);
    if (!authed) {
      return {
        ok: false,
        error:
          'Automated sign-in did not complete in time. Microsoft may be showing an interstitial that headless mode can\'t pass.',
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

/** Click the primary submit button on the current Microsoft form. */
async function clickPrimary(page: Page): Promise<void> {
  const btn = page
    .locator(
      "input[type='submit'], #idSIButton9, button[type='submit'], button:has-text('Next'), button:has-text('Sign in')",
    )
    .first();
  await btn.click({ timeout: 10000 });
}

export async function runMicrosoftLogin(): Promise<LoginResult> {
  const email = (process.env.MS_EMAIL || '').trim();
  const password = (process.env.MS_PASSWORD || '').trim();

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

      // No display on this host (typical for headless Coolify). Fall back
      // to automated headless sign-in if credentials are provided.
      if (NO_DISPLAY_RE.test(msg)) {
        if (email && password) {
          return await runHeadlessLogin(email, password);
        }
        return {
          ok: false,
          error:
            'No desktop display on this host, so the interactive sign-in window can\'t open. ' +
            'Set MS_EMAIL and MS_PASSWORD as environment variables on the server to enable automated headless sign-in instead.',
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
