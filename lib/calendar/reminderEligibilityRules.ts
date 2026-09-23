import type { TrainerIdentity, TrainerResolutionResult } from './trainerIdentityRules';

export function normalizeSgPhone(tel: string | null | undefined): string | null {
  const digits = String(tel || '').replace(/\D/g, '');
  const normalized = digits.length === 8 ? `65${digits}` : digits;
  return normalized.length >= 8 && normalized.length <= 15 ? `+${normalized}` : null;
}
export function sgtDate(now: Date = new Date(), days = 0): string {
  return new Date(now.getTime() + (8 * 60 * 60 + days * 86400) * 1000).toISOString().slice(0, 10);
}
export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export interface QueuedReminder {
  id: string;
  runUuid: string;
  sessionDate: string | null;
  eventId: string | null;
  trainerUserId: string | null;
  trainerEmail: string | null;
  trainerPhone?: string | null;
  status: string;
  runStartDate: string;
}
export interface EligibilityInput {
  runUuid: string | null;
  eventId: string | null;
  sessionDate: string;
  classStatus: string | null;
  resolution: TrainerResolutionResult;
  assignedTrainerIds: string[];
  assignmentAmbiguous?: boolean;
  queue: QueuedReminder[];
  today: string;
  ignoreNotificationId?: string;
  linkageReason?: string;
}
export interface ReminderDecision { eligible: boolean; reason: string; recipient: TrainerIdentity | null }

/** Shared by report, queue, and fresh dispatch validation. No I/O or mutation. */
export function evaluateReminderEligibility(input: EligibilityInput): ReminderDecision {
  const no = (reason: string): ReminderDecision => ({ eligible: false, reason, recipient: null });
  if (!input.runUuid || !input.eventId) return no(input.linkageReason || 'unverified_run_match');
  if (input.sessionDate <= input.today) return no('session_not_in_future');
  if (input.classStatus !== 'Confirmed') return no('class_not_confirmed');
  if (input.resolution.source === 'calendar_unavailable') return no('calendar_unavailable');
  if (input.resolution.source === 'ambiguous') return no('ambiguous_trainer');
  if (input.resolution.trainer) return no('trainer_accepted_this_session');
  if (input.assignmentAmbiguous) return no('ambiguous_local_assignment');
  if (input.resolution.pending.length !== 1) return no(input.resolution.pending.length ? 'multiple_pending_trainers' : 'no_verified_pending_trainer');
  const recipient = input.resolution.pending[0];
  if (input.assignedTrainerIds.length !== 1 || input.assignedTrainerIds[0] !== recipient.user_id) return no('local_assignment_differs');
  if (!normalizeSgPhone(recipient.phone)) return no('no_usable_phone');
  const duplicate = input.queue.find(q => q.id !== input.ignoreNotificationId && q.runUuid === input.runUuid &&
    // Legacy reminders were queued against run start. Keep this solely for deduplication, never release.
    (q.sessionDate || q.runStartDate) === input.sessionDate &&
    (q.trainerUserId === recipient.user_id || recipient.emails.some(e => e.toLowerCase() === (q.trainerEmail || '').toLowerCase())));
  if (duplicate) return no(duplicate.status === 'sent' ? 'already_sent' : ['pending', 'dispatched'].includes(duplicate.status) ? 'already_queued' : 'previous_reminder_requires_review');
  return { eligible: true, reason: 'awaiting_calendar_acceptance', recipient };
}

/** Exact provenance must survive enqueue -> dispatch; legacy rows are held for review. */
export function queuedReminderMatches(q: QueuedReminder, row: { runUuid: string | null; eventId: string | null; sessionDate: string; decision: ReminderDecision }): boolean {
  return !!q.sessionDate && !!q.eventId && !!q.trainerUserId && row.decision.eligible &&
    q.runUuid === row.runUuid && q.sessionDate === row.sessionDate && q.eventId === row.eventId &&
    q.trainerUserId === row.decision.recipient?.user_id &&
    normalizeSgPhone(q.trainerPhone) === normalizeSgPhone(row.decision.recipient.phone) &&
    row.decision.recipient.emails.some(e => e.toLowerCase() === (q.trainerEmail || '').toLowerCase());
}
