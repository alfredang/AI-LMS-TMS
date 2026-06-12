import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../../../lib/db';

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * POST /api/admin/ca-ai-process-supporting-doc
 *
 * Vision pass over a single supporting doc to (a) identify which learner
 * candidate it belongs to (matched on full name + employer name, since
 * payslips usually don't show NRIC) and (b) pre-fill match/mismatch
 * verdicts for the 4 fields the admin would otherwise tick manually.
 *
 * multipart/form-data:
 *   - file:      image or PDF (single)
 *   - learners:  JSON string — array of { id, nric, fullName, employerName, employerUen }
 *
 * Response:
 *   {
 *     success: true,
 *     extracted:        { nric, fullName, employerName, employerUen },
 *     matchedLearnerId: string | null,
 *     verdicts:         { name, nric, employer, uen } | null,   // 'match' | 'mismatch' | 'unknown'
 *     confidence:       'high' | 'medium' | 'low'
 *   }
 *
 * Returns 400 if no API key configured — caller falls back to manual flow.
 */

const VISION_MODEL = 'claude-haiku-4-5-20251001';

async function getAnthropicKey(): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT key_value FROM training_provider_api
        WHERE training_provider_id = (SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1)
          AND key_name = 'ANTHROPIC_API_KEY'`
    );
    if (result.rows[0]?.key_value) return String(result.rows[0].key_value);
  } catch (e) {
    console.error('[ca-ai-process] Failed to fetch ANTHROPIC_API_KEY from DB:', e);
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

interface Candidate {
  id: string;
  nric: string;
  fullName: string;
  employerName: string;
  employerUen: string;
}

function buildPrompt(candidates: Candidate[]): string {
  return `You are a document verification assistant for a Singapore training-provider LMS.

Examine the attached supporting document image carefully. Likely document types:
screenshot of CPF contribution statement, payslip, NRIC card, bank statement,
employer letter — anything that shows a person's NRIC/FIN and their employer.

CANDIDATE LEARNERS — one of these is the person the document belongs to:
${JSON.stringify(candidates, null, 2)}

Task 1 — Extract from the document:
- nric: Singapore NRIC or FIN visible (e.g. "S1234567A", "T9876543B", "F1234567X").
        Return null if not legible.
- fullName: The person's full name exactly as printed.
        Return null if not legible.
- employerName: The employer / company name if visible.
        Return null if not visible.
- employerUen: The Singapore UEN if visible (typically 9-10 chars, e.g. "201234567A").
        Return null if not visible.

Task 2 — Match to a candidate:
Match using EXACTLY TWO required keys: the person's full name AND the employer/company name.
NRIC and UEN are additional context shown to the admin — they DO NOT gate the match.
(Most documents are Singapore payslips, which typically do not show NRIC at all.)

Rules:
- Both name AND employer must clearly agree with the same candidate → return that candidate's id.
- Compare case-insensitively. Ignore middle initials, name order (e.g. "John Tan" vs "Tan, John"),
  and trivial company-suffix differences ("Pte Ltd" vs "Pte. Ltd." vs "Private Limited").
- Do NOT reject a match because NRIC or UEN is missing or differs — those are reported as
  per-field verdicts in Task 3 so the admin can spot inconsistencies, but they never veto.
- If no candidate's name+employer both agree → return null.

Task 3 — Per-field verdict (only if matchedLearnerId is non-null):
For each of name/nric/employer/uen, return one of:
- "match"     — extracted value clearly agrees with the candidate's value
                (case-insensitive, ignore minor formatting / Pte Ltd vs Pte. Ltd.)
                For NRIC: if the candidate's NRIC is masked (e.g. "*****822B") and the
                document's NRIC ends with the same visible suffix, treat as "match".
- "mismatch"  — extracted value clearly disagrees with the candidate's value
- "unknown"   — you could not read this field from the document

Task 4 — Confidence:
- "high"   — name + employer both clearly readable and both agree
- "medium" — name + employer agree but one is partially legible
- "low"    — document quality poor or only one of name/employer is confidently readable

Return ONLY valid JSON, no prose, in this exact shape:
{
  "extracted": { "nric": "...", "fullName": "...", "employerName": "...", "employerUen": "..." },
  "matchedLearnerId": "uuid-or-null",
  "verdicts": { "name": "match|mismatch|unknown", "nric": "...", "employer": "...", "uen": "..." },
  "confidence": "high|medium|low"
}

If matchedLearnerId is null, set verdicts to null.`;
}

function parseAiResponse(text: string): any {
  // Claude sometimes wraps the JSON in ```json fences and/or appends a "Reasoning:" prose
  // section despite "ONLY valid JSON". Try fenced block first, then fall back to the first
  // balanced { ... } object in the response.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }
  const start = text.indexOf('{');
  if (start === -1) throw new Error('no JSON object found in response');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON braces in response');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    return res.status(400).json({
      success: false,
      error: 'ANTHROPIC_API_KEY not configured — set it in training_provider_api or env to enable AI auto-assign',
    });
  }

  try {
    const form = new IncomingForm({ maxFileSize: 20 * 1024 * 1024 });
    const { fields, files } = await new Promise<{ fields: any; files: any }>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const learnersRaw = Array.isArray(fields.learners) ? fields.learners[0] : fields.learners;
    if (!learnersRaw) {
      return res.status(400).json({ success: false, error: 'learners JSON is required' });
    }
    let candidates: Candidate[];
    try {
      candidates = JSON.parse(String(learnersRaw));
      if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('empty');
    } catch {
      return res.status(400).json({ success: false, error: 'learners must be a non-empty JSON array' });
    }

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploaded) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }

    const fileBuffer = await fs.promises.readFile(uploaded.filepath);
    const base64 = fileBuffer.toString('base64');
    const mimeType = uploaded.mimetype || 'image/png';
    try { fs.unlinkSync(uploaded.filepath); } catch { /* noop */ }

    const client = apiKey.trim().startsWith('sk-ant-oat')
      ? new Anthropic({ authToken: apiKey.trim() })
      : new Anthropic({ apiKey: apiKey.trim() });

    const docBlock = mimeType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 } };

    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          docBlock,
          { type: 'text', text: buildPrompt(candidates) },
        ],
      }],
    });

    const textBlock = response.content.find((b: any) => b.type === 'text') as any;
    if (!textBlock?.text) {
      return res.status(502).json({ success: false, error: 'AI returned empty response' });
    }

    let parsed: any;
    try {
      parsed = parseAiResponse(textBlock.text);
    } catch (e) {
      console.error('[ca-ai-process] Failed to parse AI JSON:', textBlock.text);
      return res.status(502).json({
        success: false,
        error: 'AI returned non-JSON response',
        rawText: textBlock.text.slice(0, 500),
      });
    }

    const candidateIds = new Set(candidates.map(c => c.id));
    const matchedLearnerId = parsed.matchedLearnerId && candidateIds.has(parsed.matchedLearnerId)
      ? String(parsed.matchedLearnerId)
      : null;

    return res.status(200).json({
      success: true,
      extracted: parsed.extracted || {},
      matchedLearnerId,
      verdicts: matchedLearnerId ? (parsed.verdicts || null) : null,
      confidence: parsed.confidence || 'low',
    });
  } catch (err: any) {
    console.error('[ca-ai-process] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'AI processing failed',
    });
  }
}
