import type { PriorFailure, SyncItem } from '../wsqScheduleSync';

/** An enabled storefront course SSG has no future run for (from /courses/api_availability). */
export interface RunsNeededCourse {
  course_code: string;
  ssg_course_code?: string | null;
  course_title?: string | null;
}

export interface RunsNeededPlan {
  /** Website schedules to publish to TPGateway now. */
  toSubmit: SyncItem[];
  /** Per course: what will happen, for the staff email. */
  courses: Array<{
    course_code: string;
    course_title: string;
    submitting: string[];       // start dates being published
    needsDeveloper: string[];   // start dates that failed before on a non-eligibility error
    noWebsiteSchedule: boolean; // nothing future on the storefront to publish
  }>;
}

/**
 * Decide what to publish for the courses the storefront says SSG has no run for.
 * Every future website schedule of those courses is published, so SSG tallies with
 * the storefront. A schedule that failed before on eligibility is retried (the course
 * has a current support period, so the block may have cleared); one that failed on any
 * other error is left for a developer, as in the daily sync. Pure: no I/O.
 */
export function planRunsNeeded(
  needed: RunsNeededCourse[],
  futureItems: SyncItem[],
  priorFailures: Map<string, PriorFailure>,
): RunsNeededPlan {
  const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
  const plan: RunsNeededPlan = { toSubmit: [], courses: [] };
  const seen = new Set<string>();

  for (const course of needed) {
    const code = norm(course.course_code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const codes = new Set([code, norm(course.ssg_course_code)].filter(Boolean));
    const items = futureItems.filter((it) => codes.has(norm(it.course_code)));

    const submitting: string[] = [];
    const needsDeveloper: string[] = [];
    for (const it of items) {
      const failure = priorFailures.get(`${it.course_code.trim()}|${it.start_date}`);
      if (failure && !failure.blocked) {
        needsDeveloper.push(it.start_date);
      } else {
        submitting.push(it.start_date);
        plan.toSubmit.push(it);
      }
    }
    plan.courses.push({
      course_code: course.course_code.trim(),
      course_title: String(course.course_title ?? '').trim(),
      submitting,
      needsDeveloper,
      noWebsiteSchedule: items.length === 0,
    });
  }
  return plan;
}
