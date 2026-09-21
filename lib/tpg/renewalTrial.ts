import pool from '../db';
import {
  addCalendarMonths,
  buildRenewalPlan,
  canonicalizeTpgRows,
  computePlanHash,
  inspectCaptureDocument,
  normalizeDate,
  RENEWAL_PLAN_SCHEMA_VERSION,
  RenewalPlanError,
  statesEqual,
  verifyPlanHash,
  type CourseSnapshot,
  type RenewalPlanRow,
  type RenewalState,
  type SourceTab,
} from './renewalSync';

export interface TrialPlan {
  schemaVersion: number;
  kind: 'tpg-renewal-database-plan';
  createdAt: string;
  scope: {
    timezone: 'Asia/Singapore';
    asOfDate: string;
    throughDate: string;
    inclusive: true;
    courseType: 'WSQ';
  };
  captures: Record<string, unknown>;
  summary: ReturnType<typeof buildRenewalPlan>['summary'];
  rows: RenewalPlanRow[];
  planHash: string;
}

export interface TrialAudit {
  schemaVersion: 1;
  kind: 'tpg-renewal-database-apply-audit';
  createdAt: string;
  committed: boolean;
  planHash: string;
  summary: { matched: number; updated: number; alreadyCorrect: number; failed: number };
  rows: Array<Record<string, unknown>>;
}

function singaporeDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validatePageAudit(document: unknown, sourceTab: SourceTab, rowCount: number, total: number): void {
  const root = document as Record<string, any>;
  const container = root[sourceTab === 'Submissions' ? 'submissions' : 'rejectedApplications'] ?? root;
  const pageAudit = container.pageAudit;
  if (!Array.isArray(pageAudit) || pageAudit.length === 0) {
    throw new RenewalPlanError(`${sourceTab} has no page-by-page coverage audit.`);
  }
  let nextStart = 1;
  let counted = 0;
  for (const [index, page] of pageAudit.entries()) {
    if (!page || typeof page !== 'object' || page.page !== index + 1) {
      throw new RenewalPlanError(`${sourceTab} page audit is out of sequence.`);
    }
    if (total === 0 && index === 0 && page.rows === 0) continue;
    const match = String(page.summary ?? '').match(/(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+records?/i);
    if (!match) throw new RenewalPlanError(`${sourceTab} page ${page.page} has no valid range summary.`);
    const [, startText, endText, totalText] = match;
    const start = Number(startText);
    const end = Number(endText);
    if (start !== nextStart || end < start || Number(totalText) !== total || page.rows !== end - start + 1) {
      throw new RenewalPlanError(`${sourceTab} page ${page.page} has inconsistent coverage.`);
    }
    nextStart = end + 1;
    counted += page.rows;
  }
  if (counted !== rowCount || counted !== total) {
    throw new RenewalPlanError(`${sourceTab} page audit covers ${counted} of ${total} rows.`);
  }
}

function inspectFreshCapture(document: unknown, sourceTab: SourceTab) {
  const capture = inspectCaptureDocument(document, sourceTab);
  if (!capture.complete || capture.reportedTotal === null) {
    throw new RenewalPlanError(`${sourceTab} does not prove complete coverage.`);
  }
  if (!capture.sourceUrl || new URL(capture.sourceUrl).hostname !== 'www.tpgateway.gov.sg') {
    throw new RenewalPlanError(`${sourceTab} source URL is not TPGateway.`);
  }
  const captureTime = Date.parse(capture.scrapedAt ?? '');
  if (!Number.isFinite(captureTime) || Math.abs(Date.now() - captureTime) > 2 * 60 * 60 * 1000) {
    throw new RenewalPlanError(`${sourceTab} capture is not fresh (maximum 2 hours).`);
  }
  validatePageAudit(document, sourceTab, capture.rows.length, capture.reportedTotal);
  return capture;
}

export async function createTrialPlan(captures: unknown): Promise<TrialPlan> {
  if (!captures || typeof captures !== 'object' || Array.isArray(captures)) {
    throw new RenewalPlanError('Capture payload must be an object.');
  }
  const submissions = inspectFreshCapture(captures, 'Submissions');
  const rejected = inspectFreshCapture(captures, 'Rejected Applications');
  if (Math.abs(Date.parse(submissions.scrapedAt!) - Date.parse(rejected.scrapedAt!)) > 180 * 60 * 1000) {
    throw new RenewalPlanError('Submissions and Rejected Applications were captured more than 180 minutes apart.');
  }
  const asOfDate = singaporeDate();
  const throughDate = addCalendarMonths(asOfDate, 3);
  const sourceRows = [
    ...canonicalizeTpgRows(submissions.rows, 'Submissions'),
    ...canonicalizeTpgRows(rejected.rows, 'Rejected Applications'),
  ];
  const client = await pool.connect();
  const courses: CourseSnapshot[] = [];
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(
      `SELECT id::text, title, course_code, new_course_code, course_type::text,
              funding_validity, actual_renew_date::text AS actual_renew_date,
              NULLIF(BTRIM(renewal_application_no), '') AS renewal_application_no,
              NULLIF(BTRIM(renewed_status), '') AS renewed_status
       FROM public.course WHERE course_type::text = 'WSQ' ORDER BY title, id`,
    );
    for (const raw of result.rows) {
      const fundingValidity = normalizeDate(raw.funding_validity, `${raw.title} funding validity`);
      if (!fundingValidity || fundingValidity < asOfDate || fundingValidity > throughDate) continue;
      courses.push({
        id: raw.id,
        title: raw.title ?? '',
        course_code: raw.course_code ?? null,
        new_course_code: raw.new_course_code ?? null,
        course_type: raw.course_type,
        funding_validity: fundingValidity,
        actual_renew_date: normalizeDate(raw.actual_renew_date, `${raw.title} actual renewal date`),
        renewal_application_no: raw.renewal_application_no ?? null,
        renewed_status: raw.renewed_status ?? null,
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const built = buildRenewalPlan(courses, sourceRows);
  const unsigned = {
    schemaVersion: RENEWAL_PLAN_SCHEMA_VERSION,
    kind: 'tpg-renewal-database-plan' as const,
    createdAt: new Date().toISOString(),
    scope: { timezone: 'Asia/Singapore' as const, asOfDate, throughDate, inclusive: true as const, courseType: 'WSQ' as const },
    captures: {
      submissions: { rows: submissions.rows.length, reportedTotal: submissions.reportedTotal, scrapedAt: submissions.scrapedAt, sourceUrl: submissions.sourceUrl, completenessEvidence: submissions.completenessEvidence },
      rejectedApplications: { rows: rejected.rows.length, reportedTotal: rejected.reportedTotal, scrapedAt: rejected.scrapedAt, sourceUrl: rejected.sourceUrl, completenessEvidence: rejected.completenessEvidence },
    },
    summary: built.summary,
    rows: built.rows,
  };
  return { ...unsigned, planHash: computePlanHash(unsigned) };
}

function stateFromRow(row: Record<string, unknown>): RenewalState {
  return {
    actualRenewDate: normalizeDate(row.actual_renew_date, 'database actual renewal date'),
    renewalApplicationNo: String(row.renewal_application_no ?? '').trim() || null,
    renewedStatus: String(row.renewed_status ?? '').trim() || null,
  };
}

export async function applyTrialPlan(plan: TrialPlan, confirmedHash: string): Promise<TrialAudit> {
  if (plan.schemaVersion !== RENEWAL_PLAN_SCHEMA_VERSION || plan.kind !== 'tpg-renewal-database-plan'
    || !verifyPlanHash(plan as unknown as Record<string, unknown>) || plan.planHash !== confirmedHash
    || !Array.isArray(plan.rows)) {
    throw new RenewalPlanError('The reviewed plan hash is invalid or has changed.');
  }
  const client = await pool.connect();
  const auditRows: Array<Record<string, unknown>> = [];
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('tpg-renewal-sync-v1'))`);
    for (const item of plan.rows) {
      const result = await client.query(
        `SELECT id::text, title, course_code, new_course_code, course_type::text,
                funding_validity, actual_renew_date::text AS actual_renew_date,
                NULLIF(BTRIM(renewal_application_no), '') AS renewal_application_no,
                NULLIF(BTRIM(renewed_status), '') AS renewed_status
         FROM public.course WHERE id = $1 FOR UPDATE`, [item.id],
      );
      if (result.rowCount !== 1) throw new RenewalPlanError(`${item.courseTitle} no longer matches one database row.`);
      const current = result.rows[0] as Record<string, unknown>;
      const refs = [current.new_course_code, current.course_code]
        .map((value) => String(value ?? '').trim().toUpperCase()).filter(Boolean);
      if (current.title !== item.courseTitle || current.course_type !== item.courseType
        || normalizeDate(current.funding_validity, `${item.courseTitle} funding validity`) !== item.fundingValidity
        || JSON.stringify([...new Set(refs)].sort()) !== JSON.stringify([...item.courseRefs].sort())) {
        throw new RenewalPlanError(`${item.courseTitle} identity or scope changed after preview.`);
      }
      const before = stateFromRow(current);
      const alreadyApplied = statesEqual(before, item.desired);
      if (!alreadyApplied && !statesEqual(before, item.before)) {
        throw new RenewalPlanError(`${item.courseTitle} renewal fields changed after preview.`);
      }
      if (!alreadyApplied && item.changed) {
        await client.query(
          `UPDATE public.course SET actual_renew_date = $2::date,
                  renewal_application_no = $3, renewed_status = $4, updated_at = NOW()
           WHERE id = $1`,
          [item.id, item.desired.actualRenewDate, item.desired.renewalApplicationNo, item.desired.renewedStatus],
        );
      }
      const verification = await client.query(
        `SELECT actual_renew_date::text AS actual_renew_date,
                NULLIF(BTRIM(renewal_application_no), '') AS renewal_application_no,
                NULLIF(BTRIM(renewed_status), '') AS renewed_status
         FROM public.course WHERE id = $1`, [item.id],
      );
      const after = stateFromRow(verification.rows[0]);
      if (!statesEqual(after, item.desired)) throw new RenewalPlanError(`Verification failed for ${item.courseTitle}.`);
      auditRows.push({ id: item.id, courseTitle: item.courseTitle, operation: item.operation,
        before, desired: item.desired, after, action: alreadyApplied || !item.changed ? 'already-correct' : 'updated' });
    }
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return {
    schemaVersion: 1,
    kind: 'tpg-renewal-database-apply-audit',
    createdAt: new Date().toISOString(),
    committed,
    planHash: plan.planHash,
    summary: { matched: auditRows.length, updated: auditRows.filter((row) => row.action === 'updated').length,
      alreadyCorrect: auditRows.filter((row) => row.action === 'already-correct').length, failed: 0 },
    rows: auditRows,
  };
}
