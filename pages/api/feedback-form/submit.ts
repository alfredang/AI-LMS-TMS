import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { postFeedbackReview } from '../../../lib/feedback/postReview';

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

    // Publish to the storefront as a product review. Deliberately awaited but
    // never allowed to fail the submission: the learner's feedback is already
    // saved above, and the storefront is a separate system that may be slow or
    // down. The call is idempotent on the response id, so it is safe to replay.
    const review = await postFeedbackReview({
      responseId: result.rows[0].id,
      courseRunId: course_run_id || null,
      learnerName: learner_name || null,
      answers,
    }).catch(err => ({ posted: false, error: String(err) }));

    if (!review.posted && review.error) {
      console.error('[feedback] storefront review post failed', {
        response_id: result.rows[0].id,
        error: review.error,
      });
    }

    // The review outcome is deliberately not returned: this form is public and
    // unauthenticated, and storefront errors are internal detail. The learner
    // only needs to know their feedback was recorded.
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

