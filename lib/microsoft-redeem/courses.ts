/**
 * The Microsoft MCT Courseware Title Plan, extracted into a static list.
 *
 * Source of truth is `courses.json` (128 courses, generated from
 * `titleplan_may1_2026.xlsx` in the original `microsoftredeemcode` repo).
 * To refresh: regenerate the JSON from a newer Title Plan xlsx and replace
 * `courses.json` — no code change required.
 */

import coursesData from './courses.json';

export interface MicrosoftCourse {
  /** e.g. "AI-102T00" */
  courseNumber: string;
  /** Full course title, usually prefixed with the course number. */
  title: string;
  /** e.g. "Business Applications", "AI". */
  solutionArea: string;
  /** e.g. "3 day". */
  duration: string;
  /** e.g. "Exam/Certification". */
  credential: string;
  /** Microsoft Learn course URL, without the Singapore tracking suffix. */
  baseUrl: string;
}

export const microsoftCourses: MicrosoftCourse[] = coursesData as MicrosoftCourse[];

/** Look up a single course by its exact course number. */
export function findCourse(courseNumber: string): MicrosoftCourse | undefined {
  return microsoftCourses.find((c) => c.courseNumber === courseNumber);
}
