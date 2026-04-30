import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureInvoiceJobsTable } from '../../../lib/services/invoiceJobs';
import { upsertSsgEnrolmentFromLocalEnrollment } from '../../../lib/services/billingSync';
import { ensureSsgEnrolmentGrantRollupColumns } from '../../../lib/services/grantImport/ensureSsgEnrolmentGrantRollups';

/** Normalized course run start date as YYYY-MM-DD text (matches sync-all-course-runs-from-ssg). */
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

const TODAY_SG_SQL = `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::date, 'YYYY-MM-DD')`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await ensureInvoiceJobsTable();
    await ensureSsgEnrolmentGrantRollupColumns();

    const backfill = await pool.query(
      `SELECT ij.enrolment_id::text AS enrolment_id
       FROM public.invoice_jobs ij
       WHERE ij.status = 'done'
         AND ij.enrolment_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM ssg_enrolments se
           WHERE TRIM(COALESCE(se.enrolment_id, '')) = TRIM(COALESCE(ij.enrolment_id, ''))
         )
       ORDER BY ij.updated_at DESC
       LIMIT 100`
    );
    for (const row of backfill.rows) {
      try {
        if (row.enrolment_id) await upsertSsgEnrolmentFromLocalEnrollment(row.enrolment_id);
      } catch (e) {
        console.warn('[finance/all-course-runs] ssg backfill:', e);
      }
    }

    const page = parseInt(req.query.page as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const search = (req.query.search as string || '').trim();
    const courseRunId = (req.query.courseRunId as string || '').trim();
    const status = (req.query.status as string || '').trim();
    const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
    const offset = page * limit;
    const includeFuture =
      req.query.includeFuture === '1' ||
      req.query.includeFuture === 'true';
    const rawStartFrom = (req.query.startFrom as string | undefined)?.trim() || '';
    const rawStartTo = (req.query.startTo as string | undefined)?.trim() || '';
    const startFrom = rawStartFrom && rawStartTo ? (rawStartFrom <= rawStartTo ? rawStartFrom : rawStartTo) : rawStartFrom;
    const startTo = rawStartFrom && rawStartTo ? (rawStartFrom <= rawStartTo ? rawStartTo : rawStartFrom) : rawStartTo;

    // When includeFuture is off: only runs with a parseable start date on or before today (SG). Rows with no parseable start date are excluded (they are not "through today").
    const throughTodayClause = includeFuture
      ? ''
      : ` AND ${RUN_START_NORM_SQL} IS NOT NULL AND ${RUN_START_NORM_SQL} <= ${TODAY_SG_SQL}`;

    // Build WHERE conditions — always exclude incomplete rows
    const conditions: string[] = ['se.enrolment_id IS NOT NULL'];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(
        COALESCE(se.trainee_name::text, '') ILIKE $${paramIndex}
        OR COALESCE(se.enrolment_id::text, '') ILIKE $${paramIndex}
        OR COALESCE(se.course_title::text, '') ILIKE $${paramIndex}
        OR COALESCE(se.course_reference::text, '') ILIKE $${paramIndex}
        OR COALESCE(se.course_run_id::text, '') ILIKE $${paramIndex}
        OR COALESCE((se.raw_data->'course'->'run'->>'id')::text, '') ILIKE $${paramIndex}
        OR COALESCE(se.trainee_nric::text, '') ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (courseRunId) {
      conditions.push(`(
        se.course_run_id = $${paramIndex}
        OR se.raw_data->'course'->'run'->>'id' = $${paramIndex}
      )`);
      params.push(courseRunId);
      paramIndex++;
    }

    if (status) {
      conditions.push(`se.enrolment_status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    // Optional view filter by course run start date (normalized to YYYY-MM-DD).
    // When filtering by a range, exclude rows without a parseable start date.
    if (startFrom || startTo) {
      conditions.push(`${RUN_START_NORM_SQL} IS NOT NULL`);
      if (startFrom) {
        conditions.push(`${RUN_START_NORM_SQL} >= $${paramIndex}`);
        params.push(startFrom);
        paramIndex++;
      }
      if (startTo) {
        conditions.push(`${RUN_START_NORM_SQL} <= $${paramIndex}`);
        params.push(startTo);
        paramIndex++;
      }
    }

    let whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    whereClause += throughTodayClause;

    // Main query: enrolments with lateral-joined grants and claims
    const dataQuery = `
      SELECT
        se.enrolment_id,
        se.trainee_name,
        CASE WHEN se.trainee_nric IS NOT NULL AND LENGTH(se.trainee_nric) > 4
          THEN '****' || RIGHT(se.trainee_nric, 4)
          ELSE se.trainee_nric
        END AS trainee_nric,
        se.course_title,
        se.course_reference,
        se.course_run_id,
        se.enrolment_status,
        se.sponsorship_type,
        se.raw_data->'course'->'run'->>'id' AS course_run_number,
        se.raw_data->'course'->'run'->>'startDate' AS start_date,
        se.raw_data->'course'->'run'->>'endDate' AS end_date,
        se.raw_data->'trainee'->'email'->>'full' AS trainee_email,
        se.raw_data->'trainee'->'contactNumber'->>'phoneNumber' AS trainee_contact,
        se.raw_data->'trainee'->>'dateOfBirth' AS trainee_dob,
        se.raw_data->'trainee'->'employer'->>'uen' AS employer_uen,
        se.raw_data->'trainee'->'employer'->>'name' AS employer_name,
        se.raw_data->'trainee'->'employer'->'contact'->>'fullName' AS employer_contact_name,
        se.raw_data->'trainee'->'employer'->'contact'->'email'->>'full' AS employer_contact_email,
        se.raw_data->'trainee'->'employer'->'contact'->'contactNumber'->>'countryCode' AS employer_phone_country,
        se.raw_data->'trainee'->'employer'->'contact'->'contactNumber'->>'phoneNumber' AS employer_phone,
        se.raw_data->'trainee'->'fees'->>'collectionStatus' AS fee_collection_status,
        se.total_grant_expected,
        se.total_grant_received,
        se.total_grant_pending,
        se.grant_payment_status,
        se.last_grant_import_at,
        bl.grant_id AS bl_grant_id,
        bl.status AS bl_status,
        bl.estimated_grant_amount AS bl_amount,
        nbl.grant_id AS nbl_grant_id,
        nbl.status AS nbl_status,
        nbl.estimated_grant_amount AS nbl_amount,
        nbl.funding_scheme_code AS nbl_scheme,
        sc.claim_id AS sfc_claim_id,
        sc.claim_amount AS sfc_amount,
        sc.payment_date AS sfc_payment_date,
        sc.claim_status AS sfc_status,
        sc.claim_payment_status AS sfc_claim_payment_status,
        sc.qb_payment_id AS sfc_qb_payment_id,
        NULLIF(TRIM(COALESCE(ij.qbo_invoice_id::text, '')), '') AS invoice_id,
        COALESCE(
          NULLIF(TRIM(COALESCE(ij.invoice_no, '')), ''),
          NULLIF(TRIM(COALESCE(ij.qbo_doc_number, '')), ''),
          NULLIF(TRIM(COALESCE(ij.qbo_invoice_id::text, '')), '')
        ) AS invoice_no,
        ij.invoice_sent_at AS invoice_sent_at,
        ij.qbo_sfc_status AS qbo_sfc_status,
        ij.grn_doc_number AS grn_doc_number,
        (da_chk.found IS NOT NULL) AS is_da
      FROM ssg_enrolments se
      LEFT JOIN LATERAL (
        SELECT inv.invoice_no, inv.qbo_invoice_id, inv.qbo_doc_number, inv.invoice_sent_at, inv.qbo_sfc_status, inv.grn_doc_number
        FROM public.invoice_jobs inv
        WHERE inv.status = 'done'
          AND LOWER(TRIM(COALESCE(inv.enrolment_id::text, ''))) = LOWER(TRIM(COALESCE(se.enrolment_id::text, '')))
        ORDER BY inv.updated_at DESC
        LIMIT 1
      ) ij ON true
      LEFT JOIN LATERAL (
        SELECT grant_id, status, estimated_grant_amount
        FROM ssg_grants
        WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM(COALESCE(se.enrolment_id::text, '')))
          AND funding_scheme_code = 'Baseline'
        ORDER BY (CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), grant_id DESC
        LIMIT 1
      ) bl ON true
      LEFT JOIN LATERAL (
        SELECT grant_id, status, estimated_grant_amount, funding_scheme_code
        FROM ssg_grants
        WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM(COALESCE(se.enrolment_id::text, '')))
          AND funding_scheme_code != 'Baseline'
        ORDER BY (CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), grant_id DESC
        LIMIT 1
      ) nbl ON true
      LEFT JOIN LATERAL (
        SELECT claim_id, claim_amount, payment_date, claim_status, claim_payment_status, qb_payment_id
        FROM ssg_claims
        WHERE LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = LOWER(TRIM(COALESCE(se.enrolment_id::text, '')))
        ORDER BY claim_id DESC
        LIMIT 1
      ) sc ON true
      LEFT JOIN LATERAL (
        SELECT 1 AS found
        FROM public.da_application da
        WHERE LOWER(TRIM(COALESCE(da.enrolment_id,''))) = LOWER(TRIM(COALESCE(se.enrolment_id,'')))
        LIMIT 1
      ) da_chk ON true
      ${whereClause}
      ORDER BY se.enrolment_id ${sort}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM ssg_enrolments se
      ${whereClause}
    `;

    const enrolThroughTodaySql = `(${RUN_START_NORM_SQL} IS NOT NULL AND ${RUN_START_NORM_SQL} <= ${TODAY_SG_SQL})`;
    const enrolStartRangeSqlParts: string[] = [];
    if (startFrom) enrolStartRangeSqlParts.push(`${RUN_START_NORM_SQL} >= '${startFrom.replace(/'/g, "''")}'`);
    if (startTo) enrolStartRangeSqlParts.push(`${RUN_START_NORM_SQL} <= '${startTo.replace(/'/g, "''")}'`);
    const enrolStartRangeSql = enrolStartRangeSqlParts.length > 0
      ? ` AND ${RUN_START_NORM_SQL} IS NOT NULL AND (${enrolStartRangeSqlParts.join(' AND ')})`
      : '';

    // Stats query — same “through today” scope as the table when includeFuture is off
    const statsQuery = includeFuture
      ? `
      SELECT
        (SELECT COUNT(*) FROM ssg_enrolments WHERE enrolment_id IS NOT NULL) AS total_enrolments,
        COALESCE((SELECT SUM(estimated_grant_amount) FROM ssg_grants WHERE funding_scheme_code = 'Baseline'), 0) AS total_bl,
        COALESCE((SELECT SUM(estimated_grant_amount) FROM ssg_grants WHERE funding_scheme_code != 'Baseline'), 0) AS total_nbl,
        COALESCE((SELECT SUM(claim_amount) FROM ssg_claims), 0) AS total_sfc
    `
      : `
      SELECT
        (SELECT COUNT(*) FROM ssg_enrolments se WHERE se.enrolment_id IS NOT NULL AND ${enrolThroughTodaySql}${enrolStartRangeSql}) AS total_enrolments,
        COALESCE((
          SELECT SUM(g.estimated_grant_amount) FROM ssg_grants g
          WHERE g.funding_scheme_code = 'Baseline'
            AND EXISTS (
              SELECT 1 FROM ssg_enrolments se
              WHERE se.enrolment_id = g.enrollment_id AND se.enrolment_id IS NOT NULL AND ${enrolThroughTodaySql}${enrolStartRangeSql}
            )
        ), 0) AS total_bl,
        COALESCE((
          SELECT SUM(g.estimated_grant_amount) FROM ssg_grants g
          WHERE g.funding_scheme_code != 'Baseline'
            AND EXISTS (
              SELECT 1 FROM ssg_enrolments se
              WHERE se.enrolment_id = g.enrollment_id AND se.enrolment_id IS NOT NULL AND ${enrolThroughTodaySql}${enrolStartRangeSql}
            )
        ), 0) AS total_nbl,
        COALESCE((
          SELECT SUM(c.claim_amount) FROM ssg_claims c
          WHERE EXISTS (
            SELECT 1 FROM ssg_enrolments se
            WHERE se.enrolment_id = c.enrollment_id AND se.enrolment_id IS NOT NULL AND ${enrolThroughTodaySql}${enrolStartRangeSql}
          )
        ), 0) AS total_sfc
    `;

    const statusBreakdownQuery = includeFuture
      ? `
      SELECT enrolment_status AS status, COUNT(*)::int AS count
      FROM ssg_enrolments
      WHERE enrolment_id IS NOT NULL
      GROUP BY enrolment_status
      ORDER BY count DESC
    `
      : `
      SELECT se.enrolment_status AS status, COUNT(*)::int AS count
      FROM ssg_enrolments se
      WHERE se.enrolment_id IS NOT NULL AND ${enrolThroughTodaySql}${enrolStartRangeSql}
      GROUP BY se.enrolment_status
      ORDER BY count DESC
    `;

    // Filter params exclude the pagination params (limit, offset) added last
    const filterParams = params.slice(0, paramIndex - 1);

    const [dataResult, countResult, statsResult, statusResult] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, filterParams),
      pool.query(statsQuery),
      pool.query(statusBreakdownQuery),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        rows: dataResult.rows,
        total: Number(countResult.rows[0]?.total ?? 0),
        page,
        limit,
        stats: {
          totalEnrolments: Number(statsResult.rows[0]?.total_enrolments ?? 0),
          totalBL: Number(statsResult.rows[0]?.total_bl ?? 0),
          totalNBL: Number(statsResult.rows[0]?.total_nbl ?? 0),
          totalSFC: Number(statsResult.rows[0]?.total_sfc ?? 0),
          byStatus: statusResult.rows.map((r: { status: string | null; count: string | number }) => ({
            status: r.status ?? '',
            count: Number(r.count ?? 0),
          })),
        },
      },
    });
  } catch (error) {
    console.error('[ERROR] [finance/all-course-runs] Failed to fetch:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
