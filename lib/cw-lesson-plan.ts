/**
 * Lesson Plan (LP) generator — pure TypeScript port of `scripts/generate-lp.py`.
 *
 * Produces the same two-phase output as the Streamlit reference:
 *   1. Cover page + Version Control Record rendered from `LP_template_v2.docx`
 *      via our existing Jinja pipeline (`fillTemplate('lp', ...)`) so the
 *      branding/logo/copyright match the Streamlit reference exactly.
 *   2. Per-day schedule tables appended programmatically using a barrier
 *      scheduling algorithm (9am-6pm day, 12:30-1:15 lunch, assessment
 *      block at 4-6pm on the last day).
 *
 * Zero Python — uses `pizzip` to append the day tables' XML directly to
 * `word/document.xml` before saving.
 */

import PizZip from 'pizzip';
import { fillTemplate } from './cw-fill-template';

// ── Constants (must match Streamlit `timetable_generator.py`) ───────────────
const DAY_START = 9 * 60;                    // 09:00
const DAY_END = 18 * 60;                     // 18:00
const LUNCH_START = 12 * 60 + 30;            // 12:30
const LUNCH_DURATION = 45;                   // minutes
const LUNCH_END = LUNCH_START + LUNCH_DURATION;
const MIN_SESSION = 15;                      // minutes before barrier

// ── Time helpers ────────────────────────────────────────────────────────────
function parseHours(val: unknown): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).trim();
  const hM = str.match(/(\d+)\s*(?:hour|hr)/i);
  const mM = str.match(/(\d+)\s*(?:min)/i);
  if (hM) {
    const h = parseInt(hM[1], 10);
    const m = mM ? parseInt(mM[1], 10) : 0;
    return h + m / 60;
  }
  const n = str.match(/(\d+\.?\d*)/);
  return n ? parseFloat(n[1]) : 0;
}

function round5(mins: number): number {
  return Math.round(mins / 5) * 5;
}

function fmtTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  let h12 = h <= 12 ? h : h - 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ── Schedule types ──────────────────────────────────────────────────────────
// `description` is rendered as one OR more paragraphs in the Description cell.
// Multi-paragraph cells are required for LU rows that hold multiple topic
// titles ("T1: …", "T2: …") and for assessment rows that list each method
// on its own line — both behaviours match the Streamlit reference.
interface Slot {
  timing: string;
  duration: string;
  description: string[];   // one entry per paragraph in the Description cell
  methods: string;
  is_lu_header?: boolean;
}

export interface Schedule {
  num_days: number;
  instructional_hours: number;
  assessment_hours: number;
  per_topic_mins: number;
  days: Record<number, Slot[]>;
}

// ── Barrier scheduling ──────────────────────────────────────────────────────
export function buildSchedule(context: any): Schedule {
  let totalHours = parseHours(context.Total_Course_Duration_Hours || '16');
  let instrHours = parseHours(context.Total_Training_Hours || '');
  let assessHours = parseHours(context.Total_Assessment_Hours || '0');

  const extractedText: string = context.extractedText || '';
  if (extractedText) {
    const crM = extractedText.match(/Classroom\s*\w*\s*\|\s*([\d.]+)\s*hours?/i);
    const prM = extractedText.match(/Practical\s*.*?Practicum\w*\s*\|\s*([\d.]+)\s*hours?/i);
    const elM = extractedText.match(/E-Learning\s*\|\s*([\d.]+)\s*hours?/i);
    const asM = extractedText.match(/\|\s*Assessment\s*\|\s*([\d.]+)\s*hours?/i);
    const tdM = extractedText.match(/Total\s*Duration\s*\|\s*([\d.]+)\s*hours?/i);
    let calcInstr = 0;
    if (crM) calcInstr += parseFloat(crM[1]);
    if (prM) calcInstr += parseFloat(prM[1]);
    if (elM) calcInstr += parseFloat(elM[1]);
    if (calcInstr > 0) instrHours = calcInstr;
    if (asM) assessHours = parseFloat(asM[1]);
    if (tdM) totalHours = parseFloat(tdM[1]);
  }

  if (!instrHours) instrHours = totalHours - assessHours;
  const numDays = totalHours >= 8 ? Math.max(1, Math.round(totalHours / 8)) : 1;

  // Per-topic schedule blocks. Each topic = one row in the day table; LUs
  // surface as gridSpan=4 header rows above their topics. Matches the
  // layout the supervisor's screenshot shows (one T1 / T2 / T3 / T4 row
  // per LU instead of all topics packed into a single multi-paragraph cell).
  // The LU title is rendered as-is — if the upstream parser already prefixed
  // it with "LU1:", the result is "LU1: LU1: Title", which is what the
  // reference output shows and the supervisor wants preserved.
  const lus: any[] = context.Learning_Units || [];
  type TopicBlock = { lu_num: number; lu_title: string; topic_desc: string; methods: string };
  const topicBlocks: TopicBlock[] = [];
  lus.forEach((lu, i) => {
    const topics: any[] = lu.Topics || [];
    const methodsArr: string[] = lu.Instructional_Methods || [];
    const methods = methodsArr.length ? methodsArr.join(', ') : '-';
    const luTitle = lu.LU_Title || `Learning Unit ${i + 1}`;
    if (!topics.length) {
      topicBlocks.push({ lu_num: i + 1, lu_title: luTitle, topic_desc: luTitle, methods });
    } else {
      topics.forEach((t, j) => {
        const title = t.Topic_Title || t.title || `Topic ${j + 1}`;
        topicBlocks.push({
          lu_num: i + 1,
          lu_title: luTitle,
          topic_desc: `T${j + 1}: ${title}`,
          methods,
        });
      });
    }
  });

  if (!topicBlocks.length) {
    return {
      num_days: numDays, instructional_hours: instrHours, assessment_hours: assessHours,
      per_topic_mins: 0, days: {},
    };
  }

  const totalTopics = topicBlocks.length;
  const perTopic = (instrHours * 60) / totalTopics;
  const days: Record<number, Slot[]> = {};
  let tIdx = 0;
  let tRemaining = perTopic;
  let isContd = false;
  let lastLuNum = -1;

  for (let day = 1; day <= numDays; day += 1) {
    const slots: Slot[] = [];
    let current = DAY_START;
    const isLastDay = day === numDays;
    let lunchDone = false;
    const assessMins = Math.round(assessHours * 60);
    const instrEnd = isLastDay && assessMins > 0 ? DAY_END - assessMins : DAY_END;

    while (tIdx < topicBlocks.length && current < instrEnd) {
      const block = topicBlocks[tIdx];
      if (block.lu_num !== lastLuNum) {
        const contd = isContd ? " (Cont'd)" : '';
        slots.push({
          timing: '', duration: '', methods: '',
          description: [`LU${block.lu_num}: ${block.lu_title}${contd}`],
          is_lu_header: true,
        });
        lastLuNum = block.lu_num;
      }

      if (!lunchDone && current >= LUNCH_START) {
        slots.push({
          timing: `${fmtTime(current)} - ${fmtTime(LUNCH_END)}`,
          duration: `${LUNCH_DURATION} mins`,
          description: ['Lunch Break'],
          methods: '-',
        });
        current = LUNCH_END;
        lunchDone = true;
        if (isContd) {
          slots.push({
            timing: '', duration: '', methods: '',
            description: [`LU${block.lu_num}: ${block.lu_title} (Cont'd)`],
            is_lu_header: true,
          });
        }
        continue;
      }

      const nextBarrier = lunchDone ? instrEnd : LUNCH_START;
      const available = nextBarrier - current;
      if (available <= 0) break;

      const desc = block.topic_desc + (isContd ? " (Cont'd)" : '');

      if (tRemaining <= available) {
        let end = round5(current + tRemaining);
        end = Math.min(end, instrEnd);
        const dur = end - current;
        if (dur > 0) {
          slots.push({
            timing: `${fmtTime(current)} - ${fmtTime(end)}`,
            duration: `${Math.round(dur)} mins`,
            description: [desc],
            methods: block.methods,
          });
        }
        current = end;
        tIdx += 1;
        tRemaining = perTopic;
        isContd = false;
      } else if (available >= MIN_SESSION) {
        slots.push({
          timing: `${fmtTime(current)} - ${fmtTime(nextBarrier)}`,
          duration: `${Math.round(available)} mins`,
          description: [desc],
          methods: block.methods,
        });
        tRemaining -= available;
        isContd = true;
        current = nextBarrier;
      } else if (!lunchDone) {
        slots.push({
          timing: `${fmtTime(current)} - ${fmtTime(LUNCH_END)}`,
          duration: `${LUNCH_DURATION} mins`,
          description: ['Lunch Break'],
          methods: '-',
        });
        current = LUNCH_END;
        lunchDone = true;
      } else {
        slots.push({
          timing: `${fmtTime(current)} - ${fmtTime(nextBarrier)}`,
          duration: `${Math.round(available)} mins`,
          description: ['Break'],
          methods: '-',
        });
        current = nextBarrier;
      }
    }

    if (!lunchDone) {
      if (current < LUNCH_START) {
        slots.push({
          timing: `${fmtTime(current)} - ${fmtTime(LUNCH_START)}`,
          duration: `${Math.round(LUNCH_START - current)} mins`,
          description: ['Break'],
          methods: '-',
        });
        current = LUNCH_START;
      }
      slots.push({
        timing: `${fmtTime(current)} - ${fmtTime(LUNCH_END)}`,
        duration: `${LUNCH_DURATION} mins`,
        description: ['Lunch Break'],
        methods: '-',
      });
      current = LUNCH_END;
    }

    if (isLastDay && assessMins > 0) {
      const amDetails: any[] = context.Assessment_Methods_Details || [];
      // Normalise "Written Assessment - Question and Answers" → "Written
      // Assessment (Question and Answers)" — same display normalisation
      // used by the Streamlit reference.
      const prettify = (name: string) =>
        name.replace(/Written Assessment\s*-\s*(Question and Answers|Short Answer Questions)/i, 'Written Assessment ($1)');
      const amNames = amDetails.map((a) => prettify(String(a.Assessment_Method || ''))).filter(Boolean);
      // Each method on its own paragraph, with a trailing `(N mins)` summary
      // — matches the Streamlit reference cell layout exactly.
      const amParas = amNames.length
        ? [...amNames.map((n) => `Assessment: ${n}`), `(${assessMins} mins)`]
        : [`Assessment (${assessMins} mins)`];
      const amStart = Math.max(current, DAY_END - assessMins);
      if (current < amStart) {
        slots.push({
          timing: `${fmtTime(current)} - ${fmtTime(amStart)}`,
          duration: `${amStart - current} mins`,
          description: ['Break'],
          methods: '-',
        });
        current = amStart;
      }
      const amEnd = Math.min(current + assessMins, DAY_END);
      slots.push({
        timing: `${fmtTime(current)} - ${fmtTime(amEnd)}`,
        duration: `${amEnd - current} mins`,
        description: amParas,
        methods: 'Assessment',
      });
      current = amEnd;
    }

    if (current < DAY_END) {
      slots.push({
        timing: `${fmtTime(current)} - ${fmtTime(DAY_END)}`,
        duration: `${DAY_END - current} mins`,
        description: ['Break'],
        methods: '-',
      });
    }

    days[day] = slots;
  }

  return {
    num_days: numDays, instructional_hours: instrHours, assessment_hours: assessHours,
    per_topic_mins: Math.round(perTopic * 10) / 10, days,
  };
}

// ── DOCX XML builders (mirror of Streamlit's `python-docx` additions) ──────
// Half-points (Word measures font size in half-points: 20 = 10pt). The
// reference LP keeps the entire summary block (title + all lines) at 10pt
// for a compact, clean look — only the title is bold.
const SZ = {
  title: '20',
  summary: '20',
  normal: '20',
};

// Format hours as `7 hrs` / `7.5 hrs` — drop trailing `.0` so whole numbers
// look like integers, matching the Streamlit reference (`1 hrs`, not `1.0 hrs`).
function fmtHours(h: number): string {
  const rounded = Math.round(h * 10) / 10;
  return `${rounded} hrs`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function paraXml(text: string, opts: { bold?: boolean; size?: string; pStyle?: string } = {}): string {
  const rPr = `<w:rPr>${opts.bold ? '<w:b/>' : ''}${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ''}</w:rPr>`;
  const pPr = opts.pStyle ? `<w:pPr><w:pStyle w:val="${opts.pStyle}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function cellXml(
  content: string | string[],
  opts: { bold?: boolean; gridSpan?: number; size?: string } = {},
): string {
  const gridSpan = opts.gridSpan && opts.gridSpan > 1 ? `<w:gridSpan w:val="${opts.gridSpan}"/>` : '';
  const rPr = `<w:rPr>${opts.bold ? '<w:b/>' : ''}<w:sz w:val="${opts.size || SZ.normal}"/><w:szCs w:val="${opts.size || SZ.normal}"/></w:rPr>`;
  // Multi-paragraph cells let Description carry separate "T1: …", "T2: …"
  // lines and the assessment row's per-method breakdown — matches the
  // Streamlit reference's `<w:p>`-per-line cell structure.
  const lines = Array.isArray(content) ? content : [content];
  const safeLines = lines.length ? lines : [''];
  const paras = safeLines
    .map((line) => `<w:p><w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`)
    .join('');
  return `<w:tc><w:tcPr>${gridSpan}</w:tcPr>${paras}</w:tc>`;
}

function scheduleXml(context: any, schedule: Schedule): string {
  const out: string[] = [];
  const courseTitle = context.Course_Title || '';
  const org = context.Name_of_Organisation || '';
  // Match Streamlit: concatenate methods in LU order WITHOUT dedup or sort,
  // so the summary line reflects each LU's listed methods in sequence.
  const allMethodsList: string[] = [];
  for (const lu of context.Learning_Units || []) {
    for (const m of lu.Instructional_Methods || []) allMethodsList.push(m);
  }

  // Order + sizes match the Streamlit reference verbatim: bold 14pt title,
  // then 11pt body lines for organisation / duration / hours / methods.
  out.push(paraXml(`Lesson Plan: ${courseTitle}`, { bold: true, size: SZ.title }));
  out.push(paraXml(`Organisation: ${org}`, { size: SZ.summary }));
  out.push(paraXml(`Course Duration: ${schedule.num_days} Day(s) (9:00 AM - 6:00 PM daily)`, { size: SZ.summary }));
  out.push(paraXml(`Total Training Hours: ${fmtHours(schedule.instructional_hours)}`, { size: SZ.summary }));
  out.push(paraXml(`Total Assessment Hours: ${fmtHours(schedule.assessment_hours)}`, { size: SZ.summary }));
  out.push(paraXml(`Instructional Methods: ${allMethodsList.join(', ') || 'N/A'}`, { size: SZ.summary }));

  const tblGrid = `<w:tblGrid>${Array(4).fill('<w:gridCol w:w="2400"/>').join('')}</w:tblGrid>`;
  const tblPr =
    `<w:tblPr>` +
    `<w:tblStyle w:val="TableGrid"/>` +
    `<w:tblW w:w="0" w:type="auto"/>` +
    `<w:jc w:val="center"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `</w:tblBorders>` +
    `</w:tblPr>`;

  for (const dayNum of Object.keys(schedule.days).map(Number).sort((a, b) => a - b)) {
    const slots = schedule.days[dayNum];
    out.push(paraXml(''));
    // Heading2 style (matches the Streamlit reference) — applies the
    // template's built-in heading formatting and lets Word's pagination
    // keep the heading with the table that follows.
    out.push(paraXml(`Day ${dayNum}`, { pStyle: 'Heading2' }));

    const headerRow = `<w:tr>${['Timing', 'Duration', 'Description', 'Instructional Methods']
      .map((h) => cellXml(h, { bold: true }))
      .join('')}</w:tr>`;

    const dataRows = slots.map((slot) => {
      if (slot.is_lu_header) {
        // LU header is always a single line — pass `description[0]` so the
        // gridSpan=4 cell renders one bold paragraph.
        return `<w:tr>${cellXml(slot.description[0] || '', { bold: true, gridSpan: 4 })}</w:tr>`;
      }
      return `<w:tr>${[
        cellXml(slot.timing || ''),
        cellXml(slot.duration || ''),
        cellXml(slot.description),       // string[] → multi-paragraph cell
        cellXml(slot.methods || ''),
      ].join('')}</w:tr>`;
    });

    out.push(`<w:tbl>${tblPr}${tblGrid}${headerRow}${dataRows.join('')}</w:tbl>`);
  }

  return out.join('');
}

// ── Entry ───────────────────────────────────────────────────────────────────
export function generateLessonPlan(context: any): { buffer: Buffer; schedule: Schedule } {
  const schedule = buildSchedule(context);
  const cover = fillTemplate('lp', {
    courseTitle: context.Course_Title,
    tgsRefNo: context.TGS_Ref_No,
    organisationName: context.Name_of_Organisation,
    UEN: context.UEN,
    learningUnits: [],
    assessmentMethodsDetails: [],
  });
  const zip = new PizZip(cover);
  let documentXml = (zip.file('word/document.xml') as any).asText();
  const scheduleBody = scheduleXml(context, schedule);
  documentXml = documentXml.replace(/<\/w:body>/, `${scheduleBody}</w:body>`);
  zip.file('word/document.xml', documentXml);
  return { buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), schedule };
}
