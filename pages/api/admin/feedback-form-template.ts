import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { DEFAULT_FEEDBACK_FORM_SECTIONS, DEFAULT_FEEDBACK_FORM_TITLE } from '../../../lib/feedbackFormDefaults';

async function resolveProviderId(): Promise<string | null> {
  const r = await pool.query('SELECT id FROM training_provider ORDER BY created_at ASC LIMIT 1');
  return r.rows[0]?.id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const providerId = await resolveProviderId();
      if (!providerId) return res.status(404).json({ success: false, error: 'No training provider found' });

      const existing = await pool.query(
        'SELECT id, title, sections, is_active FROM feedback_form_template WHERE training_provider_id = $1 LIMIT 1',
        [providerId]
      );

      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return res.status(200).json({
          success: true,
          data: {
            id: row.id,
            training_provider_id: providerId,
            title: row.title,
            sections: row.sections,
            is_active: row.is_active,
          },
        });
      }

      const seed = await pool.query(
        `INSERT INTO feedback_form_template (training_provider_id, title, sections)
         VALUES ($1, $2, $3::jsonb)
         RETURNING id, title, sections, is_active`,
        [providerId, DEFAULT_FEEDBACK_FORM_TITLE, JSON.stringify(DEFAULT_FEEDBACK_FORM_SECTIONS)]
      );
      const row = seed.rows[0];
      return res.status(200).json({
        success: true,
        data: {
          id: row.id,
          training_provider_id: providerId,
          title: row.title,
          sections: row.sections,
          is_active: row.is_active,
        },
      });
    }

    if (req.method === 'PUT') {
      const { title, sections, is_active } = req.body || {};
      if (typeof title !== 'string' || !Array.isArray(sections)) {
        return res.status(400).json({ success: false, error: 'title (string) and sections (array) are required' });
      }
      const providerId = await resolveProviderId();
      if (!providerId) return res.status(404).json({ success: false, error: 'No training provider found' });

      const result = await pool.query(
        `INSERT INTO feedback_form_template (training_provider_id, title, sections, is_active, updated_at)
         VALUES ($1, $2, $3::jsonb, COALESCE($4, true), NOW())
         ON CONFLICT (training_provider_id) DO UPDATE
           SET title = EXCLUDED.title,
               sections = EXCLUDED.sections,
               is_active = EXCLUDED.is_active,
               updated_at = NOW()
         RETURNING id, title, sections, is_active`,
        [providerId, title, JSON.stringify(sections), is_active]
      );
      const row = result.rows[0];
      return res.status(200).json({
        success: true,
        data: {
          id: row.id,
          training_provider_id: providerId,
          title: row.title,
          sections: row.sections,
          is_active: row.is_active,
        },
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
