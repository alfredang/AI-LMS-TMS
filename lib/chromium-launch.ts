/**
 * Hardened Playwright Chromium launcher.
 *
 * Coolify's runtime image is a minimal Debian where Playwright's default
 * browser detection can fail in two ways:
 *   1. The cache directory (/root/.cache/ms-playwright) may be unreadable
 *      from the runtime uid even though install at build time succeeded.
 *   2. Chromium's shared libs (libglib, libnss3, libgbm, etc.) may be
 *      missing from the slim base image.
 *
 * This helper:
 *   - Forces PLAYWRIGHT_BROWSERS_PATH to /tmp/ms-playwright (universally
 *     writable in any container runtime).
 *   - Searches both /tmp and /root cache locations for an existing binary.
 *   - Lazily runs `playwright install chromium` if not found.
 *   - Lazily runs `playwright install-deps chromium` (or apt-get fallback)
 *     to install the shared system libs.
 *   - Caches the resolved executable path so the cost is paid once per
 *     process.
 *
 * Originally proven in production via lib/cw-brochure.ts; extracted here so
 * lib/cw-slides-infographic.ts can reuse the same battle-tested logic
 * instead of relying on Playwright's default detection.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { chromium, type Browser } from 'playwright';

// Only force the /tmp cache + manual install path on Linux (the Coolify
// container scenario). On Windows/macOS the Playwright npm package handles
// browser detection through its own default cache location and the binary
// names differ ('chrome.exe' on Windows vs 'chrome' on Linux), so the
// container-specific logic actively breaks local dev. Plain
// `chromium.launch()` Just Works on Windows/macOS.
const IS_LINUX = os.platform() === 'linux';

const CHROMIUM_CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH || '/tmp/ms-playwright';
if (IS_LINUX) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = CHROMIUM_CACHE;
}

const CHROMIUM_SEARCH_ROOTS = [CHROMIUM_CACHE, '/root/.cache/ms-playwright'];

function findChromiumExecutable(rootDir: string): string | null {
  if (!fs.existsSync(rootDir)) return null;
  const targets = ['chrome-headless-shell', 'chrome', 'headless_shell'];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (targets.includes(e.name)) {
        return full;
      }
    }
  }
  return null;
}

let cachedChromiumPath: string | null = null;
let depsInstalled = false;

async function ensureChromiumSystemDeps(): Promise<void> {
  if (depsInstalled) return;

  const cliCandidates = [
    'npx --yes playwright install-deps chromium',
    'node node_modules/playwright/cli.js install-deps chromium',
    'node /app/node_modules/playwright/cli.js install-deps chromium',
    '/usr/local/bin/playwright install-deps chromium',
  ];
  for (const cmd of cliCandidates) {
    try {
      execSync(cmd, { stdio: 'inherit', timeout: 300_000 });
      depsInstalled = true;
      console.log(`[chromium-launch] system deps installed via: ${cmd}`);
      return;
    } catch {
      // try next
    }
  }

  // Direct apt-get fallback. Mirrors Playwright's own install-deps list for
  // Debian/Ubuntu. Container runs as root, so no sudo required.
  const aptPackages = [
    'libglib2.0-0', 'libnss3', 'libnspr4', 'libdbus-1-3',
    'libatk1.0-0', 'libatk-bridge2.0-0', 'libatspi2.0-0',
    'libxcomposite1', 'libxdamage1', 'libxfixes3', 'libxrandr2',
    'libgbm1', 'libxkbcommon0', 'libasound2',
    'libpango-1.0-0', 'libcairo2', 'libfontconfig1', 'fonts-liberation',
  ];
  const aptCmd = `apt-get update && apt-get install -y --no-install-recommends ${aptPackages.join(' ')}`;
  try {
    execSync(aptCmd, { stdio: 'inherit', timeout: 300_000, shell: '/bin/bash' });
    depsInstalled = true;
    console.log('[chromium-launch] system deps installed via apt-get');
    return;
  } catch (e: any) {
    throw new Error(
      'Chromium shared libraries are missing and could not be installed. ' +
      'Run `playwright install-deps chromium` in the container, or add the ' +
      `apt packages manually. Last error: ${e?.message || e}`,
    );
  }
}

async function resolveChromiumExe(): Promise<string> {
  if (cachedChromiumPath && fs.existsSync(cachedChromiumPath)) return cachedChromiumPath;

  for (const root of CHROMIUM_SEARCH_ROOTS) {
    const found = findChromiumExecutable(root);
    if (found) {
      cachedChromiumPath = found;
      console.log(`[chromium-launch] found Chromium at ${found}`);
      return found;
    }
  }

  try { fs.mkdirSync(CHROMIUM_CACHE, { recursive: true }); } catch { /* ignore */ }

  const candidates = [
    'npx --yes playwright install chromium',
    'node node_modules/playwright/cli.js install chromium',
    'node /app/node_modules/playwright/cli.js install chromium',
    '/usr/local/bin/playwright install chromium',
  ];
  console.log(`[chromium-launch] Chromium missing — installing to ${CHROMIUM_CACHE} on demand…`);
  let installed = false;
  let lastErr: any;
  for (const cmd of candidates) {
    try {
      execSync(cmd, {
        stdio: 'inherit',
        timeout: 600_000,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: CHROMIUM_CACHE },
      });
      console.log(`[chromium-launch] install succeeded: ${cmd}`);
      installed = true;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!installed) {
    throw new Error(
      'Playwright Chromium is not installed and on-demand install failed. ' +
      `Last error: ${lastErr?.message || lastErr}`,
    );
  }

  for (const root of CHROMIUM_SEARCH_ROOTS) {
    const found = findChromiumExecutable(root);
    if (found) {
      cachedChromiumPath = found;
      console.log(`[chromium-launch] installed and located at ${found}`);
      return found;
    }
  }
  throw new Error(
    'Playwright install reported success but no chromium binary was found in ' +
    CHROMIUM_SEARCH_ROOTS.join(' or ') + '. Check container filesystem permissions.',
  );
}

/**
 * Launch a hardened headless Chromium instance.
 *
 * Linux (production container): searches /tmp/ms-playwright + the default
 * cache, lazily installs Chromium and system libs if missing, then launches
 * with an explicit executablePath.
 *
 * Windows / macOS (local dev): bypasses all of that and just calls
 * `chromium.launch()` — Playwright's own browser detection handles the
 * native cache location (e.g. %USERPROFILE%\AppData\Local\ms-playwright)
 * and the platform-specific binary name (chrome.exe). Forcing the Linux
 * /tmp path on Windows breaks because the install lands at C:\tmp but the
 * binary search finds no `chrome` (only `chrome.exe`).
 *
 * Returns the launched Browser. Caller is responsible for `await browser.close()`.
 */
export async function launchHardenedChromium(args: string[] = []): Promise<Browser> {
  const defaultArgs = [
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-web-security',
    '--allow-file-access-from-files',
  ];
  const finalArgs = Array.from(new Set([...defaultArgs, ...args]));

  if (!IS_LINUX) {
    // Windows / macOS — let Playwright resolve everything natively.
    return chromium.launch({ headless: true, args: finalArgs });
  }

  // Linux: production-hardened path.
  const exePath = await resolveChromiumExe();
  await ensureChromiumSystemDeps();
  return chromium.launch({ headless: true, executablePath: exePath, args: finalArgs });
}
