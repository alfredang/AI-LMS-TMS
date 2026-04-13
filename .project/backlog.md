---
last-updated: 2026-04-12
last-session-touched-by: trainer-invitation-audit-session
---

# Backlog

Confirmed tasks ready for work. Updated by `/update-progress` (marks completed items).

**Convention**: Each task description should have enough detail to infer what it's about without reading other files — as detailed as needed but just enough.

## Active

| # | Task | Status | Added |
|---|------|--------|-------|
| 66 | **Edit Class: refetch Course Title + Course Reference Number from SSG on load** — currently reads from local DB which can drift from SSG. Auto-refetch on form mount, fall back to local with warning if SSG fetch fails. | Active | 2026-04-10 |
| 67 | **Edit Class: Save to SSG (SSG-first, sync back to local)** — replace local-only save with SSG push then sync back. If SSG fails, don't save locally. **Needs review**: 1 button (SSG-only) vs 2 buttons (local + SSG). Must parse SSG error body per ssg-response-parsing.md. | Active | 2026-04-10 |
| 64 | ~~Calendar: per-day "Ongoing but not running today" section~~ — collapsible section below daily classes showing CRs ongoing (within start/end dates) but no session on that day. Red dot for CRs with 0 total sessions. | Done | 2026-04-13 |
| 62 | **Bug: RegistrationOpeningDate not editable once past** — SSG blocks editing. Workaround: assign trainer directly via TPG. Add clearer error message with link to TPG assign flow. | Active | 2026-04-09 |
| 74 | ~~sync-trainer-to-tpg.ts reads only scalar assigned_trainer_name~~ — fixed: junction table + multi-trainer support + removed class status flip | Done | 2026-04-13 |
| 75 | **Bulk import course runs from SSG** — Two-step pipeline: (1) run `populate-course-runs.js` for selected course code(s) to fetch all course runs into `ssg_course_runs`, (2) feed each discovered course run ID through `/api/admin/upsert-from-ssg` for full upsert (course, course_run, sessions, enrolments). **Phase 2 needs proper batching** — current upsert endpoint is limited to 10 at a time; need a backend script/queue that processes runs sequentially with configurable delay (e.g. 1-2s between SSG calls) to avoid overloading SSG API. UI: admin picks course codes, preview shows discovered runs, progress bar during upsert, batch size + delay configurable. | Active | 2026-04-12 |
| 57 | **Edit Approved Trainers list from Edit Class** — add/remove/reorder trainers in the "Approved Trainers for This Course" panel directly. Currently read-only, requires Course Editor to change. Saves back to `course.trainers_list`. | Active | 2026-04-09 |
| 56 | **Reassign Trainer: typed combobox** — replace plain `<select>` with searchable combobox for reassigning trainer. Useful for courses with long approved trainer lists. Low priority UI polish. | Active | 2026-04-09 |
| 70 | **Calendar: enrolment details in expanded row** — TPG + Local enrolment pair, learner count + status breakdown, "Assign Learner" from calendar row. | Active | 2026-04-10 |
| 72 | **Calendar: per-CR admin notes with urgency colors** — short admin memos per course run (e.g. "waiting for venue confirmation"), color-coded by urgency (red/yellow/green/grey). Calendar-only display. | Active | 2026-04-10 |
| 73 | **Calendar: expanded row UI redesign** — reorganize accumulated features (status, type, sessions, trainers, enrolment, attendance, notes) into cleaner layout. Deferred until #64, #70, #72 land. | Active | 2026-04-10 |
| 76 | ~~Upsert from SSG: also sync TPG trainer~~ — the "Upsert from SSG" button (View Class By Date) imports course, course_run, sessions, enrolments and now also pulls `linkCourseRunTrainer` from the SSG response to update `tpg_assigned_trainer_name/email`. | Done | 2026-04-13 |
| 77 | ~~Add to Google Calendar on trainer invitation accept~~ — the trainer invitation accept webhook (`respond.ts`) now attempts to add the accepting trainer to the Google Calendar event. End-to-end verification still pending. | Done | 2026-04-13 |
| 78 | **Google Calendar → course run matching** — parse Google Calendar event titles to extract course title, resolve to course code → course run. Parsing logic needs to be complex (multiple naming conventions) or allow human-guided matching for ambiguous cases. Enable sync-by-day (upsert selected day's course runs from SSG). | Active | 2026-04-13 |
| 79 | **Calendar: sort by day number (Day 1 first)** — reorder daily class list so Day 1 courses appear first (or follow Google Calendar order). Day 1 classes are more likely to have issues (incorrect data, no sessions imported). Makes it easier to spot problems at a glance. | Active | 2026-04-13 |
| 80 | **Calendar: "Not in Calendar" section** — show course runs that exist locally (or in SSG) for a given date range but have no matching Google Calendar event. Surfaces missing/unsynced classes. | Active | 2026-04-13 |
| 81 | **Calendar: Unconfirmed / Reschedule actions** — let admin switch a course run to Unconfirmed or Reschedule status directly from the calendar view. Quick-action buttons or dropdown on expanded row. | Active | 2026-04-13 |
| 82 | **Calendar: show invitation status + Sync to TPG** — add per-trainer invitation status badges (Pending/Accepted/Declined) and a "Sync to TPG" action button to the View By Date calendar rows. Mirrors what Upcoming Classes already has. | Active | 2026-04-13 |
| 83 | **Bug: course run 1081114 has too many trainers + no sessions** — investigate why this course run has an excessive number of trainers assigned (duplicate junction rows, sync issue, or cascade bug?) and why it has zero sessions imported. | Active | 2026-04-13 |
| 84 | **Calendar add on accept: add to ALL sessions, not just Day 1** — `addLearnerToCalendarEvent` currently only searches ±1 day around start_date, so multi-day courses only get the trainer added to the Day 1 event. Needs to: query `course_session` for exact session dates, search calendar for each date, add trainer to all matched events. Also needs course code resolution via title for more precise matching. | Active | 2026-04-14 |

## Done

| # | Task | Completed |
|---|------|-----------|
| 69 | ~~Auto-send next trainer invitation on reject~~ — auto-escalation on decline works via `trainerInvitationSender.ts` + `respond.ts` | 2026-04-12 |
| 64 | ~~Calendar: per-day "Ongoing but not running today" section~~ | 2026-04-13 |
| 60 | ~~Assign TPG ghost-write bug~~ — SSG error body parsing added to ClassManagementViews.tsx assign/remove TPG flows | 2026-04-12 |
| 59 | ~~Trainer invitation email templates~~ — full template system built by Dr Ang (invitation/accept/decline, CC, placeholders) | 2026-04-12 |
| 58 | ~~Per-trainer invitation status badges~~ — Approved Trainers panel shows Not Sent/Pending/Accepted/Declined/Manually Added per trainer, full history with timestamps from View By Date | 2026-04-12 |
| 36 | ~~Trainer email cascade~~ — scheduler runs Mon/Thu, auto-escalation on decline, bulk invite with preview modal, late-acceptance guard | 2026-04-12 |
| 76 | ~~Upsert from SSG: also sync TPG trainer~~ | 2026-04-13 |
| 77 | ~~Add to Google Calendar on trainer invitation accept~~ — implementation done; verification pending | 2026-04-13 |
| 48 | ~~Verify local trainers vs Google Sheets~~ — trainer name audit completed, 279 courses corrected, 10 new accounts created, all names match app_user | 2026-04-12 |
| 68 | ~~View Class By Date: editable Class Type dropdown~~ | 2026-04-10 |
| 71 | ~~Calendar: navigation links + ctrl+click + auto-fill~~ | 2026-04-10 |
| 5 | ~~Build Finance Management view~~ | 2026-03-26 |
| 10 | ~~Create skills wrapping existing SSG scripts~~ | 2026-03-29 |
| 17 | ~~Add Edit button to Class Details page~~ | 2026-03-30 |
| 18 | ~~Unified SSG Lookup (/lookup)~~ | 2026-03-31 |
| 19 | ~~Fix Edit Class SSG form population~~ | 2026-03-31 |
| 20 | ~~Migrate SSG credentials to Company Setting~~ | 2026-04-02 |
| 22 | ~~Investigate TMS_1/TMS_3_NEW cert decode error~~ | 2026-03-31 |
| 25 | ~~Assessment guide steps 9-12~~ | 2026-04-02 |
| 26 | ~~Finance profile + My Profile page~~ | 2026-04-02 |
| 27 | ~~TP "Company Setting" label~~ | 2026-04-02 |
| 28 | ~~Bug: Assessment Summary Record not saving~~ | 2026-04-02 |
| 29 | ~~Learner sidebar + Certificate History~~ | 2026-04-02 |
| 30 | ~~billingSync fixes~~ | 2026-04-02 |
| 31 | ~~sync-enrolment-to-db dates~~ | 2026-04-02 |
| 32 | ~~Bug: OTP error~~ | 2026-04-02 |
| 33 | ~~Finance "All Course Runs" view~~ | 2026-04-02 |
| 9 | ~~Fix OTP not working~~ | 2026-03-29 |

## Deferred

| # | Task | Prior Status | Added |
|---|------|--------------|-------|
| 39 | Trainer rework — schema + JSONB pool (plan exists at `.project/plans/trainer-jsonb-rework.md`, 22 tasks). Most blocking dependencies resolved without it. | Deferred | 2026-04-07 |
| 1 | Unify profile architecture | Deferred | 2026-03-26 |
| 3 | Enrich enrollment table with SSG data | Deferred | 2026-03-26 |
| 4 | Fix enrolment data issues | Deferred | 2026-03-26 |
| 6 | Enrich learner_profile with SSG trainee data | Deferred | 2026-03-26 |
| 11 | Bug: Past Attendance & Past Assessment not showing | Deferred | 2026-03-30 |
| 12 | Bug: Trainers can't see their classes | Deferred | 2026-03-30 |
| 13 | Bug: Attendance validation error | Deferred | 2026-03-30 |
| 14 | New Finance role | Deferred | 2026-03-30 |
| 15 | Remove hardcoded values | Deferred | 2026-03-30 |
| 16 | Trainer personalised slides | Deferred | 2026-03-30 |
| 21 | Multi-cert support | Deferred | 2026-03-31 |
| 23 | Learner Billing History + Pro Forma Invoices (remaining: invoice generation) | Deferred | 2026-04-01 |
| 24 | Auto-sync SSG data | Deferred | 2026-04-01 |
| 34 | Sync courses Sheets ↔ AI-LMS-TMS | Deferred | 2026-04-06 |
| 35 | Assign trainers to SSG (superseded by #47) | Deferred | 2026-04-06 |
| 37 | SSG Course Runs populate + sync | Deferred | 2026-04-06 |
| 38 | Scheduler double-fire fix | Deferred | 2026-04-06 |
| 40 | Bug: tpg_assigned_trainer_* shows wrong value (resolved by #47) | Deferred | 2026-04-07 |
| 41 | Sync improvement — digital_attendance_id from ra_code | Deferred | 2026-04-07 |
