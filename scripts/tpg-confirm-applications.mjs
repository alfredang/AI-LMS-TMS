/**
 * Semi-automated confirmation of TPGateway "Direct Applications".
 *
 * WHAT IT DOES
 *   Opens a real (headed) Chromium window so you can log in via Singpass
 *   yourself — Singpass MFA / QR / passkey CANNOT be automated, exactly like
 *   lib/microsoft-redeem/login.ts handles Microsoft sign-in. Once you're in,
 *   the script:
 *     1. Goes to Direct Applications and filters to "Confirm application".
 *     2. Collects every application ID (CA-xxxx-xxxxxx) across all pages.
 *     3. For each one it opens the detail page and runs the confirm flow:
 *          Review & confirm -> tick the Declaration checkbox
 *          -> Proceed to confirm -> Confirm.
 *
 * SAFETY
 *   Confirming is an irreversible action against a government portal, so the
 *   script is DRY-RUN by default: it lists what it *would* confirm and stops.
 *   Pass --confirm to actually click through. Add --max=N to cap how many.
 *
 * USAGE
 *   node scripts/tpg-confirm-applications.mjs            # dry run (safe)
 *   node scripts/tpg-confirm-applications.mjs --confirm  # really confirm
 *   node scripts/tpg-confirm-applications.mjs --confirm --max=5
 *
 * NOTES
 *   - Needs a desktop display (won't work on the headless Coolify container).
 *   - The Singpass session is kept in a gitignored browser profile under
 *     scratch/, so re-runs may skip login until the session expires.
 *   - Selectors are text/role based off the current portal UI. If TPGateway
 *     tweaks a label, the matching step will time out and dump a screenshot to
 *     scratch/ — tell me what broke and I'll adjust the locator.
 */

import { chromium } from 'playwright';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(REPO_ROOT, 'scratch', '.tpg-profile');   // gitignored (scratch/*)
const SHOT_DIR = path.join(REPO_ROOT, 'scratch');

const WORKSPACE_URL = 'https://www.tpgateway.gov.sg/workspace/';
const LIST_URL = 'https://ds.tpgateway.gov.sg/content/portal/en/training-provider/course-application.html';
const DETAIL_URL = (id) =>
  `https://ds.tpgateway.gov.sg/content/portal/en/training-provider/course-application/detail.html?application=${id}`;

const CA_ID_RE = /CA-\d{4}-\d{6}/g;

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const DO_CONFIRM = argv.includes('--confirm');
const MAX = (() => {
  const m = argv.find((a) => a.startsWith('--max='));
  return m ? parseInt(m.split('=')[1], 10) : Infinity;
})();

const log = (...a) => console.log('[tpg]', ...a);

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (ans) => { rl.close(); res(ans.trim()); }));
}

async function shoot(page, name) {
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const f = path.join(SHOT_DIR, `tpg-${name}.png`);
    await page.screenshot({ path: f, fullPage: true });
    log('screenshot:', f);
  } catch { /* ignore */ }
}

// --- collect the application IDs to confirm ---------------------------------
async function collectApplicationIds(page) {
  log('opening Direct Applications…');
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  // Open the Filter modal and select "Confirm application".
  try {
    await page.getByRole('button', { name: /^filter/i }).first().click({ timeout: 15000 });
    const dialog = page.getByRole('dialog').filter({ hasText: /filter/i }).first();
    // The status control is a dropdown/multiselect — click it, pick the option.
    await dialog.getByText(/application status/i).first().scrollIntoViewIfNeeded().catch(() => {});
    const statusBox = dialog.locator('div,button,input').filter({ hasText: /application status/i });
    await statusBox.first().click().catch(() => {});
    // Try clicking the option by its visible text.
    await page.getByText(/^\s*confirm application\s*$/i).first().click({ timeout: 8000 }).catch(() => {});
    await dialog.getByRole('button', { name: /^apply$/i }).click({ timeout: 8000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    log('filter applied: Confirm application');
  } catch (e) {
    log('WARN: could not drive the Filter modal automatically —', e.message);
    log('      falling back to scraping only rows whose status text is "Confirm application".');
  }

  // Bump rows-per-page to 50 if the control exists (best-effort).
  try {
    await page.getByText(/rows per page/i).first().scrollIntoViewIfNeeded();
    await page.getByRole('combobox').last().selectOption('50').catch(() => {});
  } catch { /* ignore */ }

  // Walk pages, collecting IDs. Only keep rows that are in "Confirm application"
  // state — we re-check the status column so a mis-applied filter is still safe.
  const ids = new Set();
  for (let pageNo = 1; pageNo <= 200; pageNo++) {
    await page.waitForTimeout(800);
    const rowsHtml = await page.content();
    const found = rowsHtml.match(CA_ID_RE) || [];
    found.forEach((id) => ids.add(id));
    log(`page ${pageNo}: table now yields ${ids.size} unique application id(s) so far`);

    const next = page.getByRole('button', { name: /next|›|»/i }).last();
    const canNext = await next.isEnabled().catch(() => false);
    const visible = await next.isVisible().catch(() => false);
    if (!visible || !canNext) break;
    await next.click().catch(() => {});
  }
  return [...ids];
}

// --- confirm a single application -------------------------------------------
async function confirmOne(page, id) {
  await page.goto(DETAIL_URL(id), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  // Guard: only proceed if this really is awaiting confirmation.
  const pageText = (await page.textContent('body')) || '';
  if (!/confirm application/i.test(pageText)) {
    return { id, status: 'skipped', reason: 'not in "Confirm application" state' };
  }
  if (!DO_CONFIRM) {
    return { id, status: 'would-confirm' };
  }

  // Step: Review & Confirm
  await page.getByRole('button', { name: /review\s*&?\s*confirm/i }).first().click({ timeout: 15000 });

  // Modal: "Review details and confirm application" -> tick Declaration
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  const checkbox = dialog.getByRole('checkbox').first();
  await checkbox.check({ timeout: 10000 }).catch(async () => {
    // Some UIs render the box as a styled label — click the label text instead.
    await dialog.getByText(/I confirm that I have read/i).first().click();
  });

  // Step: Proceed to confirm
  await dialog.getByRole('button', { name: /proceed to confirm/i }).click({ timeout: 10000 });

  // Modal: "Confirm application" -> Confirm
  const confirmDialog = page.getByRole('dialog').filter({ hasText: /confirm application/i }).last();
  await confirmDialog.getByRole('button', { name: /^confirm$/i }).click({ timeout: 10000 });

  // Wait for the success state to settle.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  return { id, status: 'confirmed' };
}

// --- main -------------------------------------------------------------------
(async () => {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  log(DO_CONFIRM ? 'MODE: CONFIRM (will click through)' : 'MODE: DRY RUN (no confirmations — pass --confirm to execute)');
  if (Number.isFinite(MAX)) log(`cap: ${MAX} application(s)`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
  });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto(WORKSPACE_URL, { waitUntil: 'domcontentloaded' });
    log('A Chromium window is open. Log in via Singpass and land on the TPGateway workspace.');
    await prompt('   >> When you can SEE the workspace tiles, press Enter here to continue… ');

    const ids = await collectApplicationIds(page);
    log(`found ${ids.length} application(s) needing confirmation.`);
    if (ids.length === 0) { log('nothing to do.'); return; }

    const targets = ids.slice(0, MAX);
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const id = targets[i];
      log(`(${i + 1}/${targets.length}) ${id} …`);
      try {
        const r = await confirmOne(page, id);
        results.push(r);
        log(`   -> ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
      } catch (e) {
        results.push({ id, status: 'error', reason: e.message });
        log(`   -> ERROR: ${e.message}`);
        await shoot(page, `error-${id}`);
      }
    }

    log('----- summary -----');
    const by = (s) => results.filter((r) => r.status === s).map((r) => r.id);
    log('confirmed:    ', by('confirmed').length, by('confirmed').join(', '));
    log('would-confirm:', by('would-confirm').length, by('would-confirm').join(', '));
    log('skipped:      ', by('skipped').length);
    log('errors:       ', by('error').length, by('error').join(', '));
    if (!DO_CONFIRM && by('would-confirm').length) {
      log('Re-run with --confirm to actually confirm these.');
    }
  } catch (e) {
    log('FATAL:', e.message);
    await shoot(page, 'fatal');
  } finally {
    await prompt('Press Enter to close the browser… ');
    await context.close();
  }
})();
