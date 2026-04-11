import type { NextApiRequest, NextApiResponse } from 'next';
import { runAutomation } from '../../api/external/auto-send-trainer-invitations';
import {
  loadTrainingProviderEmailConfig,
  sendNextTrainerInvitationForCourseRun,
  TrainerInvitationSendResult,
} from '../../../lib/trainerInvitationSender';

/**
 * POST /api/admin/run-auto-send-trainer-invitations
 *
 * Admin trigger for the Auto Send Trainer Invitations sweep.
 *
 * Body (optional):
 *   { courseRunUuids: string[] }  — if provided, only send to these specific runs
 *                                   (used by the preview → selective send flow)
 *   If omitted, runs the full sweep (all eligible upcoming runs).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { courseRunUuids } = req.body || {};

    // Selective send: only process the specified course runs
    if (Array.isArray(courseRunUuids) && courseRunUuids.length > 0) {
      const tp = await loadTrainingProviderEmailConfig();
      if (!tp) {
        return res.status(500).json({ success: false, error: 'Training provider Gmail OAuth is not configured' });
      }

      const results: TrainerInvitationSendResult[] = [];
      let sent = 0, skipped = 0, errors = 0;

      for (const uuid of courseRunUuids) {
        try {
          const result = await sendNextTrainerInvitationForCourseRun({ courseRunUuid: uuid, tp });
          results.push(result);
          if (result.status === 'sent') sent++;
          else if (result.status === 'error') errors++;
          else skipped++;
        } catch (err) {
          errors++;
          results.push({
            status: 'error',
            courseRunUuid: uuid,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return res.status(200).json({ success: true, sent, skipped, errors, totalEligible: courseRunUuids.length, results });
    }

    // Full sweep (no filter)
    const result = await runAutomation();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ run-auto-send-trainer-invitations error:', err);
    return res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
