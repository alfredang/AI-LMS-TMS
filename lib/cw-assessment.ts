/**
 * Assessment DOCX generator — pure TypeScript port of
 * `scripts/generate-assessment.py` matching the Streamlit reference exactly.
 *
 * For each assessment type in the input, produces TWO DOCX files:
 *  - `{TYPE} - {Course Title}.docx`  — question paper with blank answer boxes
 *  - `Answer to {TYPE} - {Course Title}.docx` — suggestive answers
 */

import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'templates', 'courseware', 'LG_TGS-Ref-No_Course-Title_v1.docx');

const TYPE_LONG_NAMES: Record<string, string> = {
  'WA (SAQ)': 'Written Assessment – Short Answer Questions (SAQ)',
  'WA-SAQ': 'Written Assessment – Short Answer Questions (SAQ)',
  'WA(Q&A)': 'Written Assessment – Short Answer Questions (SAQ)',
  PP: 'Practical Performance (PP)',
  CS: 'Case Study (CS)',
  PRJ: 'Project (PRJ)',
  ASGN: 'Assignment (ASGN)',
  OI: 'Oral Interview (OI)',
  DEM: 'Demonstration (DEM)',
  RP: 'Role Play (RP)',
  OQ: 'Oral Questioning (OQ)',
};

const TYPE_SHORT_NAMES: Record<string, string> = {
  'WA (SAQ)': 'Written Assessment (SAQ)',
  'WA-SAQ': 'Written Assessment (SAQ)',
  PP: 'Practical Performance',
  CS: 'Case Study',
  PRJ: 'Project',
  ASGN: 'Assignment',
  OI: 'Oral Interview',
  DEM: 'Demonstration',
  RP: 'Role Play',
  OQ: 'Oral Questioning',
};

// ── Types ──────────────────────────────────────────────────────────────────
export interface AssessmentQuestion {
  scenario?: string;
  question_statement?: string;
  question?: string;
  knowledge_id?: string;
  ability_id?: string | string[];
  answer?: string | string[];
}

export interface AssessmentBundle {
  type?: string;
  code?: string;
  duration?: string;
  questions?: AssessmentQuestion[];
}

export interface GeneratedAssessment {
  type: string;
  questionName: string;
  questionBuffer: Buffer;
  answerName: string;
  answerBuffer: Buffer;
}

// ── XML helpers ────────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type RunOpts = { bold?: boolean; italic?: boolean; size?: number; align?: 'center' | 'left' | 'right' };

function paraXml(text: string, opts: RunOpts = {}): string {
  const sz = opts.size ? opts.size * 2 : 24; // Word uses half-points
  const align = opts.align ? `<w:pPr><w:jc w:val="${opts.align}"/></w:pPr>` : '';
  const rPr =
    `<w:rPr>` +
    (opts.bold ? '<w:b/>' : '') +
    (opts.italic ? '<w:i/>' : '') +
    `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>` +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` +
    `</w:rPr>`;
  return `<w:p>${align}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function horizontalRuleXml(): string {
  return (
    `<w:p><w:pPr><w:pBdr>` +
    `<w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/>` +
    `</w:pBdr></w:pPr></w:p>`
  );
}

function borderedBoxXml(innerParas: string[]): string {
  const tblPr =
    `<w:tblPr>` +
    `<w:tblW w:w="5000" w:type="pct"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `</w:tblBorders>` +
    `</w:tblPr>`;
  const tblGrid = `<w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>`;
  const row =
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/></w:tcPr>` +
    innerParas.join('') +
    `</w:tc></w:tr>`;
  return `<w:tbl>${tblPr}${tblGrid}${row}</w:tbl>`;
}

// ── Helpers matching Python logic ──────────────────────────────────────────
function buildRefString(q: AssessmentQuestion): string {
  const refs: string[] = [];
  const kId = (q.knowledge_id || '').trim();
  let aIds: string[] = [];
  if (Array.isArray(q.ability_id)) aIds = q.ability_id.filter(Boolean);
  else if (typeof q.ability_id === 'string' && q.ability_id) aIds = [q.ability_id];
  if (kId) refs.push(kId);
  refs.push(...aIds.filter(Boolean));
  return refs.length ? ` (${refs.join(', ')})` : '';
}

function formatDuration(duration: string | undefined): string {
  if (!duration) return '';
  const d = String(duration).trim();
  if (/min/i.test(d) && !/hour|hr/i.test(d)) return d;
  let total = 0;
  const hrM = d.match(/(\d+\.?\d*)\s*(?:hour|hr)/i);
  const mnM = d.match(/(\d+)\s*min/i);
  if (hrM) total += Math.round(parseFloat(hrM[1]) * 60);
  if (mnM) total += parseInt(mnM[1], 10);
  return total > 0 ? `${total} mins` : d;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\-. ()]/g, '').substring(0, 80).trim();
}

// ── Body builders ──────────────────────────────────────────────────────────
function buildQuestionBody(assessment: AssessmentBundle, courseTitle: string): string {
  const aType = assessment.type || assessment.code || '';
  const code = assessment.code || aType;
  const duration = formatDuration(assessment.duration);
  const questions = assessment.questions || [];
  const shortName = TYPE_SHORT_NAMES[aType] || TYPE_SHORT_NAMES[code] || aType;
  const longName = TYPE_LONG_NAMES[aType] || TYPE_LONG_NAMES[code] || aType;
  const numQ = questions.length;

  const parts: string[] = [];
  parts.push(paraXml(courseTitle, { size: 14, bold: true, align: 'center' }));
  parts.push(paraXml(shortName, { size: 12, bold: true, align: 'center' }));

  parts.push(paraXml('A: Trainee Information:', { size: 12, bold: true }));
  parts.push(paraXml('Trainee Name (as Per NRIC): ______________________________', { size: 12 }));
  parts.push(paraXml('Last three digits and alphabet of NRIC/FIN: _______________', { size: 12 }));
  parts.push(paraXml('Date: _______________', { size: 12 }));

  parts.push(paraXml('B: Assessment Instruction', { size: 12, bold: true }));
  parts.push(paraXml(`This is the ${longName}`, { size: 12 }));
  if (duration) parts.push(paraXml(`Duration: ${duration}`, { size: 12 }));
  parts.push(paraXml(`1. The assessor will pass the questions in hard copy to you. There are ${numQ} questions. You need to answer all the questions.`, { size: 12 }));
  parts.push(paraXml('2. This is an open-book exam that must be completed individually.', { size: 12 }));
  parts.push(paraXml('3. You need to get all answers correct to be competent.', { size: 12 }));
  parts.push(paraXml('Submission Procedure:', { size: 12, bold: true }));
  parts.push(paraXml('1. Please pass the hard copy to the assessor after completion.', { size: 12 }));

  parts.push(paraXml('C: Questions and Answers', { size: 12, bold: true }));

  questions.forEach((q, i) => {
    const scenario = q.scenario || '';
    const qText = q.question_statement || q.question || '';
    const ref = buildRefString(q);
    if (scenario) parts.push(paraXml(scenario, { size: 12 }));
    parts.push(paraXml(`Q${i + 1}. ${qText}${ref}`, { size: 12, bold: true }));
    parts.push(paraXml('Answer:', { size: 12, bold: true }));
    // Blank answer box: 9 empty paragraph lines inside a bordered cell
    const blankLines = Array.from({ length: 9 }, () => paraXml(''));
    parts.push(borderedBoxXml(blankLines));
  });

  parts.push(horizontalRuleXml());
  parts.push(paraXml('For Official Use Only', { size: 12, bold: true }));
  parts.push(paraXml('Grade: __________(C / NYC)', { size: 12 }));
  parts.push(paraXml('Assessor Name: _______________    Assessor NRIC: _______________', { size: 12 }));
  parts.push(paraXml('Date: _______________    Signature: _______________', { size: 12 }));

  return parts.join('');
}

function buildAnswerBody(assessment: AssessmentBundle, courseTitle: string): string {
  const aType = assessment.type || assessment.code || '';
  const code = assessment.code || aType;
  const questions = assessment.questions || [];
  const shortName = TYPE_SHORT_NAMES[aType] || TYPE_SHORT_NAMES[code] || aType;

  const parts: string[] = [];
  parts.push(paraXml(`Answers to ${courseTitle}`, { size: 14, bold: true, align: 'center' }));
  parts.push(paraXml(shortName, { size: 12, bold: true, align: 'center' }));
  parts.push(horizontalRuleXml());

  questions.forEach((q, i) => {
    const scenario = q.scenario || '';
    const qText = q.question_statement || q.question || '';
    const ref = buildRefString(q);
    const answers = q.answer;

    if (scenario) parts.push(paraXml(scenario, { size: 12, italic: true }));
    parts.push(paraXml(`Q${i + 1}. ${qText}${ref}`, { size: 12, bold: true }));

    const boxParas: string[] = [];
    boxParas.push(paraXml('Suggestive answers (not exhaustive):', { size: 12, bold: true, italic: true }));
    if (Array.isArray(answers)) {
      for (const ans of answers) boxParas.push(paraXml(`• ${ans}`, { size: 12 }));
    } else if (answers) {
      boxParas.push(paraXml(String(answers), { size: 12 }));
    }
    parts.push(borderedBoxXml(boxParas));
  });

  return parts.join('');
}

// ── DOCX assembly — reuse an existing template, replace body content ───────
function assembleDocx(bodyXml: string): Buffer {
  const z = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  let doc = (z.file('word/document.xml') as any).asText();
  // Wipe the template body (keep <w:sectPr> for page setup if present)
  const sectPrMatch = doc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
  const sectPr = sectPrMatch ? sectPrMatch[0] : '';
  doc = doc.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${bodyXml}${sectPr}</w:body>`);
  z.file('word/document.xml', doc);
  return z.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Entry ───────────────────────────────────────────────────────────────────
export function generateAssessments(
  assessments: AssessmentBundle[],
  courseTitle: string,
): GeneratedAssessment[] {
  const cleanTitle = sanitizeFilename(courseTitle);
  const out: GeneratedAssessment[] = [];
  for (const a of assessments) {
    const aType = a.type || a.code || 'Assessment';
    const typeSafe = sanitizeFilename(aType);
    const qBody = buildQuestionBody(a, courseTitle);
    const aBody = buildAnswerBody(a, courseTitle);
    out.push({
      type: aType,
      questionName: `${typeSafe} - ${cleanTitle}.docx`,
      questionBuffer: assembleDocx(qBody),
      answerName: `Answer to ${typeSafe} - ${cleanTitle}.docx`,
      answerBuffer: assembleDocx(aBody),
    });
  }
  return out;
}
