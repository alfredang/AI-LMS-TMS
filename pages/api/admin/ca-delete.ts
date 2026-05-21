import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureCompanyApplicationsTable } from '../../../lib/companyApplicationsTable';

/**
 * POST /api/admin/ca-delete
 *
 * Body: { applicationIds: string[] }
 *
 * Temporary admin cleanup tool — deletes the given company_application rows.
 * Does NOT cascade to the shared `enrollment`, `app_user`, `ssg_grants`, or
 * QuickBooks invoice tables — those are owned by the broader LMS and may be
 * referenced by other flows (DA, manual enrol). If admin needs the LMS
 * enrolment gone too they must clean it manually.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    await ensureCompanyApplicationsTable();

    const ids = Array.isArray(req.body?.applicationIds) ? req.body.applicationIds : [];
    const cleaned = Array.from(new Set(ids.map((v: unknown) => String(v || '').trim()).filter(Boolean)));
    if (cleaned.length === 0) {
      return res.status(400).json({ success: false, error: 'applicationIds is required' });
    }

    const result = await pool.query(
      `DELETE FROM public.company_application WHERE id = ANY($1::uuid[]) RETURNING id`,
      [cleaned]
    );

    return res.status(200).json({
      success: true,
      deleted: result.rowCount ?? 0,
      deletedIds: result.rows.map((r: any) => r.id),
    });
  } catch (err: any) {
    console.error('ca-delete error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete rows',
    });
  }
}
