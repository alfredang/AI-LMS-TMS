-- Data fix, not a schema change. course_run_calendar_event (see
-- create_course_run_calendar_event.sql) picked up a bad row on 2026-07-23: the tier-4
-- fuzzy title-match in lib/calendar/resolveEventToRun.ts claimed an MMS-only calendar
-- event ("*AI Vibe Coding for iOS Ecommerce App", description "C141") for an unrelated
-- WSQ course_run ("Vibe Coding for Multi-Agent AI Systems", TGS-2020503207,
-- course_run_id 1171737, run uuid d1f4171e-5a3d-42fa-b598-56bd95318e89) purely from
-- title word overlap ("vibe coding for" = 3/5 words = 60%, the match threshold).
--
-- Fixed in code (resolveEventToRun.ts tier 4 now skips events that carry their own,
-- non-matching course code — a strong signal the event belongs to a different,
-- non-candidate course rather than an unlabeled LMS run). This migration removes the
-- 2 already-persisted bad rows so the durable-mapping tier (tier 1) stops trusting them.
-- Safe to run more than once — a plain conditional DELETE, no-ops once already applied.

DELETE FROM course_run_calendar_event
WHERE course_run_id = 'd1f4171e-5a3d-42fa-b598-56bd95318e89'
  AND google_event_id IN (
    'p2m6ec0kqethhi35tlaeggr66g_20260727T013000Z',
    'p2m6ec0kqethhi35tlaeggr66g_20260728T013000Z'
  );
