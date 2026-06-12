import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File } from 'formidable';
import fs from 'fs';
import os from 'os';
import pool from '../../../lib/db';
import {
  AUDIT_DOC_TYPES,
  AUDIT_FIELD_KEYS,
  AuditDocType,
  AuditFieldKey,
  AuditFields,
  compareDoc,
  DocComparison,
  extractCoursewareFields,
  extractCpFields,
} from '../../../lib/cw-audit';

// Multipart upload — disable Next's body parser so formidable can stream.
export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '200mb',
    responseLimit: '50mb',
  },
};

interface AuditApiResponse {
  success: boolean;
  cpFields?: AuditFields;
  tgsCode?: string | null;
  comparisons?: DocComparison[];
  summary?: {
    totalDocs: number;
    totalFields: number;
    totalPass: number;
    totalFail: number;
    totalMissing: number;
  };
  error?: string;
}

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
  return process.env.ANTHROPIC_API_KEY || null;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parseChecklist(raw: string | string[] | undefined): AuditFieldKey[] {
  const list = asArray(raw);
  if (list.length === 0) return [...AUDIT_FIELD_KEYS];
  // CSV string from FormData (multi-checkboxes serialise as a single field
  // or as multiple repetitions depending on client). Accept both.
  const flat = list.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
  return flat.filter((k): k is AuditFieldKey => (AUDIT_FIELD_KEYS as readonly string[]).includes(k));
}

function parseDocTypes(raw: string | string[] | undefined, count: number): AuditDocType[] {
  const list = asArray(raw).map((s) => String(s).trim().toUpperCase());
  // Pad / clip to match upload count.
  const result: AuditDocType[] = [];
  for (let i = 0; i < count; i++) {
    const t = list[i] as AuditDocType | undefined;
    result.push(AUDIT_DOC_TYPES.includes(t!) ? t! : 'AP');
  }
  return result;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<AuditApiResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'API key not configured.' });
  }

  const tempPaths: string[] = [];
  try {
    const form = formidable({
      multiples: true,
      maxFileSize: 25 * 1024 * 1024,        // per single file
      maxTotalFileSize: 200 * 1024 * 1024,  // total across all files (CP + N courseware)
      uploadDir: os.tmpdir(),
      keepExtensions: true,
    });
    const { fields, files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) return reject(err);
          resolve({ fields, files });
        });
      },
    );

    const cpFile = (Array.isArray(files.cp) ? files.cp[0] : files.cp) as File | undefined;
    if (!cpFile?.filepath) {
      return res.status(400).json({ success: false, error: 'CP file is required (field name: "cp").' });
    }
    tempPaths.push(cpFile.filepath);

    const docFiles: File[] = [];
    if (files.docs) {
      const arr = Array.isArray(files.docs) ? files.docs : [files.docs];
      for (const f of arr) {
        if (f?.filepath) {
          docFiles.push(f);
          tempPaths.push(f.filepath);
        }
      }
    }
    if (docFiles.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one courseware document is required.' });
    }

    const tgsCodeRaw = fields.tgsCode;
    const tgsCode = (Array.isArray(tgsCodeRaw) ? tgsCodeRaw[0] : tgsCodeRaw) || null;
    const checklist = parseChecklist(fields.checklist);
    const docTypes = parseDocTypes(fields.docTypes, docFiles.length);

    // Extract CP fields once.
    const cpBuffer = fs.readFileSync(cpFile.filepath);
    const cpFields = await extractCpFields(cpBuffer, cpFile.originalFilename || 'cp.docx', apiKey);
    // Operator-supplied TGS code wins over whatever was extracted.
    if (tgsCode && typeof tgsCode === 'string') cpFields.tgs_ref_code = tgsCode;

    // Extract + compare each courseware doc.
    const comparisons: DocComparison[] = [];
    for (let i = 0; i < docFiles.length; i++) {
      const f = docFiles[i];
      const docBuffer = fs.readFileSync(f.filepath);
      const docFields = await extractCoursewareFields(
        docBuffer,
        f.originalFilename || `doc_${i}.docx`,
        docTypes[i],
        apiKey,
      );
      const cmp = compareDoc(cpFields, docFields, f.originalFilename || `doc_${i}.docx`, docTypes[i], checklist);
      comparisons.push(cmp);
    }

    const summary = comparisons.reduce(
      (acc, c) => ({
        totalDocs: acc.totalDocs + 1,
        totalFields: acc.totalFields + c.fields.filter((f) => f.status !== 'na').length,
        totalPass: acc.totalPass + c.passCount,
        totalFail: acc.totalFail + c.failCount,
        totalMissing: acc.totalMissing + c.missingCount,
      }),
      { totalDocs: 0, totalFields: 0, totalPass: 0, totalFail: 0, totalMissing: 0 },
    );

    return res.status(200).json({
      success: true,
      cpFields,
      tgsCode: typeof tgsCode === 'string' ? tgsCode : null,
      comparisons,
      summary,
    });
  } catch (error: any) {
    console.error('Courseware audit error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Audit failed' });
  } finally {
    for (const p of tempPaths) {
      try { fs.unlinkSync(p); } catch { /* best effort */ }
    }
  }
}
