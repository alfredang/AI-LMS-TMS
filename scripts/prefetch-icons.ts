/**
 * Pre-fetch ALL common MDI icons used by the slides infographic pipeline
 * and write them to lib/cw-slides-icon-cache.json. Run once during dev,
 * commit the JSON file. Production then ships with all icons inlined —
 * zero network calls to iconify.design at runtime.
 *
 * Usage:  npx tsx scripts/prefetch-icons.ts
 */

import fs from 'fs';
import path from 'path';

const ICONS = [
  // Defaults from cw-slides-infographic.ts
  'mdi/lightbulb', 'mdi/check-circle', 'mdi/star', 'mdi/shield-check',
  'mdi/cog', 'mdi/chart-line', 'mdi/book-open', 'mdi/account-group',
  // Generic concept icons
  'mdi/information', 'mdi/chevron-right', 'mdi/check', 'mdi/close',
  'mdi/alert-circle', 'mdi/alert', 'mdi/help-circle', 'mdi/clipboard-text',
  'mdi/clipboard-check', 'mdi/shield', 'mdi/scale-balance', 'mdi/lock',
  'mdi/lock-open', 'mdi/key', 'mdi/eye', 'mdi/eye-off',
  // Process / time / measurement
  'mdi/clock', 'mdi/clock-outline', 'mdi/timer', 'mdi/calendar',
  'mdi/trending-up', 'mdi/trending-down', 'mdi/chart-bar', 'mdi/chart-pie',
  'mdi/currency-usd', 'mdi/percent',
  // Tech / industry
  'mdi/rocket-launch', 'mdi/history', 'mdi/database', 'mdi/cloud',
  'mdi/server', 'mdi/laptop', 'mdi/cellphone', 'mdi/wifi',
  'mdi/api', 'mdi/code-tags', 'mdi/web',
  // People / org
  'mdi/account', 'mdi/account-multiple', 'mdi/account-tie', 'mdi/handshake',
  'mdi/domain', 'mdi/office-building', 'mdi/briefcase', 'mdi/email',
  // Quality / docs
  'mdi/file-document', 'mdi/file-check', 'mdi/file-search', 'mdi/note-text',
  'mdi/format-list-bulleted', 'mdi/format-list-numbered', 'mdi/checkbox-marked',
  // Direction / flow
  'mdi/arrow-right', 'mdi/arrow-left', 'mdi/arrow-up', 'mdi/arrow-down',
  'mdi/arrow-right-thick', 'mdi/swap-horizontal', 'mdi/refresh', 'mdi/reload',
  // Special concepts
  'mdi/heart', 'mdi/thumb-up', 'mdi/thumb-down', 'mdi/flag',
  'mdi/medal', 'mdi/trophy', 'mdi/diamond', 'mdi/fire',
  'mdi/leaf', 'mdi/earth', 'mdi/recycle', 'mdi/sprout',
];

async function fetchOne(name: string): Promise<string | null> {
  const url = `https://api.iconify.design/${name}.svg`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!r.ok) return null;
    const svg = await r.text();
    if (svg && svg.trim().startsWith('<svg')) return svg;
    return null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`Fetching ${ICONS.length} icons from iconify.design...`);
  const cache: Record<string, string> = {};
  let done = 0;
  // Bounded parallelism so we don't hammer the CDN
  const batchSize = 8;
  for (let i = 0; i < ICONS.length; i += batchSize) {
    const batch = ICONS.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchOne));
    for (let j = 0; j < batch.length; j++) {
      const svg = results[j];
      if (svg) {
        cache[batch[j]] = svg;
      }
      done++;
    }
    process.stdout.write(`\r  ${done}/${ICONS.length}`);
  }
  console.log('');
  console.log(`Got ${Object.keys(cache).length}/${ICONS.length} icons`);

  const out = path.join(process.cwd(), 'lib', 'cw-slides-icon-cache.json');
  fs.writeFileSync(out, JSON.stringify(cache));
  const sizeKB = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`Wrote ${out} (${sizeKB} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
