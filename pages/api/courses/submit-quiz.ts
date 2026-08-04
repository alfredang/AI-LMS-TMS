import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * POST /api/courses/submit-quiz
 *
 * Body: {
 *   userId: string;       // the learner's app_user.id
 *   courseId: string;     // course.id (uuid)
 *   quizId: string;       // resource_link.id (string) — identifies the quiz
 *   answers: Record<string, number>; // { questionId: selectedOptionIndex }
 * }
 *
 * The server resolves the quiz definition from course.resource_links,
 * scores the answers, and inserts a row into quiz_attempt. Returns the
 * final score + total + per-question correctness breakdown so the
 * client can show a summary immediately after submission.
 *
 * Scoring is done server-side so the client can't fake a high score.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId, courseId, quizId, answers } = req.body || {};

  if (typeof userId !== 'string' || !userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }
  if (typeof courseId !== 'string' || !courseId) {
    return res.status(400).json({ success: false, error: 'courseId is required' });
  }
  if (typeof quizId !== 'string' || !quizId) {
    return res.status(400).json({ success: false, error: 'quizId is required' });
  }
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ success: false, error: 'answers object is required' });
  }

  try {
    // Load the quiz definition from the course row
    const courseRes = await pool.query(
      `SELECT resource_links FROM course WHERE id = $1 LIMIT 1`,
      [courseId]
    );
    if (courseRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    const resourceLinks = Array.isArray(courseRes.rows[0].resource_links)
      ? courseRes.rows[0].resource_links
      : [];
    const quiz = resourceLinks.find((rl: any) => rl?.id === quizId && rl?.type === 'quiz');
    if (!quiz) {
      return res.status(404).json({ success: false, error: 'Quiz not found on this course' });
    }
    if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
      return res.status(400).json({ success: false, error: 'This quiz has no questions configured' });
    }

    // Score server-side
    let score = 0;
    const breakdown: Array<{ questionId: string; correct: boolean; correctIndex: number; selectedIndex: number | null }> = [];
    for (const q of quiz.questions) {
      const selectedRaw = answers[q.id];
      const selectedIndex = typeof selectedRaw === 'number' && Number.isInteger(selectedRaw) ? selectedRaw : null;
      const correct = selectedIndex !== null && selectedIndex === q.correctIndex;
      if (correct) score++;
      breakdown.push({
        questionId: q.id,
        correct,
        correctIndex: q.correctIndex,
        selectedIndex,
      });
    }
    const total = quiz.questions.length;

    // Persist the attempt
    const insertRes = await pool.query(
      `INSERT INTO quiz_attempt (user_id, course_id, quiz_id, score, total, answers)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, completed_at`,
      [userId, courseId, quizId, score, total, JSON.stringify(answers)]
    );
    const row = insertRes.rows[0];

    console.log(`📝 [submit-quiz] user=${userId.slice(0, 8)} course=${courseId.slice(0, 8)} quiz=${quizId} score=${score}/${total}`);

    return res.status(200).json({
      success: true,
      attemptId: row.id,
      completedAt: row.completed_at,
      score,
      total,
      breakdown,
    });
  } catch (err) {
    console.error('❌ submit-quiz error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
