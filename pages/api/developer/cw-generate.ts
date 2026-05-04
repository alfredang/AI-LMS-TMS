import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@anthropic-ai/claude-agent-sdk';
import pool from '../../../lib/db';
import { buildClaudeEnv } from '../../../lib/anthropic-auth';
import { parseCpFile } from '../../../lib/cp-parser';

// ─── File Parsing (pure TS, matches Streamlit's parse_cp_document behaviour) ───

async function parseFileContent(base64Data: string, fileName: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  return parseCpFile(buffer, fileName);
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

async function getApiKey(): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT key_value FROM training_provider_api
       WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
       AND key_name = 'ANTHROPIC_API_KEY'`
    );
    if (result.rows.length > 0 && result.rows[0].key_value) {
      return result.rows[0].key_value;
    }
  } catch (e) {
    console.error('Failed to fetch API key from DB:', e);
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

async function generateWithClaude(
  prompt: string,
  apiKey: string,
  maxTurns: number = 5,
  model?: string,
): Promise<string> {
  let resultText = '';

  const options: Record<string, unknown> = {
    env: buildClaudeEnv(apiKey),
    allowedTools: [],
    maxTurns,
  };
  if (model) options.model = model;

  for await (const message of query({
    prompt,
    options: options as any,
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

  const apiKey = await getApiKey();
  if (!apiKey) {
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
        // Single Claude call — extract structured JSON (matching Streamlit's cp_interpreter).
        // CP-text packing: previous version sent first 15K chars + last 20K chars,
        // which left a gap in the middle for moderately-sized CPs (~40–60K chars)
        // and intermittently dropped Skills Framework / Sector / Proficiency Level
        // because those often sit in the gap. Strategy now:
        //   - CPs ≤ 120K chars (~30K tokens): send the WHOLE document — fits
        //     comfortably in Claude's context and guarantees no dropped fields.
        //   - Bigger CPs: send first 60K + middle 30K + last 40K, so even
        //     long documents have the metadata band covered.
        const cpTextForPrompt = (() => {
          const t = parsedCpText;
          if (t.length <= 120000) return t;
          const head = t.substring(0, 60000);
          const tailStart = t.length - 40000;
          const middleStart = Math.floor((60000 + tailStart) / 2) - 15000;
          const middle = t.substring(middleStart, middleStart + 30000);
          const tail = t.substring(tailStart);
          return `${head}\n\n[... middle band ...]\n\n${middle}\n\n[... continuing ...]\n\n${tail}`;
        })();

        const jsonPrompt = `You are an expert WSQ course proposal analyst. Extract ALL data from this Course Proposal into a JSON object.

Course Proposal Content:
${cpTextForPrompt}

TGS Reference Number: ${tgsRefCode}

Return ONLY a valid JSON object with this EXACT structure (fill ALL fields from the CP):
{
  "Name_of_Organisation": "EXACT company name as written in the CP — preserve the original capitalisation (e.g. 'Tertiary Infotech Academy Pte Ltd', not 'TERTIARY INFOTECH PTE. LTD.'). Do NOT uppercase, abbreviate, or paraphrase.",
  "Course_Title": "EXACT course title as written in the CP. Preserve case and wording verbatim.",
  "TGS_Ref_No": "${tgsRefCode || 'extracted TGS ref'}",
  "TSC_Code": "extracted TSC code (e.g. 'ICT-BAS-0055-1.1') — ALWAYS PRESENT in the CP. Never return null.",
  "TSC_Title": "EXACT TSC title text from the CP — verbatim, do not paraphrase. ALWAYS PRESENT in the CP. Never return null.",
  "TSC_Description": "EXACT TSC description text from the CP. Copy the wording verbatim — do NOT generate, summarise, or invent. If the CP TSC Description cell says 'Basic level competency in responsible AI practices', output exactly that.",
  "TSC_Sector": "EXACT sector name from the CP (e.g. 'Infocomm Technology', 'Information and Communications Technology'). ALWAYS PRESENT in WSQ CPs (Sector / TSC Sector / TSC Category column). If you don't find it explicitly, infer from the TSC Code prefix (e.g. ICT- → 'Information and Communications Technology'). NEVER return null/empty for this field.",
  "Proficiency_Level": "Level X (verbatim from CP). ALWAYS PRESENT in WSQ CPs (Proficiency Level / TSC Proficiency Level column). Look in the TSC details / Skills Framework section. NEVER return null/empty.",
  "Skills_Framework": "EXACT skills-framework name as written in the CP — preserve the full wording (e.g. 'Skills Framework for Infocomm Technology', 'Skills Framework for Information and Communications Technology'). ALWAYS PRESENT in WSQ CPs (Skills Framework / SFw column). If the CP only writes 'ICT Skills Framework', expand the prefix from the TSC Code (ICT- → Information and Communications Technology) and output 'Skills Framework for Information and Communications Technology'. NEVER return null/empty.",
  "Total_Training_Hours": "X hrs (verbatim from the CP's Total Training Hours field)",
  "Total_Assessment_Hours": "X hrs (verbatim from the CP)",
  "Total_Course_Duration_Hours": "X hrs (verbatim from the CP)",
  "Course_Overview": "VERBATIM 'About This Course' paragraph from the CP — do not summarise or rewrite. Trim only leading/trailing whitespace.",
  "Course_Fee": "amount or N/A",
  "LO_Description": "EXACT learning outcome description text from the CP — verbatim.",
  "Learning_Units": [
    {
      "LU_Title": "<plain LU title text only — DO NOT include any 'LU1:' / 'LU2:' / 'LUx:' prefix. Output just the title (e.g. 'Ethical Principles of Generative AI'). The downstream renderers prepend the LU number themselves.>",
      "LO": "ELO1: <EXACT learning outcome text from the CP's 'Learning Outcome' column for this LU — preserve VERBATIM, do NOT paraphrase, summarise, rephrase, or invent. If the CP says 'Apply ethical judgement to evaluate generative AI outputs and support responsible implementation decisions.', output exactly that. Include the 'ELOx: ' / 'LOx: ' prefix exactly as the CP labels it.>",
      "Topics": [
        {
          "Topic_Title": "<EXACT topic text as it appears in the CP's Topics column — preserve verbatim wording, do NOT rephrase, summarise, or shorten. DO NOT prepend 'T1:' / 'T2:' / 'Tx:' — the renderer adds the numbering when needed. Output just the title text.>",
          "Bullet_Points": ["<short topic bullet 1 from the CP>", "<short topic bullet 2>", "<short topic bullet 3>"]
        }
      ],
      "K_numbering_description": [
        {"K_number": "K1", "Description": "<plain knowledge statement text WITHOUT any trailing TSC reference code like (ICT-BAS-0055-1.1)>"}
      ],
      "A_numbering_description": [
        {"A_number": "A1", "Description": "<plain ability statement text WITHOUT any trailing TSC reference code like (ICT-BAS-0055-1.1)>"}
      ],
      "Assessment_Methods": ["Written Assessment - Short Answer Questions", "Case Study"],
      "Instructional_Methods": ["Interactive presentation", "Case studies"]
    }
  ],
  "Assessment_Methods_Details": [
    {
      "Assessment_Method": "<EXACT method name as written in the CP — preserve verbatim including 'Others:' prefix when the CP uses it (e.g. 'Written Exam', 'Others: Case Study', 'Practical Performance'). Do NOT standardise or rewrite.>",
      "Method_Abbreviation": "<EXACT abbreviation as the CP uses (e.g. 'WE' for Written Exam, 'CS' for Case Study, 'PP' for Practical Performance). Do NOT remap (e.g. do NOT change 'WE' to 'WA-SAQ').>",
      "Total_Delivery_Hours": "1 hr 10 min",
      "Assessor_to_Candidate_Ratio": ["<single ratio number e.g. '1:20' — strip any '(Min)' / '(Max)' annotations and pick the maximum value when the CP gives a range>"],
      "Evidence": ["description of evidence per LO e.g. {'LO': 'ELO1', 'Evidence': 'Practical demonstration of...'}"],
      "Submission": ["Individual", "Open book"],
      "Marking_Process": ["Direct evidence of competency acquisition", "Learn by Doing approach"],
      "Retention_Period": "3 years"
    }
  ]
}

CRITICAL RULES — READ CAREFULLY (these mirror the Streamlit WSQ extractor):

TOPICS vs KNOWLEDGE/ABILITY — MOST IMPORTANT:
- Topics in a WSQ CP appear in the CP's "Topics" column. Each topic is a row of text the CP author has written verbatim (e.g. "Ethical considerations and potential risks of generative AI interaction", "Apply ethical principles in decision-making related to AI", "Data anonymisation and de-identification techniques").
- K statements are specialised KNOWLEDGE items (e.g. "K1: Programming and coding languages, logics and styles").
- A statements are specialised ABILITY items (e.g. "A1: Analyse and translate business requirements of software into multiple functions").
- DO NOT copy K statement descriptions OR A statement descriptions into Topic_Title. Those belong ONLY in K_numbering_description / A_numbering_description.
- **Topic_Title MUST be the EXACT topic text from the CP — preserve the original wording verbatim, including length. DO NOT shorten, summarise, paraphrase, or invent a "pedagogical theme" name. If the CP says "Apply ethical principles in decision-making related to AI", output that EXACT string. Long topic titles are fine — keep them long.**
- Only fall back to inventing a short label if the CP's Topics cell is genuinely empty or only contains K/A bullets with no separate topic text — and even then, prefer the bullet text over a made-up name.
- Each LU should have as many Topics as the CP lists (do not pad to 2-5 if the CP has fewer or more).
- **NEVER produce duplicate topics in the same LU.** Each topic must appear EXACTLY ONCE — do not output both a shortened pedagogical name AND the full CP text for the same topic. If you're tempted to add a "summary" version alongside the verbatim CP text, drop the summary and keep ONLY the verbatim version. Two topics that share the same subject matter (even if one is shorter) are considered duplicates.
- **Bullet_Points: when the CP has explicit sub-bullets under a topic, copy them verbatim.** When it doesn't (most CPs only carry a topic line), generate **2-4 short pedagogical sub-points (5-10 words each)** that elaborate on what that topic covers — these become the facilitator's bullet-list under each topic in the FG / LG. Do NOT exceed 4 bullets, do NOT write full sentences, and do NOT restate the topic title as a bullet.
  - Example (GOOD) for topic "Ethical considerations and potential risks of generative AI interaction":
      ["Understanding ethical challenges in AI interaction", "Identifying potential risks and consequences", "Evaluating AI outputs for ethical compliance"]
  - Example (BAD — restating the topic):
      ["Ethical considerations and potential risks of generative AI interaction"]
- Example (GOOD — preserves exact CP wording):
    { "Topic_Title": "Apply ethical principles in decision-making related to AI",
      "Bullet_Points": [] }
- Example (BAD — do NOT shorten):
    { "Topic_Title": "Ethical AI Decision-Making",
      "Bullet_Points": [] }
- Example (BAD — do NOT use K/A statement as topic):
    { "Topic_Title": "K1: Programming and coding languages, logics and styles",
      "Bullet_Points": ["Explanation of K1 ...","Elaboration of K1 ..."] }

PREFIXES:
- LU_Title: PLAIN title text only — DO NOT include "LU1:" / "LU2:" / "LUx:" prefix. If the CP source already says "LU1: Introduction to Python Programming", strip the prefix and output just "Introduction to Python Programming". The downstream renderers (LP, FG, AP, LG) add the LU numbering themselves.
- Topic_Title: PLAIN topic text only — DO NOT prepend "T1:" / "T2:" / "Tx:". Strip the prefix if the CP shows it.
- LO: must contain the EXACT learning outcome sentence from the CP's "Learning Outcome" column for that LU, prefixed with the label the CP uses (e.g. "ELO1: Apply ethical judgement to evaluate generative AI outputs and support responsible implementation decisions."). DO NOT swap topic titles, K/A statements, or invented summary text into this field. If the CP shows the LO is one sentence, output that one sentence verbatim — not a list of topics.

TSC REFERENCE CODE STRIPPING:
- If a K or A statement in the CP reads "Ethical principles in AI (ICT-BAS-0055-1.1)", output the Description as just "Ethical principles in AI". Strip any trailing "(XXX-XXX-NNNN-N.N)" style code.

ASSESSMENT METHODS — preserve CP wording verbatim (mirror Streamlit):
- Assessment_Method MUST be the EXACT method name as the CP writes it. PRESERVE the "Others:" prefix when the CP uses it (e.g. output "Others: Case Study", NOT "Case Study"). PRESERVE the CP's choice of "Written Exam" vs "Written Assessment - Short Answer Questions" — do NOT rewrite one as the other.
- Method_Abbreviation MUST be the EXACT abbreviation the CP uses for that method. If the CP writes "WE" for Written Exam, output "WE" — do NOT remap it to "WA-SAQ". If the CP writes "PP", output "PP". Only fall back to a sensible abbreviation if the CP doesn't supply one.
- **Extract every assessment method the CP LISTS as a method — but ONLY from genuine method-listing places.** Valid sources are: the assessment summary table / "Assessment Methods" table, the per-LO assessment-method columns in the Instructional Design or Sequencing table, the "Mode of Assessment" column, the assessment-duration / fee breakdown rows, and the Annex A / Annex B / "3 - Summary" sheet. **DO NOT** invent methods from free-text descriptions, instructional notes, or assessor-tool mentions. If a method name only appears inside the description of another method (e.g. "Oral Clarification" mentioned as a clarifying tool used WITHIN a Written Assessment, not as a standalone assessment), do NOT add it as a separate method. The number of distinct methods in the output should equal the number of distinct rows in the assessment table.
- The same applies to each LU's Assessment_Methods array: include the methods the CP's Mode-of-Assessment column actually assigns to that LU.
- Common method names that ARE legitimate methods when listed in the assessment table: Written Assessment (Short-Answer Questions / Q&A), Written Exam, Practical Performance, Practical Exam, Case Study, Oral Questioning, Oral Interview, Role Play, Demonstration, Project, Assignment, Online Test. "Oral Clarification" is usually NOT a standalone assessment method — it is most often a clarification technique used during another assessment. Only include it if the CP explicitly lists it in the Assessment Method column / table (not the description text).
- Assessor_to_Candidate_Ratio: extract the numeric ratio only (e.g. "1:20"). STRIP any "(Min)" / "(Max)" annotations. If the CP gives a range like "1:3 (Min) - 1:20 (Max)", output the MAXIMUM value alone: ["1:20"].

COUNTS & COVERAGE:
- Include ALL Learning Units with ALL their Topics, K statements, and A statements. If a CP has 3 LUs and each has 3-5 topics, total should be 10-15 topics.
- EVERY Learning Unit MUST have Assessment_Methods listed (same methods as in Assessment_Methods_Details).
- If the same K or A statement (same number and description) appears multiple times within the same LU, keep only ONE instance. If the same K or A appears in different LUs, keep both.

NUMBERS & DURATIONS:
- Time fields include units ("1 hr", "40 hrs", "2 hrs").
- Total_Training_Hours = SUM of all instructional components (Classroom + Practical/Practicum + E-Learning + Others). Example: CR=7.5hrs + Practical=6hrs → "13.5 hrs". NEVER use just one component.
- Total_Assessment_Hours from the CP assessment summary.
- Total_Course_Duration_Hours from the CP duration total.
- Assessment_Methods_Details Total_Delivery_Hours: PREFER the value the CP explicitly states in its "Total Delivery Hours" / assessment-summary row for that method (e.g. "WA-SAQ – 1 hr", "PP – 1 hr"). That is the authoritative figure — use it verbatim, even if per-LO breakdown rows show smaller values like "(PP) – 15 mins" (those are per-LO/per-section slices that shouldn't be reused as the total). ONLY when the CP has no summary row should you sum the per-LO minutes yourself, in which case format as "1 hr 10 min" / "1 hr 50 min" with no rounding.
- Extract EXACT Assessor_to_Candidate_Ratio from the CP (e.g. "1:3 (Min)", "1:5 (Max)"), do NOT simplify to "1:20".

NORMALISATION:
- Replace en/em dashes (–, —) with hyphens (-).
- Convert curly quotes to straight quotes.
- Replace other non-ASCII characters with ASCII equivalents where sensible.

EVIDENCE:
- For each assessment method (especially PP and CS), provide Evidence entries per LO describing what practical evidence the learner must demonstrate. Include Submission methods, Marking Process, and Retention Period (usually "3 years").
- For PP/CS, Evidence may be a list of {"LO": "ELO1", "Evidence": "..."} dicts.

Return ONLY valid JSON, no markdown code blocks, no explanation.`;

        // CP extraction uses Sonnet 4.6 — matches Streamlit's reliable
        // extraction model. Earlier Haiku 4.5 was tried for speed but it
        // missed Total_Course_Duration_Hours / Total_Training_Hours often
        // enough that downstream slide generation defaulted to 8h → 116
        // slides for what should have been 250-slide 4-day courses.
        // Sonnet adds ~30s but reliably populates every required field.
        // Streamlit reference: courseware_agents/cp_interpreter.py uses
        // claude-sonnet-4-20250514 for the same task.
        const jsonResult = await generateWithClaude(jsonPrompt, apiKey, 1, 'claude-sonnet-4-6');

        // Parse JSON from response
        let courseDataJson = null;
        const jsonMatch = jsonResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            courseDataJson = JSON.parse(jsonMatch[0]);

            // Defensive fallback: if Claude dropped Skills_Framework /
            // TSC_Sector / Proficiency_Level (the three fields most often
            // returned as null/empty), derive them from the TSC Code prefix
            // and a regex sweep over the parsed CP text. Guarantees the
            // Course Overview table never shows N/A for these.
            const SECTOR_MAP: Record<string, string> = {
              ICT: 'Information and Communications Technology',
              FIN: 'Financial Services',
              HR:  'Human Resource',
              MFG: 'Manufacturing',
              BIZ: 'Business Management',
              ACC: 'Accountancy',
              LOG: 'Logistics',
              SEC: 'Security',
              CI:  'Creative Industries',
              EHS: 'Environmental Services',
              BIN: 'Business Innovation',
              RET: 'Retail',
              MED: 'Media',
              HCE: 'Healthcare',
              ECC: 'Early Childhood Care and Education',
              TAE: 'Training and Adult Education',
              WPH: 'Workplace Safety and Health',
            };
            const isEmpty = (v: any) => !v || (typeof v === 'string' && (!v.trim() || /^n\s*\/?\s*a$/i.test(v.trim())));
            const tscCode = String(courseDataJson?.TSC_Code || '').trim();
            const tscPrefix = tscCode.split('-')[0]?.toUpperCase();
            const fallbackSector = tscPrefix && SECTOR_MAP[tscPrefix] ? SECTOR_MAP[tscPrefix] : '';
            if (isEmpty(courseDataJson.TSC_Sector) && fallbackSector) {
              courseDataJson.TSC_Sector = fallbackSector;
            }
            if (isEmpty(courseDataJson.Skills_Framework) && fallbackSector) {
              courseDataJson.Skills_Framework = `Skills Framework for ${fallbackSector}`;
            }
            if (isEmpty(courseDataJson.Proficiency_Level)) {
              // Try to grep "Level X" / "Proficiency Level: X" from CP text.
              const m1 = parsedCpText.match(/Proficiency\s*Level[:\s|]+(?:Level\s+)?(\d+)/i);
              const m2 = !m1 ? parsedCpText.match(/\bLevel\s+(\d+)\b/) : null;
              const lvl = (m1 || m2)?.[1];
              if (lvl) courseDataJson.Proficiency_Level = `Level ${lvl}`;
            }

            // Post-process: try to pin Total_Delivery_Hours to the CP's
            // explicit "Total Delivery Hours" SUMMARY row when present. The
            // CP usually lists per-LO/per-section breakdowns ("(PP) – 15
            // mins", "WA(Q&A) – 70 mins") AND a summary row ("WA-SAQ – 1 hr",
            // "PP – 1 hr", "Total – 2 hr"). The summary is authoritative.
            // We previously regex-walked per-LO patterns and overwrote
            // Claude's output with the smaller mins value — that produced
            // "PP: 15 min" when the CP clearly states "PP – 1 hr" in the
            // summary. Now we only override when the regex finds an HOURS-
            // formatted summary value.
            if (courseDataJson?.Assessment_Methods_Details && parsedCpText) {
              // Match "WA-SAQ – 1 hr", "PP – 1 hr", "WA(Q&A) - 1 hour 30 min" etc.
              // Always with an `hr`/`hour` unit so we can't pick up per-LO
              // minutes by accident.
              const summaryMatches = parsedCpText.matchAll(
                /(WA[\w()\/&-]*|PP|CS|RP|OQ|OI|DEM|PRJ|ASGN)\s*[–\-—:]\s*(\d+\s*(?:hours?|hrs?)(?:\s*\d+\s*mins?)?)/gi,
              );
              for (const m of summaryMatches) {
                const type = m[1].toUpperCase();
                const value = m[2].trim();
                for (const am of courseDataJson.Assessment_Methods_Details) {
                  const abbr = (am.Method_Abbreviation || '').toUpperCase();
                  const matchesAbbr =
                    (type.startsWith('WA') && abbr.includes('WA')) ||
                    (type === 'PP' && abbr === 'PP') ||
                    (type === 'CS' && abbr === 'CS') ||
                    (type === 'RP' && abbr === 'RP') ||
                    (type === 'OQ' && abbr === 'OQ') ||
                    (type === 'OI' && abbr === 'OI') ||
                    (type === 'DEM' && abbr === 'DEM') ||
                    (type === 'PRJ' && abbr === 'PRJ') ||
                    (type === 'ASGN' && abbr === 'ASGN');
                  if (matchesAbbr) {
                    am.Total_Delivery_Hours = value;
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

              // Fix hours from CP Breakdown section (exact values from source).
              // Handle BOTH the legacy CP format ("Total Duration | 32 hours")
              // AND the new SSG WSQ form (15MAY2025+) which uses
              // "Total Course Duration | 32 hour 0 minutes" / "Total
              // Instructional Duration | 30 hour 0 minutes". Without this
              // duration ends up empty → orchestrator falls back to 8h →
              // deck only gets ~100 slides regardless of real course length.
              const totalDurMatch = parsedCpText.match(
                /Total\s*(?:Course\s*)?Duration\s*\|\s*([\d.]+)\s*(?:hour|hr)/i,
              );
              if (totalDurMatch) {
                const hours = parseFloat(totalDurMatch[1]);
                // New CP often reports "32 hour 0 minutes" — also pick up
                // the trailing minutes if present so we don't lose precision.
                const fullMatch = parsedCpText.match(
                  /Total\s*(?:Course\s*)?Duration\s*\|\s*([\d.]+)\s*(?:hour|hr)s?\s*([\d.]+)?\s*minute?s?/i,
                );
                const minutes = fullMatch && fullMatch[2] ? parseFloat(fullMatch[2]) : 0;
                const totalH = hours + (minutes / 60);
                courseDataJson.Total_Course_Duration_Hours = `${totalH} hours`;
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
              // New-format fallback: "Total Instructional Duration | 30 hour 0 minutes"
              if (!totalTraining) {
                const instMatch = parsedCpText.match(
                  /Total\s*Instructional\s*Duration\s*\|\s*([\d.]+)\s*(?:hour|hr)s?\s*(?:([\d.]+)\s*minute?s?)?/i,
                );
                if (instMatch) {
                  const h = parseFloat(instMatch[1]);
                  const m = instMatch[2] ? parseFloat(instMatch[2]) : 0;
                  courseDataJson.Total_Training_Hours = `${h + m / 60} hours`;
                }
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
        const result = await generateWithClaude(prompt, apiKey);
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
        const result = await generateWithClaude(prompt, apiKey);
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

        const jsonResult = await generateWithClaude(jsonAssessPrompt, apiKey);
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
          results[type] = await generateWithClaude(prompt, apiKey);
        }
        return res.status(200).json({ success: true, results });
      }

      case 'generate_slides': {
        const prompt = buildPrompt(GENERATE_SLIDES_PROMPT, { course_context: courseContext });
        const result = await generateWithClaude(prompt, apiKey);
        return res.status(200).json({ success: true, result });
      }

      case 'generate_brochure': {
        const prompt = buildPrompt(GENERATE_BROCHURE_PROMPT, {
          course_context: courseContext,
          course_url: courseUrl,
        });
        const result = await generateWithClaude(prompt, apiKey);
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
        const result = await generateWithClaude(prompt, apiKey);
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
