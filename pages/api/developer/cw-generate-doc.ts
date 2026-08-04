import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@anthropic-ai/claude-agent-sdk';
import pool from '../../../lib/db';
import { buildClaudeEnv } from '../../../lib/anthropic-auth';
import { parseCpFile } from '../../../lib/cp-parser';
import { fillTemplate, type CwDocType } from '../../../lib/cw-fill-template';
import { generateLessonPlan } from '../../../lib/cw-lesson-plan';
import { generateAssessments } from '../../../lib/cw-assessment';
import {
  generateAssessmentEvidence,
  mergeEvidenceIntoDetails,
  generateCoursewareNarrative,
  mergeNarrativeIntoContext,
} from '../../../lib/cw-evidence-agent';

async function getApiKey(): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT key_value FROM training_provider_api
       WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
       AND key_name = 'ANTHROPIC_API_KEY'`,
    );
    if (result.rows.length > 0 && result.rows[0].key_value) return result.rows[0].key_value;
  } catch (e) {
    console.error('Failed to fetch API key from DB:', e);
  }
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || null;
}

/**
 * Enrich the courseData with Claude-generated content the templates need but
 * the CP doesn't carry: assessment Evidence/Submission/Marking_Process for AP,
 * and Course_Overview / LO_Description / Proficiency_Description for LG/FG.
 *
 * Both calls run in parallel via the same `@anthropic-ai/claude-agent-sdk`
 * pattern as `seo-generate.ts` / `cp-generate.ts` — no Python.
 */
async function enrichContext(
  contextData: any,
  needs: { evidence: boolean; narrative: boolean },
): Promise<any> {
  const apiKey = await getApiKey();
  if (!apiKey) return contextData;

  const amDetails = contextData.Assessment_Methods_Details
    || contextData.assessmentMethodsDetails
    || [];

  const tasks: Promise<any>[] = [];
  tasks.push(
    needs.evidence && amDetails.length
      ? generateAssessmentEvidence(contextData, apiKey).catch((e) => {
          console.error('[cw-generate-doc] evidence agent failed:', e.message);
          return null;
        })
      : Promise.resolve(null),
  );
  tasks.push(
    needs.narrative
      ? generateCoursewareNarrative(contextData, apiKey).catch((e) => {
          console.error('[cw-generate-doc] narrative agent failed:', e.message);
          return null;
        })
      : Promise.resolve(null),
  );

  const [evidence, narrative] = await Promise.all(tasks);

  let out = contextData;
  if (evidence) {
    const merged = mergeEvidenceIntoDetails(amDetails, evidence);
    out = { ...out, Assessment_Methods_Details: merged, assessmentMethodsDetails: merged };
  }
  if (narrative) {
    out = mergeNarrativeIntoContext(out, narrative);
  }
  return out;
}

const NEEDS_EVIDENCE: Record<string, boolean> = { ap: true, asr: true, ap_asr: true, all: true };
const NEEDS_NARRATIVE: Record<string, boolean> = { lg: true, fg: true, ap: true, all: true, ap_asr: true };

async function withEvidence(contextData: any, docType: string = 'all'): Promise<any> {
  return enrichContext(contextData, {
    evidence: !!NEEDS_EVIDENCE[docType],
    narrative: !!NEEDS_NARRATIVE[docType],
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: '50mb',
  },
};

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '').substring(0, 50).trim();
}

function generateDoc(docType: string, courseData: any): { name: string; data: string } {
  console.log(`[CW-DOC] Generating ${docType}, courseData keys:`, courseData ? Object.keys(courseData) : 'NULL');
  console.log(`[CW-DOC] Course Title:`, courseData?.Course_Title || courseData?.courseTitle || 'MISSING');
  console.log(`[CW-DOC] TGS Ref:`, courseData?.TGS_Ref_No || courseData?.tgsRefNo || 'MISSING');
  console.log(`[CW-DOC] Learning Units:`, courseData?.Learning_Units?.length || courseData?.learningUnits?.length || 0);

  const docBuffer = fillTemplate(docType as CwDocType, courseData || {});

  const tgsRef = courseData?.tgsRefNo || courseData?.TGS_Ref_No || 'doc';
  const courseTitle = sanitizeFileName(courseData?.courseTitle || courseData?.Course_Title || 'Course');
  const fileName = `${docType.toUpperCase()}_${tgsRef}_${courseTitle}_v1.docx`;

  return { name: fileName, data: docBuffer.toString('base64') };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { docType, courseData, extractedResult, cpFileBase64, cpFileName } = req.body;

    if (!docType) {
      return res.status(400).json({ error: 'Missing docType' });
    }

    // If raw CP file is provided, parse it to get exact text (pure TS)
    let rawCpText = extractedResult || '';
    if (cpFileBase64 && cpFileName) {
      try {
        rawCpText = await parseCpFile(Buffer.from(cpFileBase64, 'base64'), cpFileName);
      } catch (e: any) {
        console.error('CP parse for LP error:', e.message);
      }
    }

    // Merge courseData with extractedResult as fallback
    const contextData = {
      ...(courseData || {}),
      extractedText: rawCpText,
    };

    const documents: { name: string; data: string }[] = [];

    if (docType === 'ap_asr') {
      const enriched = await withEvidence(contextData, 'ap_asr');
      documents.push(generateDoc('ap', enriched));
      documents.push(generateDoc('asr', enriched));
    } else if (docType === 'all') {
      const enriched = await withEvidence(contextData, 'all');
      documents.push(generateDoc('lg', enriched));
      documents.push(generateDoc('ap', enriched));
      documents.push(generateDoc('asr', enriched));
      documents.push(generateDoc('fg', enriched));
    } else if (docType === 'lp') {
      // Lesson Plan — pure TypeScript port of the Streamlit barrier algorithm.
      const lpContext = {
        ...(contextData || {}),
        // Ensure both camelCase and PascalCase variants are present so the
        // lesson-plan helper finds fields whichever shape the UI uses.
        Course_Title: contextData?.Course_Title || contextData?.courseTitle,
        TGS_Ref_No: contextData?.TGS_Ref_No || contextData?.tgsRefNo,
        Name_of_Organisation: contextData?.Name_of_Organisation || contextData?.organisationName,
        Total_Course_Duration_Hours: contextData?.Total_Course_Duration_Hours || contextData?.totalTrainingHours,
        Total_Training_Hours: contextData?.Total_Training_Hours || contextData?.totalTrainingHours,
        Total_Assessment_Hours: contextData?.Total_Assessment_Hours || contextData?.totalAssessmentHours,
        Learning_Units: contextData?.Learning_Units || contextData?.learningUnits || [],
        Assessment_Methods_Details: contextData?.Assessment_Methods_Details || contextData?.assessmentMethodsDetails || [],
      };

      const { buffer, schedule } = generateLessonPlan(lpContext);
      const tgsRef = contextData?.TGS_Ref_No || contextData?.tgsRefNo || 'doc';
      const title = sanitizeFileName(contextData?.Course_Title || contextData?.courseTitle || 'Course');
      documents.push({
        name: `LP_${tgsRef}_${title}_v1.docx`,
        data: buffer.toString('base64'),
      });
      return res.status(200).json({
        success: true,
        documents,
        schedule: { success: true, schedule },
      });
    } else if (docType === 'assessment') {
      const amDetails = contextData.Assessment_Methods_Details || contextData.assessmentMethodsDetails || [];
      if (amDetails.length === 0) {
        return res.status(400).json({ error: `No assessment methods found in CP. courseData keys: ${Object.keys(contextData).join(', ')}` });
      }
      const apiKey = await getApiKey();
      if (!apiKey) return res.status(500).json({ error: 'Anthropic API key not configured.' });

      // Direct Claude call — avoids a self-fetch (Node 18's fetch sometimes
      // can't resolve `localhost` for same-host API calls).
      const detectedTypes = amDetails.map((am: any) => {
        const abbr = am.Method_Abbreviation || '';
        const name = am.Assessment_Method || '';
        const duration = am.Total_Delivery_Hours || '';
        const displayCode = abbr === 'WA-SAQ' ? 'WA (SAQ)' : (abbr || name);
        return { code: abbr || name, name: displayCode, duration };
      });

      // Slim the per-call context: keep only the fields a question writer
      // actually needs (course title, LU titles, K/A statements). Cuts the
      // prompt from ~15K to ~3-5K so Sonnet streams the JSON back faster.
      const slimContext = {
        Course_Title: contextData.Course_Title || contextData.courseTitle,
        TSC_Title: contextData.TSC_Title,
        Course_Overview: contextData.Course_Overview,
        Learning_Units: (contextData.Learning_Units || contextData.learningUnits || []).map((lu: any) => ({
          LU_Title: lu.LU_Title,
          LO: lu.LO,
          K_numbering_description: lu.K_numbering_description,
          A_numbering_description: lu.A_numbering_description,
        })),
      };
      const slimContextJson = JSON.stringify(slimContext).slice(0, 8000);

      const buildPrompt = (t: { code: string; name: string; duration: string }) => `You are an expert WSQ assessment question writer for Singapore SkillsFuture-accredited courses. You are writing a paper that will sit in front of a Curriculum Lead — formal, neutral, exam-board English, free of any informal or made-up specifics.

Course Data (slim):
${slimContextJson}

Assessment to generate:
- Type: ${t.name}
- Code: ${t.code}
- Duration: ${t.duration}

═══════════════════════════════════════════════════════════════
GOLD STANDARD — produce questions that read EXACTLY like these.
Study the structure, scenario realism, and stem rhythm carefully.
═══════════════════════════════════════════════════════════════

EXAMPLE 1 (PDPA — accountability):
  Scenario: A small tuition centre has experienced a data breach where student records were accidentally shared with an unauthorised party. The PDPC has launched an investigation and the centre's owner is now reviewing the concept of accountability under the PDPA.
  Question: Explain what accountability means under the PDPA and describe three (3) measures an organisation should implement to demonstrate accountability for the personal data it manages.

EXAMPLE 2 (PDPA — definition + examples):
  Scenario: A small retail shop in Singapore collects customers' names, phone numbers, and email addresses when they sign up for a membership card. The shop owner is unsure whether all the information collected qualifies as personal data under the law.
  Question: Define what constitutes 'personal data' under the Personal Data Protection Act (PDPA) and provide three (3) examples of personal data that the retail shop would typically collect from its customers.

EXAMPLE 3 (PDPA — obligations):
  Scenario: A newly established SME providing home cleaning services has just started collecting customers' personal data such as home addresses and contact numbers. The business owner has heard about PDPA but is unclear about what specific legal obligations the company must fulfil when handling this data.
  Question: Describe four (4) key obligations that organisations must comply with under the PDPA when handling individuals' personal data.

EXAMPLE 4 (PDPA — purpose & scope):
  Scenario: A local bakery chain is expanding its operations and plans to launch an online ordering platform. The management team wants to understand the full scope of Singapore's data protection legislation before they begin collecting customer data through their new digital platform.
  Question: Explain the purpose and scope of the Personal Data Protection Act 2012 (PDPA), including two (2) key objectives of the Act and the types of organisations it applies to.

PATTERN to extract from those examples — apply it to THIS course:
  • Scenario sentence 1 → "A [size adjective] [generic org type] [in Singapore | …]" + the data/activity involved.
  • Scenario sentence 2 → a concrete, realistic TRIGGER: a breach, an investigation, an expansion, a new product launch, a regulatory enquiry, an internal review, a new staff member with a question, a compliance officer mapping requirements. Reference real bodies/programmes when relevant (PDPC, DPMP, etc.) — these are real concepts, not invented brands.
  • Optional sentence 3 → one extra constraint or context.
  • Question stem → ONE sentence, action verb first (Define / Describe / Explain / Identify / Outline / State / Compare), TWO-PART when natural (e.g. "Explain X **and** describe three (3) Y", "Define X **and** provide three (3) examples"). End with a full stop.

QUESTION-CRAFT RULES — these separate a professional WSQ paper from a generic quiz:

  (a) **MAX two-part stems.** A stem may chain two clauses with "and" (define + examples; explain + measures). NEVER three-part — no "Define X, identify Y, and explain Z." If you have three things to ask, drop one or split into two questions.

  (b) **Call back to the scenario subject in the stem.** If sentence 1 was "A small retail shop…", the stem should reference "the retail shop" / "an SME like the retail shop" where it makes the question concrete. Don't ask in the abstract when the scenario gave you a subject.

  (c) **Defined terms in single quotes on first reference.** Write 'personal data', 'consent', 'accountability', 'sensitive personal data' the first time the term appears in the stem. Subsequent mentions in the same stem can drop the quotes.

  (d) **Full Act/framework name + abbreviation on first reference inside the stem.** Write "Personal Data Protection Act (PDPA)" the first time, then "PDPA" thereafter. Same pattern for any other framework the CP cites.

  (e) **No padding tail clauses.** Banned closers: "and discuss its importance", "and explain why this matters", "and include the potential consequences", "to ensure full compliance with regulatory requirements". Every clause must add specific marking-guide content.

  (f) **Match the question's depth to the K-level it cites.** K1/K2 questions are simpler ("Describe the key stages…"). K5/K6/K7 questions ask for analysis or evaluation ("Explain the purpose and scope…", "Explain what accountability means and describe three (3) measures…"). Don't pile complexity onto a low-K question or under-spec a high-K one.

═══════════════════════════════════════════════════════════════
HARD RULES — violating any of these is an automatic fail:
═══════════════════════════════════════════════════════════════

1. **GENERIC organisation descriptions only — NEVER fictional company names or named people.**
   FORBIDDEN: "FastMov Pte. Ltd.", "TrendWear Pte. Ltd.", "Sarah runs a clinic", any "Pte. Ltd.", any branded name, any first-name attribution.
   REQUIRED: "A small [org type]", "A newly established SME …", "A growing recruitment agency …", "A local bakery chain …", "A mid-sized e-commerce company selling …".

2. **DO NOT put the K/A code in the question_statement.** The code goes ONLY in the knowledge_id / ability_id JSON field. The renderer appends it to the stem automatically. If you write "… (K3)" at the end of question_statement, it WILL appear duplicated in the final document.

3. **Number formatting:** lowercase word + digit-in-parens ALWAYS. "three (3)", "four (4)", "two (2)". NEVER "THREE", "FOUR", "3 examples", "three examples".

4. **Banned words/habits:** "effectively", "robust", "comprehensive", "leverage", "best-in-class", "operationalise effectively"; casual filler ("Sarah wants to know…", "the team is curious…"); throwaway closers ("and explain why this matters", "and discuss its importance"); second-person ("you", "your") in the stem; padding clauses that don't earn their keep.

5. **Scenario length: 2-3 short neutral sentences.** Stop. Do not pad.

6. **Each question maps to a specific K or A statement from the Course Data above.** Use the real K/A IDs — do not invent. Pick the code that genuinely fits the question's content.

7. **Answer bullets:** 3-5 marking-guide bullets per question — one substantive point per bullet, written so a marker can tick them off. Use formal definitions and PDPA / framework language verbatim where the source provides it. No numbering inside bullet text.

Return ONLY a valid JSON object with this exact structure (single assessment, not an array):
{
  "type": "${t.name}",
  "code": "${t.code}",
  "duration": "${t.duration}",
  "questions": [
    {
      "scenario": "2-3 sentence scenario following the gold-standard pattern above. NO fictional company names. NO named people.",
      "question_statement": "Action-verb-first formal stem, ending with a full stop. DO NOT include the K/A code here.",
      "knowledge_id": "K1 (for Written types)",
      "ability_id": ["A1", "A2"] (for Practical types — omit for Written types),
      "answer": ["marking-guide bullet 1", "marking-guide bullet 2", "marking-guide bullet 3"]
    }
  ]
}

CRITICAL: Return ONLY the JSON object, no markdown blocks, no explanation.`;

      // Run one Claude call PER assessment type in parallel — instead of
      // a single sequential call generating questions for everything, this
      // halves wall-clock time when there are 2+ types and lets us stick
      // to a smaller prompt per call.
      const callPerType = async (t: { code: string; name: string; duration: string }): Promise<any | null> => {
        let raw = '';
        for await (const message of query({
          prompt: buildPrompt(t),
          options: {
            env: buildClaudeEnv(apiKey),
            allowedTools: [],
            maxTurns: 1,
            // Sonnet 4.6 is the same model the CP extractor uses — markedly
            // faster than the default Opus while keeping the writing quality
            // we need for assessment stems.
            model: 'claude-sonnet-4-6',
          } as any,
        })) {
          if (message.type === 'assistant' && (message as any).message?.content) {
            for (const block of (message as any).message.content) if (block.type === 'text') raw += block.text;
          }
        }
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return null;
        try {
          return JSON.parse(m[0]);
        } catch {
          return null;
        }
      };

      const results = await Promise.all(detectedTypes.map(callPerType));
      const assessments: any[] = results.filter((x: any) => x && Array.isArray(x.questions) && x.questions.length > 0);

      const courseTitleStr = contextData.Course_Title || contextData.courseTitle || 'Course';
      const orgNameStr = contextData.Name_of_Organisation || contextData.organisationName || '';
      const generated = generateAssessments(assessments, courseTitleStr, orgNameStr);
      for (const g of generated) {
        documents.push({ name: g.questionName, data: g.questionBuffer.toString('base64') });
        documents.push({ name: g.answerName, data: g.answerBuffer.toString('base64') });
      }
    } else {
      const ctx = NEEDS_EVIDENCE[docType] || NEEDS_NARRATIVE[docType]
        ? await withEvidence(contextData, docType)
        : contextData;
      documents.push(generateDoc(docType, ctx));
    }

    return res.status(200).json({ success: true, documents });
  } catch (error: any) {
    console.error('Document generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate document' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
