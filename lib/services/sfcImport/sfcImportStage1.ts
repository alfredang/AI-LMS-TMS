import * as XLSX from 'xlsx';
import pool from '@/lib/db';
import {
  requireSfcImportSchema,
  insertSfcImportRow,
  updateSfcImportBatchCounts,
  listAlreadyAppliedSfcClaimIds,
  getAppliedQbPaymentIdsByClaimId,
} from './sfcImportDb';
import { verifySfcInvoiceMatch } from './sfcInvoiceVerify';
import { realApplicationId } from '@/lib/daApplicationId';

// Unwrapped variant — these call sites want the QBO payload, not the envelope.
import { callQbProxyData as callQbProxy } from '@/lib/quickbooks/qbProxyClient';

function escapeQbQueryString(value: string): string {
  return value.replace(/'/g, "''");
}

function parseDisbursementDate(raw: string): string | null {
  // Input: DD/MM/YYYY → Output: YYYY-MM-DD
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function parseSfcXlsx(filepath: string): Array<Record<string, any>> {
  const wb = XLSX.readFile(filepath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: Array<Record<string, any>> = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return raw;
}

const COL = {
  claimId: 'Claim Id',
  individualNric: 'Individual NRIC',
  individualName: 'Individual Name',
  courseRefNumber: 'Course Reference Number',
  courseName: 'Course Name',
  courseStartDate: 'Course Start Date',
  disbursementDate: 'Disbursement Date',
  claimAmount: 'Claim Amount',
  payoutRequestId: 'Payout Request ID',
  claimStatus: 'Claim Status',
};

const REQUIRED_COLUMNS = Object.values(COL);

/**
 * Fail fast with one clear message if this isn't a TPGateway SFC Payout export, rather than
 * letting every row silently read blank values and pile up as hundreds of generic "Missing
 * Claim Id" invalid rows with no indication the file itself is wrong.
 */
function assertSfcXlsxShape(filepath: string): void {
  const wb = XLSX.readFile(filepath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[0] as unknown[]) || [];
  const headers = new Set(headerRow.map((h) => String(h ?? '').trim()));
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.has(c));
  if (missing.length > 0) {
    throw new Error(
      `This file doesn't look like a TPGateway SFC Payout export — missing column(s): ${missing.join(', ')}`
    );
  }
}


async function qbGetInvoiceById(
  app: string,
  invoiceId: string
): Promise<{ balance: number; customerRef: string; docNumber: string | null; raw: any } | null> {
  try {
    const data = await callQbProxy({ action: 'read', entity: 'invoice', id: invoiceId, app });
    const inv = data?.Invoice ?? data;
    if (!inv?.Id) return null;
    const balance = Number(inv.Balance ?? 0);
    const customerRef = inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : '';
    const docNumber = inv?.DocNumber ? String(inv.DocNumber) : null;
    return { balance, customerRef, docNumber, raw: inv };
  } catch {
    return null;
  }
}

async function qbFindInvoiceByEnrolmentId(apps: string[], enrolmentId: string): Promise<{
  app: string;
  id: string;
  balance: number;
  customerRef: string;
  docNumber: string | null;
} | null> {
  const safe = String(enrolmentId || '').replace(/'/g, "''").trim();
  if (!safe) return null;
  for (const app of apps) {
    try {
      const data = await callQbProxy({
        action: 'query',
        entity: 'invoice',
        app,
        query: `SELECT * FROM Invoice WHERE PrivateNote = 'SSG enrolment: ${safe}' MAXRESULTS 5`,
      });
      const rows = data?.QueryResponse?.Invoice;
      const list: any[] = Array.isArray(rows) ? rows : rows ? [rows] : [];
      if (list.length > 0) {
        // Prefer the customer invoice (TC26-...) over the GRN invoice (GRN-...) — both share
        // the same PrivateNote so the QB query can return either. Within each group, prefer
        // positive balance (outstanding) over zero (already paid).
        const isTc = (x: any) => String(x?.DocNumber || '').toUpperCase().startsWith('TC');
        const hasBalance = (x: any) => Number(x?.Balance ?? 0) > 0;
        const inv =
          list.find((x: any) => isTc(x) && hasBalance(x)) ??
          list.find((x: any) => isTc(x)) ??
          list.find((x: any) => hasBalance(x)) ??
          list[0];
        if (inv?.Id) {
          return {
            app,
            id: String(inv.Id),
            balance: Number(inv.Balance ?? 0),
            customerRef: inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : '',
            docNumber: inv?.DocNumber ? String(inv.DocNumber) : null,
          };
        }
      }
    } catch {
      // Try next app
    }
  }
  return null;
}

async function qbFindInvoiceByDocNumber(apps: string[], docNumber: string): Promise<{
  app: string;
  id: string;
  balance: number;
  customerRef: string;
  docNumber: string | null;
} | null> {
  const safeDoc = escapeQbQueryString(String(docNumber || '').trim());
  if (!safeDoc) return null;
  for (const app of apps) {
    try {
      const data = await callQbProxy({
        action: 'query',
        entity: 'invoice',
        app,
        query: `SELECT Id, DocNumber, Balance, CustomerRef FROM Invoice WHERE DocNumber = '${safeDoc}' MAXRESULTS 5`,
      });
      const rows = data?.QueryResponse?.Invoice;
      const list: any[] = Array.isArray(rows) ? rows : rows ? [rows] : [];
      const inv = list[0];
      if (inv?.Id) {
        return {
          app,
          id: String(inv.Id),
          balance: Number(inv.Balance ?? 0),
          customerRef: inv?.CustomerRef?.value ? String(inv.CustomerRef.value) : '',
          docNumber: inv?.DocNumber ? String(inv.DocNumber) : null,
        };
      }
    } catch {
      // Try next app
    }
  }
  return null;
}

/**
 * The primary claim -> enrolment match query, factored out so both the normal lookup
 * and the post-backfill re-lookup (see backfillMissingSsgClaim below) use the exact
 * same query — no second copy of this join to keep in sync.
 */
async function queryClaimMatch(claimId: string) {
  return pool.query(
    `SELECT
       sc.id::text AS ssg_claim_row_id,
       sc.claim_id,
       sc.claim_amount AS fms_claim_amount,
       sc.claim_status AS fms_claim_status,
       sc.claim_payment_status,
       sc.qb_payment_id AS existing_qb_payment_id,
       sc.individual_nric AS claim_individual_nric,
       se.enrolment_id,
       se.sponsorship_type,
       se.trainee_nric,
       se.trainee_name,
       ij.qbo_invoice_id,
       ij.qbo_doc_number,
       ij.invoice_no,
       da.invoice_id AS da_invoice_id,
       da.application_id AS da_application_id,
       da.sfc_invoice_id AS da_sfc_invoice_id,
       da.auto_enrol_error AS da_auto_enrol_error
     FROM public.ssg_claims sc
     JOIN public.ssg_enrolments se ON sc.enrollment_id = se.enrolment_id
     LEFT JOIN public.invoice_jobs ij ON ij.enrolment_id = se.enrolment_id
     -- LATERAL + LIMIT 1: da_application has no UNIQUE constraint on enrolment_id (only on
     -- application_id), so a plain LEFT JOIN can fan out to >1 row for a single legitimate
     -- claim/enrolment match (e.g. a re-application) and get wrongly flagged "matches multiple
     -- records" below. Deterministically pick the most recent da_application row instead.
     LEFT JOIN LATERAL (
       SELECT da2.invoice_id, da2.application_id, da2.sfc_invoice_id, da2.auto_enrol_error
       FROM public.da_application da2
       WHERE LOWER(TRIM(COALESCE(da2.enrolment_id,''))) = LOWER(TRIM(COALESCE(se.enrolment_id,'')))
       ORDER BY da2.created_at DESC
       LIMIT 1
     ) da ON true
     WHERE sc.claim_id = $1`,
    [claimId]
  );
}

/** Same DD-MM-YYYY / YYYYMMDD -> YYYY-MM-DD normalization pages/api/finance/all-course-runs.ts
 *  (RUN_START_NORM_SQL) uses for se.raw_data->course->run->startDate, so the fallback search
 *  below matches the exact same records Consolidated Finance Data's own search would find. */
const RUN_START_NORM_SQL = `(
  CASE
    WHEN (se.raw_data->'course'->'run'->>'startDate') ~ '^[0-9]{8}$' THEN
      substr((se.raw_data->'course'->'run'->>'startDate'), 1, 4) || '-' ||
      substr((se.raw_data->'course'->'run'->>'startDate'), 5, 2) || '-' ||
      substr((se.raw_data->'course'->'run'->>'startDate'), 7, 2)
    WHEN (se.raw_data->'course'->'run'->>'startDate') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN
      substr((se.raw_data->'course'->'run'->>'startDate'), 7, 4) || '-' ||
      substr((se.raw_data->'course'->'run'->>'startDate'), 4, 2) || '-' ||
      substr((se.raw_data->'course'->'run'->>'startDate'), 1, 2)
    ELSE NULLIF(trim(se.raw_data->'course'->'run'->>'startDate'), '')
  END
)`;

/**
 * Fallback for when the primary claim_id -> ssg_claims -> ssg_enrolments join finds
 * nothing. Two real, confirmed causes land here, and both need this same repair:
 *  (a) ssg_claims genuinely has no row for this claim_id at all (the SSG-claims sync
 *      lagging TPGateway's own claim export), or
 *  (b) FAR more common in this data (~9,000 of ~17,800 ssg_claims rows, verified) —
 *      ssg_claims DOES have a row, with trainee_name/course_reference/individual_nric
 *      already correctly populated by the sync, but its enrollment_id column is NULL.
 *      The primary query's JOIN requires a non-null match, so a NULL enrollment_id
 *      looks identical to "claim doesn't exist" and was never actually handled by an
 *      earlier version of this fix that only ever tried INSERT ... ON CONFLICT DO
 *      NOTHING — which silently no-ops whenever a row already exists, exactly case (b).
 *
 * Searches ssg_enrolments directly by trainee name + EXACT course reference + EXACT
 * course start date + enrolment_status = 'Confirmed', requires exactly one candidate,
 * and requires its NRIC to agree with the Excel row's before accepting it — name
 * matching alone is too loose to trust, but name + exact course code + exact run date +
 * Confirmed status + NRIC together is as solid a signal as the primary claim_id path.
 * Deliberately does NOT fall back to a looser signal (e.g. NRIC + date alone, dropping
 * the course code) if this fails — that was tried once and reverted after it matched a
 * real claim to a different, Cancelled enrolment that coincidentally shared a start
 * date. Course code, start date, status, and person must all agree; nothing looser.
 * On success, either UPDATEs the existing ssg_claims row's
 * enrollment_id (case b) or INSERTs a fresh row from the Excel's own data (case a), so
 * the caller re-resolves through the normal query and every downstream step (invoice
 * resolution, verification, FMS write-back after apply) works unmodified.
 */
async function backfillMissingSsgClaim(input: {
  claimId: string;
  individualNric: string;
  individualName: string;
  courseRefNumber: string;
  courseName: string;
  courseStartDateRaw: string;
  disbursementDateIso: string | null;
  claimAmount: number;
  payoutRequestId: string;
  claimStatus: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const courseStartDateIso = parseDisbursementDate(input.courseStartDateRaw);
  if (!courseStartDateIso) {
    return {
      ok: false,
      reason: 'Claim not linked to an enrolment in FMS (and cannot search — course start date is not in a recognized format)',
    };
  }

  type Candidate = { enrolment_id: string; trainee_nric: string | null };
  let candidate: Candidate | null = null;
  const candidateSource = 'name + course + start date';

  // Only signal used: name + course reference + exact start date, on a Confirmed enrolment.
  // Deliberately NOT a fallback to NRIC + date alone dropping the course code — that was tried
  // and reverted: it matched a real claim to a *different*, Cancelled enrolment that happened to
  // share the same start date (confirmed by the user against live data). A shared start date is
  // not enough on its own; course code, start date, and person must all agree, nothing looser.
  // enrolment_status = 'Confirmed' additionally guards Tier 1 itself against the same mistake —
  // a Cancelled enrolment must never be an acceptable match even when the course/date do agree.
  if (input.individualName.trim() && input.courseRefNumber.trim()) {
    const byNameCourseDate = await pool.query(
      `SELECT se.enrolment_id, se.trainee_nric
       FROM public.ssg_enrolments se
       WHERE se.enrolment_id IS NOT NULL
         AND se.enrolment_status = 'Confirmed'
         AND se.trainee_name ILIKE '%' || $1 || '%'
         AND UPPER(TRIM(se.course_reference)) = UPPER(TRIM($2))
         AND ${RUN_START_NORM_SQL} = $3`,
      [input.individualName.trim(), input.courseRefNumber.trim(), courseStartDateIso]
    );
    if (byNameCourseDate.rows.length === 1) {
      candidate = byNameCourseDate.rows[0];
    } else if (byNameCourseDate.rows.length > 1) {
      return {
        ok: false,
        reason: `Claim not linked to an enrolment in FMS; name + course + start-date search matched ${byNameCourseDate.rows.length} enrolments — ambiguous, refusing to guess`,
      };
    }
  }

  if (!candidate) {
    return {
      ok: false,
      reason: `Claim not linked to an enrolment in FMS, and no Confirmed enrolment matches name "${input.individualName}" + course ${input.courseRefNumber} + start date ${courseStartDateIso} either`,
    };
  }

  // Final NRIC safety check, required regardless of which tier resolved the candidate — tier 2
  // already matched by NRIC directly so this is trivially satisfied there, but tier 1 matched by
  // name alone (which can collide) and still needs independent confirmation before it's trusted.
  const excelNricLast4 = input.individualNric.trim().toUpperCase().slice(-4);
  const candidateNricLast4 = String(candidate.trainee_nric || '').trim().toUpperCase().slice(-4);
  if (!excelNricLast4 || !candidateNricLast4 || excelNricLast4 !== candidateNricLast4) {
    return {
      ok: false,
      reason: `Claim not linked to an enrolment in FMS; found enrolment ${candidate.enrolment_id} by ${candidateSource} but its NRIC (...${candidateNricLast4 || '?'}) does not match the Excel row's NRIC (...${excelNricLast4 || '?'}) — refusing to link`,
    };
  }

  const payoutRequestIdNumeric = /^\d+$/.test(input.payoutRequestId.trim()) ? input.payoutRequestId.trim() : null;

  // Case (b): a row for this claim_id already exists — heal its NULL/broken
  // enrollment_id in place rather than trying (and failing, on the UNIQUE claim_id
  // constraint) to insert a second row. Only ever touches enrollment_id — every other
  // column the real sync already wrote (trainee_name, individual_nric, claim_amount,
  // claim_status, ...) is left exactly as that sync produced it, since it's the more
  // authoritative source for everything except the link this fallback exists to fix.
  const existing = await pool.query(`SELECT id::text FROM public.ssg_claims WHERE claim_id = $1`, [input.claimId]);
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE public.ssg_claims SET enrollment_id = $2 WHERE claim_id = $1 AND enrollment_id IS NULL`,
      [input.claimId, candidate.enrolment_id]
    );
    return { ok: true };
  }

  // Case (a): genuinely no row yet — insert one from the Excel's own data. ON CONFLICT
  // DO NOTHING guards a race against the real sync (or another concurrent import run)
  // creating the row between the SELECT above and this INSERT; either way, a row for
  // this claim_id is guaranteed to exist afterward for the caller to re-resolve.
  await pool.query(
    `INSERT INTO public.ssg_claims (
       claim_id, enrollment_id, trainee_name, course_reference, claim_status,
       claim_amount, individual_nric, course_name, course_start_date, disbursement_date,
       payout_request_id, claim_payment_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::bigint, 'NOT_RECEIVED')
     ON CONFLICT (claim_id) DO NOTHING`,
    [
      input.claimId,
      candidate.enrolment_id,
      input.individualName,
      input.courseRefNumber,
      input.claimStatus,
      input.claimAmount,
      input.individualNric,
      input.courseName || null,
      courseStartDateIso,
      input.disbursementDateIso,
      payoutRequestIdNumeric,
    ]
  );

  return { ok: true };
}

export async function sfcStage1ParseMatchAndPersist(input: {
  filepath: string;
  filename: string | null;
  batchId: number;
  actorUserId: string | null;
  onProgress?: (p: { pct: number; message: string }) => void;
}): Promise<void> {
  await requireSfcImportSchema();

  input.onProgress?.({ pct: 2, message: 'Checking file format' });
  assertSfcXlsxShape(input.filepath);

  input.onProgress?.({ pct: 3, message: 'Parsing Excel' });
  const rawRows = parseSfcXlsx(input.filepath);

  // Only process "Paid" rows. Case-insensitive: TPGateway's own casing for this field isn't
  // contractually guaranteed, and a silent case mismatch here would drop rows with zero visibility.
  const paidRows = rawRows.filter((r) => String(r[COL.claimStatus] || '').trim().toUpperCase() === 'PAID');

  input.onProgress?.({ pct: 10, message: `Found ${paidRows.length} Paid rows` });

  const claimIdsAll = paidRows
    .map((r) => String(r[COL.claimId] || '').trim())
    .filter(Boolean);
  const claimIdsUnique = Array.from(new Set(claimIdsAll));

  const [alreadyAppliedSet, appliedQbPaymentIds] = await Promise.all([
    listAlreadyAppliedSfcClaimIds(claimIdsUnique),
    getAppliedQbPaymentIdsByClaimId(claimIdsUnique),
  ]);

  const appOverride = (process.env.QBO_GRANT_IMPORT_APP || 'app1').trim() || 'app1';

  const totalRows = paidRows.length;
  const counts = {
    total_rows: totalRows,
    ready_count: 0,
    already_applied_count: 0,
    unmatched_count: 0,
    skipped_da_count: 0,
    invalid_count: 0,
    needs_review_count: 0,
  };

  for (let i = 0; i < paidRows.length; i++) {
    const raw = paidRows[i];
    const rowIndex = i;

    if ((i + 1) % 10 === 0 || i === paidRows.length - 1) {
      const pct = 10 + Math.round(((i + 1) / Math.max(1, totalRows)) * 75);
      input.onProgress?.({ pct, message: `Processing rows (${i + 1}/${totalRows})` });
    }

    const claimId = String(raw[COL.claimId] || '').trim();
    const individualNric = String(raw[COL.individualNric] || '').trim();
    const individualName = String(raw[COL.individualName] || '').trim();
    const courseRefNumber = String(raw[COL.courseRefNumber] || '').trim();
    const courseName = String(raw[COL.courseName] || '').trim();
    const courseStartDate = String(raw[COL.courseStartDate] || '').trim();
    const disbursementDateRaw = String(raw[COL.disbursementDate] || '').trim();
    const disbursementDateIso = parseDisbursementDate(disbursementDateRaw);
    const claimAmountRaw = raw[COL.claimAmount];
    const claimAmount = claimAmountRaw !== '' ? parseFloat(String(claimAmountRaw)) : NaN;
    const payoutRequestId = String(raw[COL.payoutRequestId] || '').trim();
    const claimStatus = String(raw[COL.claimStatus] || '').trim();

    const validationErrors: string[] = [];
    if (!claimId) validationErrors.push('Missing Claim Id');
    if (!individualNric) validationErrors.push('Missing Individual NRIC');
    if (!Number.isFinite(claimAmount) || claimAmount <= 0) validationErrors.push('Claim Amount must be a positive number');
    if (!disbursementDateRaw) validationErrors.push('Missing Disbursement Date');
    else if (!disbursementDateIso) validationErrors.push('Disbursement Date is not in DD/MM/YYYY format');
    if (!payoutRequestId) validationErrors.push('Missing Payout Request ID');

    const baseFields = {
      batch_id: input.batchId,
      row_index: rowIndex,
      claim_id: claimId || null,
      individual_nric: individualNric || null,
      individual_name: individualName || null,
      course_reference_number: courseRefNumber || null,
      course_name: courseName || null,
      course_start_date: courseStartDate || null,
      disbursement_date: disbursementDateRaw || null,
      disbursement_date_iso: disbursementDateIso,
      claim_amount: Number.isFinite(claimAmount) ? claimAmount : null,
      payout_request_id: payoutRequestId || null,
      claim_status: claimStatus || null,
    };

    // Step 1 — Validate
    if (validationErrors.length > 0) {
      counts.invalid_count++;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'invalid',
        matched_enrolment_id: null,
        matched_ssg_claim_id: null,
        sponsorship_type: null,
        matched_qbo_invoice_id: null,
        matched_qbo_doc_number: null,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: null,
        validation_errors: validationErrors,
        apply_status: null,
        apply_error: null,
      });
      continue;
    }

    // Step 2 — Match to ssg_claims
    // Note: ssg_claims uses enrollment_id (American spelling); ssg_enrolments uses enrolment_id (British)
    let matches = await queryClaimMatch(claimId);

    // Fallback for a claim_id that ssg_claims genuinely has no row for at all — a real,
    // confirmed gap: the SSG-claims sync job can lag behind TPGateway's own claim export,
    // even though the learner's enrolment already exists (findable by name in Consolidated
    // Finance Data, which searches this exact ssg_enrolments table). Rather than give up,
    // search ssg_enrolments directly by name + course reference + course start date — the
    // same three signals Consolidated Finance Data's own search already narrows on — and
    // only ever accept the result if NRIC also verifies (same "never trust a fuzzy signal
    // alone" principle as the rest of this file). On a confident match, backfill a proper
    // ssg_claims row from the Excel's own data (the same data the missing sync would have
    // produced) and re-resolve, so every downstream step — invoice resolution, content
    // verification, and the FMS status write-back after apply — works exactly like a
    // normal, already-synced claim, with no separate code path to keep in sync.
    let claimBackfillReason: string | null = null;
    if (matches.rows.length === 0) {
      const backfill = await backfillMissingSsgClaim({
        claimId,
        individualNric,
        individualName,
        courseRefNumber,
        courseName,
        courseStartDateRaw: courseStartDate,
        disbursementDateIso,
        claimAmount,
        payoutRequestId,
        claimStatus,
      });
      if (backfill.ok) {
        matches = await queryClaimMatch(claimId);
      } else {
        claimBackfillReason = backfill.reason;
      }
    }

    if (matches.rows.length === 0) {
      counts.unmatched_count++;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'unmatched',
        matched_enrolment_id: null,
        matched_ssg_claim_id: null,
        sponsorship_type: null,
        matched_qbo_invoice_id: null,
        matched_qbo_doc_number: null,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: null,
        validation_errors: [claimBackfillReason || 'Claim ID not found in FMS'],
        apply_status: null,
        apply_error: null,
      });
      continue;
    }

    if (matches.rows.length > 1) {
      counts.unmatched_count++;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'unmatched',
        matched_enrolment_id: null,
        matched_ssg_claim_id: null,
        sponsorship_type: null,
        matched_qbo_invoice_id: null,
        matched_qbo_doc_number: null,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: null,
        validation_errors: ['Claim ID matches multiple records'],
        apply_status: null,
        apply_error: null,
      });
      continue;
    }

    const match = matches.rows[0];
    const enrolmentId = String(match.enrolment_id || '');
    const sponsorshipType = String(match.sponsorship_type || '');
    const ssgClaimRowId = String(match.ssg_claim_row_id || '');
    const daApplicationId = match.da_application_id ? String(match.da_application_id) : null;
    const daSfcInvoiceId = match.da_sfc_invoice_id ? String(match.da_sfc_invoice_id) : null;

    // Step 2b — Independent cross-check that claim_id -> enrolment_id link is actually correct.
    // The SFC Excel carries no enrolment id at all (unlike Bulk Grant Payment Sync, whose Excel
    // includes it and can cross-check against ssg_grants) — the only path from claim_id to an
    // enrolment here is ssg_claims.enrollment_id, written by a separate SSG-claims sync this
    // feature has never re-verified. ssg_claims and ssg_enrolments each carry their own
    // independently-synced NRIC, so use them the same way Grant uses ssg_grants: an external
    // source checked before any invoice/QB work happens, not trusted blindly.
    //
    // Last-4 comparison (not full string) is deliberate and masking-safe: ssg_enrolments.
    // trainee_nric gets masked to "xxxxx1234" once all three invoices are Paid (see the masking
    // block in sfcImportApply.ts), and last-4 digits always survive that mask. A DB field that's
    // empty is skipped rather than treated as a mismatch — nothing to verify against.
    const excelNricLast4 = individualNric.trim().toUpperCase().slice(-4);
    const claimNricLast4 = String(match.claim_individual_nric || '').trim().toUpperCase().slice(-4);
    const enrolNricLast4 = String(match.trainee_nric || '').trim().toUpperCase().slice(-4);
    const nricMismatches: string[] = [];
    if (excelNricLast4 && claimNricLast4 && claimNricLast4 !== excelNricLast4) {
      nricMismatches.push(`FMS claim record NRIC (...${claimNricLast4})`);
    }
    if (excelNricLast4 && enrolNricLast4 && enrolNricLast4 !== excelNricLast4) {
      nricMismatches.push(`FMS enrolment NRIC (...${enrolNricLast4})`);
    }
    if (nricMismatches.length > 0) {
      counts.needs_review_count++;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'needs_review',
        matched_enrolment_id: enrolmentId,
        matched_ssg_claim_id: ssgClaimRowId,
        sponsorship_type: sponsorshipType,
        da_application_id: daApplicationId,
        da_sfc_invoice_id: daSfcInvoiceId,
        main_qbo_invoice_id: null,
        main_qbo_doc_number: null,
        matched_qbo_invoice_id: null,
        matched_qbo_doc_number: null,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: null,
        validation_errors: [
          `Excel NRIC (...${excelNricLast4}) does not match ${nricMismatches.join(' or ')} for claim_id ${claimId} — the claim_id -> enrolment link may be pointing at the wrong learner`,
        ],
        apply_status: null,
        apply_error: null,
      });
      continue;
    }
    // DA routing is keyed on a REAL (non-placeholder) MySkillsFuture application_id — not on
    // whether da_application.invoice_id happens to be cached. That cache can be empty even when
    // the enrolment's TC/SFC-CA/GRN invoices all genuinely exist and are paid in QuickBooks (a
    // confirmed real case), and gating on it here caused every DA row without that specific cache
    // populated to be blindly routed to (or blocked from ever finding) the wrong invoice. The
    // actual DA-vs-not decision only needs to know "does a real application exist" — whether an
    // invoice can be found for it is handled below, by actually searching, not by assuming.
    const isDa = !!realApplicationId(daApplicationId);

    // Main (TC / net-fee) invoice reference. Only used for non-DA routing below — DA rows never
    // use this, they resolve the SFC-CA invoice directly instead (see the search block below).
    const mainInvoiceId = match.qbo_invoice_id
      ? String(match.qbo_invoice_id)
      : match.da_invoice_id
        ? String(match.da_invoice_id)
        : null;
    const mainDocNumber = match.qbo_doc_number
      ? String(match.qbo_doc_number)
      : match.invoice_no
        ? String(match.invoice_no)
        : null;

    // Target invoice for SFC payment apply:
    // - Non-DA: main invoice
    // - DA: supplemental SFC invoice (DocNumber SFC-CA-...), created later if missing
    let qboInvoiceId = isDa ? (daSfcInvoiceId ? String(daSfcInvoiceId) : null) : mainInvoiceId;
    // For DA rows, derive the SFC invoice doc number from the application ID (SFC-{appId}) when the
    // invoice ID is already stored — this avoids a QB API call on every re-upload while still
    // showing the invoice number in the preview. On first upload (no stored ID) the QB search
    // below fills this in from the live result.
    let qboDocNumber = isDa
      ? (daSfcInvoiceId && daApplicationId ? `SFC-${String(daApplicationId).trim().toUpperCase()}` : null)
      : (mainDocNumber ? String(mainDocNumber) : null);

    // DA rows: if we don't have the supplemental invoice id stored yet, try to find the existing SFC-CA invoice in QB
    // so the preview can correctly show "QB paid" (balance=0) without requiring an FMS apply.
    if (isDa && !qboInvoiceId && daApplicationId) {
      const apps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
      const desiredDocNumber = `SFC-${String(daApplicationId).trim().toUpperCase()}`;
      const found = await qbFindInvoiceByDocNumber(apps, desiredDocNumber);
      if (found?.id) {
        qboInvoiceId = found.id;
        qboDocNumber = found.docNumber;
        // Best-effort backfill so next run resolves from DB
        try {
          await pool.query(
            `UPDATE public.da_application
             SET sfc_invoice_id = $2::varchar
             WHERE LOWER(TRIM(COALESCE(enrolment_id,''))) = LOWER(TRIM($1::text))`,
            [enrolmentId, found.id]
          );
        } catch {
          // best-effort
        }
      }
    }

    // DA row, and no SFC-CA invoice could be found either from cache or a live QuickBooks search
    // — this feature only receives payments against an invoice that already exists, it never
    // creates one, so say plainly that none was found rather than falling through with no invoice
    // attached (da_auto_enrol_error is surfaced when we have it, since it usually explains why).
    if (isDa && !qboInvoiceId) {
      counts.unmatched_count++;
      const genErr = match.da_auto_enrol_error ? String(match.da_auto_enrol_error) : null;
      await insertSfcImportRow({
        ...baseFields,
        match_status: 'unmatched',
        matched_enrolment_id: enrolmentId,
        matched_ssg_claim_id: ssgClaimRowId,
        sponsorship_type: sponsorshipType,
        da_application_id: daApplicationId,
        da_sfc_invoice_id: daSfcInvoiceId,
        // DA row — reserved for Sync QB Invoice IDs' verified search, never the raw cache lookup.
        main_qbo_invoice_id: null,
        main_qbo_doc_number: null,
        matched_qbo_invoice_id: null,
        matched_qbo_doc_number: null,
        matched_qbo_invoice_balance: null,
        matched_qb_payment_id: null,
        validation_errors: [
          genErr
            ? `No SFC invoice (SFC-${daApplicationId}) found for this DA enrolment — related invoice generation previously failed: ${genErr}`
            : `No SFC invoice (SFC-${daApplicationId}) found for this DA enrolment in QuickBooks. This feature does not create invoices — it needs one to already exist to receive a payment against.`,
        ],
        apply_status: null,
        apply_error: null,
      });
      continue;
    }

    // Step 3 — Prior-payment reference (informational only — NOT trusted blindly).
    // sfc_import_rows tracked payment ID (from a previous apply run via this tool), or
    // ssg_claims.qb_payment_id (source-of-truth, set by the apply step when a payment is created).
    // This used to short-circuit straight to "already_applied" without ever re-verifying the
    // invoice — that shortcut is exactly how a wrong match, once cached, stayed wrong on every
    // future upload forever. It now only feeds `matched_qb_payment_id` for display; the row still
    // goes through the same invoice resolution + mandatory content verification as every other row.
    const sfcTrackedPaymentId = appliedQbPaymentIds.get(claimId) ?? null;
    const ssgClaimsPaymentId = match.existing_qb_payment_id ? String(match.existing_qb_payment_id) : null;
    const storedQbPaymentId = sfcTrackedPaymentId ?? ssgClaimsPaymentId;
    const historicallyMarkedApplied = alreadyAppliedSet.has(claimId) || !!storedQbPaymentId;

    // Step 5 — Find QB invoice (main invoice only): DB first, then QB fallback
    // DA enrolments: use da_application.invoice_id before hitting QB API (main TC/net-fee invoice)
    if (!mainInvoiceId && match.da_invoice_id) {
      const candidate = String(match.da_invoice_id);
      // Only backfill main invoice fields; DA SFC invoice is handled separately in apply.
      const resolvedMainInvoiceId = candidate;
      // For non-DA rows, we also use this as the target qboInvoiceId.
      if (!isDa && !qboInvoiceId) qboInvoiceId = resolvedMainInvoiceId;
      if (!mainDocNumber && match.invoice_no) qboDocNumber = String(match.invoice_no);

      // Backfill invoice_jobs so next upload resolves from DB (best-effort)
      try {
        await pool.query(
          `INSERT INTO public.invoice_jobs (enrolment_id, user_id, learner_email, course_code, status, qbo_invoice_id)
           SELECT $1::text, e.user_id, COALESCE(e.email, ''), COALESCE(e.course_reference, ''), 'done', $2::varchar
           FROM public.enrollment e
           WHERE LOWER(TRIM(COALESCE(e.enrolment_id, ''))) = LOWER(TRIM($1::text))
           LIMIT 1
           ON CONFLICT (enrolment_id) DO UPDATE SET
             qbo_invoice_id = EXCLUDED.qbo_invoice_id,
             status = 'done',
             updated_at = now()
           WHERE public.invoice_jobs.qbo_invoice_id IS NULL`,
          [enrolmentId, candidate]
        );
      } catch {
        // best-effort backfill — proceed regardless
      }
    }

    if (!qboInvoiceId && !isDa) {
      if ((i + 1) % 10 === 0 || i === paidRows.length - 1) {
        input.onProgress?.({ pct: 10 + Math.round(((i + 1) / Math.max(1, totalRows)) * 75), message: `Searching QuickBooks for invoice (${i + 1}/${totalRows})…` });
      }
      const searchApps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
      const found = await qbFindInvoiceByEnrolmentId(searchApps, enrolmentId);
      if (found) {
        qboInvoiceId = found.id;
        qboDocNumber = found.docNumber;
        // Backfill invoice_jobs so the next upload resolves from DB (best-effort)
        try {
          await pool.query(
            `INSERT INTO public.invoice_jobs (enrolment_id, user_id, learner_email, course_code, status, qbo_invoice_id, qbo_doc_number)
             SELECT $1::text, e.user_id, COALESCE(e.email, ''), COALESCE(e.course_reference, ''), 'done', $2::varchar, $3::varchar
             FROM public.enrollment e
             WHERE LOWER(TRIM(COALESCE(e.enrolment_id, ''))) = LOWER(TRIM($1::text))
             LIMIT 1
             ON CONFLICT (enrolment_id) DO UPDATE SET
               qbo_invoice_id = EXCLUDED.qbo_invoice_id,
               qbo_doc_number = EXCLUDED.qbo_doc_number,
               status = 'done',
               updated_at = now()
             WHERE public.invoice_jobs.qbo_invoice_id IS NULL`,
            [enrolmentId, found.id, found.docNumber]
          );
        } catch {
          // backfill is best-effort — proceed regardless
        }
      } else {
        counts.unmatched_count++;
        await insertSfcImportRow({
          ...baseFields,
          match_status: 'unmatched',
          matched_enrolment_id: enrolmentId,
          matched_ssg_claim_id: ssgClaimRowId,
          sponsorship_type: sponsorshipType,
          da_application_id: daApplicationId,
          da_sfc_invoice_id: daSfcInvoiceId,
          main_qbo_invoice_id: mainInvoiceId,
          main_qbo_doc_number: mainDocNumber,
          matched_qbo_invoice_id: null,
          matched_qbo_doc_number: null,
          matched_qbo_invoice_balance: null,
          matched_qb_payment_id: null,
          validation_errors: ['No QB invoice found for this enrolment in database or QuickBooks'],
          apply_status: null,
          apply_error: null,
        });
        continue;
      }
    }

    let qboInvoiceBalance: number | null = null;
    let resolvedMatchStatus = 'ready';
    const reviewReasons: string[] = [];

    // DA rows can be "ready" even before the supplemental SFC invoice exists.
    // In that case, Stage 2 will create the invoice (DocNumber SFC-CA-...) and then apply payment.
    //
    // Verification always runs whenever an invoice id is present — including ids cached from
    // invoice_jobs/da_application on prior uploads. A cached id is never trusted blindly: that
    // is exactly how SFC claims previously ended up "already applied" against a grant invoice
    // or another learner's invoice. This costs a QuickBooks read per row (no more size-based
    // shortcut), which is the deliberate trade — correctness over upload speed.
    if (qboInvoiceId) {
      const apps = appOverride === 'app2' ? ['app2', 'app1'] : ['app1', 'app2'];
      let invData: Awaited<ReturnType<typeof qbGetInvoiceById>> = null;
      for (const app of apps) {
        invData = await qbGetInvoiceById(app, qboInvoiceId);
        if (invData !== null) break;
      }

      if (invData === null) {
        resolvedMatchStatus = 'needs_review';
        reviewReasons.push(`Could not read invoice ${qboInvoiceId} from QuickBooks (app1/app2) to verify it`);
        // The doc number shown below is only ever derived/cached (e.g. "SFC-{applicationId}"),
        // never actually confirmed to exist in QuickBooks when we land here — showing it bare
        // implies a confirmed match that never happened. Mark it explicitly so Finance doesn't
        // go hunting in QuickBooks for a number that was never verified to be real.
        if (qboDocNumber) qboDocNumber = `${qboDocNumber} (not found in QB)`;
      } else {
        qboInvoiceBalance = invData.balance;
        // Always show what's actually in QuickBooks once we've successfully read it, rather than
        // the (possibly stale/wrong-type) cached doc number the lookup started from.
        if (invData.docNumber) qboDocNumber = invData.docNumber;
        const verify = await verifySfcInvoiceMatch({
          invoiceRaw: invData.raw,
          docNumber: invData.docNumber || qboDocNumber,
          matchedEnrolmentId: enrolmentId,
          excelNric: individualNric,
          excelCourseRef: courseRefNumber,
          daApplicationId,
        });
        if (!verify.ok) {
          resolvedMatchStatus = 'needs_review';
          reviewReasons.push(verify.reason);
          // Same principle as the "not found" case above: an invoice that verification rejected
          // (wrong type — e.g. TG-/GRN- — or wrong learner/course content) must never be shown
          // bare, as if it were a confirmed, valid target for this SFC claim.
          if (qboDocNumber) qboDocNumber = `${qboDocNumber} (rejected — not a valid TC/SFC invoice, or content mismatch)`;
        } else if (invData.balance === 0 || historicallyMarkedApplied) {
          resolvedMatchStatus = 'already_applied';
        }
      }
    } else if (historicallyMarkedApplied) {
      // We know a payment was created previously, but no invoice id could be resolved to
      // re-verify it against — fail closed rather than trusting the historical record blindly.
      resolvedMatchStatus = 'needs_review';
      reviewReasons.push(
        `Claim was previously marked applied (payment ${storedQbPaymentId || 'unknown'}) but no invoice could be resolved this run to re-verify it`
      );
    }

    if (resolvedMatchStatus === 'already_applied') {
      counts.already_applied_count++;
    } else if (resolvedMatchStatus === 'needs_review') {
      counts.needs_review_count++;
    } else {
      counts.ready_count++;
    }

    // main_qbo_invoice_id / main_qbo_doc_number is the "Customer Invoice No" reference shown
    // in the UI, independent of whatever matched_qbo_doc_number ends up as (which, for a DA
    // row, gets overwritten once its SFC-CA invoice is generated). For a non-DA row the two
    // concepts are the same invoice, so it reuses the just-verified qboInvoiceId/qboDocNumber
    // rather than the raw, NEVER-content-verified cache lookup (mainInvoiceId/mainDocNumber) —
    // that raw cache is exactly what previously caused a wrong invoice number to be shown/used
    // (confirmed live: a coincidental last-6-digit DocNumber collision). For a DA row this is
    // left null here; only Sync QB Invoice IDs' verified search (sync-invoice-ids.ts) is trusted
    // to populate it.
    await insertSfcImportRow({
      ...baseFields,
      match_status: resolvedMatchStatus,
      matched_enrolment_id: enrolmentId,
      matched_ssg_claim_id: ssgClaimRowId,
      sponsorship_type: sponsorshipType,
      da_application_id: daApplicationId,
      da_sfc_invoice_id: daSfcInvoiceId,
      main_qbo_invoice_id: isDa ? null : qboInvoiceId,
      main_qbo_doc_number: isDa ? null : qboDocNumber,
      matched_qbo_invoice_id: qboInvoiceId,
      matched_qbo_doc_number: qboDocNumber,
      matched_qbo_invoice_balance: qboInvoiceBalance,
      matched_qb_payment_id: storedQbPaymentId,
      validation_errors: reviewReasons,
      apply_status: null,
      apply_error: null,
    });
  }

  input.onProgress?.({ pct: 92, message: 'Saving batch summary' });
  await updateSfcImportBatchCounts(input.batchId, counts, 'completed');
  input.onProgress?.({ pct: 100, message: 'Done' });
}
