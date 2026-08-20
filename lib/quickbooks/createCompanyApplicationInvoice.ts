/**
 * Build + POST a QuickBooks invoice for a Company Application group.
 *
 * One invoice per (employer, course) group. Lines:
 *   1. Course fee — qty = N learners, rate = per-learner fee, participant
 *      names listed in description. GST 9% SR.
 *   2..N+1. One negative line per grant scheme (Baseline / MCES / SMEs / etc.)
 *      with grant refs listed in description. Out of Scope.
 *
 * Customer is resolved by `DisplayName = employer_org_name`. If the employer
 * genuinely isn't in QuickBooks yet (after alias / exact / UEN / fuzzy lookup),
 * we AUTO-CREATE the customer — richly populated from the application's employer
 * details (company name / contact / email / phone) so it isn't a bare shell —
 * and persist a UEN→DisplayName alias so future runs match instantly. An
 * *ambiguous* fuzzy match still throws (we won't risk creating a duplicate).
 *
 * Terms depend on prior QBO invoice history with this employer:
 *   - returning customer (≥1 prior invoice) → 30 Days Term
 *   - brand-new customer (no prior invoices) → 14 Days Term
 * BillEmail is the employer's contact email from the Excel (not whatever's
 * stored on the QBO customer record).
 *
 * QBO auto-assigns the DocNumber; we store whatever comes back.
 */

import pool from '../db';
import { callQbProxy } from './qbProxyClient';
import { appendPipelineWarning } from '../companyApplicationsTable';
import { findEmployerQboDisplayNameByUen, upsertEmployerQboAlias } from '../employerQboAliasTable';
import { refreshGrantsForEnrolments } from '../services/billingSync';
import {
  buildCaGrantInvoicePdfFileName,
  createCompanyApplicationGrantInvoice,
} from './createCompanyApplicationGrantInvoice';
import { driveFileExists, uploadInvoicePdfToDrive } from '../services/invoiceDriveUpload';
import {
  qboFetchInvoicePdf,
  qboFindCustomerByName,
  qboFindInvoiceByDocNumber,
  qboFindInvoiceByDocNumberLike,
  qboFindItemByName,
  qboFindItemBySku,
  qboFindOrCreateCompanyCustomer,
  qboFindTermByName,
  qboGetDefaultInvoiceEmailFields,
  qboQuery,
  qboResolveInvoiceLineTaxCodeRef,
  qboResolveOosTaxCodeRef,
} from '../services/qboInvoiceService';

// Term rule for the main tax invoice:
//   - returning employer (any prior QBO invoice) → "30 Days Term" (DueDate = +30d)
//   - brand-new employer (no prior invoices)     → "14 Days Term" (DueDate = +14d)
// Both term names must exist as Sales Terms in QuickBooks (Lists → All Lists →
// Terms). Invoice generation throws with a clear "Term not found" error if
// either is missing.
const CA_TERM_NAME_EXISTING = '30 Days Term';
const CA_TERM_NAME_NEW = '14 Days Term';
const CA_DUE_DAYS_EXISTING = 30;
const CA_DUE_DAYS_NEW = 14;

function buildCaInvoicePdfFileName(docNumber: string | null | undefined, invoiceId: string): string {
  const raw = String(docNumber || invoiceId || '').trim() || 'invoice';
  return `CA_QB_invoice_${raw}`;
}

/**
 * Returns true if the QBO customer already has at least one invoice (any
 * status, any date). Used to pick the term + due-date rule:
 *   - has prior invoice → returning customer → 30 Days Term
 *   - no prior invoice  → brand-new customer  → 14 Days Term
 * Errors are treated as "has history" so a transient QBO probe failure
 * doesn't hand a returning customer the tighter 14-day window.
 */
async function customerHasPriorQboInvoices(customerId: string): Promise<boolean> {
  const safe = String(customerId || '').replace(/'/g, "''").trim();
  if (!safe) return true;
  try {
    const data = await qboQuery(
      undefined,
      `SELECT Id FROM Invoice WHERE CustomerRef = '${safe}' MAXRESULTS 1`
    );
    const inv = data?.QueryResponse?.Invoice;
    const rows = Array.isArray(inv) ? inv : inv ? [inv] : [];
    return rows.length > 0;
  } catch (err) {
    console.warn('[ca-invoice] Failed to check customer invoice history (assuming existing):', err instanceof Error ? err.message : err);
    return true;
  }
}

/**
 * QBO "ValidationFault / Error code 610 / Object Not Found" → the entity we
 * referenced has been deleted or made inactive. Used to distinguish a stale-
 * id situation (clear + regenerate) from a transient failure (skip + retry).
 */
function isQboObjectNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return /\bObject Not Found\b/i.test(message) || /\(code 610\)/i.test(message) || /\berror 610\b/i.test(message);
}

/**
 * Per-group invoice DocNumber, mirroring the DA format `TC{yy}-{mmdd}-{last6}`.
 * The suffix is the last 6 chars of the alphabetically smallest enrolment_id in
 * the group — stable across re-runs (sort is deterministic) and unique per
 * (employer, course-run) because each group has distinct ENR- references.
 */
function buildCaDocNumber(enrolmentIds: string[], now: Date = new Date()): { docNumber: string; suffix: string } {
  const sorted = enrolmentIds
    .map(s => String(s || '').trim())
    .filter(s => /^ENR-/i.test(s))
    .sort();
  if (sorted.length === 0) {
    throw new Error('Cannot build CA DocNumber: no valid ENR- enrolment IDs in group');
  }
  const suffix = sorted[0].slice(-6).toUpperCase();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return { docNumber: `TC${yy}-${mm}${dd}-${suffix}`, suffix };
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function resolveGrantItemName(opts: {
  fundingSchemeCode?: string | null;
  fundingSchemeDescription?: string | null;
}): string {
  const haystack = `${opts.fundingSchemeCode || ''} ${opts.fundingSchemeDescription || ''}`.toLowerCase();
  if (/baseline|\bbl\b/.test(haystack)) return 'WSQ funding (Baseline)';
  const hasMces = /\bmces\b|mid-career enhanced subsidy/.test(haystack);
  const hasSme = /\bsme\b|\bsmes\b|enhanced training support for smes/.test(haystack);
  if (hasMces && hasSme) return 'WSQ funding (MCES/SME)';
  if (hasMces) return 'WSQ funding (MCES)';
  if (hasSme) return 'WSQ funding (SMEs)';
  return 'WSQ funding (MCES/SME)';
}

function resolveSchemeLabel(opts: {
  fundingSchemeCode?: string | null;
  fundingSchemeDescription?: string | null;
}): string {
  const haystack = `${opts.fundingSchemeCode || ''} ${opts.fundingSchemeDescription || ''}`.toLowerCase();
  if (/baseline|\bbl\b/.test(haystack)) return 'Baseline';
  const desc = (opts.fundingSchemeDescription || '').trim();
  if (desc) return desc;
  return 'Enhanced Training Support for SMEs';
}

function maskNric(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 4) return raw;
  return 'X'.repeat(raw.length - 4) + raw.slice(-4);
}

function parseIsoDateUtc(s: string | Date | null | undefined): { d: number; m: number; y: number } | null {
  if (!s) return null;
  const date = s instanceof Date ? s : new Date(s);
  if (Number.isNaN(date.getTime())) return null;
  return {
    d: date.getUTCDate(),
    m: date.getUTCMonth(),
    y: date.getUTCFullYear(),
  };
}

function formatCourseDateRange(
  startStr: string | Date | null | undefined,
  endStr: string | Date | null | undefined
): string {
  const start = parseIsoDateUtc(startStr);
  if (!start) return '';
  const end = parseIsoDateUtc(endStr);

  if (!end || (end.d === start.d && end.m === start.m && end.y === start.y)) {
    return `${start.d} ${SHORT_MONTHS[start.m]} ${start.y}`;
  }
  if (start.m === end.m && start.y === end.y) {
    return `${start.d}-${end.d} ${SHORT_MONTHS[start.m]} ${start.y}`;
  }
  if (start.y === end.y) {
    return `${start.d} ${SHORT_MONTHS[start.m]} - ${end.d} ${SHORT_MONTHS[end.m]} ${start.y}`;
  }
  return `${start.d} ${SHORT_MONTHS[start.m]} ${start.y} - ${end.d} ${SHORT_MONTHS[end.m]} ${end.y}`;
}

function escapeQboLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

// ─── Fuzzy QBO customer matcher ──────────────────────────────────────────────
// Used when the Excel name doesn't match any QBO customer exactly. Pulls the
// full customer list once (in-memory cache, 15min TTL), scores each candidate,
// and accepts the top hit only when it has a clear lead. Successful matches
// are auto-persisted to employer_qbo_alias so the next invoice for the same
// UEN skips the scan.

interface QboCustomerSummary {
  id: string;
  displayName: string;
  companyName: string;
  printOnCheckName: string;
  fullyQualifiedName: string;
  notes: string;
  addressLines: string;
}

let cachedQboCustomers: { rows: QboCustomerSummary[]; fetchedAt: number } | null = null;
const QBO_CUSTOMER_CACHE_TTL_MS = 15 * 60 * 1000;
const QBO_CUSTOMER_PAGE_SIZE = 1000;
const QBO_CUSTOMER_HARD_CAP = 10000;

// Tokens we strip before acronym / distinctive-token matching — too common to
// be discriminating across Singapore company names.
const COMPANY_NAME_STOPWORDS = new Set([
  'pte', 'ltd', 'limited', 'company', 'co', 'corp', 'corporation', 'inc',
  'and', 'the', 'of', 'for', 'in', 'at', 'by', 'to', 'sg', 'singapore', 'group',
  'holdings', 'services', 'service', 'global', 'international',
]);

// Score thresholds. Tuned conservatively because a wrong match invoices the
// wrong customer; we'd rather fall through to the error path than guess.
const FUZZY_MIN_SCORE = 50;
const FUZZY_MIN_LEAD = 20;

async function fetchAllQboCustomers(): Promise<QboCustomerSummary[]> {
  if (cachedQboCustomers && Date.now() - cachedQboCustomers.fetchedAt < QBO_CUSTOMER_CACHE_TTL_MS) {
    return cachedQboCustomers.rows;
  }

  const all: QboCustomerSummary[] = [];
  let position = 1;
  while (position <= QBO_CUSTOMER_HARD_CAP) {
    const data = await qboQuery(
      undefined,
      `SELECT * FROM Customer STARTPOSITION ${position} MAXRESULTS ${QBO_CUSTOMER_PAGE_SIZE}`
    );
    const raw = data?.QueryResponse?.Customer;
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (rows.length === 0) break;
    for (const c of rows) {
      if (!c?.Id) continue;
      const billAddr = c.BillAddr || {};
      const shipAddr = c.ShipAddr || {};
      const addressParts: string[] = [];
      for (const a of [billAddr, shipAddr]) {
        for (const k of ['Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'City', 'PostalCode', 'CountrySubDivisionCode']) {
          if (a?.[k]) addressParts.push(String(a[k]));
        }
      }
      all.push({
        id: String(c.Id),
        displayName: String(c.DisplayName || ''),
        companyName: String(c.CompanyName || ''),
        printOnCheckName: String(c.PrintOnCheckName || ''),
        fullyQualifiedName: String(c.FullyQualifiedName || ''),
        notes: String(c.Notes || ''),
        addressLines: addressParts.join(' '),
      });
    }
    if (rows.length < QBO_CUSTOMER_PAGE_SIZE) break;
    position += rows.length;
  }

  if (position > QBO_CUSTOMER_HARD_CAP) {
    console.warn(`[ca-invoice] QBO customer scan hit ${QBO_CUSTOMER_HARD_CAP}-customer cap — fuzzy matcher may miss beyond this`);
  }

  cachedQboCustomers = { rows: all, fetchedAt: Date.now() };
  return all;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function meaningfulTokens(s: string): string[] {
  return tokenize(s).filter(t => t.length >= 4 && !COMPANY_NAME_STOPWORDS.has(t));
}

function acronymOf(name: string): string {
  return tokenize(name)
    .filter(t => !COMPANY_NAME_STOPWORDS.has(t))
    .map(t => t.charAt(0))
    .join('')
    .toUpperCase();
}

function looksLikeAcronym(s: string): boolean {
  const trimmed = s.trim();
  return trimmed.length >= 2 && trimmed.length <= 6 && /^[A-Z]+$/.test(trimmed);
}

function scoreCustomerMatch(excelName: string, uen: string, c: QboCustomerSummary): number {
  let score = 0;

  // UEN substring — UENs are unique, so any hit is decisive. Search every
  // visible string field, including Notes and address lines where admins
  // commonly stash UENs that aren't surfaced in DisplayName.
  if (uen) {
    const uenLower = uen.toLowerCase();
    const uenHaystack = [
      c.displayName, c.companyName, c.printOnCheckName,
      c.fullyQualifiedName, c.notes, c.addressLines,
    ].join(' ').toLowerCase();
    if (uenHaystack.includes(uenLower)) {
      score += 100;
    }
  }

  // Acronym-style match — "NUP" against (a) initials of multi-word names like
  // "National University Polyclinics", (b) names where "NUP" appears as a
  // whole token like "NUP Pte Ltd" / "NUP - Choa Chu Kang", or (c) names
  // where "NUP" is a substring anywhere in DisplayName/CompanyName/FQN/Notes.
  if (looksLikeAcronym(excelName)) {
    const target = excelName.trim().toUpperCase();
    const lower = target.toLowerCase();
    let acronymHit = 0;

    if (acronymOf(c.displayName) === target) acronymHit = 60;
    else if (c.companyName && acronymOf(c.companyName) === target) acronymHit = 60;
    else if (c.fullyQualifiedName && acronymOf(c.fullyQualifiedName) === target) acronymHit = 60;

    if (acronymHit === 0) {
      const allTokens = new Set([
        ...tokenize(c.displayName),
        ...tokenize(c.companyName),
        ...tokenize(c.fullyQualifiedName),
        ...tokenize(c.notes),
      ]);
      if (allTokens.has(lower)) acronymHit = 60;
    }

    if (acronymHit === 0) {
      const nameHaystack = `${c.displayName} ${c.companyName} ${c.fullyQualifiedName} ${c.notes}`.toLowerCase();
      if (nameHaystack.includes(lower)) acronymHit = 30;
    }

    score += acronymHit;
  }

  // Distinctive token containment — every ≥4-char non-stopword from the Excel
  // appears in the customer name. Full coverage scores higher than partial.
  const excelTokens = meaningfulTokens(excelName);
  if (excelTokens.length > 0) {
    const haystack = `${c.displayName} ${c.companyName} ${c.fullyQualifiedName} ${c.notes}`.toLowerCase();
    const hits = excelTokens.filter(t => haystack.includes(t)).length;
    if (hits === excelTokens.length) score += 30 * hits;
    else if (hits > 0) score += 15 * hits;
  }

  // Plain substring fallback for longer non-acronym names (≥4 chars to avoid
  // noise; short acronyms are already handled above).
  const excelLower = excelName.trim().toLowerCase();
  if (excelLower.length >= 4 && !looksLikeAcronym(excelName)) {
    const nameHaystack = `${c.displayName} ${c.companyName} ${c.fullyQualifiedName}`.toLowerCase();
    if (nameHaystack.includes(excelLower)) score += 25;
  }

  return score;
}

type FuzzyResult =
  | { kind: 'match'; id: string; displayName: string; score: number }
  | { kind: 'ambiguous'; candidates: Array<{ displayName: string; score: number }> }
  | { kind: 'none'; topCandidates: Array<{ displayName: string; score: number }> };

async function fuzzyResolveQboCustomer(opts: {
  employerOrgName: string;
  employerUen: string;
}): Promise<FuzzyResult> {
  const name = (opts.employerOrgName || '').trim();
  const uen = (opts.employerUen || '').trim();
  if (!name && !uen) return { kind: 'none', topCandidates: [] };

  let customers: QboCustomerSummary[];
  try {
    customers = await fetchAllQboCustomers();
  } catch (err) {
    console.warn('[ca-invoice] Fuzzy match: failed to list QBO customers:', err instanceof Error ? err.message : err);
    return { kind: 'none', topCandidates: [] };
  }
  if (customers.length === 0) return { kind: 'none', topCandidates: [] };

  const allScored = customers
    .map(c => ({ id: c.id, displayName: c.displayName, score: scoreCustomerMatch(name, uen, c) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  // Always log the top 5 — invaluable when matching fails and the admin needs
  // to see what's actually in QBO for this employer.
  const topForLog = allScored.slice(0, 5).map(c => `"${c.displayName}"=${c.score}`).join(', ');
  console.log(`[ca-invoice] Fuzzy scan for "${name}" (UEN ${uen}) — ${customers.length} customers scanned. Top scores: ${topForLog || '(none scored)'}`);

  const scored = allScored.filter(c => c.score >= FUZZY_MIN_SCORE);

  if (scored.length === 0) {
    return {
      kind: 'none',
      topCandidates: allScored.slice(0, 5).map(c => ({ displayName: c.displayName, score: c.score })),
    };
  }

  const best = scored[0];
  const runnerUp = scored[1]?.score ?? 0;

  if (best.score - runnerUp < FUZZY_MIN_LEAD) {
    return {
      kind: 'ambiguous',
      candidates: scored.slice(0, 3).map(c => ({ displayName: c.displayName, score: c.score })),
    };
  }

  return { kind: 'match', id: best.id, displayName: best.displayName, score: best.score };
}

async function searchQboCustomer(query: string): Promise<{ id: string; displayName: string } | null> {
  try {
    const data = await qboQuery(undefined, query);
    const raw = data?.QueryResponse?.Customer;
    const c = Array.isArray(raw) ? raw[0] : raw;
    if (!c?.Id) return null;
    return { id: String(c.Id), displayName: String(c.DisplayName || '') };
  } catch (err) {
    // Some realms / fields disallow LIKE — log and move on rather than fail
    // the whole invoice generation on a fallback miss.
    console.warn(`[ca-invoice] QBO customer search failed (continuing): ${query}`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Resolve the QBO customer for a Company Application employer. The Excel may
 * use a short name like "NUP" while the QBO customer is "National University
 * Polyclinics" — so we widen the search beyond exact DisplayName.
 *
 * Order of attempts:
 *   1. Exact DisplayName match (the common case).
 *   2. Exact CompanyName match.
 *   3. UEN substring match across DisplayName, CompanyName, PrintOnCheckName,
 *      then Notes — UENs are unique enough that LIKE '%UEN%' is safe.
 *
 * Throws with a clear error pointing at the data fix if nothing matches.
 */
async function resolveEmployerCustomerRef(opts: {
  employerOrgName: string;
  employerUen: string;
  employerContactEmail?: string;
  employerContactName?: string;
  employerContactPhone?: string;
}): Promise<string> {
  const name = (opts.employerOrgName || '').trim();
  const uen = (opts.employerUen || '').trim();

  // 0. Admin-curated alias by UEN — bypass QBO search entirely when the Excel's
  //    short name (e.g. "NUP") can't be matched in QBO any other way. One row
  //    in employer_qbo_alias per awkward employer is all it takes.
  if (uen) {
    const aliasDisplayName = await findEmployerQboDisplayNameByUen(uen);
    if (aliasDisplayName) {
      const byAlias = await qboFindCustomerByName(undefined, aliasDisplayName);
      if (byAlias?.id) {
        console.log(`[ca-invoice] Matched employer via alias: UEN ${uen} → "${aliasDisplayName}"`);
        return byAlias.id;
      }
      console.warn(`[ca-invoice] Alias for UEN ${uen} points to "${aliasDisplayName}" but no such customer exists in QBO — falling through.`);
    }
  }

  if (name) {
    const byDisplay = await qboFindCustomerByName(undefined, name);
    if (byDisplay?.id) return byDisplay.id;

    const safeName = escapeQboLiteral(name);
    const byCompany = await searchQboCustomer(
      `SELECT * FROM Customer WHERE CompanyName = '${safeName}' MAXRESULTS 1`
    );
    if (byCompany?.id) return byCompany.id;
  }

  if (uen) {
    const safeUen = escapeQboLiteral(uen);
    // Notes intentionally excluded — QBO rejects it with QueryValidationError 4001
    // ("property 'Notes' is not queryable") so it'd burn an API call every time.
    const uenFields = ['DisplayName', 'CompanyName', 'PrintOnCheckName'];
    for (const field of uenFields) {
      const match = await searchQboCustomer(
        `SELECT * FROM Customer WHERE ${field} LIKE '%${safeUen}%' MAXRESULTS 1`
      );
      if (match?.id) {
        console.log(`[ca-invoice] Matched employer via UEN substring on ${field}: "${match.displayName}" (UEN ${uen})`);
        return match.id;
      }
    }
  }

  // Fuzzy fallback — scan all QBO customers and score by acronym / distinctive
  // tokens / substring. Auto-persists confident matches into employer_qbo_alias
  // so the next invoice for the same UEN hits the alias map (step 0) and skips
  // the scan entirely.
  const fuzzy = await fuzzyResolveQboCustomer({ employerOrgName: name, employerUen: uen });

  if (fuzzy.kind === 'match') {
    console.log(`[ca-invoice] Fuzzy-matched employer "${name}" (UEN ${uen}) → "${fuzzy.displayName}" (score ${fuzzy.score})`);
    if (uen) {
      try {
        await upsertEmployerQboAlias({
          employerUen: uen,
          qboDisplayName: fuzzy.displayName,
          note: `Auto-resolved from Excel name "${name}" (score ${fuzzy.score})`,
        });
      } catch (err) {
        console.warn('[ca-invoice] Failed to persist auto-resolved alias (non-fatal):', err instanceof Error ? err.message : err);
      }
    }
    return fuzzy.id;
  }

  if (fuzzy.kind === 'ambiguous') {
    const list = fuzzy.candidates.map((c, i) => `${i + 1}. "${c.displayName}" (score ${c.score})`).join('; ');
    throw new Error(
      `QuickBooks customer ambiguous for employer "${name || '?'}" (UEN ${uen || '?'}). Top candidates: ${list}. Resolve by renaming one to match "${name}" exactly, or appending UEN "${uen}" to its DisplayName/CompanyName in QBO.`
    );
  }

  // fuzzy.kind === 'none' — the employer genuinely isn't in QuickBooks yet.
  // Auto-create the customer so the consolidated invoice can still be generated
  // instead of failing. Populated richly from the application's employer details
  // (company name / contact / email / phone) so it isn't a bare shell. A UEN
  // alias is persisted so the next run for this employer matches via step 0.
  //
  // NOTE: this reverses the old "throw rather than auto-create" behaviour — see
  // the file header. We only reach here after exhaustive lookup AND a non-
  // ambiguous fuzzy result, so the risk of creating a duplicate is low; a
  // typo'd employer name would still create a slightly-wrong customer, which is
  // the accepted trade-off for auto-generating the invoice.
  if (name) {
    try {
      const newCustomerId = await qboFindOrCreateCompanyCustomer(undefined, {
        displayName: name,
        companyName: name,
        email: opts.employerContactEmail,
        phone: opts.employerContactPhone,
        contactName: opts.employerContactName,
      });
      console.log(`[ca-invoice] Auto-created QBO customer for new employer "${name}" (UEN ${uen || '—'}) → id ${newCustomerId}`);
      if (uen) {
        try {
          await upsertEmployerQboAlias({
            employerUen: uen,
            qboDisplayName: name,
            note: `Auto-created QBO customer from CA enrolment for "${name}"`,
          });
        } catch (err) {
          console.warn('[ca-invoice] Failed to persist alias after auto-create (non-fatal):', err instanceof Error ? err.message : err);
        }
      }
      return newCustomerId;
    } catch (createErr) {
      console.error('[ca-invoice] Auto-create of QBO customer failed — falling back to not-found error:', createErr instanceof Error ? createErr.message : createErr);
      // fall through to the not-found throw so the group is surfaced for rescue
    }
  }

  // Auto-create unavailable (no employer name) or failed — surface the original
  // not-found error with the top weak candidates so the admin can act.
  const hints = fuzzy.topCandidates.length > 0
    ? ` Closest names in QBO (all below confidence threshold): ${fuzzy.topCandidates.map((c, i) => `${i + 1}. "${c.displayName}" (score ${c.score})`).join('; ')}.`
    : '';
  throw new Error(
    `QuickBooks customer not found for employer "${name || '?'}" (UEN ${uen || '?'}). Tried alias map, exact DisplayName/CompanyName, UEN substring, and fuzzy scoring against all QBO customers.${hints} Fix: rename the matching QBO customer to "${name}" exactly, or append UEN "${uen}" to its DisplayName / CompanyName.`
  );
}

export interface CaInvoiceLearner {
  applicationId: string;
  fullName: string;
  nric: string;
  enrolmentId: string;
}

export interface CreateCaInvoiceInput {
  employerOrgName: string;
  employerUen: string;
  employerContactEmail: string;
  // Used only to richly populate a NEW QBO customer when the employer isn't in
  // QuickBooks yet (auto-create path). Ignored when the customer already exists.
  employerContactName?: string;
  employerContactPhone?: string;

  courseTitle: string;
  courseReferenceNumber: string;
  courseRunId: string;
  courseStartDate: string | Date | null;
  courseEndDate: string | Date | null;
  courseFee: number;

  learners: CaInvoiceLearner[];
}

export interface CreatedCaInvoice {
  invoiceId: string;
  docNumber: string;
  customerRef: string;
  subtotal: number;
  total: number;
}

interface SchemeAggregate {
  itemName: string;
  schemeLabel: string;
  totalAmount: number;
  qty: number;
  grantRefs: string[];
}

async function fetchLearnerGrantTotals(
  enrolmentIds: string[]
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (enrolmentIds.length === 0) return totals;

  const normalisedIds = enrolmentIds.map(id => id.toLowerCase().trim());
  const result = await pool.query(
    `SELECT
       LOWER(TRIM(enrollment_id)) AS enrolment_key,
       SUM(CASE
         WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
         ELSE COALESCE(estimated_grant_amount, 0)
       END)::float AS total_amt
     FROM public.ssg_grants
     WHERE LOWER(TRIM(enrollment_id)) = ANY($1::text[])
       AND COALESCE(status, '') <> 'Cancelled'
     GROUP BY LOWER(TRIM(enrollment_id))`,
    [normalisedIds]
  );
  for (const row of result.rows) {
    totals.set(String(row.enrolment_key), Number(row.total_amt) || 0);
  }
  return totals;
}

async function aggregateGrantsByScheme(enrolmentIds: string[]): Promise<SchemeAggregate[]> {
  if (enrolmentIds.length === 0) return [];

  // Pull the latest grants from SSG before reading — non-blocking on failure.
  try {
    await refreshGrantsForEnrolments(enrolmentIds);
  } catch (e) {
    console.warn('[createCompanyApplicationInvoice] Grant refresh failed (continuing with DB):', e);
  }

  const normalisedIds = enrolmentIds.map(id => id.toLowerCase().trim());

  const result = await pool.query(
    `SELECT
       enrollment_id,
       grant_id,
       (CASE
         WHEN COALESCE(approved_grant_amount, 0) > 0 THEN approved_grant_amount
         ELSE COALESCE(estimated_grant_amount, 0)
       END)::float AS amt,
       funding_scheme_code,
       funding_scheme_description,
       status
     FROM public.ssg_grants
     WHERE LOWER(TRIM(enrollment_id)) = ANY($1::text[])
       AND COALESCE(status, '') <> 'Cancelled'`,
    [normalisedIds]
  );

  // Bucket grants by enrolment_id so we can iterate in participant order
  // below. The SQL no longer carries ORDER BY because the next loop imposes
  // the order we actually want — the input enrolmentIds array. Caller
  // (createCompanyApplicationInvoice) pre-sorts that array by total grant
  // funding DESC with upload order as tiebreaker, so the grantRefs we emit
  // here naturally line up with the reordered Participant Name list.
  const grantsByEnrolment = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    const key = String(row.enrollment_id || '').toLowerCase().trim();
    if (!grantsByEnrolment.has(key)) grantsByEnrolment.set(key, []);
    grantsByEnrolment.get(key)!.push(row);
  }

  const byScheme = new Map<string, SchemeAggregate>();

  // Walk participants in their input (Excel) order. For each, push their
  // grants into the matching scheme aggregate. Result: grantRefs[N] in any
  // scheme block belongs to participant N from the Participant Name list —
  // a true 1↔1 mapping between the two numbered blocks on the invoice PDF.
  // (Caveat: a learner explicitly marked grant_ineligible contributes nothing
  // to any scheme, so the grant list packs up — there's no gap to preserve
  // strict positional alignment in mixed-eligibility groups. The
  // awaiting-grants guard upstream blocks mixed cases unless an admin has
  // explicitly opted in.)
  for (const enrolmentId of enrolmentIds) {
    const key = enrolmentId.toLowerCase().trim();
    const grants = grantsByEnrolment.get(key) || [];

    for (const row of grants) {
      const amt = Number(row.amt);
      if (!Number.isFinite(amt) || amt <= 0) continue;

      const itemName = resolveGrantItemName({
        fundingSchemeCode: row.funding_scheme_code,
        fundingSchemeDescription: row.funding_scheme_description,
      });
      const schemeLabel = resolveSchemeLabel({
        fundingSchemeCode: row.funding_scheme_code,
        fundingSchemeDescription: row.funding_scheme_description,
      });

      if (!byScheme.has(itemName)) {
        byScheme.set(itemName, {
          itemName,
          schemeLabel,
          totalAmount: 0,
          qty: 0,
          grantRefs: [],
        });
      }

      const agg = byScheme.get(itemName)!;
      agg.qty++;
      agg.totalAmount += amt;
      agg.grantRefs.push(String(row.grant_id || '-'));
    }
  }

  // Baseline must always render first on the invoice, then any other schemes
  // (ETSS/MCES/IBF STS). Map-insertion order is whichever scheme the first
  // participant happened to have first, which is not stable — sort explicitly.
  return Array.from(byScheme.values()).sort((a, b) => {
    const aBaseline = a.itemName === 'WSQ funding (Baseline)' ? 0 : 1;
    const bBaseline = b.itemName === 'WSQ funding (Baseline)' ? 0 : 1;
    return aBaseline - bBaseline;
  });
}

function prefixWsq(title: string): string {
  const trimmed = String(title || '').trim();
  if (!trimmed) return trimmed;
  if (/^WSQ\s*[-–]/i.test(trimmed)) return trimmed;
  return `WSQ - ${trimmed}`;
}

function buildCourseLineDescription(input: CreateCaInvoiceInput): string {
  const parts: string[] = [];
  const titleWithCode = input.courseReferenceNumber
    ? `${prefixWsq(input.courseTitle)} (${input.courseReferenceNumber})`
    : prefixWsq(input.courseTitle);
  parts.push(`Course Name: ${titleWithCode}`);
  // Single-line-per-participant format: "1. NAME (XXXXX123A)". Replaces the
  // previous two-line block (name on one line, NRIC: XXXXX123A on the next)
  // so the invoice description stays compact for groups with many learners.
  parts.push('Participant Name:');
  input.learners.forEach((learner, i) => {
    parts.push(`${i + 1}. ${learner.fullName || '-'} (${maskNric(learner.nric)})`);
  });

  const dateRange = formatCourseDateRange(input.courseStartDate, input.courseEndDate);
  if (dateRange) parts.push(`Course Date: ${dateRange}`);
  if (input.courseRunId) parts.push(`Course Run: ${input.courseRunId}`);

  return parts.join('\n');
}

function buildGrantLineDescription(scheme: SchemeAggregate): string {
  const parts: string[] = [];
  parts.push(`Less: WSQ funding (${scheme.schemeLabel})`);
  // Single "Grant Ref#:" header followed by a numbered list of refs.
  // Positionally aligned with the Participant list in
  // buildCourseLineDescription (grant 1 ↔ participant 1, etc.) as long as
  // all participants share the same scheme. Across-scheme groups list per
  // scheme, so alignment within each scheme block still holds.
  parts.push('Grant Ref#:');
  scheme.grantRefs.forEach((ref, i) => {
    parts.push(`${i + 1}. ${ref}`);
  });
  return parts.join('\n');
}

export async function createCompanyApplicationInvoice(
  input: CreateCaInvoiceInput
): Promise<CreatedCaInvoice> {
  if (!input.learners.length) {
    throw new Error('Cannot generate CA invoice: no learners in group');
  }
  if (!input.courseFee || input.courseFee <= 0) {
    throw new Error(
      `Cannot generate CA invoice: course fee is not set (got ${input.courseFee}). Configure course_fee on the course record.`
    );
  }
  if (!input.employerOrgName) {
    throw new Error('Cannot generate CA invoice: employer organization name missing');
  }
  if (!input.employerContactEmail) {
    throw new Error('Cannot generate CA invoice: employer contact email missing');
  }
  if (!input.courseReferenceNumber) {
    throw new Error('Cannot generate CA invoice: course reference number (TGS code) missing');
  }

  for (const l of input.learners) {
    if (!/^ENR-/i.test(l.enrolmentId || '')) {
      throw new Error(
        `Cannot generate CA invoice: learner "${l.fullName || l.applicationId}" is missing a real SSG enrolment ID (got "${l.enrolmentId || 'empty'}"). Enrol with SSG first.`
      );
    }
  }

  // Reorder participants so learners receiving more grant funding appear
  // first on the invoice (1. = top-funded, then descending). Tiebreaker
  // preserves the original upload order so two learners with identical
  // totals stay in their company_application created_at sequence. Doing
  // this BEFORE aggregateGrantsByScheme means the Grant Ref# list stays
  // positionally aligned with the new Participant Name list (since
  // aggregateGrantsByScheme walks enrolmentIds in the order it receives).
  const learnerGrantTotals = await fetchLearnerGrantTotals(
    input.learners.map(l => l.enrolmentId)
  );
  const learnersWithOrder = input.learners.map((learner, originalIdx) => ({
    learner,
    originalIdx,
    grantTotal: learnerGrantTotals.get(learner.enrolmentId.toLowerCase().trim()) ?? 0,
  }));
  learnersWithOrder.sort((a, b) => {
    if (b.grantTotal !== a.grantTotal) return b.grantTotal - a.grantTotal;
    return a.originalIdx - b.originalIdx;
  });
  input.learners = learnersWithOrder.map(x => x.learner);

  const enrolmentIds = input.learners.map(l => l.enrolmentId);
  const schemes = await aggregateGrantsByScheme(enrolmentIds);

  const customerRef = await resolveEmployerCustomerRef({
    employerOrgName: input.employerOrgName,
    employerUen: input.employerUen,
    employerContactEmail: input.employerContactEmail,
    employerContactName: input.employerContactName,
    employerContactPhone: input.employerContactPhone,
  });

  // Pick the term based on whether this employer has any prior QBO invoice.
  //   - has history → 30 Days Term
  //   - first-ever invoice for this customer → 14 Days Term
  const hasPriorInvoices = await customerHasPriorQboInvoices(customerRef);
  const termName = hasPriorInvoices ? CA_TERM_NAME_EXISTING : CA_TERM_NAME_NEW;
  const dueDays = hasPriorInvoices ? CA_DUE_DAYS_EXISTING : CA_DUE_DAYS_NEW;
  const term = await qboFindTermByName(undefined, termName);
  if (!term?.id) {
    throw new Error(
      `QuickBooks Term "${termName}" not found. Create it in QBO (Lists → All Lists → Terms).`
    );
  }
  console.log(`[ca-invoice] Customer ${customerRef} → ${hasPriorInvoices ? 'has prior invoices' : 'no prior invoices (new)'} → using term "${termName}"`);

  const courseItem = await qboFindItemBySku(undefined, input.courseReferenceNumber);
  if (!courseItem?.id) {
    throw new Error(
      `QBO item not found for SKU: ${input.courseReferenceNumber}. Create the product/service in QuickBooks first.`
    );
  }

  const taxGst = await qboResolveInvoiceLineTaxCodeRef(undefined);
  const taxOos = await qboResolveOosTaxCodeRef(undefined);
  const defaultEmailFields = await qboGetDefaultInvoiceEmailFields(undefined);

  const qty = input.learners.length;
  const courseTotal = Number((qty * input.courseFee).toFixed(2));

  const lines: any[] = [];

  // Line 1 — course fee with participant breakdown in description.
  lines.push({
    DetailType: 'SalesItemLineDetail',
    Amount: courseTotal,
    Description: buildCourseLineDescription(input),
    SalesItemLineDetail: {
      ItemRef: { value: courseItem.id, name: courseItem.name },
      Qty: qty,
      UnitPrice: input.courseFee,
      TaxCodeRef: { value: taxGst },
    },
  });

  // Lines 2+ — one per grant scheme aggregated across learners.
  for (const scheme of schemes) {
    const unitAmount = scheme.totalAmount / scheme.qty;
    const grantItem = await qboFindItemByName(undefined, scheme.itemName);
    const itemRef = grantItem?.id
      ? { value: grantItem.id, name: grantItem.name }
      : { value: courseItem.id, name: courseItem.name };

    lines.push({
      DetailType: 'SalesItemLineDetail',
      Amount: -Number(scheme.totalAmount.toFixed(2)),
      Description: buildGrantLineDescription(scheme),
      SalesItemLineDetail: {
        ItemRef: itemRef,
        Qty: scheme.qty,
        UnitPrice: -Number(unitAmount.toFixed(2)),
        TaxCodeRef: { value: taxOos },
      },
    });
  }

  const txnDate = new Date().toISOString().slice(0, 10);
  const dueDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + dueDays);
    return d.toISOString().slice(0, 10);
  })();

  // Stable DocNumber for this (employer, course-run) group. Built BEFORE the
  // QBO POST so we can also use it for orphan recovery — a network blip
  // between POST and DB save would otherwise create a duplicate invoice.
  const { docNumber, suffix } = buildCaDocNumber(enrolmentIds);

  // Orphan recovery — if a prior attempt already posted this invoice to QBO
  // but failed to persist locally, reuse it instead of creating a duplicate.
  //   1. Same DocNumber today
  //   2. LIKE search by the stable -{suffix} so a retry on a later day matches
  const existingToday = await qboFindInvoiceByDocNumber(undefined, docNumber);
  const existingBySuffix = !existingToday?.id && suffix
    ? await qboFindInvoiceByDocNumberLike(undefined, `TC%-${suffix}`)
    : null;
  const orphan = existingToday ?? existingBySuffix;
  if (orphan?.id) {
    const orphanDocNumber = String(orphan.raw?.DocNumber || docNumber);
    console.log(`[QBO CA invoice] Reusing orphan invoice ${orphan.id} (DocNumber ${orphanDocNumber}) for group ${input.employerUen}|${input.courseRunId}`);
    const reusedDocNumber = orphanDocNumber;
    const subtotal = Number(
      (courseTotal - schemes.reduce((s, x) => s + x.totalAmount, 0)).toFixed(2)
    );
    const total = Number((subtotal * 1.09).toFixed(2));
    return {
      invoiceId: String(orphan.id),
      docNumber: String(reusedDocNumber),
      customerRef,
      subtotal,
      total,
    };
  }

  // ShipAddr intentionally blanked — CA invoices have no shipping concept,
  // and QBO otherwise inherits the customer's default ShipAddr and renders a
  // "Shipping to" box on the PDF. BillAddr is left alone so the employer's
  // QBO billing address still prints normally.
  const invoiceBody = {
    CustomerRef: { value: customerRef },
    DocNumber: docNumber,
    BillEmail: { Address: input.employerContactEmail },
    ShipAddr: {
      Line1: '',
      Line2: '',
      Line3: '',
      Line4: '',
      Line5: '',
    },
    ...defaultEmailFields,
    TxnDate: txnDate,
    DueDate: dueDate,
    SalesTermRef: { value: term.id },
    GlobalTaxCalculation: 'TaxExcluded',
    Line: lines,
  };

  console.log('[QBO CA invoice body]', JSON.stringify(invoiceBody, null, 2));

  const createResp = await callQbProxy({
    action: 'create',
    entity: 'invoice',
    body: invoiceBody,
  });

  const invoice = createResp.data?.Invoice;
  if (!invoice?.Id) {
    throw new Error('QB invoice create returned no Id');
  }

  const subtotal = Number(
    (courseTotal - schemes.reduce((s, x) => s + x.totalAmount, 0)).toFixed(2)
  );
  const total = Number(invoice.TotalAmt) || Number((subtotal * 1.09).toFixed(2));

  return {
    invoiceId: String(invoice.Id),
    docNumber: String(invoice.DocNumber || docNumber),
    customerRef,
    subtotal,
    total,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Group + generate flow — shared by manual API and auto-trigger after upload.
// ────────────────────────────────────────────────────────────────────────────

export interface GenerateInvoicesResult {
  generated: number;
  /** Total skipped (sum of skippedAlreadyInvoiced + skippedNotEnrolled + skippedAwaitingGrants). Kept for backwards-compat. */
  skipped: number;
  /** Groups that already have an invoice_id — re-running just self-heals Drive/grant invoices. */
  skippedAlreadyInvoiced: number;
  /** Groups where ≥1 learner is missing an ENR- enrolment ID. */
  skippedNotEnrolled: number;
  /** Groups where ≥1 learner is enrolled but has no positive ssg_grants row yet. */
  skippedAwaitingGrants: number;
  failed: number;
  errors: Array<{
    groupKey: string;
    employerUen: string;
    employerOrgName: string;
    courseRunId: string;
    error: string;
    /** True when the failure was specifically the QBO customer lookup, so the UI can offer a "Search QBO & Link" rescue. */
    isCustomerNotFound: boolean;
  }>;
}

const CUSTOMER_NOT_FOUND_MARKERS = [
  'QuickBooks customer not found',
  'QuickBooks customer ambiguous',
];

function isCustomerLookupError(message: string): boolean {
  return CUSTOMER_NOT_FOUND_MARKERS.some(marker => message.includes(marker));
}

/**
 * Billing granularity for a Generate Invoice run.
 *
 *  - `consolidated` (default): one QBO invoice per (employer_uen,
 *    course_run_id) — every selected learner from the same employer on the
 *    same run lands on a single tax invoice. This is what the automated
 *    pipeline uses.
 *  - `per-learner`: one QBO invoice per learner. Admin sometimes needs to bill
 *    a single person on their own (a late joiner, or an employer who wants the
 *    learners split), which a consolidated run can't express.
 *
 * The mode only changes how selected rows are grouped — every downstream
 * guard (enrolment, grant, idempotency) is unchanged and still runs per group.
 */
export type InvoiceGenerationMode = 'consolidated' | 'per-learner';

/**
 * Group the given application IDs and generate one QBO invoice per group —
 * per (employer_uen, course_run_id) by default, or per learner when
 * `mode: 'per-learner'`. Idempotent — rows that already have an `invoice_id`
 * are never re-billed, only self-healed.
 */
export async function generateInvoicesForApplications(
  applicationIds: string[],
  mode: InvoiceGenerationMode = 'consolidated'
): Promise<GenerateInvoicesResult> {
  const result: GenerateInvoicesResult = {
    generated: 0,
    skipped: 0,
    skippedAlreadyInvoiced: 0,
    skippedNotEnrolled: 0,
    skippedAwaitingGrants: 0,
    failed: 0,
    errors: [],
  };
  if (!applicationIds.length) return result;

  const rowsRes = await pool.query(
    `SELECT
       ca.id,
       ca.trainee_full_name,
       ca.trainee_nric,
       ca.enrolment_id,
       ca.invoice_id,
       ca.invoice_doc_number,
       ca.invoice_drive_file_id,
       ca.grant_invoice_id,
       ca.grant_invoice_doc_number,
       ca.grant_invoice_drive_file_id,
       ca.grant_ineligible,
       ca.employer_org_name,
       ca.employer_uen,
       ca.employer_contact_email,
       ca.employer_contact_name,
       ca.employer_contact_phone,
       ca.course_reference_number,
       ca.course_run_id,
       ca.course_start_date,
       cr.start_date::text AS run_start_date,
       cr.end_date::text   AS run_end_date,
       c.title             AS db_course_title,
       c.course_fee        AS db_course_fee
     FROM public.company_application ca
     LEFT JOIN public.course_run cr
       ON cr.course_run_id::text = ca.course_run_id::text
       OR cr.id::text = ca.course_run_id::text
     LEFT JOIN public.course c ON c.id = cr.course_id
     WHERE ca.id = ANY($1::uuid[])
     ORDER BY ca.created_at, ca.id`,
    [applicationIds]
  );

  // In per-learner mode the application id joins the key, so every row lands
  // in a group of its own and gets its own invoice. Everything below the
  // grouping is mode-agnostic — a one-learner group is just a small group.
  const groups = new Map<string, any[]>();
  // lockKeys stays keyed on (employer, course-run) even in per-learner mode:
  // the advisory lock must be mode-independent, or a consolidated click and a
  // per-learner click racing on the same rows would take different locks and
  // could both POST to QBO.
  const lockKeys = new Map<string, string>();
  for (const row of rowsRes.rows) {
    const billingKey = `${(row.employer_uen || '').trim()}|${(row.course_run_id || '').trim()}`;
    const key = mode === 'per-learner' ? `${billingKey}|${String(row.id)}` : billingKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
    lockKeys.set(key, billingKey);
  }

  for (const [key, rows] of groups) {
    // Advisory lock per (employer, course-run) group. Stops the narrow window
    // where two concurrent Generate Invoice clicks both read invoice_id = NULL
    // and both POST to QBO. DocNumber-based orphan recovery already mitigates
    // this (the second caller's POST returns the first's invoice via the LIKE
    // search), but the lock guarantees we never even attempt the second POST.
    const groupLockKey = `ca-inv:${lockKeys.get(key) ?? key}`;
    let groupLockClient;
    try {
      groupLockClient = await pool.connect();
    } catch (connectErr) {
      // Pool exhausted — record as a per-group failure and try the next group
      // instead of bailing out of the whole batch.
      const first = rows[0] || {};
      const message = connectErr instanceof Error ? connectErr.message : String(connectErr);
      console.error(`[ca-invoice] pool.connect failed for group ${key}:`, message);
      result.failed++;
      result.errors.push({
        groupKey: key,
        employerUen: String(first.employer_uen || '').trim(),
        employerOrgName: String(first.employer_org_name || '').trim(),
        courseRunId: String(first.course_run_id || '').trim(),
        error: `Could not acquire DB connection for advisory lock: ${message}`,
        isCustomerNotFound: false,
      });
      continue;
    }
    let groupLockAcquired = false;
    try {
      const groupLockRes = await groupLockClient.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
        [groupLockKey]
      );
      groupLockAcquired = !!groupLockRes.rows[0]?.locked;
      if (!groupLockAcquired) {
        console.log(`[ca-invoice] Group ${key} already being generated by another worker; skipping`);
        result.skipped++;
        continue;
      }

    try {
      // A (employer, course-run) group is often MIXED: some learners were
      // billed by an earlier click, others weren't. Split on invoice_id.
      // Without this, one already-invoiced sibling made the WHOLE group report
      // "already invoiced — cannot regenerate", so a learner added later could
      // never be billed; and when the uninvoiced learner happened to sort
      // first, the new invoice_id was written over the sibling's — re-billing
      // someone who already had an invoice.
      const invoicedRows = rows.filter(r => String(r.invoice_id || '').trim());
      const pendingRows = rows.filter(r => !String(r.invoice_id || '').trim());

      // Idempotency — already invoiced. Self-heal the Drive PDF link only,
      // and run per-learner grant invoices (fills in any that weren't
      // generated previously OR repairs their Drive files). Keyed by
      // invoice_id because a group can carry several once it's billed in
      // more than one batch.
      if (invoicedRows.length > 0) {
        const byInvoiceId = new Map<string, any[]>();
        for (const r of invoicedRows) {
          const id = String(r.invoice_id).trim();
          if (!byInvoiceId.has(id)) byInvoiceId.set(id, []);
          byInvoiceId.get(id)!.push(r);
        }
        for (const [existingInvoiceId, invoiceRows] of byInvoiceId) {
          const head = invoiceRows[0];
          const existingDriveFileId = String(head.invoice_drive_file_id || '').trim();
          const existingDocNumber = String(head.invoice_doc_number || '').trim();
          const driveOk = existingDriveFileId
            ? await driveFileExists(existingDriveFileId)
            : false;
          if (!driveOk) {
            try {
              const driveUpload = await uploadInvoicePdfForRowGroup({
                invoiceId: existingInvoiceId,
                docNumber: existingDocNumber,
              });
              await pool.query(
                `UPDATE public.company_application
                    SET invoice_drive_file_id         = $1,
                        invoice_drive_web_view_link   = $2,
                        updated_at                    = now()
                  WHERE id = ANY($3::uuid[])`,
                [driveUpload.fileId, driveUpload.webViewLink, invoiceRows.map(r => r.id)]
              );
            } catch (err) {
              console.warn(`[ca-invoice] Drive re-upload for group ${key} failed (non-fatal):`, err instanceof Error ? err.message : err);
            }
          }
          await processGrantInvoicesForGroup(invoiceRows, existingDocNumber || existingInvoiceId);
        }
        result.skipped++;
        result.skippedAlreadyInvoiced++;
      }

      // Every selected learner in this group is already billed.
      if (pendingRows.length === 0) continue;

      const rowIds = pendingRows.map(r => r.id);
      const first = pendingRows[0];

      const missing = pendingRows.filter(r => !/^ENR-/i.test(String(r.enrolment_id || '')));
      if (missing.length > 0) {
        result.skipped++;
        result.skippedNotEnrolled++;
        console.log(
          `[ca-invoice] Skipping group ${key}: ${missing.length} row(s) not yet enrolled with SSG`
        );
        continue;
      }

      // Refuse to bill until every learner is either (a) granted by SSG or
      // (b) explicitly marked grant_ineligible on the View page. Without
      // this guard, clicking Generate Invoice before stakeholders apply
      // grants would create a full-fee invoice and the employer would be
      // double-billed once the grant arrives later. ssg_grants is
      // authoritative — we don't trust ca.grant_id alone because Sync
      // Grants populates ssg_grants without necessarily refreshing the
      // company_application row.
      const enrolmentIdsLower = pendingRows.map(r => String(r.enrolment_id || '').toLowerCase().trim());
      // Accept either a positive approved amount OR a positive estimated
      // amount. SSG often returns approved=0 + estimated=N while a grant is
      // in "Grant Processing" status — COALESCE(approved, estimated, 0)
      // would incorrectly return 0 because approved is 0 (not NULL),
      // skipping the row. We want the invoice to use whichever amount is
      // present; aggregateGrantsByScheme already prefers approved when
      // positive, falling back to estimated otherwise.
      const grantedRes = await pool.query(
        `SELECT DISTINCT LOWER(TRIM(enrollment_id)) AS enrolment_key
           FROM public.ssg_grants
          WHERE LOWER(TRIM(enrollment_id)) = ANY($1::text[])
            AND COALESCE(status, '') <> 'Cancelled'
            AND (
              COALESCE(approved_grant_amount, 0) > 0
              OR COALESCE(estimated_grant_amount, 0) > 0
            )`,
        [enrolmentIdsLower]
      );
      const grantedSet = new Set<string>(grantedRes.rows.map((r: any) => String(r.enrolment_key)));
      const learnersAwaitingGrants = pendingRows.filter(r => {
        if (r.grant_ineligible === true) return false; // admin override: bill at full fee
        const key = String(r.enrolment_id || '').toLowerCase().trim();
        return !grantedSet.has(key);
      });
      if (learnersAwaitingGrants.length > 0) {
        result.skipped++;
        result.skippedAwaitingGrants++;
        const names = learnersAwaitingGrants
          .map(r => String(r.trainee_full_name || '').trim() || String(r.trainee_nric || '').trim() || '(unnamed)')
          .slice(0, 5)
          .join(', ');
        const more = learnersAwaitingGrants.length > 5 ? ` (+${learnersAwaitingGrants.length - 5} more)` : '';
        console.log(
          `[ca-invoice] Skipping group ${key}: ${learnersAwaitingGrants.length} learner(s) awaiting grant application — ${names}${more}`
        );

        result.errors.push({
          groupKey: key,
          employerUen: String(first.employer_uen || '').trim(),
          employerOrgName: String(first.employer_org_name || '').trim(),
          courseRunId: String(first.course_run_id || '').trim(),
          error: `${learnersAwaitingGrants.length} learner(s) awaiting grant: ${names}${more}. Either click "Sync Grants" after stakeholders apply, or mark the learner as "Not Grant Eligible" on the View page to bill at full fee.`,
          isCustomerNotFound: false,
        });
        continue;
      }

      const courseFee = Number(first.db_course_fee);
      if (!Number.isFinite(courseFee) || courseFee <= 0) {
        result.failed++;
        result.errors.push({
          groupKey: key,
          employerUen: String(first.employer_uen || '').trim(),
          employerOrgName: String(first.employer_org_name || '').trim(),
          courseRunId: String(first.course_run_id || '').trim(),
          error: `Course fee not configured for ${first.course_reference_number || '?'}`,
          isCustomerNotFound: false,
        });
        continue;
      }

      const inv = await createCompanyApplicationInvoice({
        employerOrgName: String(first.employer_org_name || '').trim(),
        employerUen: String(first.employer_uen || '').trim(),
        employerContactEmail: String(first.employer_contact_email || '').trim(),
        employerContactName: String(first.employer_contact_name || '').trim(),
        employerContactPhone: String(first.employer_contact_phone || '').trim(),
        courseTitle: String(first.db_course_title || '').trim(),
        courseReferenceNumber: String(first.course_reference_number || '').trim(),
        courseRunId: String(first.course_run_id || '').trim(),
        courseStartDate: first.run_start_date || first.course_start_date || null,
        courseEndDate: first.run_end_date || null,
        courseFee,
        learners: pendingRows.map(r => ({
          applicationId: String(r.id),
          fullName: String(r.trainee_full_name || '').trim(),
          nric: String(r.trainee_nric || '').trim(),
          enrolmentId: String(r.enrolment_id || '').trim(),
        })),
      });

      // Persist invoice id first so a Drive-upload failure doesn't cause the
      // next run to re-bill the customer.
      await pool.query(
        `UPDATE public.company_application
            SET invoice_id         = $1,
                invoice_doc_number = $2,
                updated_at         = now()
          WHERE id = ANY($3::uuid[])`,
        [inv.invoiceId, inv.docNumber, rowIds]
      );

      // Fetch the QBO PDF and upload to Drive. Non-fatal — the next sweep
      // (or a manual "Generate Invoice" click) will re-attempt via the
      // self-heal branch above.
      try {
        const driveUpload = await uploadInvoicePdfForRowGroup({
          invoiceId: inv.invoiceId,
          docNumber: inv.docNumber,
        });
        await pool.query(
          `UPDATE public.company_application
              SET invoice_drive_file_id       = $1,
                  invoice_drive_web_view_link = $2,
                  updated_at                  = now()
            WHERE id = ANY($3::uuid[])`,
          [driveUpload.fileId, driveUpload.webViewLink, rowIds]
        );
      } catch (err) {
        console.warn(`[ca-invoice] Drive upload for group ${key} failed (non-fatal):`, err instanceof Error ? err.message : err);
      }

      // Per-learner grant invoices, each cross-referenced via PO# to the
      // group's main DocNumber. Non-fatal — failures here don't roll back
      // the successful main invoice.
      await processGrantInvoicesForGroup(pendingRows, inv.docNumber);

      result.generated++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      const first = rows[0];
      result.errors.push({
        groupKey: key,
        employerUen: String(first?.employer_uen || '').trim(),
        employerOrgName: String(first?.employer_org_name || '').trim(),
        courseRunId: String(first?.course_run_id || '').trim(),
        error: message,
        isCustomerNotFound: isCustomerLookupError(message),
      });
      console.error(`[ca-invoice] Group ${key} failed:`, err);
    }
    } finally {
      if (groupLockAcquired) {
        await groupLockClient
          .query(`SELECT pg_advisory_unlock(hashtext($1))`, [groupLockKey])
          .catch(unlockErr => {
            console.warn(
              `[ca-invoice] Failed to release advisory lock for group ${key}:`,
              unlockErr instanceof Error ? unlockErr.message : unlockErr
            );
          });
      }
      groupLockClient.release();
    }
  }

  return result;
}

/**
 * For each learner in the group with positive ssg_grants, create a per-learner
 * grant invoice (billed to WSG) cross-referenced to the group's main tax
 * invoice via PO#. Fetches the PDF and uploads to Drive. Idempotent —
 * already-grant-invoiced rows are left alone unless their Drive file is
 * missing, in which case the PDF is re-fetched and re-uploaded (self-heal).
 *
 * Non-fatal: any per-learner failure is logged but doesn't stop the rest of
 * the group. The next Generate Invoice click can retry.
 */
async function processGrantInvoicesForGroup(
  rows: any[],
  mainInvoiceDocNumber: string
): Promise<void> {
  for (const r of rows) {
    const applicationId = String(r.id || '');
    const enrolmentId = String(r.enrolment_id || '').trim();
    let existingGrantInvoiceId = String(r.grant_invoice_id || '').trim();
    let existingGrantDriveFileId = String(r.grant_invoice_drive_file_id || '').trim();

    if (!applicationId || !/^ENR-/i.test(enrolmentId)) continue;

    try {
      // Already grant-invoiced — self-heal the Drive PDF only.
      if (existingGrantInvoiceId) {
        const driveOk = existingGrantDriveFileId
          ? await driveFileExists(existingGrantDriveFileId)
          : false;
        if (driveOk) continue;

        const existingGrantDocNumber = String(r.grant_invoice_doc_number || '').trim();
        try {
          const pdf = await qboFetchInvoicePdf(undefined, existingGrantInvoiceId);
          const drive = await uploadInvoicePdfToDrive({
            pdf,
            fileName: buildCaGrantInvoicePdfFileName(existingGrantDocNumber || existingGrantInvoiceId),
          });
          await pool.query(
            `UPDATE public.company_application
                SET grant_invoice_drive_file_id       = $1,
                    grant_invoice_drive_web_view_link = $2,
                    updated_at                        = now()
              WHERE id = $3`,
            [drive.fileId, drive.webViewLink, applicationId]
          );
          continue;
        } catch (err) {
          // QBO 610 / "Object Not Found" → the stored grant_invoice_id points
          // at a QBO record that's been deleted or made inactive. Clear the
          // stale id + drive fields and fall through to fresh generation
          // below. Anything else is a transient failure we log and skip.
          if (isQboObjectNotFoundError(err)) {
            console.warn(`[ca-grant-invoice] Stale grant_invoice_id ${existingGrantInvoiceId} for learner ${applicationId} (deleted in QBO); clearing and regenerating`);
            await pool.query(
              `UPDATE public.company_application
                  SET grant_invoice_id                  = NULL,
                      grant_invoice_doc_number          = NULL,
                      grant_invoice_drive_file_id       = NULL,
                      grant_invoice_drive_web_view_link = NULL,
                      updated_at                        = now()
                WHERE id = $1`,
              [applicationId]
            );
            existingGrantInvoiceId = '';
            existingGrantDriveFileId = '';
            // fall through to fresh generation
          } else {
            console.warn(`[ca-grant-invoice] Drive re-upload for learner ${applicationId} failed (non-fatal):`, err instanceof Error ? err.message : err);
            await appendPipelineWarning(applicationId, 'grant_invoice_drive_reupload', err);
            continue;
          }
        }
      }

      // Fresh generation — returns null if SSG has no positive grants for this
      // learner (perfectly valid — that learner just doesn't get a grant inv,
      // e.g. grant_ineligible). But if a grant_id IS present on the row, a
      // null return signals out-of-sync data (grant materialised in
      // company_application but never landed in ssg_grants) — surface that
      // so admin can spot it.
      const grantInv = await createCompanyApplicationGrantInvoice({
        enrolmentId,
        mainInvoiceDocNumber: mainInvoiceDocNumber || null,
      });
      if (!grantInv) {
        const grantId = String(r.grant_id || '').trim();
        const grantIneligible = r.grant_ineligible === true;
        if (grantId && !grantIneligible) {
          console.warn(
            `[ca-grant-invoice] Skipped fresh generation for learner ${applicationId} — ssg_grants has no positive amount for enrolment ${enrolmentId} despite company_application.grant_id=${grantId}. Run Sync Grants to populate ssg_grants.`
          );
          await appendPipelineWarning(
            applicationId,
            'grant_invoice_missing_ssg_data',
            `ssg_grants has no positive grant for enrolment ${enrolmentId} (CA row has grant_id=${grantId}). Click Sync Grants then retry Generate Invoice.`
          );
        }
        continue;
      }

      // Persist id first so a Drive failure doesn't cause a duplicate next run.
      await pool.query(
        `UPDATE public.company_application
            SET grant_invoice_id         = $1,
                grant_invoice_doc_number = $2,
                updated_at               = now()
          WHERE id = $3`,
        [grantInv.invoiceId, grantInv.docNumber, applicationId]
      );

      try {
        const pdf = await qboFetchInvoicePdf(undefined, grantInv.invoiceId);
        const drive = await uploadInvoicePdfToDrive({
          pdf,
          fileName: buildCaGrantInvoicePdfFileName(grantInv.docNumber),
        });
        await pool.query(
          `UPDATE public.company_application
              SET grant_invoice_drive_file_id       = $1,
                  grant_invoice_drive_web_view_link = $2,
                  updated_at                        = now()
            WHERE id = $3`,
          [drive.fileId, drive.webViewLink, applicationId]
        );
      } catch (err) {
        console.warn(`[ca-grant-invoice] Drive upload for learner ${applicationId} failed (non-fatal):`, err instanceof Error ? err.message : err);
        await appendPipelineWarning(applicationId, 'grant_invoice_drive_upload', err);
      }
    } catch (err) {
      console.warn(`[ca-grant-invoice] Generation failed for learner ${applicationId} (enrolment ${enrolmentId}) (non-fatal):`, err instanceof Error ? err.message : err);
      await appendPipelineWarning(applicationId, 'grant_invoice_generation', err);
    }
  }
}

async function uploadInvoicePdfForRowGroup(opts: {
  invoiceId: string;
  docNumber: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const pdf = await qboFetchInvoicePdf(undefined, opts.invoiceId);
  return uploadInvoicePdfToDrive({
    pdf,
    fileName: buildCaInvoicePdfFileName(opts.docNumber, opts.invoiceId),
  });
}
