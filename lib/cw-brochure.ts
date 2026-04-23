/**
 * Brochure generator — pure TypeScript port of `scripts/generate-brochure.py`.
 *
 * Eliminates the Python runtime dependency: scrapes a course page with
 * `fetch` + `cheerio`, populates the brochure HTML template via string
 * substitution, and renders to PDF with the `playwright` npm package.
 * Coolify deploys without Python (or where Python's PATH is unreliable)
 * still produce brochures because everything runs in Node.
 */

import * as cheerio from 'cheerio';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';

// Force Playwright to use a writable cache under /tmp instead of /root/.cache.
// In Coolify (and many container runtimes) /root is read-only or owned by a
// different uid at runtime, so on-demand `playwright install chromium` fails
// silently and the launch then errors with "Executable doesn't exist". /tmp
// is universally writable.
const CHROMIUM_CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH || '/tmp/ms-playwright';
process.env.PLAYWRIGHT_BROWSERS_PATH = CHROMIUM_CACHE;

// Ordered list of candidate locations Playwright might resolve to —
// /tmp first (our forced cache), then /root (the default). The launch
// path is found by globbing under each location for the actual chromium
// binary (folder names include the playwright revision so a wildcard
// search is more reliable than guessing the version).
const CHROMIUM_SEARCH_ROOTS = [CHROMIUM_CACHE, '/root/.cache/ms-playwright'];

// Recursively walk a directory looking for the chromium executable. Stops
// at the first match.  Returns the absolute path or null.
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

// Resolve a chromium executable: search known locations, install on
// demand if not found. Caches the resolved path in module scope.
async function resolveChromiumExe(): Promise<string> {
  if (cachedChromiumPath && fs.existsSync(cachedChromiumPath)) return cachedChromiumPath;

  for (const root of CHROMIUM_SEARCH_ROOTS) {
    const found = findChromiumExecutable(root);
    if (found) {
      cachedChromiumPath = found;
      console.log(`[brochure] Found Chromium at ${found}`);
      return found;
    }
  }

  // Make sure the cache dir exists and is writable.
  try { fs.mkdirSync(CHROMIUM_CACHE, { recursive: true }); } catch { /* ignore */ }

  // Install on demand. Try multiple invocation styles in case the
  // standalone bundle stripped the `playwright` bin link.
  const candidates = [
    'npx --yes playwright install chromium',
    'node node_modules/playwright/cli.js install chromium',
    'node /app/node_modules/playwright/cli.js install chromium',
    '/usr/local/bin/playwright install chromium',
  ];
  console.log(`[brochure] Chromium missing — installing to ${CHROMIUM_CACHE} on demand...`);
  let installed = false;
  let lastErr: any;
  for (const cmd of candidates) {
    try {
      execSync(cmd, {
        stdio: 'inherit',
        timeout: 600_000,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: CHROMIUM_CACHE },
      });
      console.log(`[brochure] Chromium install command succeeded: ${cmd}`);
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

  // After install, search again — both /tmp (where we asked it to go)
  // and /root/.cache (in case the env var was overridden somewhere
  // upstream and the binary actually landed in the default location).
  for (const root of CHROMIUM_SEARCH_ROOTS) {
    const found = findChromiumExecutable(root);
    if (found) {
      cachedChromiumPath = found;
      console.log(`[brochure] Chromium installed and located at ${found}`);
      return found;
    }
  }
  throw new Error(
    'Playwright install reported success but no chromium binary was found in ' +
    CHROMIUM_SEARCH_ROOTS.join(' or ') + '. Check container filesystem permissions.',
  );
}

const FRAMEWORK_MAPPING: Record<string, string> = {
  ACC: 'Accountancy', RET: 'Retail', MED: 'Media', ICT: 'Infocomm Technology',
  BEV: 'Built Environment', DSN: 'Design', DNS: 'Design', AGR: 'Agriculture',
  ELE: 'Electronics', LOG: 'Logistics', STP: 'Sea Transport', TOU: 'Tourism',
  AER: 'Aerospace', ATP: 'Air Transport', BPM: 'BioPharmaceuticals Manufacturing',
  ECM: 'Energy and Chemicals', EGS: 'Engineering Services', EPW: 'Energy and Power',
  EVS: 'Environmental Services', FMF: 'Food Manufacturing', FSE: 'Financial Services',
  FSS: 'Food Services', HAS: 'Hotel and Accommodation Services', HCE: 'Healthcare',
  HRS: 'Human Resource', INP: 'Intellectual Property', LNS: 'Landscape',
  MAR: 'Marine and Offshore', PRE: 'Precision Engineering', PTP: 'Public Transport',
  SEC: 'Security', SSC: 'Social Service', TAE: 'Training and Adult Education',
  WPH: 'Workplace Safety and Health', WST: 'Wholesale Trade',
  ECC: 'Early Childhood Care and Education', ART: 'Arts',
};

const TSC_CODE_RE = String.raw`[A-Z]{3}-[A-Z]{3}-[0-9]+-[0-9\.]+(?:-[0-9]+)?`;

export interface BrochureData {
  course_title: string;
  course_description: string[];
  learning_outcomes: string[];
  tsc_title: string;
  tsc_code: string;
  tsc_framework: string;
  wsq_funding: Record<string, string>;
  tgs_reference_no: string;
  gst_exclusive_price: string;
  gst_inclusive_price: string;
  session_days: string;
  duration_hrs: string;
  course_details_topics: { title: string; subtopics: string[] }[];
  course_url: string;
}

async function fetchSoup(url: string): Promise<cheerio.CheerioAPI> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  const html = await res.text();
  return cheerio.load(html);
}

function extractCourseTitle($: cheerio.CheerioAPI): string {
  for (const sel of ['h1', '.course-title', '.title', '.page-title', 'title']) {
    const el = $(sel).first();
    const title = el.text().trim();
    if (title && title.length > 10) {
      return title.startsWith('WSQ') ? title : `WSQ - ${title}`;
    }
  }
  return 'WSQ - Course Title Not Found';
}

function extractCourseDescription($: cheerio.CheerioAPI): string[] {
  const descriptions: string[] = [];
  for (const sel of ['.short-description p', '.product-description p', '.course-description p', '.description p', 'p']) {
    $(sel).each((_, el) => {
      if (descriptions.length >= 2) return;
      const text = $(el).text().trim();
      const lower = text.toLowerCase();
      if (
        text.length > 100 &&
        ['course', 'designed', 'professional', 'learn', 'training'].some((w) => lower.includes(w))
      ) {
        descriptions.push(text);
      }
    });
    if (descriptions.length) break;
  }
  if (descriptions.length === 0) {
    return [
      'This advanced course is designed for professionals to build practical skills and confidence in the subject area.',
      'Participants will gain hands-on experience with industry-relevant techniques and best practices.',
    ];
  }
  return descriptions.slice(0, 2);
}

function extractLearningOutcomes($: cheerio.CheerioAPI): string[] {
  const outcomes: string[] = [];
  $('h2, h3, h4').each((_, h) => {
    if (outcomes.length) return;
    const heading = $(h).text().toLowerCase();
    if (['learning outcome', 'what you', 'objectives', 'you will learn'].some((t) => heading.includes(t))) {
      const list = $(h).nextAll('ul, ol').first();
      list.find('li').each((__, li) => {
        let text = $(li).text().trim();
        if (text.length > 20) {
          if (!text.endsWith('.')) text += '.';
          outcomes.push(text);
        }
      });
    }
  });
  if (outcomes.length === 0) {
    return [
      'Apply core concepts and methodologies to relevant workplace scenarios.',
      'Analyse practical implementation techniques for the topic area.',
      'Evaluate outcomes and improve processes based on learning.',
    ];
  }
  return outcomes.slice(0, 6);
}

function extractTscCode($: cheerio.CheerioAPI): string {
  const text = $('body').text();
  const patterns = [
    new RegExp(`(${TSC_CODE_RE})\\s+(?:Level\\s+[0-9]+\\s*)?TSC`, 'i'),
    new RegExp(`guideline.*?of.*?(${TSC_CODE_RE})`, 'i'),
    new RegExp(`follows.*?(${TSC_CODE_RE})`, 'i'),
    new RegExp(`TSC[:\\s]+(${TSC_CODE_RE})`, 'i'),
    new RegExp(`(${TSC_CODE_RE})`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return 'Not Applicable';
}

function extractTscTitle($: cheerio.CheerioAPI): string {
  const text = $('body').text();
  const patterns = [
    new RegExp(`follows.*?guideline.*?of\\s+${TSC_CODE_RE}:\\s+([\\w\\s&-]+?)\\s+under\\s+.+?Skills\\s+Framework`, 'i'),
    new RegExp(`guideline of\\s+(${TSC_CODE_RE}):\\s+(.*?)\\s+under\\s+.+?Skills`, 'i'),
    new RegExp(`(${TSC_CODE_RE}):\\s+([\\w\\s&-]+?)\\s+under\\s+.+?Skills\\s+Framework`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[m.length - 1].trim();
  }
  return 'Not Applicable';
}

function extractFramework($: cheerio.CheerioAPI, tscCode: string): string {
  const text = $('body').text();
  const patterns = [
    /under\s+([A-Z][A-Za-z\s&]+?)\s+Skills?\s+Framework/i,
    new RegExp(`${TSC_CODE_RE}.*?TSC.*?under\\s+([\\w\\s&]+?)\\s+Skills?\\s+Framework`, 'is'),
  ];
  const invalid = new Set([
    'and', 'the', 'of', 'by', 'certification', 'above', 'statement', 'from', 'that', 'they', 'have', 'achieved',
  ]);
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const fw = m[1].trim().replace(/\s+/g, ' ').replace(/&amp;/g, '&');
      if (fw.length > 2 && !invalid.has(fw.toLowerCase())) return fw;
    }
  }
  if (tscCode && tscCode !== 'Not Applicable') {
    const prefix = tscCode.split('-')[0];
    if (FRAMEWORK_MAPPING[prefix]) return FRAMEWORK_MAPPING[prefix];
  }
  return 'Not Applicable';
}

function extractTgsReference($: cheerio.CheerioAPI): string {
  let found = '';
  $('span.value').each((_, span) => {
    if (found) return;
    const t = $(span).text().trim();
    if (/^TGS-\d{10}$/.test(t)) found = t;
  });
  if (found) return found;
  const text = $('body').text();
  const patterns = [
    /Course Code[:\s]+(TGS-\d{10})/i,
    /TGS Reference[:\s]+(TGS-\d{10})/i,
    /\b(TGS-\d{10})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return 'TGS-Not Available';
}

function extractFeeBeforeGst($: cheerio.CheerioAPI): string {
  const text = $('body').text();
  const patterns = [
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*GST[- ]exclusive/i,
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:Bef|Before)\s*\.?\s*GST/i,
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:excl|excluding)\s*\.?\s*GST/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const amt = m[1].replace(/,/g, '');
      return amt.includes('.') ? `$${amt}` : `$${amt}.00`;
    }
  }
  return '$900.00';
}

function extractFeeWithGst($: cheerio.CheerioAPI): string {
  const text = $('body').text();
  const patterns = [
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*GST[- ]inclusive/i,
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:Incl|Including)\s*\.?\s*GST/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const amt = m[1].replace(/,/g, '');
      return amt.includes('.') ? `$${amt}` : `$${amt}.00`;
    }
  }
  const before = extractFeeBeforeGst($);
  const num = parseFloat(before.replace(/[$,]/g, ''));
  if (Number.isFinite(num)) return `$${(num * 1.09).toFixed(2)}`;
  return '$981.00';
}

function extractWsqFunding($: cheerio.CheerioAPI): Record<string, string> {
  const funding: Record<string, string> = {
    'Effective Date': 'Not Available',
    'Full Fee': 'Not Available',
    GST: 'Not Available',
    Baseline: 'Not Available',
    'MCES / SME': 'Not Available',
  };
  const fullText = $('body').text();
  const dateM = fullText.match(/Effective for Courses starting from (\d{1,2}\s+\w+\s+\d{4})/i);
  if (dateM) funding['Effective Date'] = dateM[1];
  $('table').each((_, table) => {
    if (funding['Full Fee'] !== 'Not Available') return;
    const tableText = $(table).text();
    if (['Full', 'Fee', 'GST', 'Baseline', 'MCES'].every((t) => tableText.includes(t))) {
      $(table).find('tr').each((__, row) => {
        if (funding['Full Fee'] !== 'Not Available') return;
        const dollars = $(row).text().match(/\$(\d+(?:,\d+)?(?:\.\d{2})?)/g);
        if (dollars && dollars.length >= 4) {
          funding['Full Fee'] = dollars[0];
          funding['GST'] = dollars[1];
          funding['Baseline'] = dollars[2];
          funding['MCES / SME'] = dollars[3];
        }
      });
    }
  });
  return funding;
}

function extractSessionDays($: cheerio.CheerioAPI): string {
  const text = $('body').text();
  const patterns = [
    /Session\s*\(days\)[:\s]*(\d+)/i,
    /Session[:\s]+(\d+)\s*days?/i,
    /(\d+)\s*days?\s*session/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return '2';
}

function extractDurationHrs($: cheerio.CheerioAPI): string {
  const text = $('body').text();
  const patterns = [
    /Duration\s*\(hrs\)[:\s]*(\d+)/i,
    /Duration[:\s]+(\d+)\s*hrs?/i,
    /(\d+)\s*hrs?\s*duration/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return '16';
}

function extractCourseTopics($: cheerio.CheerioAPI): { title: string; subtopics: string[] }[] {
  const topics: { title: string; subtopics: string[] }[] = [];
  const skipTerms = ['written assessment', 'wa-saq', 'practical performance', 'pp)', '(pp'];

  $('strong').each((_, strong) => {
    const text = $(strong).text().trim();
    const luMatch = text.match(/^LU\s*(\d+):\s*(.+)/);
    const topicMatch = text.match(/^Topic\s+(\d+)\s*[:\-]?\s*(.+)/i);
    if (!luMatch && !topicMatch) return;
    const luTitle = text;
    const subtopics: string[] = [];
    const pTag = $(strong).parent();
    if (pTag.length === 0 || pTag[0].tagName !== 'p') return;
    let current = pTag.next();
    for (let i = 0; i < 50 && current.length > 0; i++) {
      const curText = current.text().trim();
      const innerStrong = current.find('strong').first();
      if (innerStrong.length) {
        const sText = innerStrong.text().trim();
        if (/^LU\s*\d+:/.test(sText) || /^Topic\s+\d+/i.test(sText)) break;
      }
      const lowerCur = curText.toLowerCase();
      if (
        lowerCur.includes('minimum entry requirement') ||
        lowerCur.includes('entry requirement') ||
        lowerCur.includes('knowledge and skills')
      ) break;

      const tagName = current[0].tagName;
      if (tagName === 'p' && /^T\d+\./.test(curText)) {
        if (!skipTerms.some((t) => lowerCur.includes(t))) subtopics.push(curText);
      } else if (tagName === 'p' && curText.includes('•')) {
        for (const part of curText.split('•').slice(1)) {
          const b = part.trim();
          if (b.length > 15 && !skipTerms.some((t) => b.toLowerCase().includes(t))) subtopics.push(b);
        }
      } else if (tagName === 'ul') {
        current.children('li').each((__, li) => {
          const liText = $(li).text().trim();
          if (liText.length > 10 && !skipTerms.some((t) => liText.toLowerCase().includes(t))) {
            subtopics.push(liText);
          }
        });
      } else if (tagName === 'p' && /T\d+:/.test(curText)) {
        const html = $.html(current as any) || '';
        if (html.includes('<br')) {
          const parts = html.split(/<br\s*\/?>/i);
          for (const part of parts) {
            const pt = cheerio.load(part).text().trim();
            if (/^T\d+:/.test(pt) && pt.length > 10 && !skipTerms.some((t) => pt.toLowerCase().includes(t))) {
              subtopics.push(pt);
            }
          }
        } else if (/^T\d+:/.test(curText) && !skipTerms.some((t) => lowerCur.includes(t))) {
          subtopics.push(curText);
        }
      }
      current = current.next();
    }
    if (subtopics.length) topics.push({ title: luTitle, subtopics });
  });

  if (!topics.some((t) => t.title.toLowerCase().includes('final assessment'))) {
    topics.push({ title: 'Final Assessment', subtopics: [] });
  }
  return topics;
}

export async function scrapeCourse(url: string): Promise<BrochureData> {
  const $ = await fetchSoup(url);
  const tscCode = extractTscCode($);
  return {
    course_title: extractCourseTitle($),
    course_description: extractCourseDescription($),
    learning_outcomes: extractLearningOutcomes($),
    tsc_title: extractTscTitle($),
    tsc_code: tscCode,
    tsc_framework: extractFramework($, tscCode),
    wsq_funding: extractWsqFunding($),
    tgs_reference_no: extractTgsReference($),
    gst_exclusive_price: extractFeeBeforeGst($),
    gst_inclusive_price: extractFeeWithGst($),
    session_days: extractSessionDays($),
    duration_hrs: extractDurationHrs($),
    course_details_topics: extractCourseTopics($),
    course_url: url,
  };
}

// String-replace literals that the brochure HTML template contains as
// placeholders. Keeping these as exact-match string swaps (rather than a
// templating engine) preserves behaviour parity with the Python original.
const OLD_DESC_P1 =
  "Elevate your web development skills with our course on Responsive Web Interface Design " +
  "using Bootstrap. This course equips you with the knowledge and practical skills to build " +
  "visually appealing and highly functional web interfaces. You'll learn how to use Bootstrap's " +
  "grid system, components, and utilities to design layouts that adapt seamlessly to various " +
  "screen sizes. The course covers essential concepts like navigation bars, form controls, and " +
  "responsive typography, ensuring you can create professional-quality websites.";
const OLD_DESC_P2 =
  "In addition to the core Bootstrap components, this course also delves into best practices " +
  "for user experience (UX) design. You'll understand how to conduct basic usability tests, " +
  "apply responsive design patterns, and optimize site performance. These complementary skills " +
  "will enable you to create web interfaces that not only look good but also provide an " +
  "exceptional user experience, making you a more versatile and employable front-end developer.";

const OLD_LO_BLOCK =
  '            <li>Identify Bootstrap framework functionalities and information flows for responsive web interface.</li>\n' +
  '            <li>Develop components and design GUI.</li>\n' +
  '            <li>Evaluate the web responsiveness and interactivity.</li>\n' +
  '            <li>Apply Bootstrap framework to update single page design.</li>';

const OLD_TOPIC_TABLE =
  '                    <tr>\n' +
  '                        <td class="topic-header"><strong>LU1: Overview of Responsive Web Interface Design and Bootstrap</strong></td>\n' +
  '                    </tr>\n' +
  '                    <tr>\n' +
  '                        <td class="topic-content">T1: What is Responsive Web Design?<br>\n' +
  '                        T2: Introduction to Bootstrap Framework<br>\n' +
  '                        T3: Create Responsive Web Layout using Bootstrap</td>\n' +
  '                    </tr>\n' +
  '                    <tr>\n' +
  '                        <td class="topic-header"><strong>LU2: Components and Graphics Content</strong></td>\n' +
  '                    </tr>\n' +
  '                    <tr>\n' +
  '                        <td class="topic-content">T1: Create Basic Bootstrap Components<br>\n' +
  '                        T2: Design GUI with Style and Content Elements</td>\n' +
  '                    </tr>\n' +
  '                    <tr>\n' +
  '                        <td class="topic-header"><strong>LU3: Interactivity and Responsiveness</strong></td>\n' +
  '                    </tr>\n' +
  '                    <tr>\n' +
  '                        <td class="topic-content">T1: Create Interactive Components<br>\n' +
  '                        T2: Apply Bootstrap Utilities<br>\n' +
  '                        T3: Evaluate Web Interface Interactivity and Responsiveness</td>\n' +
  '                    </tr>\n' +
  '                    <tr>\n' +
  '                        <td class="topic-header"><strong>LU4: Single Page Design</strong></td>\n' +
  '                    </tr>\n' +
  '                    <tr>\n' +
  '                        <td class="topic-content">T1: Web Design Requirement for Single Page<br>\n' +
  '                        T2: Implement Single Page Design</td>\n' +
  '                    </tr>\n' +
  '                    <tr>\n' +
  '                        <td class="topic-header"><strong>Final Assessment</strong></td>\n' +
  '                    </tr>';

export function populateTemplate(templateHtml: string, data: BrochureData): string {
  let html = templateHtml;
  const title = data.course_title;
  html = html.split('WSQ - Design and Build Responsive Websites from Scratch').join(title);

  if (data.course_description[0]) html = html.replace(OLD_DESC_P1, data.course_description[0]);
  if (data.course_description[1]) html = html.replace(OLD_DESC_P2, data.course_description[1]);

  if (data.learning_outcomes.length) {
    const newBlock = data.learning_outcomes
      .map((o) => `            <li>${o.replace(/LO\d+:/g, '').trim().replace(/\.$/, '')}.</li>`)
      .join('\n');
    html = html.replace(OLD_LO_BLOCK, newBlock);
  }

  if (data.course_details_topics.length) {
    const rows: string[] = [];
    for (const t of data.course_details_topics) {
      rows.push('                    <tr>');
      rows.push(`                        <td class="topic-header"><strong>${t.title}</strong></td>`);
      rows.push('                    </tr>');
      if (t.subtopics.length && !t.title.toLowerCase().includes('final assessment')) {
        const formatted = t.subtopics.map(
          (s, i) => `T${i + 1}: ${s.replace(/^T\d+[:.\s]*/, '').trim()}`,
        );
        const joined = formatted.join('<br>\n                        ');
        rows.push('                    <tr>');
        rows.push(`                        <td class="topic-content">${joined}</td>`);
        rows.push('                    </tr>');
      }
    }
    html = html.replace(OLD_TOPIC_TABLE, rows.join('\n'));
  }

  html = html.split('TGS-2021002504').join(data.tgs_reference_no);

  const tscTitle = data.tsc_title.replace('Not Applicable', '').trim();
  const tscCode = data.tsc_code.replace('Not Applicable', '').trim();
  const framework = (data.tsc_framework.replace('Not Applicable', '').trim() || 'ICT');
  let newSf: string;
  if (tscTitle && tscCode) newSf = `<strong>${tscTitle} ${tscCode} TSC</strong> under ${framework} Skills Framework`;
  else if (tscCode) newSf = `<strong>${tscCode} TSC</strong> under ${framework} Skills Framework`;
  else newSf = `<strong>TSC</strong> under ${framework} Skills Framework`;
  html = html.replace(
    '<strong>User Interface Design ICT-DES-3008-1.1 TSC</strong> under ICT Skills Framework',
    newSf,
  );

  html = html.split('$750.00 (Bef. GST)').join(`${data.gst_exclusive_price} (Bef. GST)`);
  html = html.split('$817.50 (Incl. GST)').join(`${data.gst_inclusive_price} (Incl. GST)`);
  html = html.split('16hrs (2 days)').join(`${data.duration_hrs}hrs (${data.session_days} days)`);
  html = html.split('https://www.tertiarycourses.com.sg/wsq-bootstrap-web-design.html').join(data.course_url);

  if (data.wsq_funding['Full Fee'] !== 'Not Available') {
    html = html.split('$750').join(data.wsq_funding['Full Fee'].replace('.00', ''));
    html = html.split('$67.50').join(data.wsq_funding['GST'] || '$81.00');
    html = html.split('$442.50').join(data.wsq_funding['Baseline'] || '$531.00');
    html = html.split('$292.50').join(data.wsq_funding['MCES / SME'] || '$351.00');
  }

  return html;
}

// Render the populated HTML to PDF via headless Chromium. The browser only
// loads a `file://` path so the brochure's relative image references
// (logo, header background) resolve to the same template directory.
export async function renderPdf(htmlContent: string, templateDir: string, outputPath: string): Promise<void> {
  // Resolve and pass executablePath explicitly so we don't rely on
  // Playwright's internal path resolution (which has been picking up
  // /root/.cache despite the PLAYWRIGHT_BROWSERS_PATH override).
  const exePath = await resolveChromiumExe();
  const tmpHtml = path.join(templateDir, `_tmp_brochure_${process.pid}_${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, htmlContent, 'utf-8');
  try {
    const browser = await chromium.launch({ headless: true, executablePath: exePath });
    try {
      const page = await browser.newPage();
      await page.goto(`file://${tmpHtml.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
      await page.pdf({
        path: outputPath,
        format: 'A4',
        margin: { top: '25px', right: '20px', bottom: '0px', left: '20px' },
        printBackground: true,
        preferCSSPageSize: true,
      });
    } finally {
      await browser.close();
    }
  } finally {
    try { fs.unlinkSync(tmpHtml); } catch { /* best effort */ }
  }
}

export interface GenerateBrochureResult {
  data: BrochureData;
  pdfBuffer: Buffer;
}

export async function generateBrochure(url: string, templateDir: string): Promise<GenerateBrochureResult> {
  const templatePath = path.join(templateDir, 'brochure.html');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  const data = await scrapeCourse(url);
  const templateHtml = fs.readFileSync(templatePath, 'utf-8');
  const populated = populateTemplate(templateHtml, data);
  const outPath = path.join(os.tmpdir(), `brochure_${Date.now()}.pdf`);
  try {
    await renderPdf(populated, templateDir, outPath);
    const pdfBuffer = fs.readFileSync(outPath);
    return { data, pdfBuffer };
  } finally {
    try { fs.unlinkSync(outPath); } catch { /* best effort */ }
  }
}
