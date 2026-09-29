import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import { requireCourseRunTrainer } from '@lib/auth/courseRunAccess';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getAssessorRecord,
  signLearnerSubmissions,
  unsignLearnerSubmissions,
} from '@lib/assessment/signSubmissions';

// Stamping downloads, edits and re-uploads each file; a learner with several
// large submissions can take a while.
export const config = { api: { responseLimit: false }, maxDuration: 120 };

/**
 * POST { courseRunId, learnerUserId, signed: boolean }
 *
 * signed=true  → stamp the caller's assessor block (name/NRIC/date/signature)
 *                onto every unsigned PDF/DOCX the learner submitted for the run.
 * signed=false → restore the learner's original files.
 *
 * The "SIG" checkbox on the Student Grading Roster drives this.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = (req as AuthedApiRequest).authUser!;
  const { courseRunId, learnerUserId, signed } = req.body || {};
  if (typeof courseRunId !== 'string' || !courseRunId || typeof learnerUserId !== 'string' || !learnerUserId || typeof signed !== 'boolean') {
    return res.status(400).json({ success: false, error: 'courseRunId, learnerUserId and signed (boolean) are required' });
  }

  // Trainers may only sign for classes they are assigned to.
  if (!(await requireCourseRunTrainer(auth, res, courseRunId))) return;

  // Machine callers must say whose assessor details to stamp.
  const trainerUserId = auth.isService
    ? (typeof req.body?.trainerUserId === 'string' ? req.body.trainerUserId : '')
    : auth.id;

  try {
    if (!signed) {
      const results = await unsignLearnerSubmissions({ learnerUserId, courseRunId });
      return res.status(200).json({ success: true, signed: false, results });
    }

    if (!trainerUserId) {
      return res.status(400).json({ success: false, error: 'trainerUserId is required for machine callers' });
    }
    const assessor = await getAssessorRecord(trainerUserId);
    if (!assessor) {
      return res.status(409).json({
        success: false,
        code: 'NO_ASSESSOR_PROFILE',
        error: 'Set up your assessor name, NRIC, date and signature first.',
      });
    }
    if (!assessor.signature_png) {
      return res.status(409).json({
        success: false,
        code: 'NO_SIGNATURE',
        error: 'Draw and save your signature before signing assessments.',
      });
    }

    const results = await signLearnerSubmissions({ trainerUserId, learnerUserId, courseRunId, assessor });
    const anySigned = results.some(r => r.status === 'signed');
    const allSignedOrSkipped = results.length > 0 && results.every(r => r.status === 'signed' || (r.status === 'skipped' && r.reason === 'Already signed'));
    return res.status(200).json({
      success: true,
      signed: anySigned || allSignedOrSkipped,
      results,
    });
  } catch (error: any) {
    console.error('sign-assessments error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
