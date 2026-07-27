/**
 * Standard Tertiary-branded course banner.
 *
 * Backend course cards fall back to this whenever a course has no imageUrl,
 * replacing the random photos that picsum.photos used to serve. The banner is
 * generated as an inline SVG data URI so it works as a plain <img src>, needs
 * no asset in public/, makes no network request, and can never 404.
 */

const BRAND_NAME = 'Tertiary Infotech Academy';

/** Escape the five XML entities so course titles can't break the SVG markup. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Break a title into at most `maxLines` lines of roughly `maxChars` characters,
 * on word boundaries. The final line is ellipsised if the title doesn't fit.
 */
function wrapTitle(title: string, maxChars: number, maxLines: number): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Anything left over means we truncated — mark the last line.
  const consumed = lines.join(' ').split(/\s+/).length;
  if (consumed < words.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] =
      last.length > maxChars - 1 ? `${last.slice(0, maxChars - 1)}…` : `${last}…`;
  }

  return lines;
}

export interface CourseBannerOptions {
  /** Banner width in SVG user units. Default 400. */
  width?: number;
  /** Banner height in SVG user units. Default 200. */
  height?: number;
  /** Course title to render. Omitted for small sizes (thumbnails). */
  title?: string;
}

/**
 * Builds the standard branded course banner as an SVG data URI.
 *
 * At thumbnail sizes (under 160px wide) the wordmark and title are dropped and
 * only the logo mark is drawn, so the tile stays legible in table rows.
 */
export function getCourseBannerDataUrl(options: CourseBannerOptions = {}): string {
  const { width = 400, height = 200, title } = options;

  const isThumbnail = width < 160;

  // Scale off the SMALLER dimension so nothing overflows when the banner is
  // rendered into a short, wide box — the card containers are ~2.2:1, and
  // scaling off width alone pushed the logo and arc outside the frame.
  const scale = Math.min(width / 400, height / 200);

  // Logo mark — circle + "T", top-left on banners, centred on thumbnails.
  const markR = (isThumbnail ? 34 : 10.5) * scale;
  const pad = 20 * scale;
  const markX = isThumbnail ? width / 2 : pad + markR;
  const markY = isThumbnail ? height / 2 : pad + markR;
  const markFont = markR * 1.2;

  const logo = `
    <circle cx="${markX}" cy="${markY}" r="${markR}" fill="#3b82f6"/>
    <text x="${markX}" y="${markY}" fill="#ffffff" font-family="Helvetica,Arial,sans-serif"
      font-size="${markFont}" font-weight="700" text-anchor="middle" dominant-baseline="central">T</text>`;

  const wordmark = isThumbnail
    ? ''
    : `<text x="${markX + markR + 8 * scale}" y="${markY}" fill="#f1f5f9" font-family="Helvetica,Arial,sans-serif"
        font-size="${11 * scale}" font-weight="700" dominant-baseline="central">${escapeXml(BRAND_NAME)}</text>`;

  // Course title — optically centred in the area below the header row.
  let titleBlock = '';
  if (!isThumbnail && title) {
    const lines = wrapTitle(title, 26, 3);
    const fontSize = (lines.length >= 3 ? 21 : 25) * scale;
    const lineHeight = fontSize * 1.25;
    // Centre within the band between the header and the bottom edge.
    const bandTop = markY + markR + 8 * scale;
    const centreY = bandTop + (height - bandTop) / 2;
    const startY = centreY - ((lines.length - 1) * lineHeight) / 2;

    titleBlock = lines
      .map(
        (line, i) =>
          `<text x="${width / 2}" y="${startY + i * lineHeight}" fill="#ffffff"
            font-family="Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="700"
            text-anchor="middle" dominant-baseline="central">${escapeXml(line)}</text>`
      )
      .join('');
  }

  // Decorative arc, echoing the brand banner motif.
  const arc = isThumbnail
    ? ''
    : `<circle cx="${2 * scale}" cy="${height - 2 * scale}" r="${58 * scale}"
        fill="none" stroke="#ffffff" stroke-opacity="0.13" stroke-width="${1.5 * scale}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0a1a3f"/>
        <stop offset="100%" stop-color="#132f6b"/>
      </linearGradient>
      <!-- Soft highlight lifting the centre-right, as on the brand banner. -->
      <radialGradient id="glow" cx="0.62" cy="0.45" r="0.75">
        <stop offset="0%" stop-color="#2d5aa8" stop-opacity="0.75"/>
        <stop offset="100%" stop-color="#2d5aa8" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>
    ${arc}${logo}${wordmark}${titleBlock}
  </svg>`;

  // encodeURIComponent (not base64) keeps this readable and avoids btoa/Buffer,
  // which differ between the browser and SSR.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}
