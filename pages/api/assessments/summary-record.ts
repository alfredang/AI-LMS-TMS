import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import { isAssignedTrainer, isStaff, requireCourseRunTrainer } from '@lib/auth/courseRunAccess';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAssessorRecord } from '@lib/assessment/signSubmissions';
import {
  clearSummaryRecordSignature,
  getLearnerSignature,
  getSummaryRecord,
  getSummaryRunInfo,
  isLearnerEnrolled,
  listSummaryRecords,
  signSummaryRecord,
} from '@lib/assessment/summaryRecord';
import type { Party } from '@lib/assessment/summaryRecordStamp';

// Generating the PDF downloads the template, stamps it and re-uploads it.
export const config = { api: { responseLimit: false }, maxDuration: 120 };

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Assessment Summary Record e-signing.
 *
 * GET  ?courseRunId=&learnerUserId?
 *   Learner (enrolled, not the class trainer) or ?view=learner: their own
 *   signing state. Trainer of the class / staff: every learner's state (or
 *   one learner).
 *   Also returns the run's dates and template link for the UI.
 *
 * POST { courseRunId, learnerUserId?, party?, signDate?, signed? }
 *   party 'learner' → the caller signs the Candidate block of their own
 *                     record (must be enrolled in the run).
 *   party 'trainer' → the caller signs the Assessor block of learnerUserId's
 *                     record with their saved assessor details (must be an
 *                     assigned trainer of the run, or staff).
 *   signed=false    → remove that party's signature instead.
 *   Each call regenerates the PDF from the course's template with every block
 *   signed so far and returns the Drive link.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = (req as AuthedApiRequest).authUser!;

  try {
    if (req.method === 'GET') {
      const courseRunId = typeof req.query.courseRunId === 'string' ? req.query.courseRunId.trim() : '';
      const learnerUserId = typeof req.query.learnerUserId === 'string' ? req.query.learnerUserId.trim() : '';
      if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });

      const run = await getSummaryRunInfo(courseRunId);
      if (!run) return res.status(404).json({ success: false, error: 'Course run not found' });
      const runInfo = { startDate: run.startDate, endDate: run.endDate, templateUrl: run.templateUrl, hasTemplate: !!run.templateUrl };

      // view=learner: the course page in Learner mode wants the caller's own
      // record even when they also hold a trainer/staff role.
      const asLearner = req.query.view === 'learner';
      const canSeeAll = !asLearner && (isStaff(auth) || (auth.roles.has('trainer') && (await isAssignedTrainer(auth.id, courseRunId))));
      if (canSeeAll) {
        if (learnerUserId) {
          return res.status(200).json({ success: true, run: runInfo, record: await getSummaryRecord(courseRunId, learnerUserId) });
        }
        return res.status(200).json({ success: true, run: runInfo, learners: await listSummaryRecords(courseRunId) });
      }

      if (!(await isLearnerEnrolled(auth.id, courseRunId))) {
        return res.status(403).json({ success: false, error: 'You are not enrolled in this class' });
      }
      const signature = await getLearnerSignature(auth.id);
      return res.status(200).json({
        success: true,
        run: runInfo,
        record: await getSummaryRecord(courseRunId, auth.id),
        hasSignature: !!signature?.signature_png,
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const body = req.body || {};
    const courseRunId = typeof body.courseRunId === 'string' ? body.courseRunId.trim() : '';
    if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });
    const signed = body.signed !== false;
    const signDate = typeof body.signDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.signDate) ? body.signDate : todayIso();

    // Which block is being signed: explicit, else the trainer block for anyone
    // who may act as the class trainer, else the learner block.
    let party: Party;
    if (body.party === 'learner' || body.party === 'trainer') {
      party = body.party;
    } else {
      const trainerish = isStaff(auth) || (auth.roles.has('trainer') && (await isAssignedTrainer(auth.id, courseRunId)));
      party = trainerish && typeof body.learnerUserId === 'string' && body.learnerUserId !== auth.id ? 'trainer' : 'learner';
    }

    if (party === 'learner') {
      // A learner signs only their own record; a machine key may name the learner.
      const learnerUserId = auth.isService
        ? (typeof body.learnerUserId === 'string' ? body.learnerUserId : '')
        : auth.id;
      if (!learnerUserId) return res.status(400).json({ success: false, error: 'learnerUserId is required for machine callers' });
      if (!(await isLearnerEnrolled(learnerUserId, courseRunId))) {
        return res.status(403).json({ success: false, error: 'You are not enrolled in this class' });
      }

      if (!signed) {
        const out = await clearSummaryRecordSignature({ courseRunId, learnerUserId, party });
        return res.status(200).json({ success: true, signed: false, party, ...out });
      }

      const sig = await getLearnerSignature(learnerUserId);
      if (!sig) {
        return res.status(409).json({ success: false, code: 'NO_LEARNER_SIGNATURE', error: 'Set up your name, NRIC and signature first.' });
      }
      if (!sig.signature_png) {
        return res.status(409).json({ success: false, code: 'NO_SIGNATURE', error: 'Draw and save your signature before signing.' });
      }
      const out = await signSummaryRecord({
        courseRunId, learnerUserId, party, signDate,
        signer: { userId: learnerUserId, name: sig.learner_name, nric: sig.nric, signaturePng: sig.signature_png },
      });
      return res.status(200).json({ success: true, signed: true, party, ...out });
    }

    // Trainer block
    const learnerUserId = typeof body.learnerUserId === 'string' ? body.learnerUserId.trim() : '';
    if (!learnerUserId) return res.status(400).json({ success: false, error: 'learnerUserId is required' });
    if (!(await requireCourseRunTrainer(auth, res, courseRunId))) return;
    if (!(await isLearnerEnrolled(learnerUserId, courseRunId))) {
      return res.status(404).json({ success: false, error: 'Learner is not enrolled in this class' });
    }

    if (!signed) {
      const out = await clearSummaryRecordSignature({ courseRunId, learnerUserId, party });
      return res.status(200).json({ success: true, signed: false, party, ...out });
    }

    const trainerUserId = auth.isService
      ? (typeof body.trainerUserId === 'string' ? body.trainerUserId : '')
      : auth.id;
    if (!trainerUserId) return res.status(400).json({ success: false, error: 'trainerUserId is required for machine callers' });
    const assessor = await getAssessorRecord(trainerUserId);
    if (!assessor) {
      return res.status(409).json({ success: false, code: 'NO_ASSESSOR_PROFILE', error: 'Set up your assessor name, NRIC, date and signature first.' });
    }
    if (!assessor.signature_png) {
      return res.status(409).json({ success: false, code: 'NO_SIGNATURE', error: 'Draw and save your signature before signing.' });
    }
    const out = await signSummaryRecord({
      courseRunId, learnerUserId, party, signDate,
      signer: { userId: trainerUserId, name: assessor.assessor_name, nric: assessor.nric, signaturePng: assessor.signature_png },
    });
    return res.status(200).json({ success: true, signed: true, party, ...out });
  } catch (error: any) {
    console.error('summary-record error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer', 'learner'] });
