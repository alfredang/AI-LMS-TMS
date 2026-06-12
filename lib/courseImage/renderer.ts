import { chromium, type Browser } from 'playwright';
import { renderTemplateHtml } from './template';

let browserPromise: Promise<Browser> | null = null;

// Reuse a single Chromium instance across requests within the same Node process.
// Launching Chromium costs ~500-1500ms; reuse drops per-image time to ~150ms.
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function renderCourseImagePng(title: string): Promise<Buffer> {
  const html = renderTemplateHtml({ title });
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const buf = await page.screenshot({
      type: 'png',
      fullPage: false,
      clip: { x: 0, y: 0, width: 1600, height: 900 },
      omitBackground: false,
    });
    return buf;
  } finally {
    await context.close();
  }
}

export async function closeRendererBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
