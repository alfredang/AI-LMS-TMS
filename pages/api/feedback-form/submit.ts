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
    const routeKey = typeof course_run_id === 'string' ? course_run_id.trim() : '';
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let resolvedRunId: string | null = null;
    let sourceRunKey: string | null = null;
    let courseCode: string | null = null;
    if (routeKey) {
      if (uuidRe.test(routeKey)) {
        const run = await pool.query(
          `SELECT cr.id, COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS course_code
             FROM course_run cr
             JOIN course c ON c.id = cr.course_id
            WHERE cr.id = $1
            LIMIT 1`,
          [routeKey]
        );
        if (!run.rows[0]) return res.status(404).json({ success: false, error: 'Class not found' });
        resolvedRunId = run.rows[0].id;
        courseCode = run.rows[0].course_code || null;
      } else if (routeKey.startsWith('calendar:')) {
        const source = await pool.query(
          `SELECT source_run_key, course_code
             FROM mms_sync_source
            WHERE source_run_key = $1
            LIMIT 1`,
          [routeKey]
        );
        if (!source.rows[0]) return res.status(404).json({ success: false, error: 'Class not found' });
        sourceRunKey = source.rows[0].source_run_key;
        courseCode = source.rows[0].course_code || null;
      } else {
        const run = await pool.query(
          `SELECT cr.id, COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS course_code
             FROM course_run cr
             JOIN course c ON c.id = cr.course_id
            WHERE cr.course_run_id = $1 OR c.course_code = $1 OR c.new_course_code = $1
            ORDER BY (cr.course_run_id = $1) DESC,
                     (cr.start_date <= (now() AT TIME ZONE 'Asia/Singapore')::date
                      AND cr.end_date >= (now() AT TIME ZONE 'Asia/Singapore')::date) DESC,
                     ABS(cr.start_date - (now() AT TIME ZONE 'Asia/Singapore')::date) ASC NULLS LAST
            LIMIT 1`,
          [routeKey]
        );
        if (!run.rows[0]) return res.status(404).json({ success: false, error: 'Class not found' });
        resolvedRunId = run.rows[0].id;
        courseCode = run.rows[0].course_code || null;
      }
    }
    const result = await pool.query(
      `INSERT INTO feedback_form_response
         (template_id, course_run_id, source_run_key, user_id, learner_email, learner_name, answers)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, submitted_at`,
      [
        template_id || null,
        resolvedRunId,
        sourceRunKey,
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
      courseRunId: resolvedRunId,
      courseCode,
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

