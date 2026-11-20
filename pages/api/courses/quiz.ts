import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

const STAFF_ROLES = ['admin', 'trainingProvider', 'trainer', 'developer'];

/**
 * GET /api/courses/quiz?courseId=...&quizId=...
 *
 * One quiz (a Quiz asset on a subtopic, stored in course.resource_links) for
 * the signed-in user: used by the /quiz/<courseId>/<quizId> page behind the
 * trainer's quiz QR code and by the mobile app when it opens that link.
 * Returns the quiz with the caller's latest attempt.
 *
 * With &tally=1 (staff only) it returns how many learners have completed the
 * quiz, for the counter under the trainer's full-screen QR code.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const courseId = typeof req.query.courseId === 'string' ? req.query.courseId : '';
  const quizId = typeof req.query.quizId === 'string' ? req.query.quizId : '';
  if (!courseId || !quizId) {
    return res.status(400).json({ success: false, error: 'courseId and quizId are required' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId)) {
    return res.status(404).json({ success: false, error: 'Quiz not found' });
  }
  const user = (req as AuthedApiRequest).authUser!;

  try {
    const courseRes = await pool.query(
      `SELECT title, course_code, resource_links FROM course WHERE id = $1 LIMIT 1`,
      [courseId]
    );
    const links = courseRes.rows[0] && Array.isArray(courseRes.rows[0].resource_links)
      ? courseRes.rows[0].resource_links
      : [];
    const quiz = links.find((rl: any) => rl?.id === quizId && rl?.type === 'quiz');
    if (!quiz) {
      return res.status(404).json({ success: false, error: 'Quiz not found' });
    }

    if (req.query.tally === '1') {
      const isStaff = user.isService || STAFF_ROLES.some((r) => user.roles.has(r));
      if (!isStaff) return res.status(403).json({ success: false, error: 'Forbidden' });
      // Each learner counts once, on their latest attempt.
      const t = await pool.query(
        `SELECT COUNT(*)::int AS attempts,
                COUNT(DISTINCT user_id)::int AS learners,
                (SELECT ROUND(AVG(100.0 * l.score / NULLIF(l.total, 0)))::int
                   FROM (SELECT DISTINCT ON (user_id) score, total
                           FROM quiz_attempt
                          WHERE course_id = $1 AND quiz_id = $2
                          ORDER BY user_id, completed_at DESC) l) AS average
           FROM quiz_attempt
          WHERE course_id = $1 AND quiz_id = $2`,
        [courseId, quizId]
      );
      return res.status(200).json({ success: true, tally: t.rows[0] });
    }

    const questions = (Array.isArray(quiz.questions) ? quiz.questions : []).map((q: any) => ({
      id: String(q.id),
      question: String(q.question || ''),
      options: Array.isArray(q.options) ? q.options.map((o: any) => String(o)) : [],
      correctIndex: Number(q.correctIndex),
    }));

    let previous: { score: number; total: number; completedAt: string } | null = null;
    if (!user.isService) {
      const a = await pool.query(
        `SELECT score, total, completed_at FROM quiz_attempt
          WHERE user_id = $1 AND course_id = $2 AND quiz_id = $3
          ORDER BY completed_at DESC LIMIT 1`,
        [user.id, courseId, quizId]
      );
      if (a.rows[0]) {
        previous = { score: a.rows[0].score, total: a.rows[0].total, completedAt: a.rows[0].completed_at };
      }
    }

    return res.status(200).json({
      success: true,
      quiz: {
        id: quizId,
        courseId,
        title: quiz.title || 'Quiz',
        courseTitle: courseRes.rows[0].title,
        courseCode: courseRes.rows[0].course_code,
        questions,
      },
      previous,
    });
  } catch (err) {
    console.error('❌ quiz error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler);
