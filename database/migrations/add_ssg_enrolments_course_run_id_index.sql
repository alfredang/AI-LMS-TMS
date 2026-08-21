-- Index ssg_enrolments.course_run_id.
--
-- RUN_COURSE_CODE_SQL (lib/courseCode.ts) asks SSG which reference number a run
-- is filed under, by looking that run up in ssg_enrolments -- the table we
-- download FROM SSG. That lookup is a correlated subquery on course_run_id,
-- and the column carried no index: every evaluation sequentially scanned the
-- whole table (~22k rows today) to find one match.
--
-- Harmless at that size and at the one-row-per-call sites, but the cost grows
-- linearly with the table, and the expression now sits on the SSG-outbound
-- paths (enrolments, sessions, trainer assignment, CA auto-enrol) plus the CA
-- upload popup. Cheap to index; no reason not to.
--
-- Not partial on `IS NOT NULL`: the planner would have to prove the join's
-- other side is non-null to use it, and at this size the rows saved are not
-- worth depending on that.
--
-- Additive and READ-PATH ONLY: no column, row or constraint is touched. Takes a
-- brief SHARE lock (blocks writes to ssg_enrolments for roughly a second at
-- this size); use CREATE INDEX CONCURRENTLY instead if that must be zero.
--
-- Idempotent: IF NOT EXISTS, safe to re-run.

CREATE INDEX IF NOT EXISTS idx_ssg_enrolments_course_run_id
  ON public.ssg_enrolments (course_run_id);

COMMENT ON INDEX public.idx_ssg_enrolments_course_run_id IS
    'Supports RUN_COURSE_CODE_SQL: resolving the SSG course reference a course run is filed under.';
