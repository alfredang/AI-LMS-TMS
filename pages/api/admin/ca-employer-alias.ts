import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { ensureEmployerQboAliasTable } from '../../../lib/employerQboAliasTable';

/**
 * Manage the employer_qbo_alias table — a small backend-only translation map
 * from Excel UEN → real QBO customer DisplayName. Used when the Excel uses an
 * abbreviated name (e.g. "NUP") and QBO has the full form ("National
 * University Polyclinics").
 *
 *   GET    /api/admin/ca-employer-alias       → list all aliases
 *   POST   /api/admin/ca-employer-alias       → upsert one alias
 *                                                body: { employerUen, qboDisplayName, note? }
 *   DELETE /api/admin/ca-employer-alias       → remove an alias
 *                                                body: { employerUen }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ensureEmployerQboAliasTable();

    if (req.method === 'GET') {
      const r = await pool.query(
        `SELECT employer_uen, qbo_display_name, note, created_at, updated_at
           FROM public.employer_qbo_alias
          ORDER BY employer_uen ASC`
      );
      return res.status(200).json({ success: true, aliases: r.rows });
    }

    if (req.method === 'POST') {
      const { employerUen, qboDisplayName, note } = req.body || {};
      const uen = String(employerUen || '').trim();
      const displayName = String(qboDisplayName || '').trim();
      if (!uen || !displayName) {
        return res.status(400).json({
          success: false,
          error: 'employerUen and qboDisplayName are required',
        });
      }
      await pool.query(
        `INSERT INTO public.employer_qbo_alias (employer_uen, qbo_display_name, note)
              VALUES ($1, $2, $3)
         ON CONFLICT (employer_uen) DO UPDATE SET
           qbo_display_name = EXCLUDED.qbo_display_name,
           note             = EXCLUDED.note,
           updated_at       = now()`,
        [uen, displayName, note ? String(note).trim() : null]
      );
      return res.status(200).json({ success: true, employerUen: uen, qboDisplayName: displayName });
    }

    if (req.method === 'DELETE') {
      const { employerUen } = req.body || {};
      const uen = String(employerUen || '').trim();
      if (!uen) {
        return res.status(400).json({ success: false, error: 'employerUen is required' });
      }
      await pool.query(
        `DELETE FROM public.employer_qbo_alias WHERE LOWER(TRIM(employer_uen)) = LOWER(TRIM($1))`,
        [uen]
      );
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[ca-employer-alias] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
