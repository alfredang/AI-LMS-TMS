/**
 * Posts a learner's course-feedback submission to the storefront as a product
 * review (www.tertiarycourses.com.sg).
 *
 * The storefront endpoint (`lms_feedback_review_api.php`) decides moderation:
 * an average above 2 stars is published immediately, 2 or below is held as
 * Pending for an admin to read. Nothing here needs to know that rule — we send
 * the ratings and record what the storefront decided.
 *
 * Best-effort by design: a storefront outage must never fail a learner's
 * feedback submission, so every path here resolves rather than throws. The
 * `external_ref` (the feedback_form_response row id) makes the call idempotent
 * so a retry cannot create a duplicate review.
 */

import pool from '../db';

/**
 * LMS feedback field id -> Magento rating_id on the storefront review form.
 * Verified against the live product page markup, which posts ratings[1],
 * ratings[2] and ratings[5].
 */
const RATING_FIELD_MAP: Record<string, string> = {
  rate_learning_objectives: '1', // course meets expectation
  rate_trainer_knowledge: '2', // trainer knowledgeable
  rate_training_environment: '5', // training environment
};

export interface PostReviewInput {
  responseId: string;
  courseRunId?: string | null;
  learnerName?: string | null;
  answers: Record<string, unknown>;
}

export interface PostReviewResult {
  posted: boolean;
  skipped?: string;
  reviewId?: number;
  status?: 'approved' | 'pending';
  duplicate?: boolean;
  error?: string;
}

/** Collect the 1-5 star ratings, ignoring anything out of range or unparseable. */
function extractRatings(answers: Record<string, unknown>): Record<string, number> {
  const ratings: Record<string, number> = {};
  for (const [fieldId, ratingId] of Object.entries(RATING_FIELD_MAP)) {
    const n = Number(answers[fieldId]);
    if (Number.isFinite(n) && n >= 1 && n <= 5) ratings[ratingId] = Math.round(n);
  }
  return ratings;
}

/**
 * The storefront SKU is the course code. `new_course_code` wins when present —
 * a renumbered course keeps its old code in `course_code` while the storefront
 * has moved to the new one.
 */
async function resolveSku(courseRunId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS sku
       FROM course_run cr
       JOIN course c ON c.id = cr.course_id
      WHERE cr.id = $1
      LIMIT 1`,
    [courseRunId]
  );
  const sku = rows[0]?.sku;
  return typeof sku === 'string' && sku.trim() !== '' ? sku.trim() : null;
}

export async function postFeedbackReview(input: PostReviewInput): Promise<PostReviewResult> {
  const baseUrl = process.env.STOREFRONT_REVIEW_API_URL;
  const apiKey = process.env.STOREFRONT_REVIEW_API_KEY;

  // Absent config means the integration is simply off (e.g. a tenant that does
  // not publish reviews). That is a skip, not an error.
  if (!baseUrl || !apiKey) return { posted: false, skipped: 'not_configured' };
  if (!input.courseRunId) return { posted: false, skipped: 'no_course_run' };

  const ratings = extractRatings(input.answers);
  if (Object.keys(ratings).length === 0) return { posted: false, skipped: 'no_ratings' };

  const nickname = (input.learnerName || '').trim();
  if (!nickname) return { posted: false, skipped: 'no_learner_name' };

  const detail = String(input.answers.message ?? '').trim();
  // A review with no comment is thin but still carries the star ratings, which
  // are the part that moves the course's public score.
  const body = {
    sku: await resolveSku(input.courseRunId),
    nickname,
    detail: detail || 'Attended the course.',
    ratings,
    external_ref: input.responseId,
  };

  if (!body.sku) return { posted: false, skipped: 'no_sku' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return { posted: false, error: json?.message || json?.error || `HTTP ${res.status}` };
    }

    return {
      posted: true,
      reviewId: json.review_id,
      status: json.status,
      duplicate: !!json.duplicate,
    };
  } catch (err) {
    return { posted: false, error: err instanceof Error ? err.message : String(err) };
  }
}
