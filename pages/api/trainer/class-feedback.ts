import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import { isStaff, requireCourseRunTrainer } from '@lib/auth/courseRunAccess';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { DEFAULT_FEEDBACK_FORM_SECTIONS } from '../../../lib/feedbackFormDefaults';
import type { FeedbackFormField, FeedbackFormSection } from '../../../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET ?courseRunUuid= → every Course Feedback response for one class, for the class page's
 * Course Feedback section: the class header, the average per rating question and each response.
 * Each response also carries every answer on its form (`details`) for the feedback page
 * (/class-feedback/[runId]). The class's assigned trainers see "Learner 1, 2, …" in place of
 * names and no identity answers; staff see names and emails.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const runUuid = String(req.query.courseRunUuid || '').trim();
  if (!UUID_RE.test(runUuid)) return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
  const user = (req as AuthedApiRequest).authUser!;

  try {
    if (!(await requireCourseRunTrainer(user, res, runUuid))) return;

    const run = (await pool.query(
      `SELECT cr.course_run_id, cr.start_date::text AS start_date, cr.end_date::text AS end_date, c.title,
              COALESCE(NULLIF(c.new_course_code, ''), c.course_code) AS course_code,
              COALESCE(
                (SELECT string_agg(DISTINCT crt.trainer_name, ', ' ORDER BY crt.trainer_name)
                   FROM course_run_trainer crt WHERE crt.course_run_id = cr.id AND NULLIF(crt.trainer_name, '') IS NOT NULL),
                NULLIF(cr.assigned_trainer_name, '')
              ) AS trainer_name
         FROM course_run cr JOIN course c ON c.id = cr.course_id
        WHERE cr.id = $1`,
      [runUuid]
    )).rows[0];
    if (!run) return res.status(404).json({ success: false, error: 'Class not found' });

    const rows = (await pool.query(
      `SELECT id, template_id, learner_name, learner_email, answers, submitted_at
         FROM feedback_form_response
        WHERE course_run_id = $1
        ORDER BY submitted_at ASC`,
      [runUuid]
    )).rows;

    // The questions come from the form the responses were given on (the most used template),
    // else the provider's current template, else the built-in default form.
    const templateIds = rows.map(r => r.template_id).filter(Boolean);
    const mostUsed = templateIds.sort((a, b) =>
      templateIds.filter(x => x === b).length - templateIds.filter(x => x === a).length)[0] || null;
    const tmpl = (await pool.query(
      `SELECT sections FROM feedback_form_template
        WHERE ($1::uuid IS NOT NULL AND id = $1::uuid) OR $1::uuid IS NULL
        ORDER BY (id = $1::uuid) DESC NULLS LAST, is_active DESC, created_at ASC LIMIT 1`,
      [mostUsed]
    )).rows[0];
    const sections: FeedbackFormSection[] = tmpl?.sections?.length ? tmpl.sections : DEFAULT_FEEDBACK_FORM_SECTIONS;
    const fields: FeedbackFormField[] = sections.flatMap(s => s.fields || []);
    const ratingFields = fields.filter(f => f.type === 'rating1to5');
    const commentFields = fields.filter(f => f.type === 'textarea');

    // Every form a response was given on, so each response's full answers are labelled by its own form.
    const distinctIds = Array.from(new Set(templateIds.map(String)));
    const formById = new Map<string, FeedbackFormSection[]>();
    if (distinctIds.length) {
      const forms = await pool.query(
        `SELECT id::text AS id, sections FROM feedback_form_template WHERE id = ANY($1::uuid[])`,
        [distinctIds]
      );
      for (const f of forms.rows) if (f.sections?.length) formById.set(f.id, f.sections);
    }
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
    };
    const showNames = isStaff(user);
    // Course details the form fills in itself are already in the class header, and the learner's
    // name / email sit in each response's header (staff only — trainers see "Learner 1, 2, …"),
    // so neither is repeated in a response's answers.
    const isIdentity = (f: FeedbackFormField) =>
      f.type === 'email' || f.id === 'learner_name' || /\b(name|e-?mail|nric|phone|mobile|contact)\b/i.test(f.label);
    const detailsOf = (answers: Record<string, unknown> | null, form: FeedbackFormSection[]) =>
      form.flatMap(sec => (sec.fields || [])
        .filter(f => !f.autofill && !f.readonly)
        .filter(f => !isIdentity(f))
        .map(f => ({
          section: sec.title || '',
          label: f.label,
          type: f.type,
          value: String(answers?.[f.id] ?? '').trim(),
        })));
    const responses = rows.map((r, i) => ({
      id: r.id,
      learner: showNames ? (String(r.learner_name || r.answers?.learner_name || '').trim() || `Learner ${i + 1}`) : `Learner ${i + 1}`,
      email: showNames ? (String(r.learner_email || '').trim() || null) : null,
      ratings: ratingFields.map(f => num(r.answers?.[f.id])),
      comment: commentFields.map(f => String(r.answers?.[f.id] ?? '').trim()).filter(Boolean).join('\n'),
      details: detailsOf(r.answers, (r.template_id && formById.get(String(r.template_id))) || sections),
      submittedAt: r.submitted_at,
    }));

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const averages = ratingFields.map((_, qi) => {
      const vals = responses.map(r => r.ratings[qi]).filter((v): v is number => v !== null);
      return vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    });
    const qAvgs = averages.filter((v): v is number => v !== null);

    return res.status(200).json({
      success: true,
      data: {
        classId: String(run.course_run_id || '').trim(),
        title: run.title,
        courseCode: run.course_code,
        startDate: run.start_date,
        endDate: run.end_date,
        trainer: run.trainer_name || '',
        namesShown: showNames,
        questions: ratingFields.map(f => f.label),
        commentLabel: commentFields[0]?.label || 'Comments',
        averages,
        overallAverage: qAvgs.length ? round1(qAvgs.reduce((a, b) => a + b, 0) / qAvgs.length) : null,
        responses,
      },
    });
  } catch (err: any) {
    console.error('[class-feedback] failed:', err?.message);
    return res.status(500).json({ success: false, error: 'Could not load the course feedback' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
