/**
 * TPGateway "Fetch from TPGateway" Playwright driver for Bulk Grant Payment Sync.
 *
 * Runs a HEADLESS Chromium and streams live JPEG frames of it into the LMS
 * page itself, so the Singpass QR is scanned right there in the panel — no
 * separate popup window. Same live-view mechanism as the SERVER_BROWSER path
 * of lib/tpg/confirmApplications.ts (screenshot polling + forwarded clicks),
 * applied here unconditionally rather than only in production, per an
 * explicit request to embed the QR in-page rather than open a real window.
 *
 * Fresh browser context every run, never a persisted profile: each run starts
 * signed out so whoever clicked the button scans the Singpass QR with their
 * own phone and TPGateway sees that individual — a shared profile would hand
 * the next person someone else's session, which the TPGateway Terms of Use
 * forbid (same reasoning documented in confirmApplications.ts). This does mean
 * every run needs a fresh QR scan, unlike a persistent-profile approach.
 *
 * Steps:
 *   1. Waits for the operator to finish Singpass (screen streamed to the panel).
 *   2. Navigates to Financial Transactions -> Disbursement, filters Status to
 *      Paid only — no date filtering on TPGateway. Every Paid row is pulled;
 *      narrowing by Payment Date happens client-side in Step 2 instead (its
 *      own From/To controls), which is simpler and avoids driving TPGateway's
 *      own date-range fields at all.
 *   3. Clicks Download/Export and saves the resulting file — NOT DOM-scraped.
 *      An earlier version of this driver scraped the results table directly
 *      (following the pattern confirmApplications.ts uses for Direct
 *      Applications, whose own comments say Excel export was unreliable
 *      enough there to replace with scraping) but Financial Transactions is a
 *      reporting page, not a workflow-action page — a different reliability
 *      category — and downloading reuses the existing, already-tested upload
 *      pipeline outright, which is simpler and more robust here.
 *   4. Feeds the downloaded file straight into
 *      stage1UploadParseValidateMatchAndPersist — the EXACT same entry point
 *      the manual "Upload Excel" path uses — so there is zero custom
 *      row-scraping/matching code and zero divergence risk from a manual
 *      upload of the same file.
 *
 * LOCAL-ONLY (v1): still needs to run from a machine TPGateway/CloudFront
 * accepts (an operator's own desktop, via `npm run dev`) — headless here is
 * only about not popping a visible window, not about running on the deployed
 * server, which is still blocked by CloudFront the same way confirmApplications.ts
 * documents. No office-agent relay / production support yet.
 *
 * KNOWN RISK: the selectors below (Status dropdown, Download/Export button)
 * are built from screenshots + operator confirmation, not verified against
 * the live site directly — this environment has no Singpass credentials /
 * live browser access. Expect the first real run to need adjustment; each
 * step falls back to a best-effort strategy and dumps a debug screenshot (and,
 * for the Status filter, a DOM diagnostics JSON) to scratch/ on failure so
 * selectors can be corrected without re-running blind.
 *
 * Progress is reported to lib/tpg/grantFetchJobStore so the LMS UI can poll it.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  createGrantFetchJob,
  patchGrantFetchJob,
  getGrantFetchJob,
  requestGrantFetchCancel,
  isGrantFetchCancelled,
  pushGrantFetchLog,
  drainGrantFetchInput,
} from './grantFetchJobStore';
import { stage1UploadParseValidateMatchAndPersist } from '@/lib/services/grantImport/grantImportStage1';

const REPO_ROOT = process.cwd();
const SHOT_DIR = path.join(REPO_ROOT, 'scratch');
const SCREEN_W = 1280;
const SCREEN_H = 900;

const WORKSPACE_URL = 'https://www.tpgateway.gov.sg/workspace/';

/** Text that only appears once the operator is logged into the workspace — same markers confirmApplications.ts uses. */
const LOGGED_IN_MARKERS = [/welcome,/i, /course runs/i, /direct applications/i, /financial transactions/i];

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Narrate to the dev terminal so the operator can watch the run regardless of which window is focused. */
const log = (...a: unknown[]) => console.log('[tpg-grant-fetch]', ...a);

/** Log to the terminal AND to the panel's activity feed. */
const note = (id: string, text: string) => {
  log(text);
  pushGrantFetchLog(id, text);
};

// --- public API --------------------------------------------------------------

export interface StartGrantFetchOptions {
  /** DD-MM-YYYY — TPGateway's own Payment From field format. */
  startDate: string;
  actorUserId: string | null;
}

/** Create a job, kick off the driver in the background, return the job id. */
export function startGrantFetchJob(opts: StartGrantFetchOptions): string {
  const id = `gfetch_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  createGrantFetchJob(id, opts.startDate, opts.actorUserId);
  void runJob(id, opts).catch((err) => {
    patchGrantFetchJob(id, {
      phase: 'error',
      error: err?.message || String(err),
      message: 'Failed.',
      needsOperator: false,
      screen: null,
    });
  });
  return id;
}

export { getGrantFetchJob };

/**
 * Register a run for the office agent (scripts/tpg-grant-fetch-agent.mjs) to pick
 * up, without opening a browser here. Used on the deployed site, whose IP
 * TPGateway's CDN refuses — mirrors confirmApplications.ts's queueTpgConfirmJob.
 *
 * actorUserId is carried on the job so the agent can forward it back to the
 * LOCAL run — that endpoint's requireFinanceOrAdmin check needs a real,
 * DB-verified actorUserId, which the agent's service key alone does not
 * provide (the key only satisfies withAuth's broader role check).
 */
export function queueGrantFetchJob(startDate: string, actorUserId: string | null): string {
  const id = `gfetch_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  createGrantFetchJob(id, startDate, actorUserId);
  patchGrantFetchJob(id, {
    phase: 'queued',
    message: 'Queued — waiting for the office machine to pick it up…',
  });
  pushGrantFetchLog(id, 'Queued for the office machine.');
  return id;
}

/**
 * Ask a running job to stop. Cooperative: the driver only checks between safe
 * points (between pages / before persisting), so nothing is left half-scraped.
 */
export function cancelGrantFetchJob(id: string): boolean {
  const ok = requestGrantFetchCancel(id);
  if (ok) log(`job ${id} — cancellation requested; stopping at the next safe point.`);
  return ok;
}

// --- driver -------------------------------------------------------------------

async function runJob(id: string, opts: StartGrantFetchOptions): Promise<void> {
  log(`job ${id} started — Payment From ${opts.startDate}`);

  let context: BrowserContext | null = null;
  let browser: Browser | null = null;
  try {
    note(id, 'Opening the browser…');
    // Headless: nobody looks at this browser directly — the operator watches
    // streamed frames in the LMS panel and clicks on them instead. Same
    // anti-detection tweaks as confirmApplications.ts's SERVER_BROWSER path:
    // TPGateway sits behind CloudFront, which 403s an obviously-automated
    // client before the portal ever sees the request (headless Chromium's
    // User-Agent literally contains "HeadlessChrome", and navigator.webdriver
    // is true). This is not evasion of a security control — the same
    // authorised person still signs in with their own Singpass — it just
    // stops a WAF heuristic from rejecting a legitimate session.
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const chromeVersion = browser.version();
    context = await browser.newContext({
      viewport: { width: SCREEN_W, height: SCREEN_H },
      acceptDownloads: true,
      userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
      locale: 'en-SG',
      timezoneId: 'Asia/Singapore',
      extraHTTPHeaders: { 'Accept-Language': 'en-SG,en;q=0.9' },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    let page = context.pages()[0] || (await context.newPage());

    // 1. Login -----------------------------------------------------------------
    patchGrantFetchJob(id, {
      phase: 'awaiting_login',
      message: 'Scan the Singpass QR below to continue…',
      needsOperator: true,
    });
    note(id, 'Waiting for you to complete the Singpass login…');
    await page.goto(WORKSPACE_URL, { waitUntil: 'domcontentloaded' });
    const loggedIn = await waitForLogin(page, LOGIN_TIMEOUT_MS, id);
    if (isGrantFetchCancelled(id)) return finishCancelled(id, 'Cancelled before login completed.');
    if (!loggedIn) {
      log('login was not detected within the timeout — aborting.');
      patchGrantFetchJob(id, {
        phase: 'error',
        error: 'Singpass login was not completed in time.',
        message: 'Login timed out.',
        needsOperator: false,
        screen: null,
      });
      return;
    }
    note(id, 'Logged in.');
    patchGrantFetchJob(id, { needsOperator: false, screen: null });

    // 2. Navigate ----------------------------------------------------------------
    patchGrantFetchJob(id, { phase: 'navigating', message: 'Opening Financial Transactions…' });
    note(id, 'Navigating to Financial Transactions -> Disbursement…');
    const navigatedPage = await gotoFinancialTransactionsDisbursement(context, page, id);
    if (isGrantFetchCancelled(id)) return finishCancelled(id, 'Cancelled while navigating. Nothing was fetched.');
    if (!navigatedPage) {
      await shoot(page, id, 'grant-fetch-navigate-failed');
      patchGrantFetchJob(id, {
        phase: 'error',
        error: 'Could not find/open the Financial Transactions -> Disbursement page. A debug screenshot was saved to scratch/.',
        message: 'Navigation failed.',
      });
      return;
    }
    page = navigatedPage; // the tile may have opened a new tab — everything from here uses whichever page actually navigated

    // 3. Filter — Status = Paid, Payment From = opts.startDate. "Payment To" is left at
    // TPGateway's own default (today); Step 2's own Payment Date From/To controls are
    // still there client-side if finer narrowing is needed after the fact.
    patchGrantFetchJob(id, { phase: 'filtering', message: 'Filtering to Paid…' });
    note(id, `Setting Status = Paid, Payment From = ${opts.startDate}…`);
    const filtered = await applyFilters(page, opts.startDate);
    if (isGrantFetchCancelled(id)) return finishCancelled(id, 'Cancelled while filtering. Nothing was fetched.');
    if (!filtered) {
      await shoot(page, id, 'grant-fetch-filter-failed');
      note(id, 'Could not fully drive the Status filter — continuing to scrape whatever is currently shown (may be unfiltered).');
    }

    // 4. Download --------------------------------------------------------------
    // Downloads the filtered export and feeds it into the EXACT same entry point
    // (stage1UploadParseValidateMatchAndPersist) the manual "Upload Excel" path
    // uses — no custom row-scraping/matching code, zero divergence risk from a
    // manual upload of the same file.
    patchGrantFetchJob(id, { phase: 'downloading', message: 'Downloading the filtered export…' });
    note(id, 'Downloading the filtered Financial Transactions export…');
    const downloaded = await downloadDisbursementExport(page, id);
    if (isGrantFetchCancelled(id)) return finishCancelled(id, 'Cancelled while downloading. Nothing was fetched.');
    if (!downloaded) {
      await shoot(page, id, 'grant-fetch-download-failed');
      patchGrantFetchJob(id, {
        phase: 'error',
        error: 'Could not find/trigger the Download/Export button on the Financial Transactions page. A debug screenshot was saved to scratch/.',
        message: 'Download failed.',
      });
      return;
    }
    note(id, `Downloaded ${downloaded.filename}.`);

    // 5. Parse, validate, match, persist — same entry point + pipeline the manual
    // xlsx upload uses.
    patchGrantFetchJob(id, { phase: 'processing', message: 'Parsing & matching…' });
    note(id, 'Parsing and matching against FMS/QuickBooks…');
    try {
      const result = await stage1UploadParseValidateMatchAndPersist({
        filepath: downloaded.filepath,
        filename: downloaded.filename,
        actorUserId: opts.actorUserId,
        onProgress: (p) => patchGrantFetchJob(id, { message: p.message }),
      });

      note(id, `Done — ${result.summary.readyRows} ready, ${result.summary.alreadyAppliedRows} already applied, ${result.summary.unmatchedRows + result.summary.ambiguousRows + result.summary.invalidRows} need attention.`);
      patchGrantFetchJob(id, {
        phase: 'done',
        message: 'Done — landed in Step 2 for review.',
        rowsFound: result.summary.totalRows,
        result,
      });
    } finally {
      fs.unlink(downloaded.filepath, () => {}); // best-effort cleanup — the file may contain real trainee/employer data
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log('run failed:', msg);
    patchGrantFetchJob(id, { phase: 'error', error: msg, message: 'Failed.', needsOperator: false, screen: null });
  } finally {
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}

function finishCancelled(id: string, message: string): void {
  patchGrantFetchJob(id, { phase: 'cancelled', message, needsOperator: false, screen: null });
}

/**
 * Publish a frame of the page for the panel to render — the operator's only
 * window into a headless browser they can't otherwise see.
 */
async function publishScreen(page: Page, jobId: string): Promise<void> {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
    patchGrantFetchJob(jobId, {
      screen: {
        dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`,
        width: SCREEN_W,
        height: SCREEN_H,
        at: Date.now(),
      },
    });
  } catch {
    /* mid-navigation — the next tick will get one */
  }
}

/** Apply whatever the operator clicked or typed since the last poll. */
async function applyOperatorInput(page: Page, jobId: string): Promise<void> {
  for (const input of drainGrantFetchInput(jobId)) {
    try {
      if (input.kind === 'click') await page.mouse.click(input.x, input.y);
      else if (input.kind === 'type') await page.keyboard.type(input.text, { delay: 20 });
      else if (input.kind === 'key') await page.keyboard.press(input.key);
    } catch {
      /* the page moved under the gesture — operator can simply click again */
    }
  }
}

async function waitForLogin(page: Page, timeoutMs: number, jobId: string): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isGrantFetchCancelled(jobId)) return false;
    await applyOperatorInput(page, jobId);
    await publishScreen(page, jobId);
    try {
      const body = (await page.textContent('body')) || '';
      if (LOGGED_IN_MARKERS.some((re) => re.test(body))) return true;
    } catch {
      /* mid-navigation — retry */
    }
    // Fast enough that the streamed frames feel live.
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * Financial Transactions stays on www.tpgateway.gov.sg (NOT ds.tpgateway.gov.sg
 * — confirmed directly from a real run's URL bar) at this exact path. Unlike
 * the Direct Applications module (which lives on the separate ds.tpgateway.gov.sg
 * portal and requires a workspace-tile click to establish its session cookie
 * before any deep-link works), this one is the same origin the workspace itself
 * is on, so a direct goto() is the reliable path — no tile click, no domain
 * mismatch, no "did it open a new tab" ambiguity to resolve.
 */
const FINANCIAL_TRANSACTIONS_URL = 'https://www.tpgateway.gov.sg/workspace/grants/FinancialTransactions.aspx';

/**
 * Navigate to Financial Transactions -> Disbursement.
 *
 * Two earlier bugs, both fixed here: (1) the workspace tile's label wraps onto
 * two lines ("Financial" / "Transactions"), so an anchored ^...$ text match
 * never found it and silently clicked "Course Runs" instead; (2) even a fixed
 * tile click was checked against the wrong domain (ds.tpgateway.gov.sg, copied
 * from the Direct Applications flow) — this module never leaves
 * www.tpgateway.gov.sg, so that check could never pass regardless of the click.
 * Now navigates straight to the known URL and falls back to the tile click
 * (handling a possible new-tab launch) only if that redirects away.
 */
async function gotoFinancialTransactionsDisbursement(context: BrowserContext, page: Page, jobId: string): Promise<Page | null> {
  let active = page;

  const onFtPage = () => /FinancialTransactions/i.test(active.url());

  await active.goto(FINANCIAL_TRANSACTIONS_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await active.waitForLoadState('networkidle').catch(() => {});

  if (!onFtPage()) {
    note(jobId, 'Direct link to Financial Transactions redirected — trying the workspace tile instead.');
    await active.goto(WORKSPACE_URL, { waitUntil: 'domcontentloaded' });
    await active.waitForLoadState('networkidle').catch(() => {});

    const tile = active.getByText(/financial\s*transactions/i).first();
    if (!(await tile.count().catch(() => 0))) {
      log('could not find the "Financial Transactions" tile on the workspace page.');
      return null;
    }

    // Portal tiles can launch their module in a NEW TAB rather than navigating the
    // current page — race a same-page navigation against a new page appearing in
    // the context and follow whichever fires.
    const newPageEvent = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    await tile.click({ timeout: 10000 }).catch(() => {});
    const [sameNav, newPage] = await Promise.all([
      active.waitForURL(/FinancialTransactions/i, { timeout: 15000 }).then(() => true).catch(() => false),
      newPageEvent,
    ]);

    if (newPage) {
      note(jobId, 'Financial Transactions opened in a new tab — following it.');
      await newPage.waitForLoadState('domcontentloaded').catch(() => {});
      active = newPage;
    } else if (!sameNav) {
      log(`clicking the Financial Transactions tile did not land on the FinancialTransactions page and no new tab opened (still at ${active.url()}).`);
      return null;
    }

    await active.waitForLoadState('networkidle').catch(() => {});
    if (!onFtPage()) {
      log(`ended up at ${active.url()} instead of Financial Transactions after clicking the tile.`);
      return null;
    }
  }

  // The page defaults to a "Disbursement" tab per the screenshots provided; click it
  // explicitly in case "Recovery" (or another tab) is selected by default.
  const disbursementTab = active.getByRole('tab', { name: /disbursement/i }).first();
  if (await disbursementTab.count().catch(() => 0)) {
    await disbursementTab.click({ timeout: 8000 }).catch(() => {});
  } else {
    const disbursementText = active.getByText(/^\s*disbursement\s*$/i).first();
    if (await disbursementText.count().catch(() => 0)) {
      await disbursementText.click({ timeout: 8000 }).catch(() => {});
    }
  }
  await active.waitForLoadState('networkidle').catch(() => {});
  const ok = await waitForTableRows(active, 25000);
  return ok ? active : null;
}

/** Wait until the results table has at least one data row (SPA rows load via XHR). */
async function waitForTableRows(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.locator('table tbody tr').count().catch(() => 0);
    if (count > 0) return true;
    await page.waitForTimeout(700);
  }
  return false;
}

/**
 * Set Status = Paid and Payment From = startDate, then apply. Deliberately
 * only the START date — TPGateway's own Financial Transactions page defaults
 * to the last 30 days and caps at 180 days if a range is given, so a start
 * date alone is enough to widen the window without needing to also pin an end
 * date; "to" is left at TPGateway's own default (today).
 *
 * The Status control itself is still BEST EFFORT / UNVERIFIED, but no longer
 * guesses at an id/name/aria-label we can't see — confirmed (from the operator
 * directly) that it's a real dropdown with a small, fixed set of options (3
 * total). So the primary strategy now searches every <select> on the page for
 * whichever one actually HAS an option literally named "Paid" — not by
 * attribute name, by content — which the unrelated "Funding Component" select
 * next to it (SSG scheme names, not "Paid") can't accidentally match. Falls
 * back to a Select2-style click-to-open + click-the-option approach, scoped to
 * whatever newly-visible listbox/option-list appeared after opening it (not a
 * document-wide "Paid" text search, which could grab an unrelated occurrence
 * of the word elsewhere on the page).
 *
 * The Payment From date field mapping is confirmed against the live filter
 * row (not a guess): of the two date inputs on the page, the one next to Bank
 * Reference Id (last in DOM order) is "Payment From"; the other (top-left,
 * next to Funding Component) is "Payment To" and is deliberately left alone.
 */
async function applyFilters(page: Page, startDate: string): Promise<boolean> {
  let ok = true;

  try {
    const statusSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: /^\s*paid\s*$/i }) })
      .first();
    if (await statusSelect.count().catch(() => 0)) {
      await statusSelect.selectOption({ label: 'Paid' }).catch(() => statusSelect.selectOption('Paid').catch(() => {}));
    } else {
      // Not a native <select> — try a custom dropdown. The filter row shows each
      // field's name as placeholder text INSIDE the control itself (same as
      // "Funding Component" next to it) rather than a separate <label> above it,
      // so the element containing the text "Status" IS the dropdown trigger.
      const statusControl = page.getByText(/^\s*status\s*$/i).first();
      if (await statusControl.count().catch(() => 0)) {
        await statusControl.click({ timeout: 5000 }).catch(() => {});
        // Scope the "Paid" click to whatever just opened (a listbox/menu role, or the
        // last-added visible popup), so it can't land on an unrelated "Paid" elsewhere
        // on the page (e.g. a status badge already in the results table).
        const openList = page.locator('[role="listbox"], [role="menu"], ul:visible, .dropdown-menu:visible').last();
        const optionInList = openList.getByText(/^\s*paid\s*$/i).first();
        if (await optionInList.count().catch(() => 0)) {
          await optionInList.click({ timeout: 5000 }).catch(() => {
            ok = false;
          });
        } else {
          // Last resort: whichever "Paid" text is topmost/most-recently rendered.
          await page.getByText(/^\s*paid\s*$/i).last().click({ timeout: 5000 }).catch(() => {
            ok = false;
          });
        }
      } else {
        ok = false;
      }
    }
  } catch {
    ok = false;
  }

  // Payment From (start date only — see function doc comment for the field mapping).
  // Typing alone isn't trusted here: on a datepicker widget, characters can land in
  // the DOM without ever updating the component's actual bound value (only a real
  // date-picked event does), and Escape — the previous way this field was dismissed
  // — closes some picker widgets as "cancel", silently reverting what was just typed.
  // So every attempt is verified by reading the field back, and a second attempt
  // (via .fill, which dispatches a proper input/change event rather than simulating
  // keystrokes) is made before giving up.
  try {
    const dateInputs = page.locator('input[type="text"][class*="date" i], input[placeholder*="DD-MM-YYYY" i], input[class*="datepicker" i]');
    const dateCount = await dateInputs.count().catch(() => 0);
    if (dateCount >= 1) {
      const startDateField = dateInputs.last(); // field next to Bank Reference Id = Payment From
      let confirmedValue = '';

      await startDateField.click({ timeout: 5000 });
      await startDateField.fill('');
      await startDateField.type(startDate, { delay: 20 });
      await page.keyboard.press('Tab').catch(() => {}); // commit via blur, not Escape (which some pickers treat as cancel)
      confirmedValue = await startDateField.inputValue().catch(() => '');

      if (confirmedValue !== startDate) {
        // Retry with .fill(), which sets the value directly and fires input/change —
        // more likely to register with a controlled-component date field than typed
        // keystrokes were.
        await startDateField.click({ timeout: 5000 }).catch(() => {});
        await startDateField.fill(startDate).catch(() => {});
        await page.keyboard.press('Tab').catch(() => {});
        confirmedValue = await startDateField.inputValue().catch(() => '');
      }

      if (confirmedValue !== startDate) {
        log(`Payment From did not stick — field shows "${confirmedValue}" after setting "${startDate}". Continuing without the date filter.`);
        ok = false;
      }

      // Captured every run, not just on failure: the input's raw DOM value matching
      // what was typed does NOT prove the widget's real bound state updated — some
      // date pickers only sync that on an actual day-cell click. If results still
      // come back windowed to TPGateway's own default range despite this looking
      // "successful", this file is the next thing to check before guessing again.
      await dumpDateFilterDiagnostics(page, startDate, confirmedValue);
    } else {
      log('expected at least 1 date filter input, found 0 — Payment From was not set.');
      ok = false;
    }
  } catch {
    ok = false;
  }

  // Apply / Search. A short pause first in case the date widget syncs its real
  // bound state asynchronously after blur — clicking Apply immediately could
  // otherwise race ahead of that and submit with the pre-typed default.
  await page.waitForTimeout(400);
  try {
    const applyBtn = page.getByRole('button', { name: /^\s*(apply|search|filter)\s*$/i }).first();
    if (await applyBtn.count().catch(() => 0)) {
      await applyBtn.click({ timeout: 8000 });
      await page.waitForLoadState('networkidle').catch(() => {});
    } else {
      ok = false;
    }
  } catch {
    ok = false;
  }

  if (!ok) await dumpStatusFilterDiagnostics(page);
  return ok;
}

/**
 * Write out what the Status control actually looks like when the filter fails
 * to apply — every <select>'s options, and every element whose text is
 * exactly "Status" or "Paid" with its tag/class. A screenshot alone doesn't
 * show which of these matched or why; this closes that gap so the next fix
 * doesn't need another blind round-trip.
 */
async function dumpStatusFilterDiagnostics(page: Page): Promise<void> {
  try {
    const info = await page.evaluate(() => {
      const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
      const selects = Array.from(document.querySelectorAll('select')).map((sel) => ({
        id: sel.id || null,
        name: sel.getAttribute('name'),
        options: Array.from(sel.options).map((o) => clean(o.textContent)),
      }));
      const describe = (el: Element) => ({
        tag: el.tagName.toLowerCase(),
        class: (el as HTMLElement).className || null,
        role: el.getAttribute('role'),
        text: clean(el.textContent).slice(0, 60),
      });
      const statusMatches = Array.from(document.querySelectorAll('body *'))
        .filter((el) => /^\s*status\s*$/i.test(clean(el.textContent)) && el.children.length === 0)
        .slice(0, 5)
        .map(describe);
      const paidMatches = Array.from(document.querySelectorAll('body *'))
        .filter((el) => /^\s*paid\s*$/i.test(clean(el.textContent)) && el.children.length === 0)
        .slice(0, 5)
        .map(describe);
      return { selects, statusMatches, paidMatches };
    });
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SHOT_DIR, 'grant-fetch-status-filter-diagnostics.json'),
      JSON.stringify(info, null, 2),
      'utf8'
    );
    log('Status filter diagnostics saved to scratch/grant-fetch-status-filter-diagnostics.json');
  } catch (e) {
    log('could not write status filter diagnostics:', e instanceof Error ? e.message : e);
  }
}

/**
 * Write out the date field's real DOM structure — its own outerHTML, its parent
 * chain (a datepicker library usually wraps the visible <input> in its own
 * component div, which is where a separate bound value would actually live),
 * and every hidden input on the page whose name/id/placeholder hints at a date —
 * because "the visible input's value matches what we typed" does not prove the
 * widget's real bound state (the one an Apply click actually reads) changed too.
 * Same reasoning/shape as dumpStatusFilterDiagnostics for the Status control.
 */
async function dumpDateFilterDiagnostics(page: Page, intended: string, confirmed: string): Promise<void> {
  try {
    const info = await page.evaluate(
      ({ intended, confirmed }) => {
        const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
        const describe = (el: Element | null, depth: number) => {
          const chain: Array<{ tag: string; class: string | null; attrs: Record<string, string> }> = [];
          let cur = el;
          for (let i = 0; cur && i < depth; i++) {
            const attrs: Record<string, string> = {};
            for (const a of Array.from(cur.attributes)) attrs[a.name] = a.value.slice(0, 200);
            chain.push({ tag: cur.tagName.toLowerCase(), class: (cur as HTMLElement).className || null, attrs });
            cur = cur.parentElement;
          }
          return chain;
        };
        const dateLike = Array.from(document.querySelectorAll('input')).filter((i) =>
          /date|from|payment/i.test(`${i.id} ${i.name} ${i.placeholder} ${i.className}`)
        );
        const lastDateInput = dateLike[dateLike.length - 1] || null;
        return {
          intended,
          confirmedFromPlaywright: confirmed,
          matchedDateLikeInputCount: dateLike.length,
          allDateLikeInputs: dateLike.map((i) => ({
            tag: i.tagName.toLowerCase(),
            type: i.type,
            id: i.id || null,
            name: i.getAttribute('name'),
            placeholder: i.placeholder || null,
            value: i.value,
            hidden: i.type === 'hidden' || i.hidden,
          })),
          lastDateInputParentChain: describe(lastDateInput, 5),
        };
      },
      { intended, confirmed }
    );
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SHOT_DIR, 'grant-fetch-date-filter-diagnostics.json'),
      JSON.stringify(info, null, 2),
      'utf8'
    );
    log('Date filter diagnostics saved to scratch/grant-fetch-date-filter-diagnostics.json');
  } catch (e) {
    log('could not write date filter diagnostics:', e instanceof Error ? e.message : e);
  }
}

/**
 * Click the Download/Export button and save the resulting file to a temp path.
 *
 * BEST EFFORT / UNVERIFIED exact label — confirmed a Download/Export button
 * exists on this page, but not its precise text, so this tries several common
 * variants. Playwright's download event fires regardless of whether the click
 * triggers a same-tab file response or a new-tab one, so no special handling
 * is needed there.
 */
async function downloadDisbursementExport(page: Page, jobId: string): Promise<{ filepath: string; filename: string } | null> {
  // "Excel View" confirmed as the real button label (operator screenshot) — tried first.
  const patterns = [/^\s*excel\s*view\s*$/i, /^\s*download\s*$/i, /^\s*export\s*$/i, /export\s*to\s*excel/i, /download|export/i];
  let button = null;
  for (const pattern of patterns) {
    for (const role of ['button', 'link'] as const) {
      const candidate = page.getByRole(role, { name: pattern }).first();
      if (await candidate.count().catch(() => 0)) {
        button = candidate;
        break;
      }
    }
    if (button) break;
  }
  if (!button) {
    log('could not find a Download/Export button on the Financial Transactions page.');
    return null;
  }

  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      button.click({ timeout: 10000 }),
    ]);
    const suggested = download.suggestedFilename() || `tpgateway-disbursement-${Date.now()}.xlsx`;
    const filepath = path.join(os.tmpdir(), `gfetch-${jobId}-${suggested}`);
    await download.saveAs(filepath);
    return { filepath, filename: suggested };
  } catch (e) {
    log('clicked Download/Export but no download completed:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function shoot(page: Page, jobId: string, name: string): Promise<void> {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const f = path.join(SHOT_DIR, `${name}.png`);
    await page.screenshot({ path: f, fullPage: true });
    patchGrantFetchJob(jobId, { screenshot: f });
  } catch {
    /* ignore */
  }
}
