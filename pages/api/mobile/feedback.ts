import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { DEFAULT_FEEDBACK_FORM_SECTIONS } from '../../../lib/feedbackFormDefaults';
import { postFeedbackReview } from '../../../lib/feedback/postReview';
import { isEnrolled, UUID_RE } from '../../../lib/mobile/app';

// Course feedback for the learner app: the academy's own form for one of the learner's classes.
//  GET  ?runId=          the form, the class details it autofills, and whether it was already sent
//  POST {runId, answers} one response per learner per class
export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  const user = req.authUser!;
  if (user.isService || !user.roles.has('learner')) return res.status(403).json({ error: 'Learner access required' });
  const runId = String((req.method === 'GET' ? req.query.runId : req.body?.runId) || '');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!UUID_RE.test(runId) || !(await isEnrolled(user.id, runId))) return res.status(404).json({ error: 'Class not found' });
    const run = (await pool.query(
      `SELECT c.title, coalesce(nullif(c.new_course_code,''),c.course_code) AS code, cr.start_date::text AS start, cr.end_date::text AS "end"
         FROM course_run cr JOIN course c ON c.id=cr.course_id WHERE cr.id::text=$1`, [runId])).rows[0];
    const tmpl = (await pool.query(
      `SELECT t.id::text, t.title, t.sections FROM feedback_form_template t
        ORDER BY coalesce(t.is_active,true) DESC, t.created_at ASC LIMIT 1`).catch(() => ({ rows: [] as any[] }))).rows[0];
    const sections = tmpl?.sections?.length ? tmpl.sections : DEFAULT_FEEDBACK_FORM_SECTIONS;
    const done = ((await pool.query(`SELECT 1 FROM feedback_form_response WHERE user_id=$1 AND course_run_id::text=$2 LIMIT 1`, [user.id, runId])).rowCount ?? 0) > 0;

    if (req.method === 'GET') {
      return res.json({ data: {
        title: tmpl?.title || 'Course Feedback', sections, submitted: done,
        autofill: { course_title: run.title, course_code: run.code, start_date: run.start, end_date: run.end },
      } });
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (done) return res.status(409).json({ error: 'You have already sent feedback for this class. Thank you.' });

    const input = req.body?.answers;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ error: 'Please complete the form.' });
    const me = (await pool.query('SELECT email, full_name FROM app_user WHERE id=$1', [user.id])).rows[0];
    const auto: Record<string, unknown> = { course_title: run.title, course_code: run.code, start_date: run.start, end_date: run.end };
    const answers: Record<string, string | number> = {};
    for (const field of sections.flatMap((s: any) => s.fields || [])) {
      let v: unknown = field.autofill ? auto[field.autofill] : input[field.id];
      if (field.type === 'email' && (v === undefined || v === '')) v = me.email;
      if (field.type === 'rating1to5') {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= 5) answers[field.id] = n;
        else if (field.required) return res.status(400).json({ error: `Please rate: ${field.label}` });
        continue;
      }
      const text = typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 4000) : '';
      if (field.type === 'select' && text && Array.isArray(field.options) && !field.options.includes(text)) return res.status(400).json({ error: `Please choose an option: ${field.label}` });
      if (!text && field.required) return res.status(400).json({ error: `Please answer: ${field.label}` });
      if (text) answers[field.id] = text;
    }
    const saved = (await pool.query(
      `INSERT INTO feedback_form_response (template_id, course_run_id, user_id, learner_email, learner_name, answers)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
      [tmpl?.id || null, runId, user.id, me.email, me.full_name, JSON.stringify(answers)])).rows[0];
    // Same follow-on as the web form; a storefront problem never fails the learner's submission.
    await postFeedbackReview({ responseId: saved.id, courseRunId: runId, courseCode: run.code, learnerName: me.full_name || null, answers }).catch(() => null);
    return res.status(201).json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Your feedback could not be sent. Please try again.' });
  }
}, { roles: ['learner', 'trainer'] });
