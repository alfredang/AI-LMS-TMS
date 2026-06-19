/**
 * TEMPORARY manual-step notice shown on every reschedule / cancel / move confirmation
 * in the In-App Calendar and the Reschedule & Cancel page.
 *
 * None of these actions update learner ENROLMENTS or TRAINER ASSIGNMENTS on SSG /
 * TPGateway — those remain a manual step. (Verified: `update-sessions` / `delete-sessions`
 * only push the session schedule to SSG; `move-class-to-run` and the class-level cancel
 * are LMS-local DB + Google Calendar only — none call the SSG/TPG enrolment or trainer
 * APIs.)
 *
 * When TPG/SSG enrolment + trainer integration is built for these flows, DELETE this file
 * and remove every reference to TPG_MANUAL_NOTICE.
 */
export const TPG_MANUAL_NOTICE =
  "⚠️ This won't update enrolments or the trainer on TPGateway — please update those there yourself.";

/**
 * Variant for flows that DO sync the trainer assignment to TPGateway (currently the
 * class move, when "Also assign trainer on TPGateway" is on) — only learner enrolments
 * remain a manual step. Remove this too once enrolment integration lands.
 */
export const TPG_MANUAL_NOTICE_ENROLMENTS_ONLY =
  "⚠️ This won't update enrolments on TPGateway — please update those there yourself. (The trainer is updated on TPGateway.)";
