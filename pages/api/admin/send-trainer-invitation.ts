import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { sendNextTrainerInvitationForCourseRun } from '@/lib/trainerInvitationSender';

/**
 * POST /api/admin/send-trainer-invitation
 * Body: { courseRunUuid: string, overrideTrainerName?: string }
 *
 * Thin wrapper around the shared `sendNextTrainerInvitationForCourseRun`
 * helper so the admin UI, the on-decline auto-escalation, and the weekly
 * auto-sweep all go through the same code path.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { courseRunUuid, overrideTrainerName } = req.body || {};
    if (!courseRunUuid || typeof courseRunUuid !== 'string') {
      return res.status(400).json({ success: false, error: 'courseRunUuid is required' });
    }

    const result = await sendNextTrainerInvitationForCourseRun({
      courseRunUuid,
      overrideTrainerName: typeof overrideTrainerName === 'string' ? overrideTrainerName : undefined,
      // Admin-initiated manual sends always allow resend — if the trainer
      // still has a pending invitation, the old one is marked 'resent' and
      // a fresh email with new accept/decline tokens goes out.
      allowResend: true,
    });

    switch (result.status) {
      case 'sent':
        return res.status(200).json({ success: true, message: result.message, result });
      case 'skipped_already_pending':
        return res.status(200).json({ success: true, message: result.message, result });
      case 'skipped_class_not_found':
        return res.status(404).json({ success: false, error: 'Course run not found' });
      case 'skipped_no_approved_trainers':
      case 'skipped_all_invited':
      case 'skipped_no_email':
      case 'skipped_no_learners':
        return res.status(400).json({ success: false, error: result.message, result });
      case 'error':
      default:
        return res.status(500).json({ success: false, error: result.message || 'Failed to send invitation' });
    }
  } catch (error) {
    console.error('Error sending trainer invitation:', error);
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to send trainer invitation' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
