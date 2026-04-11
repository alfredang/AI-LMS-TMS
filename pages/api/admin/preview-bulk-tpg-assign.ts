import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@lib/db';

/**
 * GET /api/admin/preview-bulk-tpg-assign
 *
 * Preview which course runs can have their local trainer pushed to TPG.
 * Shows: course run, local trainer(s), masked NRIC, and eligibility.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const dateFrom = typeof req.query.dateFrom === 'string' && req.query.dateFrom ? req.query.dateFrom : null;
    const dateTo = typeof req.query.dateTo === 'string' && req.query.dateTo ? req.query.dateTo : null;

    // Find upcoming course runs with local trainer but no TPG trainer
    const result = await pool.query(
      `SELECT cr.id, cr.course_run_id, cr.start_date, cr.end_date,
              c.title AS course_title, c.course_code,
              cr.class_status,
              cr.assigned_trainer_name AS legacy_trainer_name,
              cr.assigned_trainer_email AS legacy_trainer_email,
              cr.assigned_trainer_id AS legacy_trainer_id
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
       WHERE cr.start_date >= COALESCE($1::date, CURRENT_DATE)
         AND cr.start_date <= COALESCE($2::date, CURRENT_DATE + INTERVAL '30 days')
         AND (cr.tpg_assigned_trainer_name IS NULL OR cr.tpg_assigned_trainer_name = '')
         AND cr.class_status NOT IN ('Cancelled', 'Unconfirmed')
       ORDER BY cr.start_date ASC`,
      [dateFrom, dateTo]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ success: true, preview: [] });
    }

    const courseRunIds = result.rows.map(r => r.id);

    // Get junction table trainers
    const junctionResult = await pool.query(
      `SELECT crt.course_run_id, crt.trainer_id, crt.trainer_name, crt.trainer_email
       FROM course_run_trainer crt
       WHERE crt.course_run_id = ANY($1::uuid[])
       ORDER BY crt.assigned_at ASC`,
      [courseRunIds]
    );

    const junctionMap = new Map<string, Array<{ trainer_id: string | null; trainer_name: string; trainer_email: string }>>();
    for (const row of junctionResult.rows) {
      const existing = junctionMap.get(row.course_run_id) || [];
      existing.push({
        trainer_id: row.trainer_id,
        trainer_name: row.trainer_name || '',
        trainer_email: row.trainer_email || '',
      });
      junctionMap.set(row.course_run_id, existing);
    }

    // Collect all trainer IDs and emails to resolve NRICs
    const allTrainerIds = new Set<string>();
    const allTrainerEmails = new Set<string>();
    for (const row of result.rows) {
      if (row.legacy_trainer_id) allTrainerIds.add(row.legacy_trainer_id);
      if (row.legacy_trainer_email) allTrainerEmails.add(row.legacy_trainer_email.toLowerCase());
      const jTrainers = junctionMap.get(row.id) || [];
      for (const jt of jTrainers) {
        if (jt.trainer_id) allTrainerIds.add(jt.trainer_id);
        if (jt.trainer_email) allTrainerEmails.add(jt.trainer_email.toLowerCase());
      }
    }

    // Resolve NRICs from trainer_profile
    const nricMap = new Map<string, string>(); // keyed by trainer_id or email
    if (allTrainerIds.size > 0 || allTrainerEmails.size > 0) {
      const nricResult = await pool.query(
        `SELECT au.id, au.email, tp.nric
         FROM app_user au
         JOIN trainer_profile tp ON tp.user_id = au.id
         WHERE au.id = ANY($1::uuid[]) OR LOWER(au.email) = ANY($2::text[])`,
        [Array.from(allTrainerIds), Array.from(allTrainerEmails)]
      );
      for (const row of nricResult.rows) {
        if (row.nric) {
          nricMap.set(row.id, row.nric);
          if (row.email) nricMap.set(row.email.toLowerCase(), row.nric);
        }
      }
    }

    const maskNric = (nric: string): string => {
      if (!nric || nric.length < 5) return nric || '';
      return nric[0] + '****' + nric.slice(-4);
    };

    const preview = result.rows.map(row => {
      const jTrainers = junctionMap.get(row.id) || [];

      // Determine local trainers: prefer junction table, fall back to scalar
      let localTrainers: Array<{ name: string; email: string; nric: string; maskedNric: string; hasNric: boolean }> = [];

      if (jTrainers.length > 0) {
        localTrainers = jTrainers.map(jt => {
          const nric = (jt.trainer_id && nricMap.get(jt.trainer_id)) ||
                       (jt.trainer_email && nricMap.get(jt.trainer_email.toLowerCase())) || '';
          return {
            name: jt.trainer_name,
            email: jt.trainer_email,
            nric,
            maskedNric: maskNric(nric),
            hasNric: !!nric && nric !== 'NA' && nric !== '',
          };
        });
      } else if (row.legacy_trainer_name) {
        const nric = (row.legacy_trainer_id && nricMap.get(row.legacy_trainer_id)) ||
                     (row.legacy_trainer_email && nricMap.get(row.legacy_trainer_email.toLowerCase())) || '';
        localTrainers = [{
          name: row.legacy_trainer_name,
          email: row.legacy_trainer_email || '',
          nric,
          maskedNric: maskNric(nric),
          hasNric: !!nric && nric !== 'NA' && nric !== '',
        }];
      }

      const hasLocalTrainer = localTrainers.length > 0;
      const primaryTrainer = localTrainers[0] || null;
      const canAssign = hasLocalTrainer && (primaryTrainer?.hasNric || false);
      const reason = !hasLocalTrainer
        ? 'No local trainer assigned'
        : !primaryTrainer?.hasNric
        ? 'No NRIC on file for trainer'
        : '';

      return {
        courseRunUuid: row.id,
        courseRunId: row.course_run_id,
        courseTitle: row.course_title,
        courseCode: row.course_code,
        classStatus: row.class_status,
        startDate: row.start_date,
        localTrainers,
        canAssign,
        reason,
      };
    });

    return res.status(200).json({ success: true, preview });
  } catch (err) {
    console.error('preview-bulk-tpg-assign error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
