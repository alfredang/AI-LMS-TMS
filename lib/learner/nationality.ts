// Nationality choices on the SWDA Enrolment form (public /enrol/[runId]). Shared by the page and
// the server-side validation in lib/learner/enrolmentDetailRequest.ts.
export const NATIONALITY_OPTIONS = ['Singapore Citizen', 'Singapore PR', 'Foreigner'] as const;
export type NationalityOption = typeof NATIONALITY_OPTIONS[number];
