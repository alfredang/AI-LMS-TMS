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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      const courseContext = JSON.stringify(contextData).slice(0, 15000);
      const prompt = `You are an expert WSQ assessment question writer.

Generate assessment questions for the following course and assessment types.

Course Data:
${courseContext}

Assessment Types to Generate:
${detectedTypes.map((t: any) => `- ${t.name} (${t.code}): ${t.duration}`).join('\n')}

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

      let raw = '';
      for await (const message of query({
        prompt,
        options: { env: buildClaudeEnv(apiKey), allowedTools: [], maxTurns: 1 },
      })) {
        if (message.type === 'assistant' && (message as any).message?.content) {
          for (const block of (message as any).message.content) if (block.type === 'text') raw += block.text;
        }
      }
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      let assessments: any[] = [];
      if (jsonMatch) {
        try { assessments = JSON.parse(jsonMatch[0]).assessments || []; } catch {}
      }

      const courseTitleStr = contextData.Course_Title || contextData.courseTitle || 'Course';
      const generated = generateAssessments(assessments, courseTitleStr);
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
