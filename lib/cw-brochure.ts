/**
 * Course brochure generator — pure-TypeScript port of
 * `scripts/generate-brochure.py`.
 *
 *   1. Scrape a tertiarycourses.com.sg course page with `fetch` + `cheerio`
 *      for title, outcomes, topics, fees, WSQ funding, TSC info.
 *   2. Populate `public/templates/brochure/brochure.html` by swapping fixed
 *      anchor strings — mirror of the Streamlit `populate_template()` logic.
 *   3. Render to PDF with Playwright Chromium.
 *
 * Zero Python.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

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

const TSC_CODE = /[A-Z]{3}-[A-Z]{3}-[0-9]+-[0-9.]+(?:-[0-9]+)?/;

export interface ScrapedCourse {
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
  course_details_topics: Array<{ title: string; subtopics: string[] }>;
  course_url: string;
}

type $Cheerio = cheerio.CheerioAPI;

// ── Fetch ─────────────────────────────────────────────────────────────────
async function fetchPage(url: string): Promise<$Cheerio> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const html = await res.text();
  return cheerio.load(html);
}

// ── Field extractors (mirrors of the Python helpers) ──────────────────────
function extractCourseTitle($: $Cheerio): string {
  for (const sel of ['h1', '.course-title', '.title', '.page-title', 'title']) {
    const el = $(sel).first();
    const text = el.text().trim();
    if (text && text.length > 10) {
      return text.startsWith('WSQ') ? text : `WSQ - ${text}`;
    }
  }
  return 'WSQ - Course Title Not Found';
}

function extractCourseDescription($: $Cheerio): string[] {
  const out: string[] = [];
  for (const sel of [
    '.short-description p',
    '.product-description p',
    '.course-description p',
    '.description p',
    'p',
  ]) {
    $(sel).each((_, el) => {
      const text = $(el).text().trim();
      if (
        text.length > 100 &&
        /course|designed|professional|learn|training/i.test(text)
      ) {
        out.push(text);
      }
    });
    if (out.length >= 1) break;
  }
  if (!out.length) {
    return [
      'This advanced course is designed for professionals to build practical skills and confidence in the subject area.',
      'Participants will gain hands-on experience with industry-relevant techniques and best practices.',
    ];
  }
  return out.slice(0, 2);
}

function extractLearningOutcomes($: $Cheerio): string[] {
  const out: string[] = [];
  $('h2, h3, h4').each((_, h) => {
    const heading = $(h).text().toLowerCase();
    if (
      /learning outcome|what you|objectives|you will learn/.test(heading) &&
      !out.length
    ) {
      const list = $(h).nextAll('ul, ol').first();
      list.find('li').each((__, li) => {
        const text = $(li).text().trim();
        if (text.length > 20) {
          out.push(text.endsWith('.') ? text : `${text}.`);
        }
      });
    }
  });
  if (!out.length) {
    return [
      'Apply core concepts and methodologies to relevant workplace scenarios.',
      'Analyse practical implementation techniques for the topic area.',
      'Evaluate outcomes and improve processes based on learning.',
    ];
  }
  return out.slice(0, 6);
}

function extractTscCode($: $Cheerio): string {
  const text = $('body').text();
  const patterns = [
    new RegExp(`(${TSC_CODE.source})\\s+(?:Level\\s+[0-9]+\\s*)?TSC`, 'i'),
    new RegExp(`guideline.*?of.*?(${TSC_CODE.source})`, 'i'),
    new RegExp(`follows.*?(${TSC_CODE.source})`, 'i'),
    new RegExp(`TSC[:\\s]+(${TSC_CODE.source})`, 'i'),
    new RegExp(`(${TSC_CODE.source})`, 'i'),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return 'Not Applicable';
}

function extractTscTitle($: $Cheerio): string {
  const text = $('body').text();
  const patterns = [
    new RegExp(`follows.*?guideline.*?of\\s+${TSC_CODE.source}:\\s+([\\w\\s&-]+?)\\s+under\\s+.+?Skills\\s+Framework`, 'is'),
    new RegExp(`guideline of\\s+(${TSC_CODE.source}):\\s+(.*?)\\s+under\\s+.+?Skills`, 'is'),
    new RegExp(`(${TSC_CODE.source}):\\s+([\\w\\s&-]+?)\\s+under\\s+.+?Skills\\s+Framework`, 'is'),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return (m[m.length - 1] || '').trim();
  }
  return 'Not Applicable';
}

function extractFramework($: $Cheerio, tscCode: string): string {
  const text = $('body').text();
  const patterns = [
    /under\s+([A-Z][A-Za-z\s&]+?)\s+Skills?\s+Framework/i,
    new RegExp(`${TSC_CODE.source}.*?TSC.*?under\\s+([\\w\\s&]+?)\\s+Skills?\\s+Framework`, 'is'),
  ];
  const invalid = new Set(['and', 'the', 'of', 'by', 'certification', 'above', 'statement', 'from', 'that', 'they', 'have', 'achieved']);
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const fw = m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').trim();
      if (fw.length > 2 && !invalid.has(fw.toLowerCase())) return fw;
    }
  }
  if (tscCode && tscCode !== 'Not Applicable') {
    const prefix = tscCode.split('-')[0];
    if (FRAMEWORK_MAPPING[prefix]) return FRAMEWORK_MAPPING[prefix];
  }
  return 'Not Applicable';
}

function extractTgsReference($: $Cheerio): string {
  let found = '';
  $('span.value').each((_, el) => {
    if (found) return;
    const t = $(el).text().trim();
    if (/^TGS-\d{10}$/.test(t)) found = t;
  });
  if (found) return found;
  const text = $('body').text();
  for (const p of [/Course Code[:\s]+(TGS-\d{10})/i, /TGS Reference[:\s]+(TGS-\d{10})/i, /\b(TGS-\d{10})\b/i]) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return 'TGS-Not Available';
}

function extractFeeBeforeGst($: $Cheerio): string {
  const text = $('body').text();
  const patterns = [
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*GST[- ]exclusive/i,
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:Bef|Before)\s*\.?\s*GST/i,
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:excl|excluding)\s*\.?\s*GST/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const amt = m[1].replace(/,/g, '');
      return amt.includes('.') ? `$${amt}` : `$${amt}.00`;
    }
  }
  return '$900.00';
}

function extractFeeWithGst($: $Cheerio): string {
  const text = $('body').text();
  const patterns = [
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*GST[- ]inclusive/i,
    /\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:Incl|Including)\s*\.?\s*GST/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const amt = m[1].replace(/,/g, '');
      return amt.includes('.') ? `$${amt}` : `$${amt}.00`;
    }
  }
  const before = extractFeeBeforeGst($);
  const amt = parseFloat(before.replace(/[$,]/g, ''));
  return Number.isFinite(amt) ? `$${(amt * 1.09).toFixed(2)}` : '$981.00';
}

function extractWsqFunding($: $Cheerio): Record<string, string> {
  const funding: Record<string, string> = {
    'Effective Date': 'Not Available',
    'Full Fee': 'Not Available',
    GST: 'Not Available',
    Baseline: 'Not Available',
    'MCES / SME': 'Not Available',
  };
  const full = $('body').text();
  const dateMatch = full.match(/Effective for Courses starting from (\d{1,2}\s+\w+\s+\d{4})/i);
  if (dateMatch) funding['Effective Date'] = dateMatch[1];
  $('table').each((_, tbl) => {
    if (funding['Full Fee'] !== 'Not Available') return;
    const txt = $(tbl).text();
    if (['Full', 'Fee', 'GST', 'Baseline', 'MCES'].every((t) => txt.includes(t))) {
      $(tbl).find('tr').each((__, row) => {
        if (funding['Full Fee'] !== 'Not Available') return;
        const dollars = Array.from($(row).text().matchAll(/\$(\d+(?:,\d+)?(?:\.\d{2})?)/g), (m) => m[1]);
        if (dollars.length >= 4) {
          funding['Full Fee'] = `$${dollars[0]}`;
          funding['GST'] = `$${dollars[1]}`;
          funding['Baseline'] = `$${dollars[2]}`;
          funding['MCES / SME'] = `$${dollars[3]}`;
        }
      });
    }
  });
  return funding;
}

function extractByPattern($: $Cheerio, patterns: RegExp[], fallback: string): string {
  const text = $('body').text();
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return fallback;
}

function extractSessionDays($: $Cheerio): string {
  return extractByPattern($, [
    /Session\s*\(days\)[:\s]*(\d+)/i,
    /Session[:\s]+(\d+)\s*days?/i,
    /(\d+)\s*days?\s*session/i,
  ], '2');
}

function extractDurationHrs($: $Cheerio): string {
  return extractByPattern($, [
    /Duration\s*\(hrs\)[:\s]*(\d+)/i,
    /Duration[:\s]+(\d+)\s*hrs?/i,
    /(\d+)\s*hrs?\s*duration/i,
  ], '16');
}

function extractCourseTopics($: $Cheerio): Array<{ title: string; subtopics: string[] }> {
  const topics: Array<{ title: string; subtopics: string[] }> = [];
  const skipTerms = ['written assessment', 'wa-saq', 'practical performance', 'pp)', '(pp'];

  $('strong').each((_, strong) => {
    const text = $(strong).text().trim();
    const luMatch = /^LU\s*(\d+):\s*(.+)/.exec(text);
    const topicMatch = /^Topic\s+(\d+)\s*[:\-]?\s*(.+)/i.exec(text);
    if (!luMatch && !topicMatch) return;

    const pTag = $(strong).parent();
    if (pTag.prop('tagName')?.toLowerCase() !== 'p') return;

    const subtopics: string[] = [];
    let current = pTag.next();
    for (let i = 0; i < 50 && current.length; i += 1) {
      const curText = current.text().trim();
      const innerStrong = current.find('strong').first();
      if (innerStrong.length) {
        const sText = innerStrong.text().trim();
        if (/^LU\s*\d+:/.test(sText) || /^Topic\s+\d+/i.test(sText)) break;
      }
      if (/minimum entry requirement|entry requirement|knowledge and skills/i.test(curText)) break;

      const tag = current.prop('tagName')?.toLowerCase();
      if (tag === 'p' && /^T\d+\./.test(curText)) {
        if (!skipTerms.some((t) => curText.toLowerCase().includes(t))) subtopics.push(curText);
      } else if (tag === 'p' && curText.includes('•')) {
        for (const b of curText.split('•').slice(1)) {
          const bb = b.trim();
          if (bb.length > 15 && !skipTerms.some((t) => bb.toLowerCase().includes(t))) subtopics.push(bb);
        }
      } else if (tag === 'ul') {
        current.children('li').each((__, li) => {
          const liText = $(li).text().trim();
          if (liText.length > 10 && !skipTerms.some((t) => liText.toLowerCase().includes(t))) subtopics.push(liText);
        });
      } else if (tag === 'p' && /T\d+:/.test(curText)) {
        if (current.find('br').length) {
          const html = $.html(current);
          for (const part of html.split(/<br\s*\/?>/i)) {
            const pt = cheerio.load(part).root().text().trim();
            if (/^T\d+:/.test(pt) && pt.length > 10 && !skipTerms.some((t) => pt.toLowerCase().includes(t))) subtopics.push(pt);
          }
        } else if (/^T\d+:/.test(curText) && !skipTerms.some((t) => curText.toLowerCase().includes(t))) {
          subtopics.push(curText);
        }
      }
      current = current.next();
    }

    if (subtopics.length) topics.push({ title: text, subtopics });
  });

  if (!topics.some((t) => /final assessment/i.test(t.title))) {
    topics.push({ title: 'Final Assessment', subtopics: [] });
  }
  return topics;
}

// ── Scraping orchestrator ──────────────────────────────────────────────────
export async function scrapeCourse(url: string): Promise<ScrapedCourse> {
  const $ = await fetchPage(url);
  const tsc_code = extractTscCode($);
  return {
    course_title: extractCourseTitle($),
    course_description: extractCourseDescription($),
    learning_outcomes: extractLearningOutcomes($),
    tsc_title: extractTscTitle($),
    tsc_code,
    tsc_framework: extractFramework($, tsc_code),
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

// ── Template population (anchor-swap like Python `populate_template`) ─────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function populateTemplate(templateHtml: string, data: ScrapedCourse): string {
  let html = templateHtml;

  // Title
  html = html.split('WSQ - Design and Build Responsive Websites from Scratch').join(escapeHtml(data.course_title));

  // About paragraphs
  const oldP1 =
    "Elevate your web development skills with our course on Responsive Web Interface Design using Bootstrap. This course equips you with the knowledge and practical skills to build visually appealing and highly functional web interfaces. You'll learn how to use Bootstrap's grid system, components, and utilities to design layouts that adapt seamlessly to various screen sizes. The course covers essential concepts like navigation bars, form controls, and responsive typography, ensuring you can create professional-quality websites.";
  const oldP2 =
    "In addition to the core Bootstrap components, this course also delves into best practices for user experience (UX) design. You'll understand how to conduct basic usability tests, apply responsive design patterns, and optimize site performance. These complementary skills will enable you to create web interfaces that not only look good but also provide an exceptional user experience, making you a more versatile and employable front-end developer.";
  if (data.course_description[0]) html = html.split(oldP1).join(escapeHtml(data.course_description[0]));
  if (data.course_description[1]) html = html.split(oldP2).join(escapeHtml(data.course_description[1]));

  // Learning outcomes
  const oldOutcomes =
    '            <li>Identify Bootstrap framework functionalities and information flows for responsive web interface.</li>\n' +
    '            <li>Develop components and design GUI.</li>\n' +
    '            <li>Evaluate the web responsiveness and interactivity.</li>\n' +
    '            <li>Apply Bootstrap framework to update single page design.</li>';
  if (data.learning_outcomes.length) {
    const newOutcomes = data.learning_outcomes
      .map((o) => {
        const cleaned = o.replace(/LO\d+:/g, '').trim().replace(/\.$/, '');
        return `            <li>${escapeHtml(cleaned)}.</li>`;
      })
      .join('\n');
    html = html.replace(oldOutcomes, newOutcomes);
  }

  // Course outline table
  if (data.course_details_topics.length) {
    const rows: string[] = [];
    for (const t of data.course_details_topics) {
      rows.push('                    <tr>');
      rows.push(`                        <td class="topic-header"><strong>${escapeHtml(t.title)}</strong></td>`);
      rows.push('                    </tr>');
      if (t.subtopics.length && !/final assessment/i.test(t.title)) {
        const formatted = t.subtopics.map((s, i) => {
          const stripped = s.replace(/^T\d+[:.\s]*/, '').trim();
          return `T${i + 1}: ${escapeHtml(stripped)}`;
        });
        rows.push('                    <tr>');
        rows.push(`                        <td class="topic-content">${formatted.join('<br>\n                        ')}</td>`);
        rows.push('                    </tr>');
      }
    }
    const oldTable =
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
    html = html.replace(oldTable, rows.join('\n'));
  }

  // Course info
  html = html.split('TGS-2021002504').join(escapeHtml(data.tgs_reference_no));

  const tscTitle = (data.tsc_title || '').replace('Not Applicable', '').trim();
  const tscCode = (data.tsc_code || '').replace('Not Applicable', '').trim();
  const framework = ((data.tsc_framework || 'ICT').replace('Not Applicable', '').trim()) || 'ICT';
  let newSf = `<strong>TSC</strong> under ${escapeHtml(framework)} Skills Framework`;
  if (tscTitle && tscCode) newSf = `<strong>${escapeHtml(tscTitle)} ${escapeHtml(tscCode)} TSC</strong> under ${escapeHtml(framework)} Skills Framework`;
  else if (tscCode) newSf = `<strong>${escapeHtml(tscCode)} TSC</strong> under ${escapeHtml(framework)} Skills Framework`;
  html = html.replace(
    '<strong>User Interface Design ICT-DES-3008-1.1 TSC</strong> under ICT Skills Framework',
    newSf,
  );

  // Fees
  html = html.split('$750.00 (Bef. GST)').join(`${data.gst_exclusive_price} (Bef. GST)`);
  html = html.split('$817.50 (Incl. GST)').join(`${data.gst_inclusive_price} (Incl. GST)`);
  html = html.split('16hrs (2 days)').join(`${data.duration_hrs}hrs (${data.session_days} days)`);

  // Registration link
  html = html.split('https://www.tertiarycourses.com.sg/wsq-bootstrap-web-design.html').join(data.course_url);

  // Funding figures
  const f = data.wsq_funding;
  if (f['Full Fee'] && f['Full Fee'] !== 'Not Available') {
    html = html.split('$750').join(f['Full Fee'].replace('.00', ''));
    html = html.split('$67.50').join(f.GST || '$81.00');
    html = html.split('$442.50').join(f.Baseline || '$531.00');
    html = html.split('$292.50').join(f['MCES / SME'] || '$351.00');
  }

  return html;
}

// ── PDF render (Playwright Chromium) ──────────────────────────────────────
async function htmlToPdf(html: string, templateDir: string, outputPath: string): Promise<void> {
  const tmpHtml = path.join(templateDir, `_tmp_brochure_${process.pid}_${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf-8');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
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
    if (browser) await browser.close();
    try { fs.unlinkSync(tmpHtml); } catch {}
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────
export interface BrochureResult {
  buffer: Buffer;
  courseTitle: string;
  tgsRef: string;
  courseData: {
    tsc_code: string;
    tsc_title: string;
    tsc_framework: string;
    duration_hrs: string;
    session_days: string;
    gst_exclusive_price: string;
    gst_inclusive_price: string;
    num_topics: number;
    num_outcomes: number;
  };
}

export async function generateBrochure(url: string): Promise<BrochureResult> {
  const templateDir = path.join(process.cwd(), 'public', 'templates', 'brochure');
  const templatePath = path.join(templateDir, 'brochure.html');
  if (!fs.existsSync(templatePath)) throw new Error(`Template not found: ${templatePath}`);

  const data = await scrapeCourse(url);
  const templateHtml = fs.readFileSync(templatePath, 'utf-8');
  const populated = populateTemplate(templateHtml, data);

  const outPath = path.join(os.tmpdir(), `brochure_${Date.now()}.pdf`);
  await htmlToPdf(populated, templateDir, outPath);

  const buffer = fs.readFileSync(outPath);
  try { fs.unlinkSync(outPath); } catch {}

  return {
    buffer,
    courseTitle: data.course_title,
    tgsRef: data.tgs_reference_no,
    courseData: {
      tsc_code: data.tsc_code,
      tsc_title: data.tsc_title,
      tsc_framework: data.tsc_framework,
      duration_hrs: data.duration_hrs,
      session_days: data.session_days,
      gst_exclusive_price: data.gst_exclusive_price,
      gst_inclusive_price: data.gst_inclusive_price,
      num_topics: data.course_details_topics.length,
      num_outcomes: data.learning_outcomes.length,
    },
  };
}
