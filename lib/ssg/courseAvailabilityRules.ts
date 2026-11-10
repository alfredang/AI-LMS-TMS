import { classifyRenewStatus } from '../courseRenewalStatus';

export type CourseAvailabilityStatus =
  | 'active'
  | 'renewal_processing'
  | 'expired'
  | 'no_public_run'
  | 'rejected'
  | 'no_support'
  | 'unknown';

export interface AvailabilityDecision {
  status: CourseAvailabilityStatus;
  reason: string;
}

export interface AvailabilityFacts {
  today: string;
  supportFrom: string | null;
  supportTo: string | null;
  hasFutureRun: boolean;
  renewedStatus?: string | null;
}

export function parseSsgDate(value: unknown): string | null {
  const date = String(value ?? '').trim();
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  return null;
}

/**
 * SSG is the availability authority. A support period alone is insufficient:
 * MySkillsFuture search only has something useful to sell when a future run is
 * published as well. Manual renewal status is used only to explain an inactive
 * result; it can never override stale/absent SSG data and reopen a course.
 */
export function classifyCourseAvailability(facts: AvailabilityFacts): AvailabilityDecision {
  const renewal = classifyRenewStatus(facts.renewedStatus);
  const supportIsCurrent = Boolean(
    facts.supportFrom && facts.supportTo &&
    facts.supportFrom <= facts.today && facts.supportTo >= facts.today,
  );

  if (supportIsCurrent && facts.hasFutureRun) {
    return { status: 'active', reason: `SSG support is valid through ${facts.supportTo} and a future run is published.` };
  }
  if (renewal === 'Rejected') {
    return { status: 'rejected', reason: 'The course renewal was rejected or marked expired.' };
  }
  if (renewal === 'Waiting') {
    return { status: 'renewal_processing', reason: 'The course renewal is still processing with SSG.' };
  }
  if (facts.supportTo && facts.supportTo < facts.today) {
    return { status: 'expired', reason: `SSG support expired on ${facts.supportTo}.` };
  }
  if (!facts.supportFrom || !facts.supportTo) {
    return { status: 'no_support', reason: 'SSG returned no WSQ or Non-WSQ support period for this course.' };
  }
  return { status: 'no_public_run', reason: 'SSG has no future published course run for this course.' };
}
