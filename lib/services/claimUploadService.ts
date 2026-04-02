import fs from 'fs';
import path from 'path';
import PDFParser from 'pdf2json';
import * as XLSX from 'xlsx';
import pool from '@lib/db';

export type ClaimRowInput = {
  claim_id?: string | null;
  grant_id?: string | null;
  enrollment_id?: string | null;
  trainee_name?: string | null;
  course_reference?: string | null;
  course_name?: string | null;
  course_start_date?: string | null;
  disbursement_date?: string | null;
  ready_for_payout_date?: string | null;
  payout_request_id?: string | null;
  paynow_account?: string | null;
  individual_nric?: string | null;
  sctp_declaration?: string | null;
  lapsed_date?: string | null;
  training_partner_code?: string | null;
  claim_status?: string | null;
  claim_amount?: number | null;
  submission_date?: string | null;
  approval_date?: string | null;
  payment_date?: string | null;
  raw_data?: any;
};

export type ClaimRowDb = {
  id: string;
  claim_id: string | null;
  grant_id: string | null;
  enrollment_id: string | null;
  trainee_name: string | null;
  course_reference: string | null;
  course_name: string | null;
  course_start_date: string | null;
  disbursement_date: string | null;
  ready_for_payout_date: string | null;
  payout_request_id: string | null;
  paynow_account: string | null;
  individual_nric: string | null;
  sctp_declaration: string | null;
  lapsed_date: string | null;
  training_partner_code: string | null;
  claim_status: string | null;
  claim_amount: string | null;
  submission_date: string | null;
  approval_date: string | null;
  payment_date: string | null;
  created_date: string;
  imported_at: string;
  raw_data: any;
};

export type ProcessResultItem =
  | {
      claim_id: string;
      result: 'exists' | 'inserted';
      message: string;
      data: ClaimRowDb;
      parsed?: any;
    }
  | {
      claim_id: null;
      result: 'failed';
      message: string;
      data: null;
      parsed?: any;
    };

export type ProcessSummary = {
  total: number;
  existing: number;
  inserted: number;
  failed: number;
};

export type ProcessResponse = {
  summary: ProcessSummary;
  results: ProcessResultItem[];
};

export type UploadedFileLike = {
  filepath: string;
  originalFilename?: string | null;
  mimetype?: string | null;
  size?: number | null;
};

function normalizeString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === 'number' && isFinite(v)) return String(v);
  return null;
}

function parseMoney(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[^0-9.-]+/g, ''));
  return isFinite(n) ? n : null;
}

function parseDateToIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
  if (typeof v === 'number') {
    // Excel date serial
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const date = new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, d.S));
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;

  // Support DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const normalized = s.includes('/') ? s.split('/').reverse().join('-') : s;
  const date = new Date(normalized);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function detectUploadMode(file: UploadedFileLike): 'pdf' | 'xlsx' {
  const name = (file.originalFilename || '').toLowerCase();
  const ext = path.extname(name);
  const mime = (file.mimetype || '').toLowerCase();

  if (ext === '.xlsx' || mime.includes('spreadsheetml') || mime.includes('excel')) return 'xlsx';
  return 'pdf';
}

async function parsePdfToText(filePath: string): Promise<string> {
  const parser = new (PDFParser as any)(null, 1);
  return await new Promise<string>((resolve, reject) => {
    (parser as any).on('pdfParser_dataError', (errData: any) => reject(errData.parserError || errData));
    (parser as any).on('pdfParser_dataReady', () => {
      const text = (parser as any).getRawTextContent();
      resolve(typeof text === 'string' ? text : '');
    });
    (parser as any).loadPDF(filePath);
  });
}

function extractClaimRowsFromPdfText(text: string, source: any): ClaimRowInput[] {
  // Best-effort: PDFs are often visually tabular but not structurally parseable.
  // We at minimum extract all claim IDs that look like 200xxxxxxxx.
  const matches = Array.from(text.matchAll(/\b(200\d{6,})\b/g)).map((m) => m[1]).filter(Boolean);
  const uniqueIds = Array.from(new Set(matches));

  if (uniqueIds.length === 0) {
    return [
      {
        claim_id: null,
        raw_data: { source, note: 'No claim_id pattern found in PDF text', sample: text.slice(0, 500) },
      },
    ];
  }

  return uniqueIds.map((claimId) => ({
    claim_id: claimId,
    raw_data: { source, extracted_from: 'pdf_text', claim_id: claimId },
  }));
}

function normalizeExcelHeader(header: string): string {
  return header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function mapExcelRow(row: Record<string, any>, source: any): ClaimRowInput {
  const normalized: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) normalized[normalizeExcelHeader(k)] = v;

  // TPG "Report Details" mapping + common variants.
  const claimId =
    normalizeString(normalized.claim_id) ||
    normalizeString(normalized.claimid) ||
    normalizeString(normalized.claim_no) ||
    normalizeString(normalized.claimnumber) ||
    normalizeString(normalized.claim);

  return {
    claim_id: claimId,
    grant_id: normalizeString(normalized.grant_id) || normalizeString(normalized.grantid),
    enrollment_id: normalizeString(normalized.enrollment_id) || normalizeString(normalized.enrolment_id),
    trainee_name:
      normalizeString(normalized.trainee_name) ||
      normalizeString(normalized.trainee) ||
      normalizeString(normalized.individual_name),
    individual_nric: normalizeString(normalized.individual_nric),
    course_reference:
      normalizeString(normalized.course_reference) ||
      normalizeString(normalized.course_ref) ||
      normalizeString(normalized.course_reference_number) ||
      normalizeString(normalized.coursereferencenumber),
    course_name: normalizeString(normalized.course_name),
    course_start_date: parseDateToIso(normalized.course_start_date),
    disbursement_date: parseDateToIso(normalized.disbursement_date),
    ready_for_payout_date: parseDateToIso(normalized.ready_for_payout_date),
    payout_request_id: normalizeString(normalized.payout_request_id),
    paynow_account: normalizeString(normalized.paynow_account),
    sctp_declaration: normalizeString(normalized.sctp_declaration),
    lapsed_date: parseDateToIso(normalized.lapsed_date),
    training_partner_code: normalizeString(normalized.training_partner_code) || normalizeString(normalized.tp_code),
    claim_status: normalizeString(normalized.claim_status) || normalizeString(normalized.status),
    claim_amount: parseMoney(normalized.claim_amount ?? normalized.amount ?? normalized.claimamount ?? normalized.claim_amount),
    submission_date: parseDateToIso(normalized.submission_date ?? normalized.submitted_on ?? normalized.submissiondate),
    approval_date: parseDateToIso(normalized.approval_date ?? normalized.approved_on ?? normalized.approvaldate),
    payment_date: parseDateToIso(
      normalized.payment_date ??
        normalized.paid_on ??
        normalized.paymentdate ??
        normalized.disbursement_date ??
        normalized.disbursementdate
    ),
    raw_data: { source, original: row, normalized },
  };
}

function parseXlsxFile(filePath: string, source: any): ClaimRowInput[] {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];

  // Many exported spreadsheets include a title block before headers.
  // Detect the most likely header row by scanning early rows for a "claim id" column.
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, raw: true }) as any[][];
  if (!rows.length) return [];

  const maxScan = Math.min(rows.length, 30);
  let headerRowIdx = 0;
  const looksLikeHeader = (cells: any[]) => {
    const normalizedCells = cells
      .map((c) => (typeof c === 'string' ? normalizeExcelHeader(c) : ''))
      .filter(Boolean);
    if (normalizedCells.length === 0) return false;
    return normalizedCells.some((h) => h === 'claim_id' || h === 'claimid' || (h.includes('claim') && h.includes('id')));
  };

  for (let i = 0; i < maxScan; i++) {
    if (looksLikeHeader(rows[i] || [])) {
      headerRowIdx = i;
      break;
    }
  }

  const headerCells = (rows[headerRowIdx] || []).map((c) => (c == null ? '' : String(c)));
  const headers = headerCells.map((h) => h.trim());

  const out: ClaimRowInput[] = [];
  for (let rIdx = headerRowIdx + 1; rIdx < rows.length; rIdx++) {
    const cells = rows[rIdx] || [];
    const isEmptyRow = cells.every((c) => c == null || String(c).trim() === '');
    if (isEmptyRow) continue;

    const obj: Record<string, any> = {};
    for (let cIdx = 0; cIdx < headers.length; cIdx++) {
      const key = headers[cIdx];
      if (!key) continue;
      obj[key] = cells[cIdx];
    }
    out.push(mapExcelRow(obj, source));
  }

  return out;
}

export async function parseUploadedClaimFile(file: UploadedFileLike): Promise<{ mode: 'pdf' | 'xlsx'; rows: ClaimRowInput[] }> {
  const mode = detectUploadMode(file);
  const source = {
    filename: file.originalFilename || path.basename(file.filepath),
    mimetype: file.mimetype || null,
    size: file.size || null,
    mode,
  };

  if (mode === 'xlsx') {
    const rows = parseXlsxFile(file.filepath, source);
    return { mode, rows };
  }

  const text = await parsePdfToText(file.filepath);
  const rows = extractClaimRowsFromPdfText(text, source);
  return { mode, rows };
}

export async function checkExistingClaims(claimIds: string[]): Promise<Map<string, ClaimRowDb>> {
  if (claimIds.length === 0) return new Map();
  const client = await pool.connect();
  try {
    const r = await client.query('SELECT * FROM ssg_claims WHERE claim_id = ANY($1::text[])', [claimIds]);
    const map = new Map<string, ClaimRowDb>();
    for (const row of r.rows) {
      if (row?.claim_id) map.set(String(row.claim_id), row as ClaimRowDb);
    }
    return map;
  } finally {
    client.release();
  }
}

export async function upsertClaims(rows: ClaimRowInput[]): Promise<{ rowsByClaimId: Map<string, ClaimRowDb>; insertedIds: Set<string> }> {
  const toUpsert = rows.filter((r) => r.claim_id && String(r.claim_id).trim().length > 0);
  if (toUpsert.length === 0) return { rowsByClaimId: new Map(), insertedIds: new Set() };

  // Multi-row upsert with RETURNING so we can confirm inserts, and backfill missing fields on existing rows.
  const cols = [
    'claim_id',
    'grant_id',
    'enrollment_id',
    'trainee_name',
    'individual_nric',
    'course_reference',
    'course_name',
    'course_start_date',
    'training_partner_code',
    'claim_status',
    'claim_amount',
    'disbursement_date',
    'ready_for_payout_date',
    'payout_request_id',
    'paynow_account',
    'sctp_declaration',
    'lapsed_date',
    'raw_data',
    'created_date',
    'imported_at',
  ] as const;

  const values: any[] = [];
  const tuples: string[] = [];
  const nowIso = new Date().toISOString();

  for (const r of toUpsert) {
    const baseIdx = values.length;
    tuples.push(
      `($${baseIdx + 1},$${baseIdx + 2},$${baseIdx + 3},$${baseIdx + 4},$${baseIdx + 5},$${baseIdx + 6},$${baseIdx + 7},$${baseIdx + 8},$${baseIdx + 9},$${baseIdx + 10},$${baseIdx + 11},$${baseIdx + 12},$${baseIdx + 13},$${baseIdx + 14},$${baseIdx + 15},$${baseIdx + 16},$${baseIdx + 17},$${baseIdx + 18}::jsonb,$${baseIdx + 19}::timestamptz,$${baseIdx + 20}::timestamptz)`
    );
    values.push(
      String(r.claim_id).trim(),
      r.grant_id ?? null,
      r.enrollment_id ?? null,
      r.trainee_name ?? null,
      r.individual_nric ?? null,
      r.course_reference ?? null,
      r.course_name ?? null,
      r.course_start_date ?? null,
      r.training_partner_code ?? null,
      r.claim_status ?? null,
      r.claim_amount ?? null,
      r.disbursement_date ?? null,
      r.ready_for_payout_date ?? null,
      r.payout_request_id ?? null,
      r.paynow_account ?? null,
      r.sctp_declaration ?? null,
      r.lapsed_date ?? null,
      JSON.stringify(r.raw_data ?? { parsed: r }),
      nowIso,
      nowIso
    );
  }

  const sql = `
    INSERT INTO ssg_claims (${cols.join(',')})
    VALUES ${tuples.join(',')}
    ON CONFLICT (claim_id)
    DO UPDATE SET
      imported_at = EXCLUDED.imported_at,
      -- Backfill new report fields if existing row is missing them
      trainee_name = COALESCE(ssg_claims.trainee_name, EXCLUDED.trainee_name),
      individual_nric = COALESCE(ssg_claims.individual_nric, EXCLUDED.individual_nric),
      course_reference = COALESCE(ssg_claims.course_reference, EXCLUDED.course_reference),
      course_name = COALESCE(ssg_claims.course_name, EXCLUDED.course_name),
      course_start_date = COALESCE(ssg_claims.course_start_date, EXCLUDED.course_start_date),
      disbursement_date = COALESCE(ssg_claims.disbursement_date, EXCLUDED.disbursement_date),
      ready_for_payout_date = COALESCE(ssg_claims.ready_for_payout_date, EXCLUDED.ready_for_payout_date),
      payout_request_id = COALESCE(ssg_claims.payout_request_id, EXCLUDED.payout_request_id),
      paynow_account = COALESCE(ssg_claims.paynow_account, EXCLUDED.paynow_account),
      sctp_declaration = COALESCE(ssg_claims.sctp_declaration, EXCLUDED.sctp_declaration),
      lapsed_date = COALESCE(ssg_claims.lapsed_date, EXCLUDED.lapsed_date),
      raw_data = COALESCE(ssg_claims.raw_data, '{}'::jsonb) || EXCLUDED.raw_data
    RETURNING *, (xmax = 0) AS inserted;
  `;

  const client = await pool.connect();
  try {
    const r = await client.query(sql, values);
    const map = new Map<string, ClaimRowDb>();
    const insertedIds = new Set<string>();
    for (const row of r.rows) {
      if (row?.claim_id) {
        const claimId = String(row.claim_id);
        map.set(claimId, row as ClaimRowDb);
        if (row?.inserted === true) insertedIds.add(claimId);
      }
    }
    return { rowsByClaimId: map, insertedIds };
  } finally {
    client.release();
  }
}

export async function processClaimUpload(file: UploadedFileLike): Promise<ProcessResponse> {
  if (!file?.filepath) {
    return {
      summary: { total: 0, existing: 0, inserted: 0, failed: 1 },
      results: [{ claim_id: null, result: 'failed', message: 'No file uploaded', data: null }],
    };
  }

  const { rows } = await parseUploadedClaimFile(file);
  if (!rows || rows.length === 0) {
    return {
      summary: { total: 0, existing: 0, inserted: 0, failed: 1 },
      results: [{ claim_id: null, result: 'failed', message: 'No rows detected in uploaded file', data: null }],
    };
  }

  const claimIds = rows
    .map((r) => (r.claim_id ? String(r.claim_id).trim() : ''))
    .filter((v) => v.length > 0);

  const uniqueClaimIds = Array.from(new Set(claimIds));
  const existingMap = await checkExistingClaims(uniqueClaimIds);

  // Upsert ALL parsed rows so existing claims can be backfilled with new report fields (e.g. course_name).
  const { rowsByClaimId: upsertedMap, insertedIds } = await upsertClaims(rows);
  const insertedIdList = Array.from(insertedIds);

  // Merge with any pre-existing rows (upsert should cover all, but keep safe).
  const combinedExisting = new Map(existingMap);
  Array.from(upsertedMap.entries()).forEach(([k, v]) => combinedExisting.set(k, v));

  const results: ProcessResultItem[] = rows.map((r) => {
    const claimId = r.claim_id ? String(r.claim_id).trim() : '';
    if (!claimId) {
      return { claim_id: null, result: 'failed', message: 'Missing claim_id', data: null, parsed: r };
    }

    const dbRow = combinedExisting.get(claimId);
    if (!dbRow) {
      return { claim_id: null, result: 'failed', message: `Failed to fetch or insert claim_id ${claimId}`, data: null, parsed: r };
    }

    if (existingMap.has(claimId) && !insertedIds.has(claimId)) {
      return { claim_id: claimId, result: 'exists', message: 'Claim already exists', data: dbRow, parsed: r };
    }

    return { claim_id: claimId, result: 'inserted', message: 'Claim inserted successfully', data: dbRow, parsed: r };
  });

  const summary: ProcessSummary = {
    total: results.length,
    existing: results.filter((r) => r.result === 'exists').length,
    inserted: results.filter((r) => r.result === 'inserted').length,
    failed: results.filter((r) => r.result === 'failed').length,
  };

  return { summary, results };
}

