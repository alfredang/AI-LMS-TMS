/**
 * TPGateway "confirm & fetch" Playwright driver.
 *
 * Opens a HEADED Chromium so a human can complete the Singpass login (which
 * cannot be automated — same reason lib/microsoft-redeem/login.ts is headed),
 * then automatically:
 *   1. Waits for the operator to finish Singpass, then minimises the window so
 *      focus returns to the LMS.
 *   2. Filters Direct Applications to "Confirm application" and collects every
 *      application id (CA-xxxx-xxxxxx).
 *   3. Confirms each: Review & confirm -> tick Declaration -> Proceed -> Confirm.
 *   4. (live only) Re-filters to the download set, downloads the export, parses
 *      it server-side into header-keyed rows for the LMS to ingest.
 *
 * DRY-RUN stops after step 2 (lists what it *would* confirm; touches nothing).
 *
 * LOCAL-ONLY: needs a desktop display + a human. Will not run on the headless
 * Coolify container.
 *
 * Progress is reported to lib/tpg/jobStore so the LMS UI can poll it.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import {
  createJob,
  patchJob,
  upsertApp,
  getJob,
  requestCancel,
  isCancelled,
  approveJob,
  isApproved,
  pushLog,
} from './jobStore';

const REPO_ROOT = process.cwd();
const PROFILE_DIR = path.join(REPO_ROOT, 'scratch', '.tpg-profile'); // gitignored
const SHOT_DIR = path.join(REPO_ROOT, 'scratch');

const WORKSPACE_URL = 'https://www.tpgateway.gov.sg/workspace/';
const LIST_URL =
  'https://ds.tpgateway.gov.sg/content/portal/en/training-provider/course-application.html';
const DETAIL_URL = (id: string) =>
  `https://ds.tpgateway.gov.sg/content/portal/en/training-provider/course-application/detail.html?application=${id}`;

/**
 * Is this browser running on the shared server rather than an operator's own
 * desktop? Set TPG_SERVER_BROWSER=true only on an image that ships Chromium and
 * a virtual display; it also switches the profile from persistent to per-run.
 */
const SERVER_BROWSER = process.env.TPG_SERVER_BROWSER === 'true';

const CA_ID_RE = /CA-\d{4}-\d{6}/g;

/** Text that only appears once the operator is logged into the workspace. */
const LOGGED_IN_MARKERS = [/welcome,/i, /course runs/i, /direct applications/i];

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** How long an unlimited live run waits for approval before giving up. Kept
 *  short enough that the TPGateway session is still alive when it proceeds. */
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

/** Narrate to the dev terminal so the operator can watch the run regardless of
 *  which window is focused. Always visible, unlike the in-LMS panel. */
const log = (...a: unknown[]) => console.log('[tpg]', ...a);

/**
 * Log to the terminal AND to the panel's activity feed.
 *
 * Use for the handful of milestones an operator actually wants narrated. The
 * plain `log` stays for selector-level detail, which belongs in the terminal —
 * a feed that reports every click is as unreadable as no feed at all.
 */
const note = (id: string, text: string) => {
  log(text);
  pushLog(id, text);
};

/** Plain words for the feed — the raw statuses are for the chips, not prose. */
const TPG_STATUS_WORD: Record<string, string> = {
  confirmed: 'confirmed',
  'would-confirm': 'would be confirmed',
  skipped: 'skipped',
  failed: 'failed',
};

/** One-time-per-run flag to dump an application detail page's HTML for scraping. */
let _detailDumped = false;

// --- public API -------------------------------------------------------------

export interface StartOptions {
  dryRun: boolean;
  max: number | null;
}

/** Create a job, kick off the driver in the background, return the job id. */
export function startTpgConfirmJob(opts: StartOptions): string {
  const id = `tpg_${Date.now().toString(36)}_${Math.floor(
    Math.random() * 1e6,
  ).toString(36)}`;
  createJob(id, opts.dryRun, opts.max);
  // Fire-and-forget; the job store carries all progress/results.
  void runJob(id, opts).catch((err) => {
    patchJob(id, {
      phase: 'error',
      error: err?.message || String(err),
      message: 'Failed.',
    });
  });
  return id;
}

export { getJob };

/**
 * Ask a running job to stop. Cancellation is cooperative: the driver only acts
 * on it at a safe boundary (between applications), so a confirmation already in
 * flight always completes rather than being abandoned half-way on TPGateway.
 */
export function cancelTpgConfirmJob(id: string): boolean {
  const ok = requestCancel(id);
  if (ok) log(`job ${id} — cancellation requested; stopping at the next safe point.`);
  return ok;
}

/** Release a run parked at 'awaiting_approval' so it may start confirming. */
export function approveTpgConfirmJob(id: string): boolean {
  const ok = approveJob(id);
  log(ok ? `job ${id} — approved; confirming now.` : `job ${id} — nothing waiting for approval.`);
  return ok;
}

// --- driver -----------------------------------------------------------------

async function runJob(id: string, opts: StartOptions): Promise<void> {
  _detailDumped = false;
  log(`job ${id} started — ${opts.dryRun ? 'DRY RUN' : 'LIVE'}${opts.max ? `, max ${opts.max}` : ''}`);

  let context: BrowserContext | null = null;
  let browser: Browser | null = null;
  try {
    note(id, 'Opening the browser…');
    if (SERVER_BROWSER) {
      // Shared server: every run starts signed out, so whoever pressed the
      // button scans the Singpass QR with their own phone and TPGateway sees
      // that individual. A persistent profile would leave one person's session
      // behind for the next person's run to inherit — convenient on your own
      // laptop, wrong on a machine several staff share.
      browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
      context = await browser.newContext({ viewport: null, acceptDownloads: true });
    } else {
      // Local operator: keep the profile so you are not re-scanning a QR on
      // every run of your own machine.
      fs.mkdirSync(PROFILE_DIR, { recursive: true });
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        viewport: null,
        acceptDownloads: true,
        args: ['--start-maximized'],
      });
    }
    const page = context.pages()[0] || (await context.newPage());

    // 1. Login ---------------------------------------------------------------
    patchJob(id, {
      phase: 'awaiting_login',
      message: 'A browser opened — complete the Singpass login…',
    });
    note(id, 'Waiting for you to complete the Singpass login…');
    await page.goto(WORKSPACE_URL, { waitUntil: 'domcontentloaded' });
    await focusWindow(context, page); // bring the login window to the front
    const loggedIn = await waitForLogin(page, LOGIN_TIMEOUT_MS, id);
    if (isCancelled(id)) return finishCancelled(id, 'Cancelled before login completed.');
    if (!loggedIn) {
      log('login was not detected within the timeout — aborting.');
      patchJob(id, {
        phase: 'error',
        error: 'Singpass login was not completed in time.',
        message: 'Login timed out.',
      });
      return;
    }
    note(id, 'Logged in — minimising the browser window.');
    // Duck the window out of the way so focus returns to the LMS.
    await minimizeWindow(context, page);

    // 2. Collect --------------------------------------------------------------
    patchJob(id, { phase: 'collecting', message: 'Finding pending applications…' });
    note(id, 'Opening Direct Applications and filtering to "Confirm application"…');
    const ids = await collectApplicationIds(page);
    note(id, `Found ${ids.length} application(s) awaiting confirmation.`);
    patchJob(id, {
      found: ids.length,
      message: `Found ${ids.length} application(s) awaiting confirmation.`,
    });
    if (isCancelled(id)) return finishCancelled(id, 'Cancelled while searching. Nothing was confirmed.');
    if (ids.length === 0) {
      // Could be a genuine empty list, OR the list didn't load / filter misfired.
      // Capture what the page looked like so we can tell them apart.
      await shoot(page, id, 'empty-list');
      log(`nothing to confirm — no CA ids found on ${page.url()} (screenshot saved to scratch/tpg-empty-list.png)`);
      // The panel gets the plain-English answer to "did I need to do anything?".
      // The URL and screenshot path are diagnostics for the rare case where the
      // list failed to load — they stay in the terminal log, and the panel links
      // to the screenshot rather than reciting a file path at someone who is
      // simply being told there is no work to do.
      patchJob(id, {
        phase: 'done',
        message: 'No applications are waiting to be confirmed.',
      });
      return;
    }

    const targets = opts.max ? ids.slice(0, opts.max) : ids;

    // 3. Confirm --------------------------------------------------------------
    // Only the applications this run will actually touch become panel rows —
    // listing all of `ids` made a Limit=1 run look like it was processing every
    // application it merely *found*.
    targets.forEach((appId) => upsertApp(id, { id: appId, status: 'pending' }));
    const limited = targets.length < ids.length;

    // An unlimited LIVE run would confirm everything it found before the
    // operator ever saw the number — and confirmation on TPGateway cannot be
    // undone. So park here, show the count and the queued list, and wait for an
    // explicit approval. A Limit is already an explicit "this many", and a dry
    // run changes nothing, so neither needs the checkpoint.
    if (!opts.dryRun && !opts.max) {
      patchJob(id, {
        phase: 'awaiting_approval',
        total: targets.length,
        message: `Found ${targets.length} application(s) awaiting confirmation. Nothing has been confirmed yet — approve to continue.`,
      });
      log(`awaiting your approval to confirm ${targets.length} application(s) — nothing confirmed yet.`);
      const approved = await waitForApproval(id, APPROVAL_TIMEOUT_MS);
      if (!approved) {
        return finishCancelled(
          id,
          isCancelled(id)
            ? 'Cancelled before approving. Nothing was confirmed.'
            : 'Timed out waiting for approval. Nothing was confirmed.',
        );
      }
    }

    patchJob(id, {
      phase: 'confirming',
      total: targets.length,
      message: opts.dryRun
        ? `Dry run: checking ${targets.length} of ${ids.length} found (nothing will be confirmed)…`
        : `Confirming ${targets.length}${limited ? ` of ${ids.length} found` : ''}…`,
    });
    const confirmedIds: string[] = [];
    const confirmedRows: Record<string, string>[] = [];
    let wasCancelled = false;
    for (let i = 0; i < targets.length; i++) {
      // Stop only between applications — never mid-confirmation, which could
      // leave one half-actioned on TPGateway.
      if (isCancelled(id)) {
        wasCancelled = true;
        log(`cancelled after ${i} of ${targets.length} application(s).`);
        break;
      }
      const appId = targets[i];
      upsertApp(id, { id: appId, status: 'confirming' });
      const step = `${i + 1}/${targets.length}`;
      patchJob(id, {
        message: `${opts.dryRun ? 'Checking' : 'Confirming'} ${step}: ${appId}`,
      });
      note(id, `${opts.dryRun ? 'Checking' : 'Confirming'} ${step} — ${appId}…`);
      try {
        const r = await confirmOne(page, appId, opts.dryRun);
        upsertApp(id, { id: appId, status: r.status, reason: r.reason, name: r.name });
        note(
          id,
          `${step} ${r.name || appId} → ${TPG_STATUS_WORD[r.status] || r.status}${r.reason ? ` (${r.reason})` : ''}`,
        );
        if (r.status === 'confirmed') {
          confirmedIds.push(appId);
          if (r.row) confirmedRows.push(r.row);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        upsertApp(id, { id: appId, status: 'failed', reason: msg });
        note(id, `${step} ${appId} → failed: ${msg}`);
        log('  (screenshot saved to scratch/)');
        await shoot(page, id, `error-${appId}`);
      }
    }

    if (opts.dryRun) {
      const checked = getJob(id)?.apps.filter((a) => a.status === 'would-confirm').length ?? 0;
      log(`DRY RUN ${wasCancelled ? 'cancelled' : 'complete'} — ${checked} would be confirmed. Nothing was changed. Closing browser.`);
      patchJob(id, {
        phase: wasCancelled ? 'cancelled' : 'done',
        message: `Dry run ${wasCancelled ? 'cancelled' : 'complete'} — ${checked} would be confirmed. Nothing was changed.`,
      });
      return;
    }

    // Only enrol what was actually confirmed THIS run — never something whose
    // confirmation failed or was skipped.
    if (confirmedIds.length === 0) {
      log('no applications were confirmed this run — skipping download/enrol.');
      patchJob(id, {
        phase: wasCancelled ? 'cancelled' : 'done',
        message: wasCancelled
          ? 'Cancelled — nothing had been confirmed yet.'
          : 'No applications were confirmed — nothing to enrol.',
      });
      return;
    }

    // 4. Enrolment data ------------------------------------------------------
    // Comes straight from the detail pages we scraped while confirming — no
    // flaky Excel export involved.
    // A cancelled run still hands over what it already confirmed — those are
    // live on TPGateway, so skipping the ingest would strand them.
    patchJob(id, { phase: 'downloading', message: 'Preparing enrolment data…' });
    const rows = confirmedRows;
    note(id, `Prepared ${rows.length} enrolment row(s) — handing over to the LMS to enrol.`);
    patchJob(id, {
      phase: wasCancelled ? 'cancelled' : 'done',
      rows,
      message: `${wasCancelled ? 'Cancelled' : 'Done'} — confirmed ${confirmedIds.length} and prepared ${rows.length} row(s). Ingesting…`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    note(id, `Failed: ${msg}`);
    patchJob(id, { phase: 'error', error: msg, message: 'Failed.' });
    throw err;
  } finally {
    if (context) {
      try {
        note(id, 'Closing the browser window.');
        await context.close();
      } catch {
        /* ignore */
      }
    }
    // launch() leaves the browser process alive after its context closes —
    // unlike launchPersistentContext, where closing the context ends it. On a
    // long-lived server that difference is a Chromium leak per run.
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    log(`job ${id} finished.`);
  }
}

/** Block until the operator approves, cancels, or the wait times out. */
async function waitForApproval(id: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isCancelled(id)) return false;
    if (isApproved(id)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Mark a job as stopped at the operator's request (the browser closes in `finally`). */
function finishCancelled(id: string, message: string): void {
  log(`job ${id} cancelled — ${message}`);
  patchJob(id, { phase: 'cancelled', message });
}

// --- steps ------------------------------------------------------------------

async function waitForLogin(page: Page, timeoutMs: number, jobId: string): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isCancelled(jobId)) return false;
    try {
      const body = (await page.textContent('body')) || '';
      if (LOGGED_IN_MARKERS.some((re) => re.test(body))) return true;
    } catch {
      /* mid-navigation — retry */
    }
    await page.waitForTimeout(2500);
  }
  return false;
}

/** Raise the automation window to the front so the operator sees the login prompt. */
async function focusWindow(context: BrowserContext, page: Page): Promise<void> {
  try {
    await page.bringToFront();
    const cdp = await context.newCDPSession(page);
    const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
    // normal → maximized nudges it out of a minimized/background state and on top.
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  } catch {
    /* best-effort */
  }
}

/** Minimise the automation window via CDP so the operator's LMS window resurfaces. */
async function minimizeWindow(context: BrowserContext, page: Page): Promise<void> {
  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as {
      windowId: number;
    };
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'minimized' },
    });
  } catch {
    /* best-effort — if minimise fails the window just stays visible */
  }
}

/** Scrape all application ids currently rendered on the page (rendered text, not raw HTML). */
async function scrapeIdsFromPage(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  return text.match(CA_ID_RE) || [];
}

/**
 * Scrape one entry per application row, pairing its CA id with whether the row's
 * status is "Confirm application". This lets us target only genuinely-pending
 * applications even when the Filter modal can't be driven — a row in
 * "Confirmed" / "Confirmed (Pending payment)" state won't contain the exact
 * phrase "Confirm application".
 */
async function scrapeApplications(page: Page): Promise<{ id: string; pending: boolean }[]> {
  return page
    .evaluate(() => {
      const CA = /CA-\d{4}-\d{6}/;
      const seen = new Set<string>();
      const out: { id: string; pending: boolean }[] = [];
      let rows: Element[] = Array.from(document.querySelectorAll('tr'));
      if (!rows.length) {
        rows = Array.from(document.querySelectorAll('div,li')).filter((el) =>
          CA.test(el.textContent || ''),
        );
      }
      for (const el of rows) {
        const txt = (el.textContent || '').replace(/\s+/g, ' ');
        const all = txt.match(/CA-\d{4}-\d{6}/g) || [];
        // Row-sized elements contain exactly one CA id (skip the whole table/container).
        if (all.length !== 1 || seen.has(all[0])) continue;
        seen.add(all[0]);
        out.push({ id: all[0], pending: /confirm application/i.test(txt) });
      }
      return out;
    })
    .catch(() => [] as { id: string; pending: boolean }[]);
}

/**
 * Wait until the first application id on the page differs from `previousFirstId`
 * — i.e. the next page of rows has actually rendered. Returns false if it never
 * changes, so the caller stops rather than scraping the same page twice.
 */
async function waitForRowsToChange(
  page: Page,
  previousFirstId: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!previousFirstId) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = await scrapeIdsFromPage(page);
    if (ids.length > 0 && ids[0] !== previousFirstId) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** Wait until at least one application id has rendered (SPA rows load via XHR). */
async function waitForRows(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = await scrapeIdsFromPage(page);
    if (ids.length > 0) return true;
    await page.waitForTimeout(700);
  }
  return false;
}

/**
 * Enter the ds.tpgateway training-provider portal.
 *
 * Deep-linking straight to a ds.tpgateway URL bounces back to the workspace —
 * the portal session is only established by clicking in through a workspace
 * tile. So we click a tile (Course Runs / Enrolments / …) first. Once that
 * handshake happens the session cookie is set and later deep-links work.
 */
async function enterDsPortal(page: Page): Promise<boolean> {
  if (/ds\.tpgateway\.gov\.sg/i.test(page.url())) return true;
  await page.goto(WORKSPACE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const tiles = [/^\s*course runs\s*$/i, /^\s*enrolments\s*$/i, /^\s*attendance\s*$/i, /^\s*course registry\s*$/i];
  for (const tile of tiles) {
    const el = page.getByText(tile).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 8000 }).catch(() => {});
      await page.waitForURL(/ds\.tpgateway\.gov\.sg/i, { timeout: 20000 }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      if (/ds\.tpgateway/i.test(page.url())) {
        log(`entered ds portal via tile (${tile.source}) → ${page.url()}`);
        return true;
      }
    }
  }
  log('could not enter the ds portal from a workspace tile.');
  return false;
}

/** Navigate to the Direct Applications list the way a human does. */
async function gotoDirectApplications(page: Page): Promise<boolean> {
  await enterDsPortal(page);
  // Prefer the in-portal nav tab; fall back to the deep link (now the session exists).
  const tab = page.getByRole('link', { name: /direct applications/i }).first();
  if (await tab.count().catch(() => 0)) {
    await tab.click({ timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  if (!/course-application/i.test(page.url())) {
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  return waitForRows(page, 25000);
}

/** Dump the filter modal's HTML so selectors can be finalized if driving fails. */
async function dumpFilterModalHtml(page: Page): Promise<void> {
  try {
    const html = await page.evaluate(() => {
      const cands = Array.from(
        document.querySelectorAll(
          '[role=dialog], .modal, [class*=modal], [class*=Modal], [class*=dialog], [class*=Dialog]',
        ),
      );
      const el =
        cands.find((c) => /application status/i.test(c.textContent || '')) ||
        cands.find((c) => /\bapply\b/i.test(c.textContent || '')) ||
        cands[cands.length - 1];
      return el ? (el as HTMLElement).outerHTML : document.body.innerHTML.slice(0, 30000);
    });
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOT_DIR, 'tpg-filter-modal.html'), html);
    log('saved filter modal HTML → scratch/tpg-filter-modal.html (for selector tuning).');
  } catch {
    /* ignore */
  }
}

/**
 * Open the Filter modal and select Application-status options, then Apply.
 *
 * The status control is a Select2 widget over a hidden native
 * `<select id="appStatus" multiple>` (options: "Confirm application",
 * "Confirmed", "Confirmed (Pending payment)"). Rather than fight the Select2 UI,
 * we set the underlying select's options directly and fire the change event that
 * Select2/jQuery listen to, then click APPLY (`#applyButton`, onclick=appFilter()).
 * Returns true if it selected at least one option and clicked Apply.
 */
async function applyStatusFilter(page: Page, statuses: string[]): Promise<boolean> {
  try {
    // 1. Open the Filter modal (button labelled "FILTER" / "FILTER (1)").
    const filterBtn = page.getByRole('button', { name: /filter/i }).first();
    if (await filterBtn.count()) {
      await filterBtn.click({ timeout: 10000 });
    } else {
      await page.getByText(/^\s*filter(\s*\(\d+\))?\s*$/i).first().click({ timeout: 8000 });
    }

    // 2. Wait for the hidden status <select> to be present.
    await page.locator('#appStatus').waitFor({ state: 'attached', timeout: 8000 });

    // 3. Set the selected options on the native select + notify Select2/jQuery.
    const selectedCount = await page.evaluate((wanted: string[]) => {
      const sel = document.getElementById('appStatus') as HTMLSelectElement | null;
      if (!sel) return -1;
      let count = 0;
      for (const opt of Array.from(sel.options)) {
        const on = wanted.some((w) => w.toLowerCase() === opt.value.toLowerCase());
        opt.selected = on;
        if (on) count++;
      }
      const jq = (window as unknown as { jQuery?: (el: Element) => { trigger: (e: string) => void } }).jQuery;
      if (jq) jq(sel).trigger('change');
      else sel.dispatchEvent(new Event('change', { bubbles: true }));
      return count;
    }, statuses);
    if (selectedCount <= 0) return false;

    // 4. Apply.
    await page.locator('#applyButton').click({ timeout: 5000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function collectApplicationIds(page: Page): Promise<string[]> {
  // The list renders its rows via a background API call — wait for real rows
  // before scraping, otherwise we read an empty shell (→ 0 ids).
  const loaded = await gotoDirectApplications(page);
  log(`list page loaded=${loaded} at ${page.url()}`);

  // Filter to "Confirm application". Best-effort — the row-status scan below is
  // the real safety net, so a failed filter still yields the correct pending set.
  if (await applyStatusFilter(page, ['Confirm application'])) {
    log('applied "Confirm application" filter.');
    await waitForRows(page, 15000); // let the filtered rows re-render
  } else {
    log('could not drive the filter modal — scraping the list as shown (row-status scan still narrows to pending).');
    await dumpFilterModalHtml(page);
  }

  // Bump rows-per-page to 50 (best-effort).
  try {
    await page.getByRole('combobox').last().selectOption('50').catch(() => {});
    await page.waitForTimeout(1200);
  } catch {
    /* ignore */
  }

  const status = new Map<string, boolean>(); // id -> is "Confirm application"
  let firstIdOnPage = '';
  for (let pageNo = 1; pageNo <= 200; pageNo++) {
    // Wait for THIS page's rows to have rendered rather than sleeping a fixed
    // 800ms each time: returns as soon as the ids change, but still waits out a
    // slow XHR instead of scraping a half-rendered page and losing applications.
    if (pageNo > 1) {
      const changed = await waitForRowsToChange(page, firstIdOnPage, 8000);
      if (!changed) break; // page never advanced — stop rather than rescrape
    }
    const scraped = await scrapeApplications(page);
    firstIdOnPage = scraped[0]?.id || firstIdOnPage;
    for (const a of scraped) {
      if (!status.has(a.id)) status.set(a.id, a.pending);
    }

    const next = page.getByRole('button', { name: /next|›|»/i }).last();
    const visible = await next.isVisible().catch(() => false);
    const enabled = await next.isEnabled().catch(() => false);
    if (!visible || !enabled) break;
    await next.click().catch(() => {});
  }

  const pendingIds = [...status.entries()].filter(([, p]) => p).map(([id]) => id);
  if (pendingIds.length > 0) {
    log(`${pendingIds.length} of ${status.size} listed application(s) are in "Confirm application" status.`);
    return pendingIds;
  }
  // Row-status scan found none flagged — fall back to every id; confirmOne
  // re-checks each detail page and safely skips anything not awaiting confirmation.
  log(`row-scan flagged 0 as pending — falling back to all ${status.size} id(s) (each re-checked on its detail page).`);
  return [...status.keys()];
}

interface ConfirmResult {
  status: 'confirmed' | 'would-confirm' | 'skipped';
  reason?: string;
  name?: string;
  row?: Record<string, string>;
}

/** Validate a scraped value looks like a learner name (TPGateway shows names in caps). */
function cleanName(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().replace(/\s+/g, ' ');
  if (/^[A-Z][A-Z .,'/@()-]{1,59}$/.test(s) && /[A-Z]{2,}/.test(s)) return s;
  return undefined;
}

/** Pull the learner's name off the application detail page (best-effort). */
async function extractDetailName(page: Page): Promise<string | undefined> {
  // Strategy 1: the "Name" label followed by its value element.
  try {
    const label = page.getByText('Name', { exact: true }).first();
    if (await label.count()) {
      const val = await label
        .locator('xpath=following::*[1]')
        .textContent({ timeout: 1000 })
        .catch(() => null);
      const cleaned = cleanName(val);
      if (cleaned) return cleaned;
    }
  } catch {
    /* fall through */
  }
  // Strategy 2: regex on the body text.
  try {
    const body = (await page.textContent('body')) || '';
    const m = body.match(/\bName\b\s*[:\n]?\s*([A-Z][A-Z .,'/@()-]{2,60})/);
    const cleaned = cleanName(m?.[1]);
    if (cleaned) return cleaned;
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Scrape the enrolment fields off an application detail page and return them
 * keyed by the Excel headers the LMS DA ingest already understands — so the
 * result drops straight into /api/admin/upload-da-applications. This replaces
 * the unreliable Excel export as the enrolment data source.
 */
async function scrapeDetailFields(page: Page): Promise<Record<string, string>> {
  const raw = await page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
    const map: Record<string, string> = {};
    document.querySelectorAll('div.fw-bold').forEach((label) => {
      const key = clean(label.textContent);
      const val = label.nextElementSibling as HTMLElement | null;
      if (key && val && !(key in map)) map[key] = clean(val.textContent);
    });
    const byHeader = (header: string): string => {
      const n = Array.from(document.querySelectorAll('.modal-details-title')).find(
        (x) => clean(x.textContent).toUpperCase() === header,
      );
      const container = n ? (n.nextElementSibling as HTMLElement | null) : null;
      if (!container) return '';
      const input = container.querySelector('input') as HTMLInputElement | null;
      if (input) return clean(input.value);
      const sel = container.querySelector('select') as HTMLSelectElement | null;
      if (sel) return clean(sel.value || (sel.options[sel.selectedIndex]?.text ?? ''));
      return clean(container.textContent);
    };
    // Fees live in spans with stable ids on the detail page.
    const feeById = (fid: string): string => {
      const el = document.getElementById(fid);
      return el ? el.getAttribute('value') || clean(el.textContent).replace(/[^0-9.]/g, '') : '';
    };
    // The course run <select> option text carries the run dates alongside the id,
    // e.g. "15 Aug 2026 - 16 Aug 2026 (1129287)". Reading dates from the SAME
    // element that gives us Course Run ID means the two can never disagree.
    const runSel = document.getElementById('runId') as HTMLSelectElement | null;
    const runOptionText = runSel ? clean(runSel.options[runSel.selectedIndex]?.text ?? '') : '';
    // Fallback: the course-title row repeats the same range (its label is the
    // course title, so it can't be looked up by a fixed key). Require a full
    // range so "Application Date" ("22 Jul 2026, 12:34 am") can't match.
    const rangeRe = /\d{1,2} [A-Za-z]{3,} \d{4}\s*[-–]\s*\d{1,2} [A-Za-z]{3,} \d{4}/;
    const runDatesFallback = Object.values(map).find((v) => rangeRe.test(v)) || '';
    const tgs = (document.body.innerText || '').match(/TGS-\d{6,}/);
    return {
      appId: map['Application ID'] || '',
      appDate: map['Application Date'] || '',
      name: map['Name'] || '',
      nric: map['NRIC/FIN'] || '',
      dob: map['Date of birth'] || '',
      email: map['Email address'] || '',
      contact: map['Contact number'] || '',
      qualification: map['Highest qualification'] || '',
      courseTitle: byHeader('COURSE TITLE'),
      courseRunId: byHeader('COURSE RUN (COURSE RUN ID)'),
      runDates: runOptionText || runDatesFallback,
      fullCourseFee: feeById('fullCourseFee'),
      gst: feeById('gstAmount'),
      subsidy: feeById('subsidyFee'),
      sfc: feeById('sfcUsage'),
      payable: feeById('payableFee'),
      tgs: tgs ? tgs[0] : '',
    };
  });

  const pm = (raw.contact || '').match(/^\s*(\+\d+)?\s*(.+)$/);
  const phoneCc = pm && pm[1] ? pm[1] : '';
  const phone = pm ? pm[2].trim() : raw.contact;
  const idType = /^[FG]\d{7}[A-Z]$/i.test(raw.nric)
    ? 'FIN'
    : /^[ST]\d{7}[A-Z]$/i.test(raw.nric)
      ? 'NRIC'
      : '';
  const payableNum = parseFloat((raw.payable || '0').replace(/[^0-9.]/g, '')) || 0;
  // Course run dates. A single-day run shows one date, so end falls back to start.
  // Left blank rather than guessed if the run text is unreadable — the ingest
  // skips empty values, so a NULL is preferable to a wrong date on an invoice.
  // "22 Jul 2026, 12:34 am" — keep only the date; the ingest's parseDate() can't
  // read the lowercase am/pm time, and a blank DA date makes the row sort oddly
  // in the admin list.
  const applicationDate = ((raw.appDate || '').match(/\d{1,2} [A-Za-z]{3,} \d{4}/) || [''])[0];
  const runDates = (raw.runDates || '').match(/\d{1,2} [A-Za-z]{3,} \d{4}/g) || [];
  const courseStartDate = runDates[0] || '';
  const courseEndDate = runDates[1] || runDates[0] || '';
  // Match how the manual Excel upload records confirmed applications: always
  // "Confirmed". Verified against existing data (2300 "Confirmed", no genuine
  // "Confirmed (Pending payment)") — TPGateway's UI shows pending-payment but
  // the export/LMS uses plain "Confirmed".
  const status = 'Confirmed';

  return {
    'Application ID': raw.appId,
    'Application Date': applicationDate,
    'Trainee Name': raw.name,
    'Trainee ID': raw.nric,
    'Trainee ID Type': idType,
    'Date of Birth': raw.dob,
    'Trainee Email': raw.email,
    'Trainee Phone Country Code': phoneCc,
    'Trainee Phone': phone,
    'Course Run ID': raw.courseRunId,
    'Course Reference Number': raw.tgs,
    'Course Title': raw.courseTitle,
    'Course Start Date': courseStartDate,
    'Course End Date': courseEndDate,
    'Full course fee': raw.fullCourseFee,
    'GST': raw.gst,
    'SkillsFuture subsidy': raw.subsidy,
    'SkillsFuture Credit': raw.sfc,
    'Payable Fee': String(payableNum),
    'Highest Qualification': raw.qualification,
    'Application Status': status,
  };
}

async function confirmOne(page: Page, id: string, dryRun: boolean): Promise<ConfirmResult> {
  await page.goto(DETAIL_URL(id), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (/workspace/i.test(page.url())) {
    // Bounced to workspace — re-establish the portal session and retry once.
    await enterDsPortal(page);
    await page.goto(DETAIL_URL(id), { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  const name = await extractDetailName(page);

  // Dump the first detail page's HTML (once per run) so the enrol-field scrapers
  // can be built from the real markup — captured even on a dry run.
  if (!_detailDumped) {
    _detailDumped = true;
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      fs.writeFileSync(path.join(SHOT_DIR, 'tpg-detail.html'), await page.content());
      log('saved detail page HTML → scratch/tpg-detail.html');
    } catch {
      /* ignore */
    }
  }

  // Is this application still awaiting confirmation? Ask the page for the thing
  // we'd actually have to click, not for a phrase — "confirm application" also
  // appears in the deadline banner ("Confirm application by 11 Aug 2026"), so
  // matching text could wave through an already-confirmed application. This is
  // the only safety net when collectApplicationIds falls back to every id.
  const reviewBtn = page
    .locator('button[onclick="openDetail()"], button:has-text("REVIEW & CONFIRM")')
    .first();
  // waitFor (not isVisible) so a slow SPA render isn't mistaken for "confirmed".
  const stillPending = await reviewBtn
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!stillPending) {
    return { status: 'skipped', reason: 'not awaiting confirmation', name };
  }

  // Scrape the enrolment fields off this detail page (data source for the LMS).
  const row = await scrapeDetailFields(page);

  if (dryRun) {
    return { status: 'would-confirm', name, row };
  }

  // These are Bootstrap modals, NOT role=dialog — target the real elements.

  // 1. Review & Confirm → opens the declaration modal (onclick openDetail()).
  await reviewBtn.click({ timeout: 15000 });

  // 2. Declaration modal: tick #CaD (fires validationProcess(), enabling Proceed).
  const decl = page.locator('#CaD');
  await decl.waitFor({ state: 'visible', timeout: 15000 });
  await decl.check({ timeout: 8000 }).catch(async () => {
    await page.getByText(/I confirm that I have read/i).first().click();
  });

  // 3. Proceed to confirm (onclick openConfirmPopup()).
  await page
    .locator('button.proceedButton:visible, button:has-text("PROCEED TO CONFIRM")')
    .first()
    .click({ timeout: 10000 });

  // 4. Confirm popup: WAIT for the CONFIRM button to animate in, then click it.
  //    SAFETY: match only the confirmApplication('TGS-…') / payment-confirm
  //    buttons, and the fallback explicitly excludes cancelApplication() — the
  //    CANCEL APPLICATION flow's popup button also reads "CONFIRM".
  let confirmBtn = page
    .locator("button[onclick^=\"confirmApplication('\"]:visible, button.confirmPaymentButton:visible")
    .first();
  await confirmBtn.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  if ((await confirmBtn.count()) === 0) {
    confirmBtn = page
      .locator('button:visible:not([onclick*="cancelApplication"])')
      .filter({ hasText: /^\s*confirm\s*$/i })
      .first();
  }
  await confirmBtn.waitFor({ state: 'visible', timeout: 8000 });
  await confirmBtn.click({ timeout: 8000 });

  // The confirm popup closing IS the signal that TPGateway accepted it, so wait
  // for that rather than sleeping a flat 1.5s per application. Falls back to the
  // old blind wait if the popup behaves unexpectedly, so a slow response can't
  // be mistaken for a finished one.
  const settled = await confirmBtn
    .waitFor({ state: 'hidden', timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!settled) await page.waitForTimeout(1500);
  await page.waitForLoadState('networkidle').catch(() => {});
  return { status: 'confirmed', name, row };
}

async function shoot(page: Page, jobId: string, name: string): Promise<void> {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const f = path.join(SHOT_DIR, `tpg-${name}.png`);
    await page.screenshot({ path: f, fullPage: true });
    patchJob(jobId, { screenshot: f });
  } catch {
    /* ignore */
  }
}
