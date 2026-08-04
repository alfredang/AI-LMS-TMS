import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  sendScheduleChangeNotification,
  previewScheduleChangeNotification,
  type ScheduleChangeType,
} from '../../../lib/notifications/scheduleChangeEmail';

/**
 * /api/admin/notify-schedule-change
 *
 * GET  ?courseRunId&changeType&summary&reason&subject — PREVIEW only (no send).
 *      Returns { subject, html, summary, recipients:[{email,name,role}] } so the
 *      composer can show an editable, branded preview + per-attendee checkboxes.
 *
 * POST { courseRunId, changeType:'reschedule'|'cancel', summary, reason?, includeTrainer?,
 *        subject?, recipients?:string[] } — sends the (possibly admin-edited) email to
 *      the confirmed learners + accepted trainer(s). When `recipients` is given, ONLY
 *      those addresses are emailed (composer exclusion). Only ever called from an
 *      explicit, admin-confirmed action — never automated.
 */
const VALID_TYPES = new Set<ScheduleChangeType>([
  'session_reschedule', 'day_reschedule', 'class_reschedule', 'session_cancel', 'day_cancel', 'class_cancel', 'reschedule', 'cancel',
]);
const isCancel = (t: ScheduleChangeType) => t === 'cancel' || t.endsWith('_cancel');
const defaultSummary = (changeType: ScheduleChangeType, summary?: string) =>
  String(summary || (isCancel(changeType) ? 'Your class has been cancelled.' : 'Your class schedule has changed.'));

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { courseRunId, changeType, summary, reason, subject, includeTrainer } = req.query as Record<string, string>;
    if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });
    if (!VALID_TYPES.has(changeType as ScheduleChangeType)) {
      return res.status(400).json({ success: false, error: 'invalid changeType' });
    }
    const ct = changeType as ScheduleChangeType;
    try {
      const preview = await previewScheduleChangeNotification({
        courseRunId: String(courseRunId),
        changeType: ct,
        summary: defaultSummary(ct, summary),
        reason: reason ? String(reason) : undefined,
        subjectOverride: subject ? String(subject) : undefined,
        includeTrainer: includeTrainer === 'false' ? false : undefined,
      });
      if (preview.error) return res.status(404).json({ success: false, error: preview.error });
      return res.status(200).json({ success: true, ...preview });
    } catch (err: any) {
      console.error('❌ [notify-schedule-change:preview]', err?.message || err);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to build preview' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const { courseRunId, changeType, summary, reason, includeTrainer, subject, recipients } = (req.body || {}) as {
    courseRunId?: string; changeType?: ScheduleChangeType; summary?: string; reason?: string;
    includeTrainer?: boolean; subject?: string; recipients?: string[];
  };
  if (!courseRunId) return res.status(400).json({ success: false, error: 'courseRunId is required' });
  if (!VALID_TYPES.has(changeType as ScheduleChangeType)) {
    return res.status(400).json({ success: false, error: 'invalid changeType' });
  }
  const ct = changeType as ScheduleChangeType;
  try {
    const result = await sendScheduleChangeNotification({
      courseRunId: String(courseRunId),
      changeType: ct,
      summary: defaultSummary(ct, summary),
      reason: reason ? String(reason) : undefined,
      includeTrainer,
      subjectOverride: subject ? String(subject) : undefined,
      recipientsOverride: Array.isArray(recipients) ? recipients.map(String) : undefined,
    });
    return res.status(200).json({ ...result });
  } catch (err: any) {
    console.error('❌ [notify-schedule-change]', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to send notifications' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
