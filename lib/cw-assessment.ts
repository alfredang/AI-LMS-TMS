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

// Display label used for the body title (line 1) AND the "This is the X"
// instruction line (line 7) — Streamlit-parity. Always renders as
// "Full Name (Abbr)" so the title is informative even when the CP only
// supplied an abbreviation. Lookup tries the assessment's type first
// (which is the verbatim CP name), then the code/abbreviation.
const TYPE_LONG_NAMES: Record<string, string> = {
  // Lookup by abbreviation
  'WA-SAQ': 'Written Assessment – Short Answer Questions (WA-SAQ)',
  'WA (SAQ)': 'Written Assessment – Short Answer Questions (WA-SAQ)',
  'WA(Q&A)': 'Written Assessment – Short Answer Questions (WA-SAQ)',
  'WE': 'Written Exam (WE)',
  PP: 'Practical Performance (PP)',
  CS: 'Case Study (CS)',
  PRJ: 'Project (PRJ)',
  ASGN: 'Assignment (ASGN)',
  OI: 'Oral Interview (OI)',
  OQ: 'Oral Questioning (OQ)',
  OC: 'Oral Clarification (OC)',
  DEM: 'Demonstration (DEM)',
  RP: 'Role Play (RP)',
  OT: 'Online Test (OT)',
  // Lookup by full name (verbatim CP name)
  'Written Exam': 'Written Exam (WE)',
  'Written Assessment': 'Written Assessment – Short Answer Questions (WA-SAQ)',
  'Written Assessment - Short Answer Questions': 'Written Assessment – Short Answer Questions (WA-SAQ)',
  'Practical Performance': 'Practical Performance (PP)',
  'Practical Exam': 'Practical Performance (PP)',
  'Case Study': 'Case Study (CS)',
  'Others: Case Study': 'Case Study (CS)',
  'Oral Questioning': 'Oral Questioning (OQ)',
  'Oral Clarification': 'Oral Clarification (OC)',
  'Oral Interview': 'Oral Interview (OI)',
  'Role Play': 'Role Play (RP)',
  Demonstration: 'Demonstration (DEM)',
  Project: 'Project (PRJ)',
  Assignment: 'Assignment (ASGN)',
  'Online Test': 'Online Test (OT)',
};

// Same map alias for the (now identical) short-name lookup so both line 1
// and line 7 of the body render the same display label.
const TYPE_SHORT_NAMES = TYPE_LONG_NAMES;

// Map full-name → standard abbreviation, used to build the file name in
// Streamlit's "<ABBR> (<Full Name>) - <Course>.docx" format. If the
// assessment data already provides the abbreviation in `code`, that wins.
const TYPE_ABBR_OF: Record<string, string> = {
  'Written Exam': 'WE',
  'Written Assessment': 'WA-SAQ',
  'Written Assessment - Short Answer Questions': 'WA-SAQ',
  'Practical Performance': 'PP',
  'Practical Exam': 'PP',
  'Case Study': 'CS',
  'Others: Case Study': 'CS',
  'Oral Questioning': 'OQ',
  'Oral Clarification': 'OC',
  'Oral Interview': 'OI',
  'Role Play': 'RP',
  Demonstration: 'DEM',
  Project: 'PRJ',
  Assignment: 'ASGN',
  'Online Test': 'OT',
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
    `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>` +
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

// Strip any trailing K/A code parens the model may have included in the
// stem (e.g. "Define ... examples. (K3)") so we don't double-print when
// buildRefString appends the code from the knowledge_id / ability_id field.
function stripTrailingKACode(s: string): string {
  return String(s || '')
    .replace(/\s*\(\s*[KA]\d+(?:\s*,\s*[KA]\d+)*\s*\)\s*\.?\s*$/i, '')
    .trimEnd();
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
  // Streamlit-parity: title and "This is the X" line both show JUST the
  // abbreviation (e.g. "WE"), not the long name. Prefer the explicit code,
  // fall back to a known abbreviation lookup, finally to the type name.
  const displayLabel = (code && code !== aType ? code : '') || TYPE_ABBR_OF[aType] || aType;
  const numQ = questions.length;

  const parts: string[] = [];
  parts.push(paraXml(courseTitle, { size: 14, bold: true, align: 'center' }));
  parts.push(paraXml(displayLabel, { size: 12, bold: true, align: 'center' }));

  parts.push(paraXml('A: Trainee Information:', { size: 12, bold: true }));
  parts.push(paraXml('Trainee Name (as Per NRIC): ______________________________', { size: 12 }));
  parts.push(paraXml('Last three digits and alphabet of NRIC/FIN: _______________', { size: 12 }));
  parts.push(paraXml('Date: _______________', { size: 12 }));

  parts.push(paraXml('B: Assessment Instruction', { size: 12, bold: true }));
  parts.push(paraXml(`This is the ${displayLabel}`, { size: 12 }));
  if (duration) parts.push(paraXml(`Duration: ${duration}`, { size: 12 }));
  parts.push(paraXml(`1. The assessor will pass the questions in hard copy to you. There are ${numQ} questions. You need to answer all the questions.`, { size: 12 }));
  parts.push(paraXml('2. This is an open-book exam that must be completed individually.', { size: 12 }));
  parts.push(paraXml('3. You need to get all answers correct to be competent.', { size: 12 }));
  parts.push(paraXml('Submission Procedure:', { size: 12, bold: true }));
  parts.push(paraXml('1. Please pass the hard copy to the assessor after completion.', { size: 12 }));

  parts.push(paraXml('C: Questions and Answers', { size: 12, bold: true }));

  questions.forEach((q, i) => {
    const scenario = q.scenario || '';
    const qText = stripTrailingKACode(q.question_statement || q.question || '');
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
  const displayLabel = (code && code !== aType ? code : '') || TYPE_ABBR_OF[aType] || aType;

  const parts: string[] = [];
  parts.push(paraXml(`Answers to ${courseTitle}`, { size: 14, bold: true, align: 'center' }));
  parts.push(paraXml(displayLabel, { size: 12, bold: true, align: 'center' }));
  parts.push(horizontalRuleXml());

  questions.forEach((q, i) => {
    const scenario = q.scenario || '';
    const qText = stripTrailingKACode(q.question_statement || q.question || '');
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
function assembleDocx(bodyXml: string, orgName: string = ''): Buffer {
  const z = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  let doc = (z.file('word/document.xml') as any).asText();
  // Wipe the template body (keep <w:sectPr> for page setup if present)
  const sectPrMatch = doc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
  const sectPr = sectPrMatch ? sectPrMatch[0] : '';
  doc = doc.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${bodyXml}${sectPr}</w:body>`);
  z.file('word/document.xml', doc);

  // Streamlit-parity: every run in the assessment doc renders in Arial.
  // The LG template's docDefaults are Calibri, so any run that lacks an
  // explicit rFonts override would inherit Calibri. Patch the document
  // defaults in styles.xml to Arial so nothing slips through as Calibri.
  const stylesKey = 'word/styles.xml';
  const stylesFile = z.file(stylesKey) as any;
  if (stylesFile) {
    let styles: string = stylesFile.asText();
    const arialFonts = '<w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
    // Replace the <w:rFonts/> inside <w:rPrDefault> only.
    styles = styles.replace(
      /(<w:rPrDefault>\s*<w:rPr>)([\s\S]*?)(<\/w:rPr>\s*<\/w:rPrDefault>)/,
      (_m, open, inner, close) => {
        const innerNoFonts = inner.replace(/<w:rFonts\b[^/]*\/>/, '');
        return `${open}${arialFonts}${innerNoFonts}${close}`;
      },
    );
    z.file(stylesKey, styles);
  }

  // Streamlit's assessment doc has NO footer at all (no header either).
  // The LG template carries a footer with copyright text that includes
  // raw "{{Year}}, {{Name_of_Organisation}}" placeholders, which kept
  // showing up unfilled in our assessment output. Match Streamlit by
  // stripping the footer entirely:
  //   1. Drop word/footer*.xml files from the zip.
  //   2. Drop footer references from word/document.xml.rels.
  //   3. Drop <w:footerReference> inside the document's <w:sectPr>.
  //   4. Drop footer Override entries from [Content_Types].xml.
  void orgName; // no longer used in this path
  const footerKeys = Object.keys(z.files).filter((n) => /^word\/footer\d+\.xml$/.test(n));
  const footerRelIds: string[] = [];
  const relsKey = 'word/_rels/document.xml.rels';
  const relsFile = z.file(relsKey) as any;
  if (relsFile) {
    let rels: string = relsFile.asText();
    // Capture rIds for footer relationships before dropping them.
    const relRe = /<Relationship\s+[^>]*?Type="[^"]*\/footer"[^>]*?\/>/g;
    let m: RegExpExecArray | null;
    while ((m = relRe.exec(rels)) !== null) {
      const idMatch = m[0].match(/Id="([^"]+)"/);
      if (idMatch) footerRelIds.push(idMatch[1]);
    }
    rels = rels.replace(relRe, '');
    z.file(relsKey, rels);
  }
  // Drop the footer file(s) themselves.
  for (const k of footerKeys) {
    delete (z.files as any)[k];
  }
  // Strip <w:footerReference> from the document's section properties so
  // Word doesn't try to load a footer that no longer exists.
  let docNow = (z.file('word/document.xml') as any).asText();
  docNow = docNow.replace(/<w:footerReference\b[^/]*\/>/g, '');
  z.file('word/document.xml', docNow);
  // Remove footer overrides from [Content_Types].xml.
  const ctKey = '[Content_Types].xml';
  const ctFile = z.file(ctKey) as any;
  if (ctFile) {
    let ct: string = ctFile.asText();
    ct = ct.replace(/<Override\s+PartName="\/word\/footer\d+\.xml"[^/]*\/>/g, '');
    z.file(ctKey, ct);
  }
  void footerRelIds; // captured for debugging if needed

  return z.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Entry ───────────────────────────────────────────────────────────────────
export function generateAssessments(
  assessments: AssessmentBundle[],
  courseTitle: string,
  orgName: string = '',
): GeneratedAssessment[] {
  const cleanTitle = sanitizeFilename(courseTitle);
  const out: GeneratedAssessment[] = [];
  for (const a of assessments) {
    const aType = a.type || a.code || 'Assessment';
    // Streamlit pattern: "<ABBR> (<Full Name>) - <Course>.docx" (e.g.
    // "WE (Written Exam) - Course.docx", "CS (Case Study) - Course.docx").
    // Prefer the assessment's explicit code, then look up by the verbatim
    // type name; fall back to the type alone if no abbreviation is known.
    const abbr = (a.code && a.code !== aType ? a.code : '') || TYPE_ABBR_OF[aType] || '';
    const fileLabel = abbr && abbr.toLowerCase() !== aType.toLowerCase()
      ? `${abbr} (${aType})`
      : aType;
    const fileLabelSafe = sanitizeFilename(fileLabel);
    const qBody = buildQuestionBody(a, courseTitle);
    const aBody = buildAnswerBody(a, courseTitle);
    out.push({
      type: aType,
      questionName: `${fileLabelSafe} - ${cleanTitle}.docx`,
      questionBuffer: assembleDocx(qBody, orgName),
      answerName: `Answer to ${fileLabelSafe} - ${cleanTitle}.docx`,
      answerBuffer: assembleDocx(aBody, orgName),
    });
  }
  return out;
}
