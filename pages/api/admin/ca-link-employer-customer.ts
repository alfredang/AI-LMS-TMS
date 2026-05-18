import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { upsertEmployerQboAlias } from '../../../lib/employerQboAliasTable';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';
import { generateInvoicesForApplications } from '../../../lib/quickbooks/createCompanyApplicationInvoice';

/**
 * POST /api/admin/ca-link-employer-customer
 *
 * Body: { employerUen: string, qboDisplayName: string, courseRunId?: string }
 *
 * Persists the (UEN → QBO DisplayName) mapping then re-runs invoice generation
 * for every uninvoiced company_application row tied to this employer (or just
 * the given courseRunId group if provided). Used by the inline rescue UI on
 * View Company Application after the admin picks the right QBO customer from
 * the search modal.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { employerUen, qboDisplayName, courseRunId } = req.body || {};
  const uen = String(employerUen || '').trim();
  const displayName = String(qboDisplayName || '').trim();
  const runId = String(courseRunId || '').trim();

  if (!uen || !displayName) {
    return res.status(400).json({
      success: false,
      error: 'employerUen and qboDisplayName are required',
    });
  }

  try {
    await ensureCompanyApplicationsTable();
    await upsertEmployerQboAlias({
      employerUen: uen,
      qboDisplayName: displayName,
      note: 'Manually linked via rescue UI',
    });

    // Find every uninvoiced CA row for this employer (optionally narrowed to
    // a single course run group) and re-run invoice generation for them.
    const params: any[] = [uen];
    let runClause = '';
    if (runId) {
      params.push(runId);
      runClause = 'AND TRIM(course_run_id) = $2';
    }
    const rowsRes = await pool.query(
      `SELECT id
         FROM public.company_application
        WHERE LOWER(TRIM(COALESCE(employer_uen, ''))) = LOWER(TRIM($1))
          AND COALESCE(TRIM(invoice_id), '') = ''
          ${runClause}`,
      params
    );
    const ids = rowsRes.rows.map((r: { id: string }) => r.id);

    if (ids.length === 0) {
      return res.status(200).json({
        success: true,
        aliasSaved: true,
        retried: 0,
        generated: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      });
    }

    const result = await generateInvoicesForApplications(ids);
    return res.status(200).json({
      success: true,
      aliasSaved: true,
      retried: ids.length,
      ...result,
    });
  } catch (err) {
    console.error('[ca-link-employer-customer] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
