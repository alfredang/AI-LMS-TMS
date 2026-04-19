import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@anthropic-ai/claude-agent-sdk';
import pool from '../../../lib/db';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── File Parsing Helpers (matching Streamlit's parse_cp_document logic) ───

const MAX_PROMPT_CHARS = 80000;

function trimDocxContent(text: string): string {
  // Trim to relevant CP sections: Part 1 through Part 4 (matching Streamlit)
  const startMatch = text.match(/Part\s*1[\s\S]*?Particulars\s*of\s*Course/i);
  const endMatch = text.match(/Part\s*\d+[\s\S]*?Facilities\s*and\s*Resources/i);
  if (startMatch && startMatch.index !== undefined) {
    const startIdx = startMatch.index;
    if (endMatch && endMatch.index !== undefined) {
      const endIdx = endMatch.index + endMatch[0].length;
      text = text.substring(startIdx, endIdx);
    } else {
      text = text.substring(startIdx);
    }
  }
  // Collapse excessive newlines
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function trimXlsxContent(text: string): string {
  // Trim to relevant sections: Course Particulars through Declarations (matching Streamlit)
  const startIdx = text.indexOf('1 - Course Particulars');
  const endIdx = text.indexOf('4 - Declarations');
  if (startIdx >= 0) {
    text = endIdx >= 0 ? text.substring(startIdx, endIdx) : text.substring(startIdx);
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

async function parseFileContent(base64Data: string, fileName: string): Promise<string> {
  // Use Python parser (python-docx / openpyxl) — matches Streamlit's parse_cp_document exactly
  const tmpDir = os.tmpdir();
  const b64Path = path.join(tmpDir, `cp_b64_${Date.now()}.txt`);
  const scriptPath = path.join(process.cwd(), 'scripts', 'parse-cp.py');

  fs.writeFileSync(b64Path, base64Data, 'utf-8');

  try {
    const result = execSync(
      `python "${scriptPath}" "${b64Path}" base64 "${fileName}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const parsed = JSON.parse(result.trim());
    if (parsed.error) throw new Error(parsed.error);
    return parsed.text || '';
  } catch (e: any) {
    console.error('Python CP parser error:', e.message);
    // Fallback to JS parsing
    const buffer = Buffer.from(base64Data, 'base64');
    let fbResult = '';
    if (fileName.match(/\.xlsx?$/i)) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const allText: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (rows.length > 0) {
          const sheetText = rows
            .filter(row => row.some((cell: any) => String(cell).trim()))
            .map(row => row.map((cell: any) => String(cell).trim()).join(' | '))
            .join('\n');
          if (sheetText.trim()) allText.push(`## ${sheetName}\n${sheetText}`);
        }
      }
      fbResult = trimXlsxContent(allText.join('\n\n'));
    } else if (fileName.match(/\.docx$/i)) {
      const extracted = await mammoth.extractRawText({ buffer: Buffer.from(base64Data, 'base64') });
      fbResult = trimDocxContent(extracted.value);
    } else {
      fbResult = buffer.toString('utf8');
    }
    return fbResult;
  } finally {
    try { fs.unlinkSync(b64Path); } catch {}
  }
}

// ─── Prompt Templates ───

const EXTRACT_COURSE_INFO_PROMPT = `You are an expert WSQ instructional designer and course proposal analyst for Singapore's SSG framework.

Extract and structure the following Course Proposal (CP) content into a comprehensive course data summary.

TGS Reference Number (provided by user): {tgs_ref_code}
Course URL (if provided): {course_url}

Course Proposal Content:
{cp_text}

Extract the following information and format as a structured summary:

## 1. Course Overview
Present as a table with these fields (one per row):
- Registered Training Provider
- Course Title
- Course Ref Code (TGS): Use the TGS Reference Number provided above: {tgs_ref_code}
- TSC Code
- TSC Title
- Skills Framework
- Sector
- Proficiency Level
- Total Course Duration
- Total Training Hours
- Total Assessment Hours
- Course Fee (if available, otherwise N/A)

## 2. What This Course Is About
A brief description of the course topic and focus area.

## 3. What You'll Learn
List the Learning Outcomes (LO1, LO2, etc.) as bullet points.

## 4. Topics
For each Learning Unit, list:
- LU Title
- All topics with subtopics as bullet points

## 5. Knowledge and Ability Statements
For each Learning Unit:
- Knowledge (K) statements with numbering (K1, K2, etc.)
- Ability (A) statements with numbering (A1, A2, etc.)

## 6. Instructional Methods & Duration
Present as a markdown table with EXACTLY these columns: Learning Unit | Instructional Methods
- ONE row per Learning Unit only
- Instructional Methods column: list all methods for that LU as comma-separated values (e.g. "Interactive presentation, Peer teaching / Peer practice, Case studies")
- Do NOT include duration, mode of training, or subtotals
- Do NOT have separate rows per method

Example format:
| Learning Unit | Instructional Methods |
|---|---|
| Preparation for Negotiation | Interactive presentation, Peer teaching / Peer practice, Case studies |
| Advanced Negotiation | Interactive presentation, Role-play, Case studies |

## 7. Assessment Methods & Duration
Present as a markdown table with EXACTLY these 4 columns: Assessment Method | Abbreviation | Duration | Assessor:Candidate Ratio
- ONE row per unique assessment method (NOT per LO)
- Duration: Sum all durations across all LOs for the same method and show as human-readable (e.g. "1 hour", "48 minutes", "12 minutes")
- Do NOT include subtotals, totals, grand totals, or per-LO breakdowns
- Do NOT include a second table with per-LO details

Example format:
| Assessment Method | Abbreviation | Duration | Assessor:Candidate Ratio |
|---|---|---|---|
| Written Assessment - Short Answer Questions | WA-SAQ | 1 hour | 1:20 |
| Case Study | CS | 48 minutes | 1:20 |
| Role Play | RP | 12 minutes | 1:1 |

## 8. Course Overview Description
Write a 2-3 paragraph professional course overview.

Respond with ONLY the extracted information using the section headers above, nothing else.`;

const GENERATE_AP_PROMPT = `You are an expert WSQ instructional designer creating an Assessment Plan (AP) for SSG Singapore.

Based on the following Course Proposal data, generate a comprehensive Assessment Plan:

{course_context}

The Assessment Plan must include:
1. Assessment Overview and Objectives
2. For each Learning Unit:
   - Assessment methods and their alignment to K/A statements
   - Evidence requirements
   - Assessment criteria and rubrics
   - Duration allocation
3. Assessment Conditions (venue, equipment, resources)
4. Reasonable Adjustment provisions
5. Assessment Summary Record (ASR) template outline

Follow WSQ AP template structure. Professional academic tone.
Respond with ONLY the Assessment Plan content, nothing else.`;

const GENERATE_FG_PROMPT = `You are an expert WSQ instructional designer creating a Facilitator Guide (FG) for SSG Singapore.

Based on the following Course Proposal data, generate a comprehensive Facilitator Guide:

{course_context}

The Facilitator Guide must include:
1. Course Overview and Objectives
2. Facilitator Prerequisites and Preparation
3. For each Learning Unit/Topic:
   - Detailed delivery instructions
   - Instructional methods and activities
   - Timing and duration
   - Resources and materials needed
   - Discussion points and facilitation tips
   - Assessment integration points
4. Classroom Management Guidelines
5. Assessment Administration Instructions

Follow WSQ FG template structure. Professional tone suitable for trainers.
Respond with ONLY the Facilitator Guide content, nothing else.`;

const GENERATE_LG_PROMPT = `You are an expert WSQ instructional designer creating a Learner Guide (LG) for SSG Singapore.

Based on the following Course Proposal data, generate a comprehensive Learner Guide:

{course_context}

The Learner Guide must include:
1. Course Introduction and Welcome
2. Learning Objectives
3. For each Learning Unit/Topic:
   - Learning content and key concepts
   - Examples and illustrations
   - Practice exercises and activities
   - Self-assessment questions
   - Key takeaways
4. Glossary of Terms
5. References and Further Reading

Follow WSQ LG template structure. Learner-friendly tone.
Respond with ONLY the Learner Guide content, nothing else.`;

const GENERATE_LESSON_PLAN_PROMPT = `You are an expert WSQ instructional designer creating a Lesson Plan with barrier scheduling for SSG Singapore.

Based on the following Course Proposal data, generate a day-by-day lesson plan:

{course_context}

Number of Training Days: {num_training_days}

Scheduling Rules (MUST follow exactly):
- Daily hours: 9:00 AM - 6:00 PM (9 hours total per day)
- Lunch: Fixed 12:30 PM - 1:15 PM (45 minutes) every day
- Assessment: Fixed 4:00 PM - 6:00 PM (2 hours) on the LAST day only
- Topic Duration: Equal time allocation = instructional_hours * 60 / num_topics minutes each
- Topics CAN split across lunch or day-end barriers with "(Cont'd)" suffix
- Minimum session before a barrier: 15 minutes (otherwise insert Break)
- Fill all remaining gaps with "Break" entries to make each day exactly 9:00 AM - 6:00 PM

Format each entry as:
Day X:
HH:MM AM/PM - HH:MM AM/PM | Duration (min) | Description

Respond with ONLY the lesson plan, nothing else.`;

const GENERATE_ASSESSMENT_PROMPT = `You are an expert WSQ assessment developer creating assessment questions for Singapore's SSG framework.

Based on the following Course Proposal data, generate assessment questions:

{course_context}

Assessment Type: {assessment_type}

For each question, provide:
1. A realistic scenario (2-3 sentences, industry-relevant)
2. A clear question statement
3. Knowledge ID mapping (e.g., K1, K2) or Ability ID mapping (e.g., A1, A2)
4. Detailed answer in bullet points (3-5 points)

Generate questions that cover all relevant K and A statements for this assessment type.
Questions must be practical, scenario-based, and aligned with WSQ competency standards.

Format each question clearly with:
**Question X:**
Scenario: [scenario text]
Question: [question statement]
K/A Mapping: [K1, A2, etc.]
Answer:
• [bullet point 1]
• [bullet point 2]
• [bullet point 3]

Respond with ONLY the assessment questions, nothing else.`;

const GENERATE_SLIDES_PROMPT = `You are an expert WSQ instructional designer creating slide content for a training presentation.

Based on the following Course Proposal data, generate comprehensive slide content:

{course_context}

Generate structured slide content for each topic with:
1. Title Slide for each Learning Unit
2. Learning Objectives slide
3. Content slides with:
   - Key concepts and definitions
   - Real-world examples and statistics (with citations)
   - Process flows and frameworks
   - Best practices and guidelines
4. Activity/Discussion slides
5. Summary/Key Takeaways slide
6. Assessment Preview slide

For each slide, specify:
- Slide Title
- Bullet points (max 5 per slide, max 20 words each)
- Speaker notes (2-3 sentences)
- Suggested infographic type (if applicable): overview, process, comparison, hierarchy, timeline, statistics

Respond with ONLY the slide content, nothing else.`;

const GENERATE_BROCHURE_PROMPT = `You are an expert marketing content writer for Singapore's professional training industry.

Based on the following course information, generate professional brochure content:

{course_context}

Course URL: {course_url}

Generate a marketing brochure with:
1. Eye-catching headline and tagline
2. Course highlights (3-5 bullet points)
3. Who should attend (target audience)
4. Key learning outcomes (5-7 points)
5. Course structure overview
6. Trainer/Provider credentials
7. Certification and funding information (WSQ, SkillsFuture)
8. Registration details and call-to-action

Professional marketing tone. Focus on benefits and outcomes.
Respond with ONLY the brochure content, nothing else.`;

const CONVERT_ASSESSMENT_PROMPT = `You are an expert WSQ instructional designer converting assessment documents into WSQ-standard format.

Source Document Content:
{source_text}

Convert this document into WSQ-standard assessment format with:
1. Proper question numbering and structure
2. Scenario-based questions with K/A statement mapping
3. Clear answer guidelines with marking criteria
4. Trainee information header
5. Assessment instructions
6. Assessor sign-off section

Maintain the original content while restructuring into WSQ format.
Respond with ONLY the converted document, nothing else.`;

const CONVERT_COURSEWARE_PROMPT = `You are an expert WSQ instructional designer converting courseware into WSQ-standard format.

Source Document Content:
{source_text}

Convert this document into WSQ-standard courseware format with:
1. Proper section structure (Course Overview, Learning Units, Topics)
2. Learning outcomes aligned to K/A statements
3. Structured content with activities and exercises
4. Assessment integration points
5. Professional formatting consistent with WSQ guidelines

Maintain the original content while restructuring into WSQ format.
Respond with ONLY the converted document, nothing else.`;

const CONVERT_LESSON_PLAN_PROMPT = `You are an expert WSQ instructional designer converting a lesson plan into WSQ-standard format.

Source Document Content:
{source_text}

Convert this into WSQ-standard lesson plan format with:
1. Day-by-day schedule (9:00 AM - 6:00 PM)
2. Fixed lunch at 12:30 PM - 1:15 PM
3. Assessment on last day at 4:00 PM - 6:00 PM
4. Proper timing and duration columns
5. Topic descriptions with instructional methods

Maintain the original content while restructuring into WSQ lesson plan format.
Respond with ONLY the converted lesson plan, nothing else.`;

const COURSEWARE_AUDIT_PROMPT = `You are an expert WSQ quality auditor for Singapore's SSG framework.

Audit the following courseware documents against the Course Proposal for consistency.

Course Proposal (CP):
{cp_text}

{additional_documents}

For EACH document provided, check and compare against the CP for:
1. Course Title — exact match
2. TGS Reference Number — exact match
3. TSC Code and Title — exact match
4. Total Training Hours — must match
5. Total Assessment Hours — must match
6. Topics — all CP topics must appear
7. Learning Outcomes — must be present and aligned
8. K Statements — must be referenced correctly
9. A Statements — must be referenced correctly
10. Assessment Methods — must match CP methods
11. Instructional Methods — must match CP methods
12. Company Name — must match
13. UEN — must match

For each field, report:
✅ PASS — if consistent
❌ FAIL — if inconsistent (explain the discrepancy)
⚠️ N/A — if field not found in document (not all documents contain all fields)

Respond with ONLY the audit report, nothing else.`;

// ─── Helpers ───

async function getApiKey(): Promise<{ key: string; envVar: string } | null> {
  try {
    const result = await pool.query(
      `SELECT key_value FROM training_provider_api
       WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
       AND key_name = 'ANTHROPIC_API_KEY'`
    );
    if (result.rows.length > 0 && result.rows[0].key_value) {
      const key = result.rows[0].key_value;
      const envVar = key.startsWith('sk-ant-oat') ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';
      return { key, envVar };
    }
  } catch (e) {
    console.error('Failed to fetch API key from DB:', e);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { key: process.env.ANTHROPIC_API_KEY, envVar: 'ANTHROPIC_API_KEY' };
  }
  return null;
}

async function generateWithClaude(prompt: string, apiConfig: { key: string; envVar: string }, maxTurns: number = 5): Promise<string> {
  let resultText = '';

  for await (const message of query({
    prompt,
    options: {
      env: { ...process.env, [apiConfig.envVar]: apiConfig.key },
      allowedTools: [],
      maxTurns,
    },
  })) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          resultText += block.text;
        }
      }
    }
  }

  if (!resultText) {
    throw new Error('No response from Claude. Please try again.');
  }

  return resultText;
}

function buildPrompt(template: string, vars: Record<string, string>): string {
  let prompt = template;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  return prompt;
}

function buildCourseContext(courseData: any, cpText: string): string {
  if (courseData) {
    // Use structured data — support both camelCase and PascalCase field names
    const get = (...keys: string[]) => {
      for (const k of keys) if (courseData[k]) return courseData[k];
      return '';
    };
    const getArr = (...keys: string[]) => {
      for (const k of keys) if (courseData[k]) return courseData[k];
      return [];
    };
    let context = `Course Title: ${get('Course_Title', 'courseTitle')}
TGS Reference: ${get('TGS_Ref_No', 'tgsRefNo')}
TSC Code: ${get('TSC_Code', 'tscCode')} | TSC Title: ${get('TSC_Title', 'tscTitle')}
Training Hours: ${get('Total_Training_Hours', 'totalTrainingHours')}
Assessment Hours: ${get('Total_Assessment_Hours', 'totalAssessmentHours')}
Total Course Duration: ${get('Total_Course_Duration_Hours')}
Organisation: ${get('Name_of_Organisation', 'organisationName')}
Course Overview: ${get('Course_Overview', 'courseOverview', 'TSC_Description')}
Learning Units: ${JSON.stringify(getArr('Learning_Units', 'learningUnits'), null, 2)}
Assessment Methods: ${JSON.stringify(getArr('Assessment_Methods_Details', 'assessmentMethodsDetails'), null, 2)}`;
    // Limit context size
    if (context.length > 25000) {
      context = context.substring(0, 25000) + '\n[Truncated]';
    }
    return context;
  }
  // Fallback: use cpText but limit size (cpText might be base64 or parsed text)
  const text = cpText.length > 25000 ? cpText.substring(0, 25000) + '\n[Truncated]' : cpText;
  return text;
}

// ─── Config: increase body size limit for file uploads ───
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

// ─── Handler ───

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { section } = req.body;
  if (!section) {
    return res.status(400).json({ error: 'Missing section parameter' });
  }

  const apiConfig = await getApiKey();
  if (!apiConfig) {
    return res.status(500).json({ error: 'API key not configured. Please set it in Company Settings > LLM Credentials.' });
  }

  try {
    const {
      cpText = '',
      fileName = '',
      tgsRefCode = '',
      courseData = null,
      docType = 'ap',
      numTrainingDays = '2',
      assessmentTypes = [],
      courseUrl = '',
      sourceText = '',
      convertType = 'assessment',
      auditDocuments = {},
    } = req.body;

    // Parse file if base64 content is provided with a filename
    let parsedCpText = cpText;
    if (cpText && fileName && fileName.match(/\.(xlsx?|docx?)$/i)) {
      try {
        parsedCpText = await parseFileContent(cpText, fileName);
      } catch (e) {
        console.error('File parsing error:', e);
        parsedCpText = cpText;
      }
    }

    const courseContext = buildCourseContext(courseData, parsedCpText);

    switch (section) {
      case 'extract_course_info': {
        // Single Claude call — extract structured JSON (matching Streamlit's cp_interpreter)
        const jsonPrompt = `You are an expert WSQ course proposal analyst. Extract ALL data from this Course Proposal into a JSON object.

Course Proposal Content (Part 1 - Course Details):
${parsedCpText.substring(0, 15000)}

Course Proposal Content (Part 2 - Methodologies & Assessment):
${parsedCpText.length > 15000 ? parsedCpText.substring(parsedCpText.length - Math.min(20000, parsedCpText.length - 15000)) : ''}

TGS Reference Number: ${tgsRefCode}

Return ONLY a valid JSON object with this EXACT structure (fill ALL fields from the CP):
{
  "Name_of_Organisation": "extracted company name",
  "Course_Title": "extracted course title",
  "TGS_Ref_No": "${tgsRefCode || 'extracted TGS ref'}",
  "TSC_Code": "extracted TSC code",
  "TSC_Title": "extracted TSC title",
  "TSC_Description": "1 short paragraph (2-3 sentences max) course description from the CP",
  "TSC_Sector": "sector name",
  "Proficiency_Level": "Level X",
  "Skills_Framework": "framework name",
  "Total_Training_Hours": "X hours",
  "Total_Assessment_Hours": "X hours",
  "Total_Course_Duration_Hours": "X hours",
  "Course_Overview": "1 short paragraph (2-3 sentences max) from the CP's About This Course section. Keep it concise.",
  "Course_Fee": "amount or N/A",
  "LO_Description": "1-2 sentences summarizing what learners will achieve. Keep concise.",
  "Learning_Units": [
    {
      "LU_Title": "full LU title",
      "LO": "full learning outcome text",
      "Topics": [
        {"Topic_Title": "topic name", "Bullet_Points": ["subtopic 1", "subtopic 2", "subtopic 3"]}
      ],
      "K_numbering_description": [
        {"K_number": "K1", "Description": "knowledge statement text"}
      ],
      "A_numbering_description": [
        {"A_number": "A1", "Description": "ability statement text"}
      ],
      "Assessment_Methods": ["Written Exam", "Case Study"],
      "Instructional_Methods": ["Interactive presentation", "Case studies"]
    }
  ],
  "Assessment_Methods_Details": [
    {
      "Assessment_Method": "full method name",
      "Method_Abbreviation": "WA-SAQ or PP or CS or RP or OQ",
      "Total_Delivery_Hours": "1 hour 10 min",
      "Assessor_to_Candidate_Ratio": ["1:3 to 1:15"],
      "Evidence": ["description of evidence per LO e.g. {'LO': 'ELO1', 'Evidence': 'Practical demonstration of...'}"],
      "Submission": ["Individual", "Open book"],
      "Marking_Process": ["Direct evidence of competency acquisition", "Learn by Doing approach"],
      "Retention_Period": "3 years"
    }
  ]
}

CRITICAL RULES:
- Include ALL Learning Units with ALL their Topics, K statements, and A statements
- IMPORTANT: Count EVERY topic carefully. If a CP has 3 LUs and each LU has 3-5 topics, the total should be 10-15 topics. Do NOT merge or skip topics. Each distinct topic listed in the CP must be a separate entry in the Topics array
- Each Topic MUST have 2-5 Bullet_Points (subtopics)
- For Total_Training_Hours: Sum ALL instructional components (Classroom + Practical/Practicum + E-Learning + Others). Example: If CR=7.5hrs + Practical=6hrs → Total_Training_Hours = "13.5 hours". NEVER use just one component.
- For Total_Assessment_Hours: Use the total assessment hours from the CP summary
- For Total_Course_Duration_Hours: Use the total duration from the CP (e.g., "16 hours")
- For Assessment_Methods_Details: Sum EXACT minutes across all LOs for the same method, then convert to human-readable format
  Example: If WA-SAQ has LO1=30min + LO2=40min = 70min total → "1 hour 10 min"
  Example: If PP has LO1=60min + LO2=50min = 110min total → "1 hour 50 min"
  NEVER round durations. Use exact calculated values like "1 hour 10 min", "1 hour 50 min", NOT "1 hour" or "2 hours"
- Extract the EXACT Assessor_to_Candidate_Ratio from the CP (e.g. "1:3 to 1:15"), do NOT simplify to "1:20"
- For Evidence Gathering Plan: For each assessment method (especially PP), generate Evidence entries per LO describing what practical evidence the learner must demonstrate. Include Submission methods, Marking Process, and Retention Period (usually "3 years")
- For K statements: Map to Written Assessment methods (WA-SAQ). For A statements: Map to Practical methods (PP, CS, RP)
- EVERY Learning Unit MUST have Assessment_Methods listed (use the same methods as in Assessment_Methods_Details)
- Return ONLY valid JSON, no markdown code blocks, no explanation`;

        const jsonResult = await generateWithClaude(jsonPrompt, apiConfig);

        // Parse JSON from response
        let courseDataJson = null;
        const jsonMatch = jsonResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            courseDataJson = JSON.parse(jsonMatch[0]);

            // Post-process: fix assessment durations by extracting exact minutes from parsed CP text
            if (courseDataJson?.Assessment_Methods_Details && parsedCpText) {
              // Find exact durations from CP text (e.g. "70 mins", "110 mins")
              const durationMatches = parsedCpText.match(/(\w[\w\s()\/&]+?)\s*\|\s*[\d:]+\s*to\s*[\d:]+\s*\|\s*(\d+)\s*mins/gi);
              if (durationMatches) {
                for (const match of durationMatches) {
                  const parts = match.split('|').map((s: string) => s.trim());
                  if (parts.length >= 3) {
                    const methodName = parts[0];
                    const mins = parseInt(parts[2]);
                    if (!isNaN(mins)) {
                      const hours = Math.floor(mins / 60);
                      const remainMins = mins % 60;
                      let durStr = '';
                      if (hours > 0 && remainMins > 0) durStr = `${hours} hour${hours > 1 ? 's' : ''} ${remainMins} min`;
                      else if (hours > 0) durStr = `${hours} hour${hours > 1 ? 's' : ''}`;
                      else durStr = `${mins} min`;

                      // Match to Assessment_Methods_Details
                      for (const am of courseDataJson.Assessment_Methods_Details) {
                        if (methodName.toLowerCase().includes('wa') && (am.Method_Abbreviation?.includes('WA') || am.Assessment_Method?.toLowerCase().includes('written'))) {
                          am.Total_Delivery_Hours = durStr;
                        } else if (methodName.toLowerCase().includes('pp') && (am.Method_Abbreviation === 'PP' || am.Assessment_Method?.toLowerCase().includes('practical'))) {
                          am.Total_Delivery_Hours = durStr;
                        } else if (methodName.toLowerCase().includes('cs') && (am.Method_Abbreviation === 'CS' || am.Assessment_Method?.toLowerCase().includes('case'))) {
                          am.Total_Delivery_Hours = durStr;
                        }
                      }
                    }
                  }
                }
              }

              // Also try simpler pattern: "WA(Q&A) – 70 mins" or "PP– 110 mins"
              const simpleMatches = parsedCpText.match(/(?:WA|PP|CS|RP|OQ|OI)[\w()\/&]*[–\-—\s]*(\d+)\s*mins?/gi);
              if (simpleMatches) {
                for (const match of simpleMatches) {
                  const minsMatch = match.match(/(\d+)\s*mins?/i);
                  const typeMatch = match.match(/^(WA|PP|CS|RP|OQ|OI)/i);
                  if (minsMatch && typeMatch) {
                    const mins = parseInt(minsMatch[1]);
                    const type = typeMatch[1].toUpperCase();
                    const hours = Math.floor(mins / 60);
                    const remainMins = mins % 60;
                    let durStr = '';
                    if (hours > 0 && remainMins > 0) durStr = `${hours} hour${hours > 1 ? 's' : ''} ${remainMins} min`;
                    else if (hours > 0) durStr = `${hours} hour${hours > 1 ? 's' : ''}`;
                    else durStr = `${mins} min`;

                    for (const am of courseDataJson.Assessment_Methods_Details) {
                      const abbr = am.Method_Abbreviation || '';
                      if ((type === 'WA' && abbr.includes('WA')) ||
                          (type === 'PP' && abbr === 'PP') ||
                          (type === 'CS' && abbr === 'CS') ||
                          (type === 'RP' && abbr === 'RP') ||
                          (type === 'OQ' && abbr === 'OQ') ||
                          (type === 'OI' && abbr === 'OI')) {
                        am.Total_Delivery_Hours = durStr;
                      }
                    }
                  }
                }
              }

              // Fix ratios — extract from CP text patterns like "1:3 to 1:15 for WA(Q&A)"
              const ratioPatterns = parsedCpText.match(/(?:assessor|ratio)[^|]*?(\d+:\d+\s*to\s*\d+:\s*\d+)\s*(?:for\s*)?(WA|PP|CS|RP|OQ|OI)?/gi);
              if (ratioPatterns) {
                for (const rp of ratioPatterns) {
                  const ratioVal = rp.match(/(\d+:\d+\s*to\s*\d+:\s*\d+)/i);
                  const methodType = rp.match(/(?:for\s*)(WA|PP|CS|RP|OQ|OI)/i);
                  if (ratioVal) {
                    const ratio = ratioVal[1].replace(/\s+/g, '');
                    for (const am of courseDataJson.Assessment_Methods_Details) {
                      const abbr = (am.Method_Abbreviation || '').toUpperCase();
                      if (methodType) {
                        const mt = methodType[1].toUpperCase();
                        if (abbr.includes(mt)) am.Assessor_to_Candidate_Ratio = [ratio];
                      } else {
                        // Apply to all if no specific method mentioned
                        if (!am.Assessor_to_Candidate_Ratio?.length || am.Assessor_to_Candidate_Ratio[0]?.includes('N/A') || am.Assessor_to_Candidate_Ratio[0] === '1:20') {
                          am.Assessor_to_Candidate_Ratio = [ratio];
                        }
                      }
                    }
                  }
                }
              }

              // Also check the assessment table: "| WA(Q&A) ... | 1:3 to 1:15 | 70 mins |"
              const tableRatios = parsedCpText.match(/\|\s*(WA|PP|CS|RP|OQ)[\w()\/&\s]*\|[^|]*?(\d+:\d+\s*to\s*\d+:\s*\d+)/gi);
              if (tableRatios) {
                for (const tr of tableRatios) {
                  const methodMatch = tr.match(/\|\s*(WA|PP|CS|RP|OQ)/i);
                  const ratioVal = tr.match(/(\d+:\d+\s*to\s*\d+:\s*\d+)/i);
                  if (methodMatch && ratioVal) {
                    const mt = methodMatch[1].toUpperCase();
                    const ratio = ratioVal[1].replace(/\s+/g, '');
                    for (const am of courseDataJson.Assessment_Methods_Details) {
                      if ((am.Method_Abbreviation || '').toUpperCase().includes(mt)) {
                        am.Assessor_to_Candidate_Ratio = [ratio];
                      }
                    }
                  }
                }
              }

              // Fix hours from CP Breakdown section (exact values from source)
              // Total Duration
              const totalDurMatch = parsedCpText.match(/Total\s*Duration\s*\|\s*([\d.]+)\s*hours?/i);
              if (totalDurMatch) {
                courseDataJson.Total_Course_Duration_Hours = `${totalDurMatch[1]} hours`;
              }

              // Training Hours = Classroom + Practical + E-Learning + Others (excluding Assessment)
              const classroomMatch = parsedCpText.match(/Classroom\s*\w*\s*\|\s*([\d.]+)\s*hours?/i);
              const practicalMatch = parsedCpText.match(/Practical\s*.*?Practicum\w*\s*\|\s*([\d.]+)\s*hours?/i);
              const eLearningMatch = parsedCpText.match(/E-Learning\s*\|\s*([\d.]+)\s*hours?/i);
              let totalTraining = 0;
              if (classroomMatch) totalTraining += parseFloat(classroomMatch[1]);
              if (practicalMatch) totalTraining += parseFloat(practicalMatch[1]);
              if (eLearningMatch) totalTraining += parseFloat(eLearningMatch[1]);
              if (totalTraining > 0) {
                courseDataJson.Total_Training_Hours = `${totalTraining} hours`;
              }

              // Assessment Hours
              const assessMatch = parsedCpText.match(/\|\s*Assessment\s*\|\s*([\d.]+)\s*hours?/i);
              if (assessMatch) {
                courseDataJson.Total_Assessment_Hours = `${assessMatch[1]} hours`;
              }

              // Also try "Total - X hrs" format
              if (!assessMatch) {
                const assessTotalMatch = parsedCpText.match(/Total\s*[-–]\s*([\d.]+)\s*hrs?/i);
                if (assessTotalMatch) {
                  courseDataJson.Total_Assessment_Hours = `${assessTotalMatch[1]} hours`;
                }
              }
            }
          } catch (e) {
            console.error('JSON parse error:', e);
          }
        }

        // Generate display text from JSON or use raw result
        let displayResult = jsonResult;
        if (courseDataJson) {
          // Build formatted display from structured JSON
          const cd = courseDataJson;
          const lines = [
            `## 1. Course Overview`,
            `| Field | Details |`,
            `|---|---|`,
            `| Registered Training Provider | ${cd.Name_of_Organisation || ''} |`,
            `| Course Title | ${cd.Course_Title || ''} |`,
            `| Course Ref Code (TGS) | ${cd.TGS_Ref_No || ''} |`,
            `| TSC Code | ${cd.TSC_Code || ''} |`,
            `| TSC Title | ${cd.TSC_Title || ''} |`,
            `| Skills Framework | ${cd.Skills_Framework || ''} |`,
            `| Sector | ${cd.TSC_Sector || ''} |`,
            `| Proficiency Level | ${cd.Proficiency_Level || ''} |`,
            `| Total Course Duration | ${cd.Total_Course_Duration_Hours || ''} |`,
            `| Total Training Hours | ${cd.Total_Training_Hours || ''} |`,
            `| Total Assessment Hours | ${cd.Total_Assessment_Hours || ''} |`,
            `| Course Fee | ${cd.Course_Fee || 'N/A'} |`,
            ``,
            `## 2. What This Course Is About`,
            cd.TSC_Description || cd.Course_Overview || '',
            ``,
            `## 3. What You'll Learn`,
          ];
          for (const lu of cd.Learning_Units || []) {
            lines.push(`- ${lu.LO || lu.LU_Title}`);
          }
          lines.push('', `## 4. Topics`);
          for (const lu of cd.Learning_Units || []) {
            lines.push(`### ${lu.LU_Title}`);
            for (const t of lu.Topics || []) {
              lines.push(`**${t.Topic_Title}**`);
              for (const bp of t.Bullet_Points || []) {
                lines.push(`- ${bp}`);
              }
            }
            if (lu.K_numbering_description?.length) {
              lines.push('**Knowledge Statements:**');
              for (const k of lu.K_numbering_description) lines.push(`- **${k.K_number}**: ${k.Description}`);
            }
            if (lu.A_numbering_description?.length) {
              lines.push('**Ability Statements:**');
              for (const a of lu.A_numbering_description) lines.push(`- **${a.A_number}**: ${a.Description}`);
            }
          }
          lines.push('', `## 6. Instructional Methods & Duration`);
          lines.push(`| Learning Unit | Instructional Methods |`, `|---|---|`);
          for (const lu of cd.Learning_Units || []) {
            lines.push(`| ${lu.LU_Title} | ${(lu.Instructional_Methods || []).join(', ')} |`);
          }
          lines.push('', `## 7. Assessment Methods & Duration`);
          lines.push(`| Assessment Method | Abbreviation | Duration | Assessor:Candidate Ratio |`, `|---|---|---|---|`);
          for (const am of cd.Assessment_Methods_Details || []) {
            lines.push(`| ${am.Assessment_Method} | ${am.Method_Abbreviation} | ${am.Total_Delivery_Hours} | ${(am.Assessor_to_Candidate_Ratio || []).join(', ')} |`);
          }
          displayResult = lines.join('\n');
        }

        return res.status(200).json({ success: true, result: displayResult, courseData: courseDataJson, parsedCpText: parsedCpText });
      }

      case 'generate_ap_fg_lg': {
        const templateMap: Record<string, string> = {
          ap: GENERATE_AP_PROMPT,
          fg: GENERATE_FG_PROMPT,
          lg: GENERATE_LG_PROMPT,
        };
        const template = templateMap[docType];
        if (!template) return res.status(400).json({ error: `Unknown document type: ${docType}` });
        // Limit context to 15K chars to stay within single-turn limit
        const truncatedContext = courseContext.length > 15000 ? courseContext.substring(0, 15000) + '\n[Truncated]' : courseContext;
        const prompt = buildPrompt(template, { course_context: truncatedContext });
        console.log(`[CW] AP/FG/LG prompt size: ${prompt.length} chars for ${docType}`);
        const result = await generateWithClaude(prompt, apiConfig);
        return res.status(200).json({ success: true, result });
      }

      case 'generate_lesson_plan': {
        // Build a focused context for LP with key fields
        let lpContext = courseContext;
        if (!courseData && parsedCpText) {
          // Extract key fields from the extracted result text for LP generation
          lpContext = `The following is the extracted course information. Use it to generate the lesson plan.

${parsedCpText.substring(0, 15000)}

IMPORTANT: Find the Training Hours, Assessment Hours, Learning Units, and Assessment Methods from the text above and use them for the lesson plan.`;
        }
        const prompt = buildPrompt(GENERATE_LESSON_PLAN_PROMPT, {
          course_context: lpContext,
          num_training_days: String(numTrainingDays),
        });
        const result = await generateWithClaude(prompt, apiConfig);
        return res.status(200).json({ success: true, result });
      }

      case 'generate_assessment_all': {
        // Auto-generates JSON structured questions for all assessment types in CP
        const amDetails = (courseData?.Assessment_Methods_Details || []) as any[];
        if (amDetails.length === 0) {
          return res.status(400).json({ error: 'No assessment methods found.' });
        }

        // Build list of detected types
        const detectedTypes: Array<{ code: string; name: string; duration: string }> = [];
        for (const am of amDetails) {
          const abbr = am.Method_Abbreviation || '';
          const name = am.Assessment_Method || '';
          const duration = am.Total_Delivery_Hours || '';
          const displayCode = abbr === 'WA-SAQ' ? 'WA (SAQ)' : (abbr || name);
          detectedTypes.push({ code: abbr || name, name: displayCode, duration });
        }

        const jsonAssessPrompt = `You are an expert WSQ assessment question writer.

Generate assessment questions for the following course and assessment types.

Course Data:
${courseContext.substring(0, 15000)}

Assessment Types to Generate:
${detectedTypes.map(t => `- ${t.name} (${t.code}): ${t.duration}`).join('\n')}

For EACH assessment type, generate 3-5 questions with:
- Realistic scenario (2-3 sentences)
- Clear question statement
- Map to specific K or A statements from the CP
- Detailed answer bullets (3-5 points)

Return ONLY valid JSON with this exact structure:
{
  "course_title": "extracted course title",
  "assessments": [
    {
      "type": "WA (SAQ) or PP or CS etc",
      "code": "WA-SAQ or PP or CS etc",
      "duration": "1 hr 10 min",
      "questions": [
        {
          "scenario": "realistic 2-3 sentence scenario",
          "question_statement": "clear question",
          "knowledge_id": "K1 (for Written types)",
          "ability_id": ["A1", "A2"] (for Practical types),
          "answer": ["bullet point 1", "bullet point 2", "bullet point 3"]
        }
      ]
    }
  ]
}

CRITICAL: Return ONLY the JSON, no markdown blocks, no explanation.`;

        const jsonResult = await generateWithClaude(jsonAssessPrompt, apiConfig);
        console.log('[AssessmentAI] Raw Claude response length:', jsonResult.length);
        console.log('[AssessmentAI] First 500 chars:', jsonResult.substring(0, 500));

        const jsonMatch = jsonResult.match(/\{[\s\S]*\}/);
        let parsed: any = { course_title: '', assessments: [] };
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
            console.log('[AssessmentAI] Parsed', parsed.assessments?.length || 0, 'assessments');
          } catch (e: any) {
            console.error('Assessment JSON parse error:', e.message);
          }
        } else {
          console.error('[AssessmentAI] No JSON found in response');
        }
        return res.status(200).json({
          success: true,
          course_title: parsed.course_title || courseData?.Course_Title || '',
          assessments: parsed.assessments || [],
          rawResponse: jsonResult.substring(0, 2000),  // for debugging
        });
      }

      case 'generate_assessment': {
        const types = assessmentTypes as string[];
        if (types.length === 0) {
          return res.status(400).json({ error: 'No assessment types selected.' });
        }
        const typeLabels: Record<string, string> = {
          saq: 'Short Answer Questions (SAQ)',
          pp: 'Practical Performance (PP)',
          cs: 'Case Study (CS)',
          prj: 'Project (PRJ)',
          asgn: 'Assignment (ASGN)',
          oi: 'Oral Interview (OI)',
          dem: 'Demonstration (DEM)',
          rp: 'Role Play (RP)',
          oq: 'Oral Questioning (OQ)',
        };
        const results: Record<string, string> = {};
        for (const type of types) {
          const prompt = buildPrompt(GENERATE_ASSESSMENT_PROMPT, {
            course_context: courseContext,
            assessment_type: typeLabels[type] || type,
          });
          results[type] = await generateWithClaude(prompt, apiConfig);
        }
        return res.status(200).json({ success: true, results });
      }

      case 'generate_slides': {
        const prompt = buildPrompt(GENERATE_SLIDES_PROMPT, { course_context: courseContext });
        const result = await generateWithClaude(prompt, apiConfig);
        return res.status(200).json({ success: true, result });
      }

      case 'generate_brochure': {
        const prompt = buildPrompt(GENERATE_BROCHURE_PROMPT, {
          course_context: courseContext,
          course_url: courseUrl,
        });
        const result = await generateWithClaude(prompt, apiConfig);
        return res.status(200).json({ success: true, result });
      }

      case 'convert_documents': {
        const convertTemplates: Record<string, string> = {
          assessment: CONVERT_ASSESSMENT_PROMPT,
          courseware: CONVERT_COURSEWARE_PROMPT,
          lesson_plan: CONVERT_LESSON_PLAN_PROMPT,
        };
        const template = convertTemplates[convertType];
        if (!template) return res.status(400).json({ error: `Unknown convert type: ${convertType}` });
        const prompt = buildPrompt(template, { source_text: sourceText });
        const result = await generateWithClaude(prompt, apiConfig);
        return res.status(200).json({ success: true, result });
      }

      case 'courseware_audit': {
        const docs = auditDocuments as Record<string, string>;
        const cpContent = docs.cp || '';
        if (!cpContent) {
          return res.status(400).json({ error: 'Course Proposal (CP) content is required for audit.' });
        }
        const additionalDocs = Object.entries(docs)
          .filter(([key, val]) => key !== 'cp' && val.trim())
          .map(([key, val]) => `${key.toUpperCase()} Document:\n${val}`)
          .join('\n\n---\n\n');
        const prompt = buildPrompt(COURSEWARE_AUDIT_PROMPT, {
          cp_text: cpContent,
          additional_documents: additionalDocs,
        });
        const result = await generateWithClaude(prompt, apiConfig);
        return res.status(200).json({ success: true, result });
      }

      default:
        return res.status(400).json({ error: `Unknown section: ${section}` });
    }
  } catch (error: any) {
    console.error('Courseware generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate courseware content' });
  }
}
