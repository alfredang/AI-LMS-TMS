import fs from 'fs';
import path from 'path';

// Official Tertiary "T" mark (512x512, transparent PNG) downloaded from
// tertiaryinfotech.com's own R2 bucket. Paired with live-rendered wordmark
// text so the lockup sits cleanly on the dark gradient with no white halo.
const LOGO_PATH = path.join(process.cwd(), 'public/templates/brand/tertiary-logo-official.png');

let cachedLogoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const buf = fs.readFileSync(LOGO_PATH);
  cachedLogoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
  return cachedLogoDataUri;
}

// Strip leading "WSQ", "WSQ -", "WSQ:" tokens so the visible title focuses on the
// course subject (the WSQ chip is implicit for funded courses and already shown
// elsewhere on the course page).
export function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*WSQ\s*[:\-–—]?\s*/i, '')
    .trim();
}

// Title font-size auto-fit: shorter titles get larger text. The CSS uses
// `clamp`-like manual tiering so headless Chromium produces consistent output
// without measuring text width at runtime.
function titleFontPx(title: string): number {
  const len = title.length;
  if (len <= 30) return 120;
  if (len <= 50) return 100;
  if (len <= 70) return 86;
  if (len <= 100) return 72;
  if (len <= 130) return 62;
  return 54;
}

export interface CourseImageTemplateInput {
  title: string;
}

export function renderTemplateHtml({ title }: CourseImageTemplateInput): string {
  const cleaned = cleanTitle(title);
  const fontPx = titleFontPx(cleaned);
  const logoDataUri = getLogoDataUri();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1600px; height: 900px; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif;
    color: #ffffff;
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(ellipse at 62% 40%, rgba(59, 111, 196, 0.55) 0%, rgba(13, 42, 94, 0) 60%),
      linear-gradient(180deg, #05102A 0%, #0D2A5E 55%, #1F4A8F 100%);
  }
  /* Cyan top bar accent */
  .top-bar {
    position: absolute; top: 0; left: 0; right: 0;
    height: 4px;
    background: linear-gradient(90deg, #59EBFD 0%, #3B6FC4 50%, #59EBFD 100%);
    opacity: 0.85;
  }
  /* Faint dot grid texture */
  .dots {
    position: absolute; inset: 0;
    background-image: radial-gradient(rgba(89, 235, 253, 0.18) 1.5px, transparent 1.5px);
    background-size: 40px 40px;
    background-position: 0 0;
    opacity: 0.5;
    pointer-events: none;
  }
  /* Bottom-left corner ring decoration */
  .corner-ring {
    position: absolute;
    left: -120px; bottom: -120px;
    width: 320px; height: 320px;
    border: 3px solid rgba(89, 235, 253, 0.35);
    border-radius: 50%;
  }
  /* Top-left brand lockup: T mark + wordmark text */
  .brand {
    position: absolute;
    top: 70px; left: 80px;
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .brand-mark {
    height: 96px;
    width: 96px;
    object-fit: contain;
    filter: drop-shadow(0 2px 6px rgba(0,0,0,0.35));
  }
  .brand-text {
    font-size: 36px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.005em;
    line-height: 1;
    text-shadow: 0 2px 6px rgba(0,0,0,0.35);
    white-space: nowrap;
  }
  /* Centered title block */
  .title-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 200px 100px 140px 100px; /* leave room for top logo + bottom breathing */
  }
  .title {
    font-weight: 800;
    font-size: ${fontPx}px;
    line-height: 1.1;
    text-align: center;
    letter-spacing: -0.01em;
    text-shadow: 0 3px 12px rgba(0, 0, 0, 0.55);
    /* Limit width so longer titles wrap naturally instead of stretching edge-to-edge */
    max-width: 1380px;
    word-break: normal;
    overflow-wrap: break-word;
  }
</style>
</head>
<body>
  <div class="top-bar"></div>
  <div class="dots"></div>
  <div class="corner-ring"></div>
  <div class="brand">
    <img class="brand-mark" src="${logoDataUri}" alt="" />
    <div class="brand-text">Tertiary Infotech Academy</div>
  </div>
  <div class="title-wrap">
    <div class="title">${escapeHtml(cleaned)}</div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
