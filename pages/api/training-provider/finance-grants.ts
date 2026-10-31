import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const page = parseInt(req.query.page as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const search = (req.query.search as string || '').trim();
    const status = (req.query.status as string || '').trim();
    const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
    const offset = page * limit;

    /**
     * Performance note (localhost):
     * Joining many local tables (enrollment/app_user/learner_profile/da_application) made this endpoint very slow.
     * For the Financial Dashboard grants grid, we only need trainee name/NRIC when available. Prefer:
     * 1) `ssg_enrolments` (when present)
     * 2) `ssg_grants.api_response` (SSG grant payload includes enrolment.trainee)
     *
     * This keeps the endpoint fast and avoids connection timeouts.
     */
    const grantsFromSql = `
      FROM ssg_grants sg
      LEFT JOIN ssg_enrolments se
        ON LOWER(TRIM(COALESCE(sg.enrollment_id::text, ''))) = LOWER(TRIM(COALESCE(se.enrolment_id::text, '')))
    `;

    // NOTE: we intentionally keep the main SQL light, then enrich names/NRIC for only the visible page.
    // This avoids slow joins across large tables while still showing identity when we have it locally.

    // Build WHERE conditions (search uses same resolved name/NRIC as SELECT)
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(
        sg.grant_id ILIKE $${paramIndex}
        OR sg.enrollment_id ILIKE $${paramIndex}
        OR sg.funding_scheme_description ILIKE $${paramIndex}
        OR COALESCE(se.trainee_name, '') ILIKE $${paramIndex}
        OR COALESCE(se.trainee_nric, '') ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status) {
      conditions.push(`sg.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Data query with pagination
    const dataQuery = `
      SELECT
        sg.grant_id,
        sg.enrollment_id,
        sg.status,
        sg.funding_scheme_description,
        sg.component_description,
        sg.estimated_grant_amount,
        sg.approved_grant_amount,
        sg.imported_at AS tpg_checked_at,
        se.trainee_name AS se_trainee_name,
        se.trainee_nric AS se_trainee_nric,
        se.raw_data AS se_raw_data,
        sg.api_response
      ${grantsFromSql}
      ${whereClause}
      ORDER BY sg.grant_id ${sort}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total
      ${grantsFromSql}
      ${whereClause}
    `;

    // Stats query (always unfiltered for KPI cards)
    const statsQuery = `
      SELECT
        COUNT(*) as total_grants,
        COALESCE(SUM(estimated_grant_amount), 0) as total_estimated,
        COALESCE(SUM(approved_grant_amount), 0) as total_approved
      FROM ssg_grants
    `;

    const statusBreakdownQuery = `
      SELECT status, COUNT(*) as count
      FROM ssg_grants
      GROUP BY status
      ORDER BY count DESC
    `;

    // Use a single pooled client to avoid exhausting connections in dev.
    // (Promise.all on 4 queries can acquire 4 clients; if each query is slow, subsequent requests time out.)
    const client = await pool.connect();
    let dataResult;
    let countResult;
    let statsResult;
    let statusResult;
    try {
      dataResult = await client.query(dataQuery, params);
      countResult = await client.query(countQuery, params.slice(0, -2));
      statsResult = await client.query(statsQuery);
      statusResult = await client.query(statusBreakdownQuery);
    } finally {
      client.release();
    }

    // --- Enrich trainee identity for visible page (fast, bounded) ---
    const enrolmentIds = Array.from(
      new Set(
        (dataResult.rows as Array<{ enrollment_id?: string | null }>).map((r) => String(r.enrollment_id || '').trim()).filter(Boolean)
      )
    );

    type Identity = { trainee_name: string | null; trainee_nric: string | null };
    const identityByEnr: Record<string, Identity> = {};

    type ClassInfo = {
      enrolment_status: string | null;
      course_run_code: string | null;
      start_date: string | null;
      end_date: string | null;
      total_sessions: number;
      attended_sessions: number;
    };
    const classInfoByEnr: Record<string, ClassInfo> = {};

    if (enrolmentIds.length > 0) {
      const idClient = await pool.connect();
      try {
        // Prefer ssg_enrolments (has official trainee_name / trainee_nric)
        const ssgId = await idClient.query(
          `SELECT enrolment_id::text AS enrolment_id,
                  trainee_name::text AS trainee_name,
                  trainee_nric::text AS trainee_nric,
                  raw_data
           FROM ssg_enrolments
           WHERE LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = ANY(
             SELECT LOWER(TRIM(x::text)) FROM unnest($1::text[]) x
           )`,
          [enrolmentIds]
        );
        for (const r of ssgId.rows as Array<{ enrolment_id: string; trainee_name: string | null; trainee_nric: string | null; raw_data?: any }>) {
          const key = r.enrolment_id.trim();
          const fromRawName = String(r.raw_data?.trainee?.fullName ?? '').trim() || null;
          const fromRawNric = String(r.raw_data?.trainee?.id ?? '').trim() || null;
          identityByEnr[key] = {
            trainee_name: (r.trainee_name || '').trim() || fromRawName,
            trainee_nric: (r.trainee_nric || '').trim() || fromRawNric,
          };
        }

        // Fallback to local enrollment → app_user / learner_profile (often present on dev)
        const localId = await idClient.query(
          `SELECT e.enrolment_id::text AS enrolment_id,
                  u.full_name::text AS trainee_name,
                  COALESCE(lp.nric::text, e.nric::text) AS trainee_nric
           FROM enrollment e
           LEFT JOIN app_user u ON u.id = e.user_id
           LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
           WHERE LOWER(TRIM(COALESCE(e.enrolment_id::text, ''))) = ANY(
             SELECT LOWER(TRIM(x::text)) FROM unnest($1::text[]) x
           )`,
          [enrolmentIds]
        );
        for (const r of localId.rows as Array<{ enrolment_id: string; trainee_name: string | null; trainee_nric: string | null }>) {
          const key = r.enrolment_id.trim();
          const existing = identityByEnr[key];
          if (existing?.trainee_name && existing?.trainee_nric) continue;
          identityByEnr[key] = {
            trainee_name: existing?.trainee_name || (r.trainee_name || '').trim() || null,
            trainee_nric: existing?.trainee_nric || (r.trainee_nric || '').trim() || null,
          };
        }

        // Fallback to da_application (DA enrolments may not exist in ssg_enrolments or enrollment)
        const daId = await idClient.query(
          `SELECT enrolment_id::text AS enrolment_id,
                  trainee_name::text AS trainee_name,
                  trainee_id::text AS trainee_nric
           FROM public.da_application
           WHERE enrolment_id IS NOT NULL
             AND LOWER(TRIM(COALESCE(enrolment_id::text, ''))) = ANY(
               SELECT LOWER(TRIM(x::text)) FROM unnest($1::text[]) x
             )`,
          [enrolmentIds]
        );
        for (const r of daId.rows as Array<{ enrolment_id: string; trainee_name: string | null; trainee_nric: string | null }>) {
          const key = r.enrolment_id.trim();
          const existing = identityByEnr[key];
          if (existing?.trainee_name && existing?.trainee_nric) continue;
          identityByEnr[key] = {
            trainee_name: existing?.trainee_name || (r.trainee_name || '').trim() || null,
            trainee_nric: existing?.trainee_nric || (r.trainee_nric || '').trim() || null,
          };
        }

        // Fallback to ssg_claims (populated from SSG claim API, has trainee_name + individual_nric)
        const claimId = await idClient.query(
          `SELECT DISTINCT ON (enrollment_id)
                  enrollment_id::text AS enrolment_id,
                  trainee_name::text AS trainee_name,
                  individual_nric::text AS trainee_nric
           FROM public.ssg_claims
           WHERE enrollment_id IS NOT NULL
             AND LOWER(TRIM(COALESCE(enrollment_id::text, ''))) = ANY(
               SELECT LOWER(TRIM(x::text)) FROM unnest($1::text[]) x
             )
           ORDER BY enrollment_id, claim_id DESC`,
          [enrolmentIds]
        );
        for (const r of claimId.rows as Array<{ enrolment_id: string; trainee_name: string | null; trainee_nric: string | null }>) {
          const key = r.enrolment_id.trim();
          const existing = identityByEnr[key];
          if (existing?.trainee_name && existing?.trainee_nric) continue;
          identityByEnr[key] = {
            trainee_name: existing?.trainee_name || (r.trainee_name || '').trim() || null,
            trainee_nric: existing?.trainee_nric || (r.trainee_nric || '').trim() || null,
          };
        }

        // Enrolment status, course run and class attendance for the visible page.
        // Local enrollment is preferred (reflects admin removals); ssg_enrolments is the fallback.
        // Attendance counts only sessions where attendance was actually taken, matching the learner
        // by user_id or NRIC (same rule as auto-create-certificates).
        const classInfo = await idClient.query(
          `WITH k AS (
             SELECT DISTINCT LOWER(TRIM(x::text)) AS key FROM unnest($1::text[]) x
           ),
           le AS (
             SELECT DISTINCT ON (LOWER(TRIM(e.enrolment_id)))
                    LOWER(TRIM(e.enrolment_id)) AS key, e.enrolment_status, e.user_id,
                    COALESCE(lp.nric, e.nric) AS nric, e.course_run_id
             FROM enrollment e
             LEFT JOIN learner_profile lp ON lp.user_id = e.user_id
             WHERE LOWER(TRIM(COALESCE(e.enrolment_id, ''))) IN (SELECT key FROM k)
             ORDER BY LOWER(TRIM(e.enrolment_id)), e.updated_at DESC
           ),
           sse AS (
             SELECT DISTINCT ON (LOWER(TRIM(s.enrolment_id)))
                    LOWER(TRIM(s.enrolment_id)) AS key, s.enrolment_status, s.trainee_nric, s.course_run_id
             FROM ssg_enrolments s
             WHERE LOWER(TRIM(COALESCE(s.enrolment_id, ''))) IN (SELECT key FROM k)
             ORDER BY LOWER(TRIM(s.enrolment_id)), s.imported_at DESC
           ),
           base AS (
             SELECT k.key,
                    COALESCE(NULLIF(TRIM(le.enrolment_status), ''), NULLIF(TRIM(sse.enrolment_status), '')) AS enrolment_status,
                    le.user_id,
                    COALESCE(NULLIF(TRIM(le.nric), ''), NULLIF(TRIM(sse.trainee_nric), '')) AS nric,
                    COALESCE(le.course_run_id, cr2.id) AS run_uuid,
                    sse.course_run_id AS ssg_run_code
             FROM k
             LEFT JOIN le ON le.key = k.key
             LEFT JOIN sse ON sse.key = k.key
             LEFT JOIN LATERAL (
               SELECT id FROM course_run WHERE course_run_id = sse.course_run_id LIMIT 1
             ) cr2 ON le.course_run_id IS NULL
           )
           SELECT b.key, b.enrolment_status,
                  COALESCE(cr.course_run_id, b.ssg_run_code) AS course_run_code,
                  cr.start_date::text AS start_date, cr.end_date::text AS end_date,
                  (SELECT COUNT(*) FROM course_session cs
                    WHERE cs.course_run_id = b.run_uuid AND cs.deleted = false
                      AND EXISTS (SELECT 1 FROM course_attendance ca WHERE ca.session_id = cs.id))::int AS total_sessions,
                  (SELECT COUNT(DISTINCT ca.session_id) FROM course_attendance ca
                    JOIN course_session cs ON cs.id = ca.session_id
                    WHERE cs.course_run_id = b.run_uuid AND cs.deleted = false AND ca.is_present = true
                      AND ((b.user_id IS NOT NULL AND ca.user_id = b.user_id)
                        OR (b.nric IS NOT NULL AND UPPER(TRIM(ca.nric)) = UPPER(b.nric))))::int AS attended_sessions
           FROM base b
           LEFT JOIN course_run cr ON cr.id = b.run_uuid`,
          [enrolmentIds]
        );
        for (const r of classInfo.rows as Array<ClassInfo & { key: string }>) {
          const { key, ...info } = r;
          classInfoByEnr[key] = info;
        }
      } finally {
        idClient.release();
      }
    }

    const enrichedRows = (dataResult.rows as any[]).map((r) => {
      const enr = String(r.enrollment_id || '').trim();
      const fromApiName = String(r.api_response?.enrolment?.trainee?.fullName ?? '').trim() || null;
      const fromApiNric = String(r.api_response?.enrolment?.trainee?.id ?? '').trim() || null;
      const fromSeName =
        (String(r.se_trainee_name ?? '').trim() || String(r.se_raw_data?.trainee?.fullName ?? '').trim() || '') || null;
      const fromSeNric =
        (String(r.se_trainee_nric ?? '').trim() || String(r.se_raw_data?.trainee?.id ?? '').trim() || '') || null;
      const fallback = identityByEnr[enr];
      const trainee_name = fromSeName || fallback?.trainee_name || fromApiName;
      const trainee_nric = fromSeNric || fallback?.trainee_nric || fromApiNric;
      // Strip extra fields used for enrichment
      const { se_trainee_name, se_trainee_nric, se_raw_data, api_response, ...rest } = r;
      const cls = classInfoByEnr[enr.toLowerCase()];
      return {
        ...rest,
        trainee_name,
        trainee_nric,
        enrolment_status: cls?.enrolment_status ?? null,
        course_run_id: cls?.course_run_code ?? null,
        course_run_start: cls?.start_date ?? null,
        course_run_end: cls?.end_date ?? null,
        attendance_total_sessions: cls?.total_sessions ?? 0,
        attendance_attended_sessions: cls?.attended_sessions ?? 0,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        grants: enrichedRows,
        total: parseInt(countResult.rows[0].total),
        page,
        limit,
        stats: {
          totalGrants: parseInt(statsResult.rows[0].total_grants),
          totalEstimated: parseFloat(statsResult.rows[0].total_estimated),
          totalApproved: parseFloat(statsResult.rows[0].total_approved),
          byStatus: statusResult.rows.map((r: { status: string; count: string }) => ({
            status: r.status,
            count: parseInt(r.count),
          })),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching finance grants:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
