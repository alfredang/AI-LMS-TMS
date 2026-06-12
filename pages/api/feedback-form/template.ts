import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { provider_id, course_run_id } = req.query;

    let providerId: string | null = (provider_id as string) || null;

    if (!providerId) {
      const r = await pool.query('SELECT id FROM training_provider ORDER BY created_at ASC LIMIT 1');
      providerId = r.rows[0]?.id ?? null;
    }

    if (!providerId) return res.status(404).json({ success: false, error: 'No training provider found' });

    const tmpl = await pool.query(
      'SELECT id, title, sections, is_active FROM feedback_form_template WHERE training_provider_id = $1 LIMIT 1',
      [providerId]
    );
    if (tmpl.rows.length === 0) return res.status(404).json({ success: false, error: 'Template not found' });

    const row = tmpl.rows[0];

    let runContext: Record<string, any> | null = null;
    if (typeof course_run_id === 'string' && course_run_id.length > 0) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      // Try matching against course_run.id (UUID), course_run.course_run_id (TGS code), or fall back to course.course_code
      const trainerSubq = `(
        SELECT string_agg(DISTINCT crt.trainer_name, ', ' ORDER BY crt.trainer_name)
        FROM course_run_trainer crt
        WHERE crt.course_run_id = cr.id
      ) AS trainer_name`;
      const r = uuidRe.test(course_run_id)
        ? await pool.query(
            `SELECT cr.id AS course_run_id, cr.course_run_id AS course_run_code, cr.start_date, cr.end_date,
                    c.title AS course_title, c.course_code, ${trainerSubq}
             FROM course_run cr JOIN course c ON c.id = cr.course_id
             WHERE cr.id = $1 LIMIT 1`,
            [course_run_id]
          )
        : await pool.query(
            `SELECT cr.id AS course_run_id, cr.course_run_id AS course_run_code, cr.start_date, cr.end_date,
                    c.title AS course_title, c.course_code, ${trainerSubq}
             FROM course_run cr JOIN course c ON c.id = cr.course_id
             WHERE cr.course_run_id = $1 OR c.course_code = $1
             ORDER BY cr.start_date DESC NULLS LAST LIMIT 1`,
            [course_run_id]
          );
      runContext = r.rows[0] || null;
    }

    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        title: row.title,
        sections: row.sections,
        is_active: row.is_active,
        run_context: runContext,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
