import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { template_id, course_run_id, user_id, learner_email, learner_name, answers } = req.body || {};

  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ success: false, error: 'answers (object) is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO feedback_form_response
         (template_id, course_run_id, user_id, learner_email, learner_name, answers)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, submitted_at`,
      [
        template_id || null,
        course_run_id || null,
        user_id || null,
        learner_email || null,
        learner_name || null,
        JSON.stringify(answers),
      ]
    );

    return res.status(200).json({
      success: true,
      data: { id: result.rows[0].id, submitted_at: result.rows[0].submitted_at },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

