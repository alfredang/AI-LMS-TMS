/**
 * Drive Microsoft Learn with Playwright to request achievement codes.
 *
 * Ported from the original `microsoftredeemcode` Flask app (backend/generate.py).
 *
 * Flow per code:
 *   1. Click "Request achievement code" on the course page (opens a modal).
 *   2. In the modal, fill the "students redeeming this code" input.
 *   3. Click "Request code" inside the modal.
 *   4. Read the generated code + URL from the success state of the modal.
 *   5. Close the modal before the next iteration.
 *
 * The saved Microsoft Learn session (see login.ts) is loaded from the
 * database and reused in a headless browser context.
 */

import type { Browser, Frame, Locator, Page } from 'playwright';
import { launchHardenedChromium } from '../chromium-launch';
import { SG_SUFFIX } from './constants';
import { appendCodes, getStoredSession, type StorageState } from './db';
import { findCourse } from './courses';

const VIEWPORT = { width: 1280, height: 860 };

// Voucher codes on MS Learn can be short (e.g. "8X582M" = 6 chars). Accept any
// 5+ char alphanumeric token (with optional dashes) and exclude obvious words.
const CODE_RE = /[A-Z0-9]{5,}(?:-[A-Z0-9]{3,}){0,4}/g;
const URL_RE = /https?:\/\/[^\s"']+/;
const SUBMIT_BUTTON = /^\s*Request code\s*$/i;
const READY_TEXT = /code is ready/i;

const CODE_BLOCKLIST = new Set([
  'ACHIEVEMENT',
  'REQUEST',
  'MICROSOFT',
  'STUDENT',
  'STUDENTS',
  'REDEEM',
  'LEARN',
  'CODE',
  'COPY',
  'CLOSE',
]);

/** A Playwright step failed in a recognisable way. */
class StepError extends Error {
  step: string;
  constructor(step: string, message: string) {
    super(`${step}: ${message}`);
    this.step = step;
    this.name = 'StepError';
  }
}

// -----------------------------------------------------------------------------
// Code detection helpers
// -----------------------------------------------------------------------------

function looksLikeCode(raw: string): boolean {
  const text = raw.trim();
  if (!text || text.length < 5 || text.length > 30) return false;
  if (CODE_BLOCKLIST.has(text.toUpperCase())) return false;
  if (text.includes(' ')) return false;
  if (![...text].some((c) => /[a-z0-9]/i.test(c))) return false;
  // Mixed case is unlikely for a voucher.
  if (text.toUpperCase() !== text && text.toLowerCase() !== text) return false;
  const hasDigit = /[0-9]/.test(text);
  const hasLetter = /[a-z]/i.test(text);
  return (hasDigit && hasLetter) || /^[A-Z0-9-]{6,}$/.test(text.toUpperCase());
}

function candidateCodes(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const matches = text.toUpperCase().matchAll(CODE_RE);
  for (const m of matches) {
    const token = m[0].replace(/^-+|-+$/g, '');
    if (looksLikeCode(token)) out.push(token);
  }
  // Prefer tokens with both letters and digits, then longer tokens.
  out.sort((a, b) => {
    const score = (t: string) =>
      /[0-9]/.test(t) && /[A-Z]/.test(t) ? 0 : 1;
    return score(a) - score(b) || b.length - a.length;
  });
  return out;
}

// -----------------------------------------------------------------------------
// Page-level helpers
// -----------------------------------------------------------------------------

/** Scroll top-to-bottom to force lazy-loaded sections to render. */
async function scrollThroughPage(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const h = document.body.scrollHeight;
      for (let y = 0; y <= h; y += Math.max(300, window.innerHeight - 100)) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
  } catch {
    /* best effort */
  }
}

/**
 * Step 1: search the whole page (including iframes) for the "Request
 * achievement code" button. Returns the locator or throws StepError.
 */
async function findRequestButtonAnywhere(
  page: Page,
  timeoutMs = 30000,
): Promise<Locator> {
  const patterns = [
    /^\s*Request achievement code\s*$/i,
    /Request achievement code/i,
    /Request a code/i,
    /Get achievement code/i,
  ];

  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  let scrolledOnce = false;

  while (Date.now() < deadline) {
    const frames: Frame[] = [
      page.mainFrame(),
      ...page.frames().filter((f) => f !== page.mainFrame()),
    ];

    for (const frame of frames) {
      for (const pat of patterns) {
        // Strategy A: accessible-role lookup.
        try {
          const loc = frame.getByRole('button', { name: pat }).first();
          if ((await loc.count()) && (await loc.isVisible())) return loc;
        } catch (err) {
          lastErr = err;
        }
        // Strategy B: any clickable element with matching text.
        try {
          const loc = frame
            .locator('button, a, [role=button], [role=link]')
            .filter({ hasText: pat })
            .first();
          if ((await loc.count()) && (await loc.isVisible())) return loc;
        } catch (err) {
          lastErr = err;
        }
        // Strategy C: plain text anchor.
        try {
          const loc = frame.getByText(pat).first();
          if ((await loc.count()) && (await loc.isVisible())) return loc;
        } catch (err) {
          lastErr = err;
        }
      }
    }

    if (!scrolledOnce) {
      await scrollThroughPage(page);
      scrolledOnce = true;
    }
    await page.waitForTimeout(500);
  }

  // Compose a hint so the user knows *why* the button wasn't found.
  const hints: string[] = [];
  try {
    const body = (await page.innerText('body')).toLowerCase();
    if (body.includes('sign in') && !body.includes('sign out')) {
      hints.push("the page shows a 'Sign in' prompt — session may have expired");
    }
    if (body.includes('not available') || body.includes('no longer available')) {
      hints.push('the page text says the course is not available');
    }
    if (!body.includes('achievement code')) {
      hints.push(
        "'Achievement Code' text is absent — the account may not be " +
          'entitled to request a code for this course',
      );
    }
  } catch {
    /* ignore */
  }
  const hintStr = hints.length ? ` Possible causes: ${hints.join('; ')}.` : '';

  throw new StepError(
    'Find Request achievement code button',
    `Button not found anywhere on the page within ${Math.floor(timeoutMs / 1000)}s ` +
      `(tried role/text/clickable selectors across all frames).${hintStr} ` +
      `Last Playwright error: ${lastErr}`,
  );
}

async function clickFoundButton(btn: Locator): Promise<void> {
  try {
    await btn.scrollIntoViewIfNeeded();
    await btn.click({ timeout: 5000 });
  } catch (err) {
    throw new StepError(
      "Click 'Request achievement code'",
      `Clicking the button failed — ${err}`,
    );
  }
}

/** Return the currently-open dialog locator (or a best-effort fallback). */
function modal(page: Page): Locator {
  return page.locator("[role='dialog'], [aria-modal='true'], dialog").first();
}

async function waitForModal(page: Page, timeoutMs = 10000): Promise<void> {
  try {
    await modal(page).waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    throw new StepError(
      'Wait for modal',
      `No dialog appeared within ${Math.floor(timeoutMs / 1000)}s after ` +
        "clicking 'Request achievement code'.",
    );
  }
}

/** Locate the student-quantity input in the modal and fill it. */
async function fillStudentCount(page: Page, students: number): Promise<void> {
  const dialog = modal(page);
  const selectors = [
    "input[type='number']",
    "input[inputmode='numeric']",
    "[role='spinbutton']",
    'input',
  ];
  let lastErr: unknown = null;
  for (const sel of selectors) {
    let n = 0;
    try {
      n = await dialog.locator(sel).count();
    } catch (err) {
      lastErr = err;
      continue;
    }
    for (let i = 0; i < n; i++) {
      const el = dialog.locator(sel).nth(i);
      try {
        if (!(await el.isVisible()) || !(await el.isEditable())) continue;
        await el.fill(String(students));
        return;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw new StepError(
    'Fill student count',
    `Could not find an editable student-count input inside the modal. ` +
      `Underlying: ${lastErr}`,
  );
}

async function clickSubmitInModal(page: Page): Promise<void> {
  const dialog = modal(page);
  const btn = dialog.getByRole('button', { name: SUBMIT_BUTTON }).first();
  try {
    if (!(await btn.count())) {
      throw new StepError(
        'Submit in modal',
        "'Request code' button is missing inside the modal.",
      );
    }
    await btn.waitFor({ state: 'visible', timeout: 10000 });
  } catch (err) {
    if (err instanceof StepError) throw err;
    throw new StepError(
      'Submit in modal',
      `'Request code' button did not become visible — ${err}`,
    );
  }

  // Wait for the button to become enabled (disabled until input has a value).
  let enabled = false;
  for (let i = 0; i < 15; i++) {
    try {
      if (await btn.isEnabled()) {
        enabled = true;
        break;
      }
    } catch {
      /* retry */
    }
    await page.waitForTimeout(200);
  }
  if (!enabled) {
    throw new StepError(
      'Submit in modal',
      "'Request code' button stayed disabled — the student-count input may " +
        'be invalid or required additional fields.',
    );
  }

  try {
    await btn.click({ timeout: 5000 });
  } catch (err) {
    throw new StepError('Submit in modal', `Clicking 'Request code' failed — ${err}`);
  }
}

async function waitForSuccess(page: Page, timeoutMs = 30000): Promise<void> {
  const dialog = modal(page);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = await dialog.innerText();
      if (READY_TEXT.test(text)) return;
      const lower = text.toLowerCase();
      if (
        lower.includes('error') ||
        lower.includes('something went wrong') ||
        lower.includes('try again')
      ) {
        const firstLine = text.trim().split('\n')[0].slice(0, 160);
        throw new StepError(
          'Wait for success',
          `Microsoft returned an error in the modal: ${firstLine}`,
        );
      }
    } catch (err) {
      if (err instanceof StepError) throw err;
      /* dialog not stable yet — retry */
    }
    await page.waitForTimeout(400);
  }
  throw new StepError(
    'Wait for success',
    `No 'code is ready to share' message within ${Math.floor(timeoutMs / 1000)}s ` +
      "after clicking 'Request code'.",
  );
}

/**
 * Find a button matching `nameRe`, then read the value of the input/field
 * next to it (same row / adjacent container). kind = 'url' | 'code'.
 */
async function valueNearButton(
  dialog: Locator,
  nameRe: RegExp,
  kind: 'url' | 'code',
): Promise<string> {
  let n = 0;
  try {
    n = await dialog.getByRole('button', { name: nameRe }).count();
  } catch {
    return '';
  }

  for (let i = 0; i < n; i++) {
    const btn = dialog.getByRole('button', { name: nameRe }).nth(i);
    try {
      if (!(await btn.isVisible())) continue;
    } catch {
      continue;
    }

    // Walk up to 4 ancestors looking for a matching input / text.
    for (let up = 1; up <= 4; up++) {
      const container = btn.locator(`xpath=ancestor::*[${up}]`);
      let m = 0;
      try {
        m = await container.locator('input').count();
      } catch {
        m = 0;
      }
      for (let j = 0; j < m; j++) {
        const el = container.locator('input').nth(j);
        let val = '';
        try {
          val = ((await el.inputValue()) || '').trim();
        } catch {
          continue;
        }
        if (!val) continue;
        if (kind === 'url' && /^https?:\/\//i.test(val)) return val;
        if (kind === 'code' && looksLikeCode(val)) return val;
      }

      let txt = '';
      try {
        txt = (await container.innerText()) || '';
      } catch {
        txt = '';
      }
      if (kind === 'url') {
        const m2 = URL_RE.exec(txt);
        if (m2) return m2[0];
      } else {
        const cands = candidateCodes(txt);
        if (cands.length) return cands[0];
      }
    }
  }
  return '';
}

/** Read the generated code + URL from the success state of the modal. */
async function extractCodeAndUrl(page: Page): Promise<{ code: string; url: string }> {
  const dialog = modal(page);

  let code = await valueNearButton(dialog, /copy\s*code/i, 'code');
  let url = await valueNearButton(dialog, /copy\s*url/i, 'url');

  // Fallback: scan all visible inputs in the dialog and classify them.
  if (!code || !url) {
    let n = 0;
    try {
      n = await dialog.locator('input').count();
    } catch {
      n = 0;
    }
    for (let i = 0; i < n; i++) {
      const el = dialog.locator('input').nth(i);
      let val = '';
      try {
        if (!(await el.isVisible())) continue;
        val = ((await el.inputValue()) || '').trim();
      } catch {
        continue;
      }
      if (!val) continue;
      if (!url && /^https?:\/\//i.test(val)) {
        url = val;
        continue;
      }
      if (!code && looksLikeCode(val)) code = val;
    }
  }

  // Final fallback: dialog inner text.
  if (!code || !url) {
    let text = '';
    try {
      text = await dialog.innerText();
    } catch {
      text = '';
    }
    if (!url) {
      const m = URL_RE.exec(text);
      if (m) url = m[0];
    }
    if (!code) {
      for (const cand of candidateCodes(text)) {
        if (!url || !url.toLowerCase().includes(cand.toLowerCase())) {
          code = cand;
          break;
        }
      }
    }
  }

  if (!code && !url) {
    throw new StepError(
      'Extract code + URL',
      'Success message appeared but neither a code nor a URL was found in the modal.',
    );
  }
  if (!code) {
    throw new StepError(
      'Extract code + URL',
      `Found URL (${url}) but could not locate the code value near the ` +
        "'Copy code' button.",
    );
  }
  return { code, url };
}

async function closeModal(page: Page): Promise<void> {
  const dialog = modal(page);
  for (const name of ['Close', 'Close dialog', 'Done', 'Dismiss']) {
    try {
      const btn = dialog
        .getByRole('button', { name: new RegExp(`^${name}$`, 'i') })
        .first();
      if ((await btn.count()) && (await btn.isVisible())) {
        await btn.click({ timeout: 1500 });
        return;
      }
    } catch {
      /* try next */
    }
  }
  try {
    await dialog.locator("[aria-label*='close' i]").first().click({ timeout: 1500 });
    return;
  } catch {
    /* fall through */
  }
  try {
    await page.keyboard.press('Escape');
  } catch {
    /* ignore */
  }
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

export interface GenerateResult {
  ok: boolean;
  requested: number;
  generated: number;
  students: number;
  codes: string[];
  results: { code: string; url: string }[];
  errors: string[];
  error?: string;
}

/**
 * Generate `count` achievement codes for the given Microsoft Learn course.
 *
 * @param courseNumber  Exact course number (must exist in courses.json).
 * @param count         Number of codes to request (1–50).
 * @param students      Students redeeming each code (1–1000).
 * @param requestedBy   app_user.id of the admin running this, for the log.
 */
export async function generateCodes(
  courseNumber: string,
  count: number,
  students: number,
  requestedBy: string | null,
): Promise<GenerateResult> {
  const empty: GenerateResult = {
    ok: false,
    requested: count,
    generated: 0,
    students,
    codes: [],
    results: [],
    errors: [],
  };

  if (count < 1 || count > 50) {
    return { ...empty, error: 'count must be between 1 and 50' };
  }
  if (students < 1 || students > 1000) {
    return { ...empty, error: 'students must be between 1 and 1000' };
  }

  const course = findCourse(courseNumber);
  if (!course) {
    return { ...empty, error: `Unknown course ${courseNumber}` };
  }

  const session = await getStoredSession();
  if (!session) {
    return {
      ...empty,
      error: 'Not signed in to Microsoft Learn. Run the one-time sign-in first.',
    };
  }

  const url = course.baseUrl + SG_SUFFIX;
  const results: { code: string; url: string }[] = [];
  const errors: string[] = [];

  let browser: Browser | null = null;
  try {
    browser = await launchHardenedChromium();
    const context = await browser.newContext({
      storageState: session.storageState as StorageState as any,
      viewport: VIEWPORT,
    });
    const page = await context.newPage();

    for (let i = 0; i < count; i++) {
      try {
        try {
          if (i === 0) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          } else {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          }
        } catch (err) {
          throw new StepError('Navigate to course', `Could not load ${url} — ${err}`);
        }

        // Step 1: find & click "Request achievement code" anywhere on the page.
        const btn = await findRequestButtonAnywhere(page);
        await clickFoundButton(btn);
        await waitForModal(page);

        // Step 2: enter student count, click "Request code" in the modal.
        await fillStudentCount(page, students);
        await clickSubmitInModal(page);
        await waitForSuccess(page);

        // Step 3: copy the code and the URL.
        const { code, url: codeUrl } = await extractCodeAndUrl(page);
        results.push({ code, url: codeUrl });
        await closeModal(page);
      } catch (err: any) {
        const label =
          err instanceof StepError ? String(err) : `unexpected error: ${err?.message || err}`;
        errors.push(`Iteration ${i + 1} — ${label}`);
        break;
      }
    }
  } catch (err: any) {
    errors.push(`Browser launch failed: ${err?.message || err}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }

  if (results.length) {
    try {
      await appendCodes(
        results.map((r) => ({
          courseNumber,
          courseTitle: course.title,
          code: r.code,
          url: r.url,
          students,
        })),
        requestedBy,
      );
    } catch (err: any) {
      errors.push(`Codes generated but failed to save to history: ${err?.message || err}`);
    }
  }

  return {
    ok: errors.length === 0 && results.length > 0,
    requested: count,
    generated: results.length,
    students,
    codes: results.map((r) => r.code),
    results,
    errors,
  };
}
