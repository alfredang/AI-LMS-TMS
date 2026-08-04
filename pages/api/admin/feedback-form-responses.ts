import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'PATCH') {
      const { id, learner_name, learner_email, answers } = req.body || {};
      if (typeof id !== 'string') return res.status(400).json({ success: false, error: 'id is required' });
      if (answers && typeof answers !== 'object') return res.status(400).json({ success: false, error: 'answers must be an object' });

      const result = await pool.query(
        `UPDATE feedback_form_response
            SET learner_name = COALESCE($2, learner_name),
                learner_email = COALESCE($3, learner_email),
                answers = COALESCE($4::jsonb, answers)
          WHERE id = $1
          RETURNING id, learner_name, learner_email, answers, submitted_at`,
        [id, learner_name ?? null, learner_email ?? null, answers ? JSON.stringify(answers) : null]
      );
      if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Response not found' });
      return res.status(200).json({ success: true, data: result.rows[0] });
    }

    if (req.method === 'DELETE' || req.method === 'POST') {
      const body = req.body || {};
      const ids: unknown = body.ids ?? (typeof req.query.id === 'string' ? [req.query.id] : []);
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every(x => typeof x === 'string')) {
        return res.status(400).json({ success: false, error: 'ids (string[]) is required' });
      }
      const result = await pool.query(
        `DELETE FROM feedback_form_response WHERE id = ANY($1::uuid[]) RETURNING id`,
        [ids]
      );
      return res.status(200).json({ success: true, deleted: result.rowCount, ids: result.rows.map(r => r.id) });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
