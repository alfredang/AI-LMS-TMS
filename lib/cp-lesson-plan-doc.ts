/**
 * CP Generator — Lesson Plan DOCX/PDF builder.
 *
 * Streamlit-parity output: title, metadata block, then one 4-column table per
 * day (Timing | Duration | Description | Instructional Methods) with a blue
 * header row. No cover page, no logo, no version-control record — that's the
 * separate CW (Courseware Generator) flow in lib/cw-lesson-plan.ts.
 *
 * Input is the AI-generated lesson plan TEXT (cp.lessonPlanText) which the
 * LESSON_PLAN_PROMPT in lib/cp-prompts.ts produces in this shape:
 *
 *   Day 1 (9:00 AM - 6:00 PM)
 *
 *   9:00 AM - 11:40 AM | T1: Foundations
 *   Duration: 160 mins
 *   • Explain ...
 *   Instructional Method: Interactive presentation
 *
 *   11:40 AM - 11:55 AM | Break
 *
 *   ...
 */

import PizZip from 'pizzip';

export interface LessonPlanSlot {
  timing: string;
  duration: string;
  description: string;
  methods: string;
}

export interface LessonPlanDay {
  day: number;
  header: string; // e.g. "Day 1 (9:00 AM - 6:00 PM)"
  slots: LessonPlanSlot[];
}

export interface ParsedLessonPlan {
  days: LessonPlanDay[];
}

// ── Parser ──────────────────────────────────────────────────────────────────
// AI text → structured days/slots. Tolerant of small format variations: the
// "Duration:" and "Instructional Method:" lines are optional (breaks omit
// them), bullets are skipped (they belong in the spec, not the schedule
// table), and stray blank lines are ignored.
export function parseLessonPlanText(text: string): ParsedLessonPlan {
  const lines = text.split(/\r?\n/);
  const days: LessonPlanDay[] = [];
  let currentDay: LessonPlanDay | null = null;
  let currentSlot: LessonPlanSlot | null = null;

  const pushSlot = () => {
    if (currentSlot && currentDay) {
      currentDay.slots.push(currentSlot);
    }
    currentSlot = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pushSlot();
      continue;
    }

    // Day header: "Day 1 (9:00 AM - 6:00 PM)" or just "Day 1"
    const dayMatch = line.match(/^Day\s+(\d+)\b/i);
    if (dayMatch) {
      pushSlot();
      currentDay = {
        day: parseInt(dayMatch[1], 10),
        header: line,
        slots: [],
      };
      days.push(currentDay);
      continue;
    }

    // Slot start: "9:00 AM - 12:30 PM | Description"
    // Time portion accepts h or h:mm with AM/PM, surrounded by hyphen/dash.
    const slotMatch = line.match(
      /^(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))\s*\|\s*(.+)$/,
    );
    if (slotMatch) {
      pushSlot();
      if (!currentDay) {
        // No day header seen yet — synthesise Day 1 so we don't lose the slot.
        currentDay = { day: 1, header: 'Day 1', slots: [] };
        days.push(currentDay);
      }
      currentSlot = {
        timing: slotMatch[1].replace(/\s+/g, ' ').trim(),
        duration: '',
        description: slotMatch[2].trim(),
        methods: '',
      };
      continue;
    }

    if (!currentSlot) continue; // bullets / stray text outside any slot

    // Duration line
    const durMatch = line.match(/^Duration\s*:\s*(.+)$/i);
    if (durMatch) {
      currentSlot.duration = durMatch[1].trim();
      continue;
    }

    // Instructional Method line (singular or plural)
    const methodMatch = line.match(/^Instructional\s+Methods?\s*:\s*(.+)$/i);
    if (methodMatch) {
      currentSlot.methods = methodMatch[1].trim();
      continue;
    }

    // Anything else (bullets starting with •, -, *, etc.) is intentionally
    // dropped — the schedule table doesn't render bullet content.
  }

  pushSlot();

  return { days };
}

// ── Format helpers ──────────────────────────────────────────────────────────
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

export interface LessonPlanMeta {
  courseTitle: string;
  courseDurationHours: number;
  instructionalHours: number;
  assessmentHours: number;
  instructionalMethods: string[]; // pre-joined display order
}

// ── DOCX builder ────────────────────────────────────────────────────────────
// Builds a fresh .docx from scratch with pizzip — no template file required.
// Matches the Streamlit reference layout: bold 14pt title, 4 metadata lines
// at 11pt, then one Day heading + 4-col table per day. Header row gets blue
// shading (#4472C4) with white text, mirroring the screenshot.

const HEADER_BG = '4472C4';

function rPrXml(opts: { bold?: boolean; size?: number; color?: string } = {}): string {
  const parts: string[] = [];
  if (opts.bold) parts.push('<w:b/>');
  if (opts.color) parts.push(`<w:color w:val="${opts.color}"/>`);
  if (opts.size) {
    const sz = String(opts.size * 2); // half-points
    parts.push(`<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`);
  }
  parts.push(`<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>`);
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

function paraXml(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): string {
  return `<w:p><w:r>${rPrXml(opts)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function cellXml(
  text: string,
  opts: { bold?: boolean; size?: number; color?: string; shadingFill?: string; width?: number } = {},
): string {
  const shading = opts.shadingFill
    ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shadingFill}"/>`
    : '';
  const width = opts.width
    ? `<w:tcW w:w="${opts.width}" w:type="dxa"/>`
    : '';
  const tcPr = `<w:tcPr>${width}${shading}</w:tcPr>`;
  return `<w:tc>${tcPr}<w:p><w:r>${rPrXml(opts)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;
}

function tableXml(parsed: ParsedLessonPlan): string {
  // Column widths in twentieths of a point (dxa). Total ~9000 ≈ printable
  // width inside 1" margins on Letter/A4.
  const widths = [1900, 1100, 4000, 2000];
  const tblGrid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const tblPr =
    `<w:tblPr>` +
    `<w:tblW w:w="9000" w:type="dxa"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:color="000000"/>` +
    `<w:left w:val="single" w:sz="4" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="4" w:color="000000"/>` +
    `<w:right w:val="single" w:sz="4" w:color="000000"/>` +
    `<w:insideH w:val="single" w:sz="4" w:color="000000"/>` +
    `<w:insideV w:val="single" w:sz="4" w:color="000000"/>` +
    `</w:tblBorders>` +
    `</w:tblPr>`;

  const out: string[] = [];
  for (const day of parsed.days) {
    out.push(paraXml('')); // spacer
    out.push(paraXml(`Day ${day.day}`, { bold: true, size: 12, color: '4472C4' }));

    const headers = ['Timing', 'Duration', 'Description', 'Instructional Methods'];
    const headerRow = `<w:tr>${headers
      .map((h, i) => cellXml(h, { bold: true, size: 10, color: 'FFFFFF', shadingFill: HEADER_BG, width: widths[i] }))
      .join('')}</w:tr>`;

    const dataRows = day.slots
      .map((slot) =>
        `<w:tr>${[
          cellXml(slot.timing, { size: 10, width: widths[0] }),
          cellXml(slot.duration, { size: 10, width: widths[1] }),
          cellXml(slot.description, { size: 10, width: widths[2] }),
          cellXml(slot.methods, { size: 10, width: widths[3] }),
        ].join('')}</w:tr>`,
      )
      .join('');

    out.push(`<w:tbl>${tblPr}${tblGrid}${headerRow}${dataRows}</w:tbl>`);
  }
  return out.join('');
}

function metadataXml(meta: LessonPlanMeta, parsed: ParsedLessonPlan): string {
  const numDays = parsed.days.length || 1;
  const lines = [
    `Course Duration: ${fmtHours(meta.courseDurationHours)} / ${numDays} Day(s) (9:00 AM - 6:00 PM daily)`,
    `Total Instructional Hours: ${fmtHours(meta.instructionalHours)}`,
    `Total Assessment Hours: ${fmtHours(meta.assessmentHours)}`,
    `Instructional Methods: ${meta.instructionalMethods.join(', ') || 'N/A'}`,
  ];
  return lines.map((l) => paraXml(l, { size: 11 })).join('');
}

function buildDocumentXml(meta: LessonPlanMeta, parsed: ParsedLessonPlan): string {
  const title = paraXml(`Lesson Plan: ${meta.courseTitle}`, { bold: true, size: 14 });
  const body = title + metadataXml(meta, parsed) + tableXml(parsed);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

// Minimal valid .docx skeleton. These three companion files are required for
// Word to open the document — anything less and Word reports "file is corrupt".
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

export function generateLessonPlanDocx(text: string, meta: LessonPlanMeta): Buffer {
  const parsed = parseLessonPlanText(text);
  const documentXml = buildDocumentXml(meta, parsed);

  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', RELS_XML);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
  zip.file('word/document.xml', documentXml);

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── HTML builder (used as input to Playwright PDF) ──────────────────────────
export function generateLessonPlanHtml(text: string, meta: LessonPlanMeta): string {
  const parsed = parseLessonPlanText(text);
  const numDays = parsed.days.length || 1;

  const dayBlocks = parsed.days
    .map(
      (day) => `
        <h2>Day ${day.day}</h2>
        <table>
          <thead>
            <tr>
              <th>Timing</th>
              <th>Duration</th>
              <th>Description</th>
              <th>Instructional Methods</th>
            </tr>
          </thead>
          <tbody>
            ${day.slots
              .map(
                (s) => `
              <tr>
                <td>${esc(s.timing)}</td>
                <td>${esc(s.duration)}</td>
                <td>${esc(s.description)}</td>
                <td>${esc(s.methods)}</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>`,
    )
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Lesson Plan: ${esc(meta.courseTitle)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: Arial, sans-serif; color: #000; font-size: 10pt; }
    h1 { font-size: 14pt; margin: 0 0 12px; }
    h2 { font-size: 12pt; color: #4472C4; margin: 18px 0 6px; }
    .meta p { margin: 2px 0; font-size: 10pt; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; table-layout: fixed; }
    th, td { border: 1px solid #000; padding: 6px 8px; vertical-align: top; word-wrap: break-word; }
    th { background: #4472C4; color: #fff; text-align: left; font-weight: bold; }
    th:nth-child(1), td:nth-child(1) { width: 21%; }
    th:nth-child(2), td:nth-child(2) { width: 12%; }
    th:nth-child(3), td:nth-child(3) { width: 45%; }
    th:nth-child(4), td:nth-child(4) { width: 22%; }
  </style>
</head>
<body>
  <h1>Lesson Plan: ${esc(meta.courseTitle)}</h1>
  <div class="meta">
    <p>Course Duration: ${fmtHours(meta.courseDurationHours)} / ${numDays} Day(s) (9:00 AM - 6:00 PM daily)</p>
    <p>Total Instructional Hours: ${fmtHours(meta.instructionalHours)}</p>
    <p>Total Assessment Hours: ${fmtHours(meta.assessmentHours)}</p>
    <p>Instructional Methods: ${esc(meta.instructionalMethods.join(', ') || 'N/A')}</p>
  </div>
  ${dayBlocks}
</body>
</html>`;
}
