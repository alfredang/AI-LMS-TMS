import fs from 'fs';
import * as XLSX from 'xlsx';
import type { GrantImportRowParsed, TpGatewayDisbursementRowRaw } from './tpGatewayDisbursementTypes';

function normalizeNull(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  if (!s) return null;
  if (s === "'-" || s === '-' || s.toLowerCase() === 'null') return null;
  return s;
}

function parseAmount(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseDdMmYyyy(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!dd || !mm || !yyyy) return null;
  const iso = `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  // validate date exists
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() + 1 !== mm || d.getUTCDate() !== dd) return null;
  return iso;
}

export function parseTpGatewayDisbursementXlsx(filePath: string): Array<{ rowNumber: number; raw: TpGatewayDisbursementRowRaw }> {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, raw: true }) as any[][];
  if (!rows.length) return [];

  // Column order is defined; we assume header row exists as the first non-empty row.
  // But we still tolerate title blocks by locating the row where col[0] matches "Financial Transaction ID".
  const maxScan = Math.min(rows.length, 30);
  let headerRowIdx = 0;
  for (let i = 0; i < maxScan; i++) {
    const c0 = normalizeNull(rows[i]?.[0]);
    if (c0 && c0.toLowerCase() === 'financial transaction id') {
      headerRowIdx = i;
      break;
    }
  }

  const headers = (rows[headerRowIdx] || []).map((c) => (c == null ? '' : String(c).trim()));
  const out: Array<{ rowNumber: number; raw: TpGatewayDisbursementRowRaw }> = [];
  for (let rIdx = headerRowIdx + 1; rIdx < rows.length; rIdx++) {
    const cells = rows[rIdx] || [];
    const isEmptyRow = cells.every((c) => c == null || String(c).trim() === '');
    if (isEmptyRow) continue;

    const obj: TpGatewayDisbursementRowRaw = {};
    for (let cIdx = 0; cIdx < headers.length; cIdx++) {
      const key = headers[cIdx];
      if (!key) continue;
      obj[key] = cells[cIdx];
    }
    out.push({ rowNumber: rIdx + 1, raw: obj });
  }
  return out;
}

export function normalizeAndParseTpGatewayRow(rowNumber: number, raw: TpGatewayDisbursementRowRaw): GrantImportRowParsed {
  const financialTransactionId = normalizeNull(raw['Financial Transaction ID']);
  const enrolmentId = normalizeNull(raw['Enrolment ID']);
  const grantId = normalizeNull(raw['Grant ID']);
  const courseTitle = normalizeNull(raw['Course Title']);
  const scheme = normalizeNull(raw['Scheme']);
  const traineeId = normalizeNull(raw['Trainee ID']);
  const traineeName = normalizeNull(raw['Trainee']);
  const employerName = normalizeNull(raw['Employer Name']);
  const amountRaw = normalizeNull(raw['Amount']);
  const amountParsed = parseAmount(amountRaw);
  const paymentDateRaw = normalizeNull(raw['Payment Date']);
  const paymentDateParsed = parseDdMmYyyy(paymentDateRaw);
  const bankReferenceId = normalizeNull(raw['Bank Reference ID']);
  const fundingComponent = normalizeNull(raw['Funding Component']) || normalizeNull(raw['Claim Funding Component']);

  return {
    rowNumber,
    financialTransactionId,
    enrolmentId,
    grantId,
    courseTitle,
    scheme,
    traineeId,
    traineeName,
    employerName,
    amountRaw,
    amountParsed,
    paymentDateRaw,
    paymentDateParsed,
    bankReferenceId,
    fundingComponent,
    rawRowJson: raw,
    validationStatus: 'invalid',
    validationErrors: [],
    warnings: [],
  };
}

