import React, { useState, useMemo } from 'react';
import { Icon, IconName } from '../ui/Icon';

interface EndpointDoc {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  title: string;
  description: string;
  headers: { name: string; value: string; description: string }[];
  queryParams?: { name: string; type: string; required: boolean; description: string }[];
  bodyFields?: { name: string; type: string; required: boolean; description: string }[];
  exampleRequest?: string;
  exampleResponse?: string;
}

interface EndpointSection {
  title: string;
  description: string;
  endpoints: EndpointDoc[];
}

const sections: EndpointSection[] = [
  // ─── EXTERNAL / AUTOMATION ───
  {
    title: 'External / Automation',
    description: 'Public-facing endpoints for third-party integrations and automation bots. All require x-api-key header.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/external/unassign-trainer',
        title: 'Unassign Trainer from Course Run',
        description: 'Removes the assigned trainer from a course run by clearing the trainer fields.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'course_run_id', type: 'string', required: true, description: 'The SSG course run ID' },
        ],
        exampleRequest: `curl -X POST __BASE_URL__/api/external/unassign-trainer \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "course_run_id": "1303232" }'`,
        exampleResponse: `{
  "success": true,
  "message": "Trainer unassigned from course run 1303232"
}`,
      },
      {
        method: 'GET',
        path: '/api/external/get-course-run',
        title: 'Get Course Run Details',
        description: 'Retrieves full details for a specific course run, including assigned trainer and enrolled learner count.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'course_run_id', type: 'string', required: true, description: 'The SSG course run ID' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/get-course-run?course_run_id=1303232" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{
  "success": true,
  "data": {
    "uuid": "...",
    "course_run_id": "1303232",
    "start_date": "2026-03-12",
    "end_date": "2026-03-14",
    "class_status": "Confirmed",
    "mode_of_learning": "Virtual",
    "digital_attendance_id": "RA741642",
    "assigned_trainer_id": "...",
    "assigned_trainer_name": "John Doe",
    "assigned_trainer_email": "trainer@example.com",
    "course_title": "Virtual Training Course",
    "course_code": "TGS-2023011234",
    "enrolled_learners": "12"
  }
}`,
      },
      {
        method: 'GET',
        path: '/api/external/list-course-runs',
        title: 'List Course Runs',
        description: 'Lists course runs with optional filtering by status and trainer email. Returns up to 200 results ordered by start date descending.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'Filter by class status (e.g. "Confirmed", "Completed")' },
          { name: 'trainer_email', type: 'string', required: false, description: 'Filter by assigned trainer email (case-insensitive)' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/list-course-runs?status=Confirmed" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{
  "success": true,
  "count": 5,
  "data": [
    {
      "course_run_id": "1303232",
      "start_date": "2026-03-12",
      "end_date": "2026-03-14",
      "class_status": "Confirmed",
      "assigned_trainer_name": "John Doe",
      "course_title": "Virtual Training Course",
      "course_code": "TGS-2023011234"
    }
  ]
}`,
      },
      {
        method: 'GET',
        path: '/api/external/list-trainers',
        title: 'List Trainers',
        description: 'Lists all trainers with their profile information. Optionally filter by trainer status.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'Filter by trainer status (e.g. "Active")' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/list-trainers?status=Active" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{
  "success": true,
  "count": 3,
  "data": [
    {
      "user_id": "...",
      "full_name": "John Doe",
      "email": "trainer@example.com",
      "secondary_email": null,
      "trainer_type": "ACLP",
      "trainer_status": "Active",
      "account_status": "active"
    }
  ]
}`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-create-learners',
        title: 'Auto-Create Learner Accounts',
        description: 'Automatically creates learner accounts for course runs starting tomorrow. Fetches SSG enrollments directly from the SSG API and upserts enrollment records.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        exampleResponse: `{
  "success": true,
  "runId": "run_1721625600000",
  "startedAt": "2026-07-22T10:00:00.000Z",
  "processed": 3,
  "results": [
    {
      "runId": "run_1721625600000",
      "courseRunId": "1303232",
      "courseTitle": "Virtual Training Course",
      "courseCode": "TGS-2023011234",
      "startDate": "2026-07-23",
      "endDate": "2026-07-25",
      "status": "success",
      "totalEnrolled": 7,
      "createdCount": 5,
      "existingCount": 2,
      "errorCount": 0,
      "details": [...],
      "errorMessage": null
    }
  ]
}`,
      },
      {
        method: 'POST',
        path: '/api/external/sync-course-run-dates',
        title: 'Sync Course Run Dates',
        description: 'Syncs course run start/end dates with SSG data for runs starting today. Compares local dates with SSG dates and updates if different.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        exampleResponse: `{
  "success": true,
  "runId": "sync_1721606400000",
  "startedAt": "2026-07-22T01:00:00.000Z",
  "processed": 2,
  "updated": 1,
  "noChange": 1,
  "errors": 0,
  "results": [
    {
      "runId": "sync_1721606400000",
      "courseRunId": "1303232",
      "courseTitle": "Virtual Training Course",
      "courseCode": "TGS-2023011234",
      "dbStartDate": "2026-03-12",
      "dbEndDate": "2026-03-14",
      "ssgStartDate": "2026-03-13",
      "ssgEndDate": "2026-03-14",
      "status": "updated",
      "updatedDates": true,
      "errorMessage": null
    }
  ]
}`,
      },
      {
        method: 'GET',
        path: '/api/external/backfill-enrollments',
        title: 'Backfill Enrollments (Preview)',
        description: 'Lists enrollments missing raw data without executing any changes. Use POST to execute the backfill.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'Max enrollments to process (default: 50, max: 200)' },
        ],
        exampleResponse: `{
  "success": true,
  "total": 10,
  "enrollments": [...]
}`,
      },
      {
        method: 'POST',
        path: '/api/external/backfill-enrollments',
        title: 'Backfill Enrollments (Execute)',
        description: 'Fetches and updates enrollments with raw data directly from the SSG API.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'Max enrollments to process (default: 50, max: 200)' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Backfill complete. Updated 8 of 10 enrollments.",
  "total": 10,
  "updated": 8,
  "skipped": 2,
  "errors": 0,
  "results": [
    { "enrolmentId": "ENR-...", "status": "200", "result": "updated", "detail": "Jane Tan" }
  ]
}`,
      },
      {
        method: 'GET',
        path: '/api/external/reschedule-learner-readiness',
        title: 'Learner Move — Readiness Check',
        description: 'Pre-flight check before moving a learner between runs. Always call before POST /api/external/reschedule-learner. Checks LMS state (same run, enrolment conflicts, target cancelled) and calendar readiness (target run has a GCal event).',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'current_run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID the learner is currently on' },
          { name: 'target_run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID to move the learner to' },
          { name: 'learner_email', type: 'string', required: true, description: 'Learner email (case-insensitive)' },
        ],
        exampleResponse: `{
  "canExecute": true,
  "blockers": [],
  "warnings": ["Learner has 2 assessment submission(s) on the source run. Moving them will not transfer these submissions."],
  "lms": {
    "same_run": false, "current_enrolment_found": true, "target_in_lms": true,
    "same_course": true, "target_not_cancelled": true, "has_sessions": true, "no_conflict": true
  },
  "cal": { "canSync": true, "target_has_calendar": true, "current_has_calendar": true, "blockers": [] }
}`,
      },
      {
        method: 'POST',
        path: '/api/external/reschedule-learner',
        title: 'Move Learner Between Runs',
        description: 'Moves a learner from one run to another. Commit order: TPGateway re-point, then LMS, then GCal. If tpg_synced:true and enrollment_moved:false, ESCALATE to staff immediately — TPGateway already committed and LMS must be fixed manually.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'current_run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'target_run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'learner_email', type: 'string', required: true, description: 'Learner email' },
          { name: 'skip_readiness', type: 'boolean', required: false, description: 'Skip the readiness pre-check (default false) — use only after already calling the readiness endpoint' },
        ],
        exampleRequest: `curl -X POST __BASE_URL__/api/external/reschedule-learner \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "current_run_id": "TGS-123456-01", "target_run_id": "TGS-123456-02", "learner_email": "jane@example.com" }'`,
        exampleResponse: `{
  "success": true,
  "result": {
    "tpg_synced": true,
    "tpg_status": "skipped_no_enrolment_id",
    "enrollment_moved": true,
    "calendar_synced": true
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/external/run-attendee',
        title: 'Add / Drop a Learner on a Run',
        description: 'Adds or drops a single learner on a run across LMS + TPGateway + GCal. ADD: 404 if the email has no LMS account (no email-only enrolment path exists). Re-adding a previously-removed learner reactivates the existing record rather than duplicating. DROP: 409 SUBMISSION_EXISTS if the learner has submitted assessments (use force:true to override); 422 if TPG cancel fails (escalate, do not force-remove from LMS).',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'email', type: 'string', required: true, description: 'Learner email' },
          { name: 'action', type: 'string', required: true, description: '"add" or "drop"' },
          { name: 'force', type: 'boolean', required: false, description: 'Drop only — override the SUBMISSION_EXISTS block' },
          { name: 'sync_tpg', type: 'boolean', required: false, description: 'Default true' },
          { name: 'sync_calendar', type: 'boolean', required: false, description: 'Default true' },
        ],
        exampleRequest: `curl -X POST __BASE_URL__/api/external/run-attendee \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "run_id": "TGS-123456-01", "email": "jane@example.com", "action": "add" }'`,
        exampleResponse: `{
  "lms": { "enrolled": true, "enrollment_id": "<uuid>", "reactivated": false },
  "tpg": { "status": "synced", "enrolmentRef": "ENR-..." },
  "calendar": { "status": "ok", "changed": 1 }
}`,
      },
      {
        method: 'POST',
        path: '/api/external/move-class',
        title: 'Move an Entire Class to Another Run',
        description: 'Moves all active learners (and the trainer) from a source run to a target run of the same course. If the source is vacated, its GCal events are removed. drop_emails learners are soft-removed instead of moved (blocked if they have assessment submissions unless force:true). Learners already enrolled in the target are skipped (skipped_conflicts), not double-moved.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'source_run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID being vacated' },
          { name: 'target_run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID — destination' },
          { name: 'drop_emails', type: 'string[]', required: false, description: 'Learners to soft-remove instead of move. Must be an array.' },
          { name: 'trainer_email', type: 'string', required: false, description: 'Official trainer for the target. Omit to carry over the source trainer.' },
          { name: 'trainer_name', type: 'string', required: false, description: 'Required if trainer_email is not already in LMS' },
          { name: 'force', type: 'boolean', required: false, description: 'Override the drop_emails submission-exists block' },
        ],
        exampleResponse: `{
  "summary": { "moved": 12, "removed": 1, "skipped_conflicts": ["already@tia.sg"], "source_vacated": true },
  "tpg_enrolment": { "repointed": [{ "userId": "<uuid>", "status": "synced" }], "cancelled": [] },
  "tpg_trainer": { "target": { "status": "synced" }, "source": { "status": "synced" } },
  "calendar": { "target": { "status": "ok" }, "source_events_removed": true }
}`,
      },
      {
        method: 'POST',
        path: '/api/external/assign-trainer',
        title: 'Assign / Unassign Trainer on a Run',
        description: 'Assigns or unassigns a trainer across LMS + TPGateway + GCal. is_official (default true): only the official trainer is pushed to TPGateway, though multiple trainers can exist on a run in LMS. Returns a warning if the email belongs to a Learner-role account.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'trainer_email', type: 'string', required: true, description: 'Trainer email' },
          { name: 'trainer_name', type: 'string', required: false, description: 'Required for assign if trainer has no LMS account' },
          { name: 'action', type: 'string', required: true, description: '"assign" or "unassign"' },
          { name: 'is_official', type: 'boolean', required: false, description: 'Default true — pushes to TPGateway as the official trainer' },
        ],
        exampleResponse: `{ "success": true, "tpg": { "status": "synced" }, "warning": null }`,
      },
      {
        method: 'GET',
        path: '/api/external/run-sessions',
        title: 'List Sessions for a Run',
        description: 'Lists sessions for a run from the LMS database cache. start_date/end_date are returned in SSG native YYYYMMDD format, not YYYY-MM-DD — convert before passing to the reschedule endpoints.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'refresh', type: 'boolean', required: false, description: 'Default false. Set true to pull latest from SSG before returning — do this before any session mutation.' },
        ],
        exampleResponse: `{
  "sessions": [{ "session_id": "TGS-123456-01-S001", "start_date": "20260804", "end_date": "20260804", "start_time": "09:00", "end_time": "18:00", "mode_of_training": "1" }],
  "total": 3
}`,
      },
      {
        method: 'POST',
        path: '/api/external/reschedule-session',
        title: 'Reschedule a Single Session',
        description: 'Reschedules one session to a new date. Commit order: SSG, then LMS sync, then GCal reconcile. SSG wipes the trainer on any session edit — this endpoint re-asserts it afterwards automatically. 400 on a same-date/time no-op or an impossible calendar date.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'session_id', type: 'string', required: true, description: 'From GET /api/external/run-sessions' },
          { name: 'new_date', type: 'string', required: true, description: 'YYYY-MM-DD' },
          { name: 'new_start_time', type: 'string', required: false, description: 'HH:mm — existing time kept if omitted' },
          { name: 'new_end_time', type: 'string', required: false, description: 'HH:mm — existing time kept if omitted' },
          { name: 'sync_calendar', type: 'boolean', required: false, description: 'Default true' },
        ],
        exampleResponse: `{
  "session_id": "TGS-123456-01-S001",
  "new_date": "2026-09-15",
  "sibling_run_conflict": [{ "course_run_id": "TGS-123456-02", "matched_dates": ["2026-09-15"] }],
  "ssg": { "status": "ok" }, "lms_sync": { "ok": true, "upserted": 3 },
  "tpg_trainer": { "status": "synced" }, "calendar": { "status": "ok" }
}`,
      },
      {
        method: 'POST',
        path: '/api/external/reschedule-day',
        title: 'Reschedule an Entire Training Day',
        description: 'Reschedules every session on from_date to to_date. Same commit order and trainer re-assertion as the single-session endpoint. 404 if no active sessions exist on from_date.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'from_date', type: 'string', required: true, description: 'YYYY-MM-DD' },
          { name: 'to_date', type: 'string', required: true, description: 'YYYY-MM-DD' },
          { name: 'new_start_time', type: 'string', required: false, description: 'Applied to all sessions on the day' },
          { name: 'new_end_time', type: 'string', required: false, description: 'Applied to all sessions on the day' },
          { name: 'sync_calendar', type: 'boolean', required: false, description: 'Default true' },
        ],
        exampleResponse: `{
  "from_date": "2026-08-04", "to_date": "2026-08-11", "sessions_moved": 2,
  "warnings": [], "sibling_run_conflict": [],
  "ssg": { "status": "ok" }, "lms_sync": { "ok": true },
  "tpg_trainer": { "status": "synced" }, "calendar": { "status": "ok" }
}`,
      },
      {
        method: 'POST',
        path: '/api/external/cancel-session',
        title: 'Cancel a Single Session',
        description: 'Permanently deletes one session from SSG. IRREVERSIBLE — there is no create-session endpoint to undo this. Warns (past_session_warning) if the session is in the past with attendance records that will be permanently deleted.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'session_id', type: 'string', required: true, description: 'From GET /api/external/run-sessions' },
          { name: 'sync_calendar', type: 'boolean', required: false, description: 'Default true' },
        ],
        exampleResponse: `{
  "session_id": "TGS-123456-01-S001", "was_last_session": false,
  "ssg": { "status": "ok" }, "lms_sync": { "ok": true },
  "tpg_trainer": { "status": "synced" }, "calendar": { "status": "ok" }
}`,
      },
      {
        method: 'POST',
        path: '/api/external/cancel-day',
        title: 'Cancel an Entire Training Day',
        description: 'Permanently deletes every session on date from SSG. IRREVERSIBLE. was_last_day_of_run:true means the run is now sessionless — alert staff.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'date', type: 'string', required: true, description: 'YYYY-MM-DD' },
          { name: 'sync_calendar', type: 'boolean', required: false, description: 'Default true' },
        ],
        exampleResponse: `{
  "date": "2026-08-04", "sessions_cancelled": 2, "was_last_day_of_run": false,
  "ssg": { "status": "ok" }, "lms_sync": { "ok": true },
  "tpg_trainer": { "status": "synced" }, "calendar": { "status": "ok" }
}`,
      },
      {
        method: 'POST',
        path: '/api/external/ensure-run-calendar',
        title: 'Ensure Calendar Events Exist for a Run',
        description: 'Creates GCal events for a run that has none. Idempotent — existing events are adopted, not duplicated. One event per session day. 422 if the run has no active sessions (sync from SSG first).',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
        ],
        exampleResponse: `{ "status": "ok", "created": 3, "adopted": 0, "kept": 0 }`,
      },
      {
        method: 'GET',
        path: '/api/external/calendar-attendees',
        title: 'List GCal Attendees for a Run',
        description: 'Lists Google Calendar events and attendees for a run, classified against the LMS roster.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
        ],
        exampleResponse: `{
  "events": [{ "eventId": "abc123", "date": "2026-08-04", "attendees": [{ "email": "jane@example.com", "responseStatus": "accepted", "classification": "desired" }] }]
}`,
      },
      {
        method: 'POST',
        path: '/api/external/calendar-attendees',
        title: 'Add / Remove a GCal Attendee for a Run',
        description: 'Adds or removes a single email from every GCal event for a run. Affects Google Calendar only — no LMS or TPGateway change. Use for manual recovery when calendar_synced:false after a reschedule.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'run_id', type: 'string', required: true, description: 'SSG run ID or LMS UUID' },
          { name: 'email', type: 'string', required: true, description: 'Attendee email' },
          { name: 'action', type: 'string', required: true, description: '"add" or "remove"' },
        ],
        exampleResponse: `{ "status": "ok", "changed": 1 }`,
      },
      {
        method: 'GET',
        path: '/api/external/morning-check',
        title: 'Morning Check (TMS Class Info)',
        description: 'Daily class-list feed for automation bots — course, trainer, venue, and e-attendance link for every Confirmed class in a date range. Date match is against actual course_session dates within the window, not the run’s overall start/end span, so multi-day classes with any activity in range are correctly included.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication (or Authorization: Bearer <API_KEY>)' },
        ],
        queryParams: [
          { name: 'start_date', type: 'string', required: true, description: 'YYYY-MM-DD' },
          { name: 'end_date', type: 'string', required: true, description: 'YYYY-MM-DD' },
          { name: 'status', type: 'string', required: false, description: 'Default "Confirmed"' },
          { name: 'include_virtual', type: 'boolean', required: false, description: 'Default true' },
          { name: 'include_external', type: 'boolean', required: false, description: 'Default true' },
          { name: 'include_cancelled', type: 'boolean', required: false, description: 'Default false' },
          { name: 'course_run_id', type: 'string', required: false, description: 'Fetch a single course run instead of a range' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/morning-check?start_date=2026-07-22&end_date=2026-07-22" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `[{
  "course_run_id": "1130294", "course_code": "TGS-2024051900", "course_title": "...",
  "start_date": "2026-07-20", "end_date": "2026-07-24", "duration_label": "5 days",
  "status": "Confirmed", "mode_of_training": "Physical",
  "trainer": { "trainer_id": "<uuid>", "name": "Sivanesan Sivakaruniam", "email": "...", "phone_e164": "+65..." },
  "pax": 12, "attendance_code": "RA798853",
  "e_attendance_url": "https://www.myskillsfuture.gov.sg/api/take-attendance/RA798853",
  "venue": "#07-85/87, Room Training room, S(737715)"
}]`,
      },
      {
        method: 'GET',
        path: '/api/external/trainer-reminders',
        title: 'Trainer Reminders',
        description: 'Trainer contact + class details for sending reminders, with deterministic trainer resolution: live Google Calendar attendees cross-checked against the Trainer role (primary signal), the LMS’s own course_run_trainer assignment as a collision tiebreaker, and TPGateway as final fallback — never trusts the LMS assignment alone, since admin staff sometimes edit the calendar invite directly without updating the LMS. See trainer_resolution.source in the response to see how each row was determined; ambiguous/not_found rows carry admin_warning and trainer:null rather than being silently dropped.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication (or Authorization: Bearer <API_KEY>)' },
        ],
        queryParams: [
          { name: 'start_date', type: 'string', required: false, description: 'YYYY-MM-DD. Required unless course_run_id is given.' },
          { name: 'end_date', type: 'string', required: false, description: 'YYYY-MM-DD. Required unless course_run_id is given.' },
          { name: 'course_run_id', type: 'string', required: false, description: 'Fetch a single course run instead of a range' },
          { name: 'status', type: 'string', required: false, description: 'Default "Confirmed"' },
          { name: 'send_reminder', type: 'boolean', required: false, description: '"true" to filter to only rows with a usable phone number' },
          { name: 'include_virtual', type: 'boolean', required: false, description: 'Default true' },
          { name: 'include_external', type: 'boolean', required: false, description: 'Default true' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/trainer-reminders?start_date=2026-07-22&end_date=2026-07-24" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `[{
  "course_run_id": "1130294", "course_code": "TGS-2024051900", "course_title": "...",
  "start_date": "2026-07-20", "end_date": "2026-07-24",
  "trainer": { "trainer_id": "<uuid>", "name": "Sivanesan Sivakaruniam", "phone_e164": "+65...", "email": "..." },
  "trainer_resolution": { "source": "gcal_role_match" },
  "admin_warning": null,
  "google_meet_url": null, "venue": "...",
  "send_reminder": true
}]`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-add-today-enrolments-to-calendar',
        title: 'Auto: Add Today’s Enrolments to Calendar',
        description: 'Scheduler job. Pulls today’s (SGT) SSG enrolments, then for each Confirmed enrolment whose class has a matching Google Calendar event, adds the learner’s email as an attendee if not already present. Matches events by stripped course title + start date within a small date window.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key (or ?apiKey= query param, or x-internal-scheduler header for the internal cron)' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-add-today-enrolments-to-calendar" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "pulled": 14, "confirmedToday": 6, "added": 4, "alreadyAttendee": 2, "noEvent": 0, "errors": 0 }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-create-assessment-records',
        title: 'Auto: Create Assessment Records',
        description: 'Scheduler job (daily 2:00 PM SGT). Creates Google Drive assessment folders for every course run starting today, under Course → Assessment Records → Session Folder. Trainer name is resolved locally (course_run_trainer → assigned_trainer_name → trainer_profile.common_name) — no SSG calls made. Self-guards against duplicate folder creation on re-runs via auto_create_trainer_folder_log.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-create-assessment-records" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "runId": "trainer_folder_...", "processed": 3, "created": 2, "existing": 1, "errors": 0, "results": [...] }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-create-certificates',
        title: 'Auto: Create Certificates',
        description: 'Scheduler job. Generates + emails Certificate of Achievement PDFs (via Google Slides template + Gmail) for learners on course runs that ended in the last 7 days (or a specific end_date), meeting the configured attendance threshold (default 60%). Uses an atomic UPDATE claim on enrollment.certificate to prevent double-generation across concurrent runs.',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'authKey', type: 'string', required: true, description: 'Must equal NEXT_PUBLIC_SCHEDULER_SECRET — this is the internal scheduler secret, not the external CLAWDBOT API key' },
          { name: 'date', type: 'string', required: false, description: 'YYYY-MM-DD to target a specific end_date instead of the rolling 7-day window' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-create-certificates" \\
  -H "Content-Type: application/json" \\
  -d '{"authKey": "YOUR_SCHEDULER_SECRET"}'`,
        exampleResponse: `{ "success": true, "runId": "<uuid>", "stats": { "totalGenerated": 5, "totalSkipped": 1, "totalErrors": 0 } }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-generate-da-invoices',
        title: 'Auto: Generate Direct-Application Invoices',
        description: 'Scheduler job. Safety-net sweep for confirmed, SSG-enrolled Direct Applications still missing a main tax, grant, or SFC invoice — re-runs the invoicing pipeline with forceInvoice, then sends any pending main-invoice emails that were generated but not yet emailed (gated by training_provider.auto_send_invoice_email).',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT (accepted as an alternative to body authKey)' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'authKey', type: 'string', required: false, description: 'NEXT_PUBLIC_SCHEDULER_SECRET — either this or the x-api-key header authorises the call' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-generate-da-invoices" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "runId": "<uuid>", "stats": { "totalCandidates": 4, "totalSucceeded": 3, "totalFailed": 0, "totalSkipped": 1, "emailsSent": 2, "emailsFailed": 0, "failures": [] } }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-generate-proforma-invoices',
        title: 'Auto: Generate Proforma Invoices',
        description: 'Scheduler job (daily 04:00 SGT). Safety net for any active enrollment still missing pro_forma_url — generates one from the standard template. Idempotent: enrollments that already have a pro forma are skipped.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT (accepted as an alternative to body authKey)' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'authKey', type: 'string', required: false, description: 'NEXT_PUBLIC_SCHEDULER_SECRET — either this or the x-api-key header authorises the call' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-generate-proforma-invoices" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "runId": "<uuid>", "stats": { "totalGenerated": 2, "totalSkipped": 0, "totalErrors": 0, "totalCandidates": 2 } }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-retry-wsq-blocked',
        title: 'Auto: Retry Blocked WSQ Schedules',
        description: 'Scheduler job (weekly, off-peak). DISABLED by default — publishes real course runs to SSG. Retries ONLY future WSQ schedules whose last publish attempt failed on an eligibility block (course-approval-related); schedules that failed for any other reason are left for a developer, since retrying would just re-fail and spam SSG.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-retry-wsq-blocked" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "ok": true, "started": true, "jobId": "<uuid>", "considered": 2 }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-sanitise-data',
        title: 'Auto: Sanitise Retained PII',
        description: 'Scheduler job (default Sunday 02:00 SGT). Masks learner NRIC/phone across enrollment, course_attendance, da_application, ssg_enrolments, ssg_claims, and learner_profile once the associated class has been over for longer than training_provider.sanitise_after_months (default 6). Trainer PII is deliberately exempt — trainers are long-lived contractual partners. Honours the training_provider.auto_mask_sensitive_data master toggle (off → single skipped log row). Fully idempotent.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-sanitise-data" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "runId": "sanitise_...", "enabled": true, "retentionMonths": 6, "cutoffDate": "2026-01-22", "totalScanned": 340, "totalUpdated": 12, "results": [{ "table": "enrollment", "rowsScanned": 120, "rowsUpdated": 5, "status": "success", "message": null }] }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-send-course-completion',
        title: 'Auto: Send Course Completion Emails',
        description: 'Scheduler job (daily 8:00 PM SGT, after certificates at 6:30 PM). Sends the "Course Completion and Thank You" template to confirmed learners on runs ending today. Uses a claimed-delivery table (auto_send_course_completion_delivery) plus a prior-sent-log check so the same learner is never emailed twice, even across overlapping runs.',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'authKey', type: 'string', required: true, description: 'Must equal NEXT_PUBLIC_SCHEDULER_SECRET' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-send-course-completion" \\
  -H "Content-Type: application/json" \\
  -d '{"authKey": "YOUR_SCHEDULER_SECRET"}'`,
        exampleResponse: `{ "success": true, "runId": "<uuid>", "stats": { "totalSent": 8, "totalSkipped": 1, "totalErrors": 0 } }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-send-course-confirmation',
        title: 'Auto: Send Final Course Confirmation Emails',
        description: 'Scheduler job (daily 9:00 AM SGT). Sends the "Final Course Confirmation" template to confirmed learners on runs starting in N days (scheduler_config.days_in_advance, default 3), including first-session venue/time. Writes a summary log row on every run — including zero-match days and fatal errors — so the log viewer always shows the sweep fired.',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'authKey', type: 'string', required: true, description: 'Must equal NEXT_PUBLIC_SCHEDULER_SECRET' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-send-course-confirmation" \\
  -H "Content-Type: application/json" \\
  -d '{"authKey": "YOUR_SCHEDULER_SECRET"}'`,
        exampleResponse: `{ "success": true, "runId": "<uuid>", "stats": { "totalSent": 4, "totalSkipped": 0, "totalErrors": 0 } }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-send-courseware-attendance',
        title: 'Auto: Send Courseware & Attendance Emails',
        description: 'Scheduler job (daily 7:00 AM SGT). Sends the "Courseware and Attendance Taking" template to confirmed learners on runs starting today (unless course_run.courseware_email_disabled), embedding the digital attendance ID. Also flips that run’s learner materials (slides/guide/lesson plan) to "anyone with the link" so non-Google company emails can still open them — idempotent, non-blocking.',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'authKey', type: 'string', required: true, description: 'Must equal NEXT_PUBLIC_SCHEDULER_SECRET' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-send-courseware-attendance" \\
  -H "Content-Type: application/json" \\
  -d '{"authKey": "YOUR_SCHEDULER_SECRET"}'`,
        exampleResponse: `{ "success": true, "runId": "<uuid>", "stats": { "totalSent": 6, "totalSkipped": 0, "totalErrors": 0 } }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-send-trainer-invitations',
        title: 'Auto: Send Trainer Invitations',
        description: 'Scheduler job (default Mon/Thu 10:00 AM SGT). Finds upcoming course runs in the lookahead window (scheduler_config.days_in_advance, default 30) with no locally-assigned trainer and at least one confirmed enrolment, then invites the next eligible trainer in the cascade for each. Respects training_provider.trainer_invitation_min_lead_days (default 1, skips same-day starts) and course_run.invitation_paused. If a run’s invite cascade is exhausted (everyone declined), sends a one-time exhausted-list alert instead of silently stalling.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-send-trainer-invitations" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "runId": "trainer_invite_...", "windowDays": 30, "minLeadDays": 1, "totalEligible": 3, "sent": 2, "skipped": 1, "errors": 0, "results": [...] }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-sync-attendance',
        title: 'Auto: Sync Attendance from SSG',
        description: 'Scheduler job. For course runs that ended in the last 7 days, pulls session + attendance data from SSG (decrypting the SSG attendance payload) and upserts into local course_session / course_attendance, matching learners by NRIC. Rate-limited (1.5s between SSG calls) to stay gentle on the SSG endpoint.',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'authKey', type: 'string', required: true, description: 'Must equal NEXT_PUBLIC_SCHEDULER_SECRET' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-sync-attendance" \\
  -H "Content-Type: application/json" \\
  -d '{"authKey": "YOUR_SCHEDULER_SECRET"}'`,
        exampleResponse: `{ "success": true, "courseRunsProcessed": 2, "sessionsFetched": 6, "sessionsSynced": 6, "attendanceFetched": 48, "attendanceUpserted": 48, "errors": [] }`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-sync-wsq-schedule',
        title: 'Auto: Sync WSQ Schedule to SSG (Daily)',
        description: 'Scheduler job (default 02:00 SGT). DISABLED by default — publishes real course runs to SSG. Pulls the MMS course schedule and publishes every FRESH future schedule item (one that has never failed before) to SSG. Items that previously failed for any reason are left alone here — eligibility-blocked ones are retried by the separate weekly auto-retry-wsq-blocked job; anything else needs a developer.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/auto-sync-wsq-schedule" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "ok": true, "started": true, "jobId": "<uuid>", "considered": 3, "skippedPreviouslyFailed": 1 }`,
      },
      {
        method: 'GET',
        path: '/api/external/sync-course-run-sessions',
        title: 'Sync: Gap-Fill Course Sessions from SSG',
        description: 'Daily gap-fill cron. For active/upcoming runs that currently have ZERO local course_session rows but DO have people (≥1 learner or a trainer signal), pulls sessions live from SSG and upserts them — catching classes nobody has opened in the LMS yet (per-run viewing already syncs on demand). Scoped to people-bearing runs to keep SSG call volume bounded. Also accepts POST. Optional ?limit= caps the sweep for manual/test runs.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'Caps the number of course runs processed (default/max 500)' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/sync-course-run-sessions?limit=50" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "targets": 12, "synced": 11, "withSessions": 9, "empty": 2, "failed": 1, "capped": false, "errors": [{ "runId": "1130294", "error": "..." }] }`,
      },
      {
        method: 'POST',
        path: '/api/external/sync-enrolment-ids',
        title: 'Sync: Enrolment IDs from SSG (Nightly Backstop)',
        description: 'Nightly SSG → LMS pull. Reconciles local enrollment.enrolment_id against SSG’s authoritative state for current/upcoming runs — linking the live reference, clearing stale ones. Scoped ONLY to enrolment_id: never adds/removes learners and never changes roster status.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT (or x-internal-scheduler header for the internal cron)' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/sync-enrolment-ids" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "linked": 4, "cleared": 1, "unchanged": 30, "errors": 0 }`,
      },
      {
        method: 'POST',
        path: '/api/external/sync-google-calendar',
        title: 'Sync: Google Calendar → Course Run (Virtual/Hybrid + Meet Link)',
        description: 'Runs daily 1:00 AM SGT. Reads events on the training provider’s Google Calendar within a configurable look-ahead window (default 21 days). For events tagged [VIRTUAL] or [HYBRID] in the title, matches them to a course_run (by run ID in the description, or by title+date), then sets class_type and stores the extracted Google Meet link on that run.',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'startDate', type: 'string', required: false, description: 'YYYY-MM-DD, defaults to now' },
          { name: 'endDate', type: 'string', required: false, description: 'YYYY-MM-DD, defaults to startDate + look-ahead days' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/sync-google-calendar" \\
  -H "Content-Type: application/json" -d '{}'`,
        exampleResponse: `{ "success": true, "summary": { "totalEvents": 40, "virtualEvents": 6, "updated": 4, "skipped": 2, "calendarId": "..." }, "results": [...] }`,
      },
      {
        method: 'POST',
        path: '/api/external/sync-learners-to-mailerlite',
        title: 'Sync: Learner Emails to MailerLite',
        description: 'Scheduler job (default daily 03:00 SGT). Pushes active learner emails not yet recorded in mailerlite_synced_email into the configured MailerLite group (Company Settings → Integrations → MailerLite, env-var fallback). *.gov.sg addresses are always excluded. Missing config → single skipped log row (safe no-op for tenants without MailerLite). Fully idempotent — MailerLite’s subscriber endpoint is itself an upsert.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/sync-learners-to-mailerlite" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "runId": "mailerlite_...", "enabled": true, "totalCandidates": 18, "submitted": 18, "failed": 0, "status": "success", "message": null }`,
      },
      {
        method: 'GET',
        path: '/api/external/sync-run-trainers-from-tpg',
        title: 'Sync: Trainers from TPGateway (Nightly Pull)',
        description: 'Nightly bulk TPG trainer pull — the grid-wide backstop counterpart to the per-run on-view pull. For every active/upcoming people-bearing course run, does a live TPG viewCourseRun and upserts course_run.tpg_assigned_trainer_* (+ tpg_sync_status), so trainers added/removed directly on TPGateway (outside the LMS invite flow) are reflected even on runs nobody opened. Handles removal too (empty TPG roster → name cleared). Also accepts POST. Mirrors sync-course-run-sessions.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'Caps the number of course runs processed (default/max 1000)' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/sync-run-trainers-from-tpg?limit=100" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "targets": 40, "processed": 38, "changed": 3, "failed": 2, "capped": false, "errors": [...] }`,
      },
      {
        method: 'GET',
        path: '/api/external/sync-ssg-enrolments',
        title: 'Sync: SSG Enrolments (Rolling 7-Day Pull)',
        description: 'Pulls SSG enrolments for each of the last 7 days (SSG’s searchEnrolment only filters by a single date, so days are queried separately) and inserts new rows into the local ssg_enrolment_record staging table, skipping duplicates by enrolment_reference. Also accepts POST; used both by the scheduler (sync_ssg_enrolments task) and the admin "Run Once" button.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT (calls without a key are also allowed if none is configured, or via x-internal-scheduler)' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/sync-ssg-enrolments" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "inserted": 9, "skipped": 21, "errors": 0, "daysChecked": 7 }`,
      },
      {
        method: 'POST',
        path: '/api/external/sync-trainer-to-tpg',
        title: 'Sync: Local Trainer → TPGateway (Sanity Check)',
        description: 'Runs daily after the SSG enrolment/trainer-assign step. The real-time push to TPG already happens at trainer-invitation accept-time, so this is a SANITY CHECK covering only two cases: (1) local trainer assigned but TPG is missing it, or (2) TPG’s trainer name differs from the current local trainer. Already-synced runs are filtered out at the SQL level to save SSG rate-limit budget. Resolves each trainer’s NRIC (by ID → email → name fallback) before submitting to SSG’s Edit Course Run; also clears stale TPG assignments where no local trainer exists anymore.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/sync-trainer-to-tpg" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "runId": "sync_trainer_...", "thresholdDays": 21, "total": 5, "successCount": 3, "skipped": 1, "errors": 1, "cleared": 0 }`,
      },
      {
        method: 'GET',
        path: '/api/external/sync-trainers-to-calendar',
        title: 'Sync: LMS Trainers → Google Calendar (Daily)',
        description: 'Daily job, LMS → Calendar direction (the counterpart to auto-add-today-enrolments-to-calendar, which pushes learners). The LMS is the source of truth: for every upcoming class in the configured window (default 7 days ahead), pushes each LMS-assigned trainer (course_run_trainer junction, or legacy assigned_trainer_email) onto the matching Google Calendar event as an attendee. Add-only — never reads trainers back from the calendar, never removes/creates events, never emails (sendUpdates: none). GET reads recent run logs; POST triggers a run.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'GET only — number of log rows to return (default 20, max 100)' },
        ],
        bodyFields: [
          { name: 'daysAhead', type: 'number', required: false, description: 'POST only — overrides scheduler_config.days_in_advance (default 7)' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/sync-trainers-to-calendar" \\
  -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d '{}'`,
        exampleResponse: `{ "success": true, "window_start": "2026-07-22", "window_end": "2026-07-29", "runsProcessed": 6, "assignments": 6, "pushed": 4, "alreadyPresent": 2, "eventNotFound": 0, "errors": 0, "attention": [] }`,
      },
      {
        method: 'GET',
        path: '/api/external/backfill-class-calendar-links',
        title: 'Backfill: Adopt Existing Calendar Events',
        description: 'Phase-0 backfill that adopts pre-existing Google Calendar events into the durable course_run_calendar_event mapping table. Write-only on that mapping table — never creates, deletes, or modifies a calendar event. For each non-cancelled run ending in the last 30+ days with no mapping yet, fuzzy-matches an event per session date within a small date window. GET is a dry-run preview (no writes); POST with {"apply":true} writes the mappings. Idempotent — skips already-mapped runs.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'GET only — caps the number of course runs scanned (max 2000)' },
        ],
        bodyFields: [
          { name: 'apply', type: 'boolean', required: false, description: 'POST only — must be true to actually write mappings; omitted/false behaves like a dry run' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/backfill-class-calendar-links?limit=50" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "dryRun": true, "runsScanned": 50, "linked": 41, "noMatch": 6, "ambiguous": 1, "errors": 2, "details": [{ "courseRunId": "1130294", "date": "2026-07-20", "status": "linked", "eventId": "..." }] }`,
      },
      {
        method: 'GET',
        path: '/api/external/cleanup-cancelled-folders',
        title: 'Cleanup: Delete Empty Assessment Folders for Cancelled Classes',
        description: 'For every course run that was auto-created an assessment folder (via auto-create-assessment-records) and has since been marked Cancelled, finds the matching Google Drive session folder and deletes it — but ONLY if it’s empty. Non-empty folders are left alone and flagged not_empty so no trainer-uploaded content is ever destroyed.',
        headers: [],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/cleanup-cancelled-folders"`,
        exampleResponse: `{ "success": true, "summary": { "total_processed": 3, "deleted": 2, "not_empty_skipped": 1, "not_found": 0 }, "details": [{ "log_id": 14, "folder_name": "...", "result": "deleted" }] }`,
      },
      {
        method: 'GET',
        path: '/api/external/course-info',
        title: 'Single Course Lookup',
        description: 'Single-course lookup for external automations (e.g. an n8n "Auto Reply for SSG Course Enquiry" flow). Returns ONE live course row as a flat object (not a paginated array) so downstream expressions can read fields directly. Always live from the DB — no manually-maintained data table to go stale.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'course_code', type: 'string', required: false, description: 'Exact match, e.g. TGS-2025052468 (preferred). One of course_code/search is required.' },
          { name: 'search', type: 'string', required: false, description: 'ILIKE match on title or course_code; returns the best (A–Z first) match' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/course-info?course_code=TGS-2025052468" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "data": { "course_id": "<uuid>", "title": "...", "course_code": "TGS-2025052468", "trainer_name": "...", "trainer_email": "...", "course_fee": 1200, "training_hours": 24, "skillsfuture_link": "..." } }`,
      },
      {
        method: 'GET',
        path: '/api/external/course-runs',
        title: 'List Course Runs',
        description: 'Paginated course-run listing for external automations, with optional nested sessions. Filters combine with AND. When include_sessions=true, each run gains a sessions[] array (session_id, session_number, title, start/end date+time, mode_of_training).',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'course_run_id', type: 'string', required: false, description: 'Exact match on SSG course_run_id' },
          { name: 'course_code', type: 'string', required: false, description: 'e.g. TGS-2025060472' },
          { name: 'status', type: 'string', required: false, description: 'Confirmed | Pending | Cancelled | Reschedule' },
          { name: 'from', type: 'string', required: false, description: 'start_date >= this (YYYY-MM-DD)' },
          { name: 'to', type: 'string', required: false, description: 'start_date <= this (YYYY-MM-DD)' },
          { name: 'include_sessions', type: 'boolean', required: false, description: '"true" to nest each run’s sessions' },
          { name: 'limit', type: 'number', required: false, description: 'Default 100, max 500' },
          { name: 'offset', type: 'number', required: false, description: 'Default 0' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/course-runs?status=Confirmed&from=2026-08-01&limit=20" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "total": 42, "limit": 20, "offset": 0, "data": [{ "course_run_uuid": "<uuid>", "course_run_id": "1130294", "class_status": "Confirmed", "start_date": "2026-08-03", "end_date": "2026-08-07", "course_title": "...", "course_code": "TGS-...", "enrolled_count": 12 }] }`,
      },
      {
        method: 'GET',
        path: '/api/external/courses',
        title: 'List Courses (Catalog Feed)',
        description: 'Paginated course-level catalog feed. Supports a `fields` allow-list so lightweight consumers (e.g. an n8n AI-agent search tool) can skip heavy text columns (description/outline/outcomes). Trainer selection picks one trainer per course: among that course’s runs with a trainer, prefers a TPG-assigned trainer, else the most recently-assigned local trainer.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'page', type: 'number', required: false, description: '0-based (default 0)' },
          { name: 'limit', type: 'number', required: false, description: 'Default 500, max 1000' },
          { name: 'course_code', type: 'string', required: false, description: 'Exact match' },
          { name: 'search', type: 'string', required: false, description: 'ILIKE on title or course_code; ranks exact code/title matches first' },
          { name: 'fields', type: 'string', required: false, description: 'Comma-separated subset of the server-defined column allow-list; unknown names are ignored, omit for the full row' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/courses?search=data%20analytics&fields=title,course_code,course_fee" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "pagination": { "page": 0, "limit": 500, "total": 3, "returned": 3 }, "data": [{ "title": "...", "course_code": "TGS-...", "course_fee": 1200 }] }`,
      },
      {
        method: 'POST',
        path: '/api/external/create-course-run',
        title: 'Create Course Run (+ Sessions, Submits to SSG) — BROKEN, DO NOT USE',
        description: '⚠️ BROKEN as of 27 Aug 2026 — every call is rejected by SSG with "Invalid input parameter(s)". The payload is built in a different shape from the one SSG accepts, and SSG names no field in its error, so it looks like the caller is at fault. Use POST /api/external/wsq-submit-runs instead. Kept listed because other agents may still call it; it fails safely and creates nothing. Original description follows. Add-only endpoint for agent-driven "create a new run for course X on these dates" requests — never updates or deletes existing rows. Clones venue, schedule, and session pattern from the course’s most recent existing run (values SSG has already accepted for that course) and remaps them onto the caller-supplied dates; the caller only needs to give course_code + start_date + end_date, with everything else optional overrides. Submits to SSG via addCourseRun, then best-effort persists the new course_run + course_session rows locally (INSERT ONLY, ON CONFLICT DO NOTHING) — if local persistence fails, the SSG run still stands and the daily sync reconciles it, so the request still returns success with a warning.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'course_code', type: 'string', required: true, description: 'e.g. TGS-2025060472' },
          { name: 'start_date', type: 'string', required: true, description: 'YYYY-MM-DD, new run start' },
          { name: 'end_date', type: 'string', required: true, description: 'YYYY-MM-DD, new run end' },
          { name: 'opening_registration_date', type: 'string', required: false, description: 'Default: today (SGT)' },
          { name: 'closing_registration_date', type: 'string', required: false, description: 'Default: day before start_date' },
          { name: 'vacancy', type: 'string', required: false, description: 'Default: available' },
          { name: 'admin_email', type: 'string', required: false, description: 'Default: cloned run’s admin email, then TP support email' },
          { name: 'mode_of_training', type: 'string', required: false, description: 'SSG mode code; default cloned from template run' },
          { name: 'venue', type: 'object', required: false, description: '{ floor, unit, postalCode, room, block, street, building, wheelChairAccess } — required if there is no template run to clone' },
          { name: 'sessions', type: 'array', required: false, description: '[{ start_date, end_date, start_time, end_time, mode_of_training }] — default: template session pattern remapped onto the new dates' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/create-course-run" \\
  -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"course_code": "TGS-2025060472", "start_date": "2026-09-01", "end_date": "2026-09-02"}'`,
        exampleResponse: `{ "success": true, "course_run_id": "1140501", "cloned_from": "1130294", "ssg": { "sequenceNumber": 3, "message": null }, "run": { "course_code": "TGS-2025060472", "start_date": "2026-09-01", "end_date": "2026-09-02", "venue": {...} }, "sessions": [...], "warnings": [] }`,
      },
      {
        method: 'POST',
        path: '/api/external/direct-application-email',
        title: 'Ingest Direct-Application Email',
        description: 'Ingests a parsed Direct Application email (e.g. from an email-parsing automation) and runs it through the same Direct Application auto-enrolment pipeline used elsewhere (processDirectApplication). Auth is a plain Bearer token (DIRECT_APPLICATION_EMAIL_INGEST_TOKEN), separate from the shared x-api-key used by other /api/external/* routes. Errors carry a machine-readable `code` and `retryable` flag so the caller’s retry logic can distinguish transient failures (e.g. SERVER_ERROR) from permanent ones (e.g. DISABLED, UNAUTHORIZED).',
        headers: [
          { name: 'Authorization', value: 'Bearer <DIRECT_APPLICATION_EMAIL_INGEST_TOKEN>' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'source', type: 'string', required: false, description: 'e.g. "gmail"' },
          { name: 'sourceMessageId', type: 'string', required: false, description: 'For idempotency/tracing' },
          { name: 'applicationId', type: 'string', required: false, description: 'SSG Direct Application ID, if known' },
          { name: 'applicationStatus', type: 'string', required: false, description: '' },
          { name: 'courseReferenceNumber', type: 'string', required: false, description: 'SSG course reference' },
          { name: 'courseRunId', type: 'string', required: false, description: '' },
          { name: 'traineeName', type: 'string', required: false, description: '' },
          { name: 'traineeEmail', type: 'string', required: false, description: '' },
          { name: 'traineePhone', type: 'string', required: false, description: '' },
          { name: 'traineeId', type: 'string', required: false, description: 'NRIC/FIN/passport, if present in the email' },
          { name: 'traineeIdType', type: 'string', required: false, description: '' },
          { name: 'payableFee', type: 'number', required: false, description: '' },
          { name: 'skillsfutureCredit', type: 'number', required: false, description: '' },
          { name: 'rawText', type: 'string', required: false, description: 'Full raw email body, kept for audit/debugging' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/direct-application-email" \\
  -H "Authorization: Bearer YOUR_INGEST_TOKEN" -H "Content-Type: application/json" \\
  -d '{"applicationId": "DA-12345", "courseReferenceNumber": "TGS-2025060472", "traineeName": "...", "traineeEmail": "..."}'`,
        exampleResponse: `{ "success": true, "applicationId": "DA-12345", "status": "processed" }`,
      },
      {
        method: 'GET',
        path: '/api/external/enrollments',
        title: 'List / Create Enrollments',
        description: 'GET lists enrollments with filters (inactive statuses — admin removed / cancelled / withdrawn — always excluded). POST enrolls a learner into an existing course run, resolving the learner by email or ID; if no matching learner exists the response tells the caller to create one first via POST /api/external/learners. POST is an upsert on (user_id, course_run_id).',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'course_run_id', type: 'string', required: false, description: '' },
          { name: 'course_code', type: 'string', required: false, description: '' },
          { name: 'learner_email', type: 'string', required: false, description: '' },
          { name: 'payment_status', type: 'string', required: false, description: '' },
          { name: 'limit', type: 'number', required: false, description: 'Default 100, max 500' },
          { name: 'offset', type: 'number', required: false, description: 'Default 0' },
        ],
        bodyFields: [
          { name: 'course_run_id', type: 'string', required: true, description: 'POST only — SSG course_run_id, e.g. "1334264"' },
          { name: 'learner_email', type: 'string', required: false, description: 'POST only — one of learner_email/learner_id is required' },
          { name: 'learner_id', type: 'string', required: false, description: 'POST only' },
          { name: 'sponsorship_type', type: 'string', required: false, description: 'POST only — "Individual" | "Employer", default "Individual"' },
          { name: 'payment_status', type: 'string', required: false, description: 'POST only — "Paid" | "Unpaid", default "Unpaid"' },
          { name: 'enrolment_status', type: 'string', required: false, description: 'POST only — default "Confirmed"' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/enrollments" \\
  -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"course_run_id": "1334264", "learner_email": "jane@example.com"}'`,
        exampleResponse: `{ "success": true, "message": "Learner enrolled in course run 1334264", "data": { "enrollment_id": "<uuid>", "course_run_id": "1334264", "learner_email": "jane@example.com", "enrolment_status": "Confirmed", "payment_status": "Unpaid" } }`,
      },
      {
        method: 'GET',
        path: '/api/external/grants',
        title: 'List SSG Grants',
        description: 'Paginated listing of local ssg_grants records with a summary block (total/estimated/approved amounts, per-status counts) computed over the same filtered set.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'enrollment_id', type: 'string', required: false, description: 'SSG enrolment reference (ENR-...)' },
          { name: 'status', type: 'string', required: false, description: 'Pending | Approved | Rejected' },
          { name: 'funding_scheme', type: 'string', required: false, description: 'funding_scheme_code' },
          { name: 'limit', type: 'number', required: false, description: 'Default 100, max 500' },
          { name: 'offset', type: 'number', required: false, description: 'Default 0' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/grants?status=Approved" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "summary": { "total_grants": 12, "total_estimated": 8400, "total_approved": 7200, "pending_count": 2, "approved_count": 9, "rejected_count": 1 }, "limit": 100, "offset": 0, "data": [{ "grant_id": "...", "status": "Approved", "estimated_grant_amount": 700, "approved_grant_amount": 700, "trainee_name": "..." }] }`,
      },
      {
        method: 'GET',
        path: '/api/external/invoices',
        title: 'List Invoices',
        description: 'Paginated listing of invoice_jobs rows (the QuickBooks-integrated invoice pipeline). Gracefully returns an empty result set (not an error) if the invoice_jobs table doesn’t exist yet on a fresh tenant (Postgres error code 42P01).',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'learner_email', type: 'string', required: false, description: '' },
          { name: 'course_code', type: 'string', required: false, description: 'Course code / SKU' },
          { name: 'status', type: 'string', required: false, description: 'queued | running | done | failed' },
          { name: 'limit', type: 'number', required: false, description: 'Default 100, max 500' },
          { name: 'offset', type: 'number', required: false, description: 'Default 0' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/invoices?status=done&limit=20" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "total": 15, "limit": 20, "offset": 0, "data": [{ "id": "...", "learner_email": "...", "course_code": "TGS-...", "status": "done", "invoice_no": "INV-...", "qbo_invoice_id": "...", "drive_web_view_link": "...", "invoice_sent_at": "2026-07-15T02:00:00Z" }] }`,
      },
      {
        method: 'POST',
        path: '/api/external/learners',
        title: 'Create Learner Account',
        description: 'Creates a new learner account (Learner role + learner_profile), or reactivates + updates an existing one if the email already exists. Password is optional — auto-generated if omitted. Non-empty fields on an existing profile are never blanked out (COALESCE(NULLIF(...))) when reactivating.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'learner_name', type: 'string', required: true, description: '' },
          { name: 'learner_email', type: 'string', required: true, description: '' },
          { name: 'nric', type: 'string', required: false, description: '' },
          { name: 'contact', type: 'string', required: false, description: '' },
          { name: 'company', type: 'string', required: false, description: '' },
          { name: 'password', type: 'string', required: false, description: 'Auto-generated if omitted' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/learners" \\
  -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"learner_name": "Jane Doe", "learner_email": "jane@example.com"}'`,
        exampleResponse: `{ "success": true, "created": true, "message": "Learner account created", "data": { "learner_id": "<uuid>", "learner_name": "Jane Doe", "learner_email": "jane@example.com" } }`,
      },
      {
        method: 'POST',
        path: '/api/external/reconcile-enrolment-cancellations',
        title: 'Reconcile Enrolment Cancellations from TPG',
        description: 'Pulls the current TPG status for active local enrolments on recently-ended / near-future course runs and writes cancellations back to the local DB. Closes the gap where a learner cancels on TPG but the local enrolment_status stays "Confirmed" — which previously let cancelled learners slip through assessment/certificate guards.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT (or x-internal-scheduler header)' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        bodyFields: [
          { name: 'pastDays', type: 'number', required: false, description: 'How many days back to check ended runs (optional, has a default)' },
          { name: 'futureDays', type: 'number', required: false, description: 'How many days ahead to check upcoming runs (optional, has a default)' },
          { name: 'maxChecks', type: 'number', required: false, description: 'Caps the number of TPG lookups per run (optional, has a default)' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/reconcile-enrolment-cancellations" \\
  -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d '{}'`,
        exampleResponse: `{ "success": true, "checked": 40, "cancelledFound": 2, "updated": 2, "errors": 0 }`,
      },
      {
        method: 'GET',
        path: '/api/external/trainers-export',
        title: 'Export Trainers (for AI-MMS Import)',
        description: 'Returns every user holding the Trainer role, with email, name, account status, full role list, and key trainer-profile fields. AI-MMS pulls this to create/sync operator accounts + roles in its own admin so trainers can be invited/confirmed for classes there.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'Filter by trainer_profile.status, e.g. "Active"' },
        ],
        exampleRequest: `curl -X GET "__BASE_URL__/api/external/trainers-export?status=Active" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "count": 34, "data": [{ "user_id": "<uuid>", "email": "...", "full_name": "...", "account_status": "active", "trainer_status": "Active", "tel": "...", "nric": "...", "roles": ["Trainer"] }] }`,
      },
      {
        method: 'POST',
        path: '/api/external/upcoming-course-runs',
        title: 'Fetch TGS Enrolments & Assign Trainers (Daily)',
        description: 'Runs daily 2:00 AM SGT. For every local TGS- course code, searches SSG course runs, scans bottom-up collecting runs whose SSG start date falls within today → today + upcoming_classes_threshold_days (default 21), then searches SSG enrolments for each in-window run. Runs with zero enrolments are skipped entirely (course_run untouched). Where enrolments exist: new active ones are synced in via syncEnrolmentToDB, existing ones get status/raw_data refreshed (never overwriting an Admin Removed decision), and course_run is upserted with the latest SSG start/end/vacancy — but only if at least one enrolment is still active (all-cancelled runs skip the course_run upsert). Finishes with a trainer-assignment pass over any processed run still missing a trainer: tries SSG linkCourseRunTrainer first, then the course’s trainers_email_list, then trainers_list, and auto-confirms a Pending class once both a trainer and an enrolment exist.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'EXTERNAL_API_KEY_FOR_CLAWDBOT' },
        ],
        exampleRequest: `curl -X POST "__BASE_URL__/api/external/upcoming-course-runs" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{ "success": true, "runId": "upcoming_...", "thresholdDays": 21, "processed": 5, "successCount": 5, "errors": 0, "results": [{ "courseRunId": "1140501", "courseCode": "TGS-...", "ssgStartDate": "2026-08-03", "status": "success" }] }`,
      },
    ],
  },

  // ─── AUTHENTICATION ───
  {
    title: 'Authentication',
    description: 'User authentication endpoints for login, OTP, and password management.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/auth/login',
        title: 'User Login',
        description: 'Authenticates a user via password or OTP. Returns user profile, roles, and session token.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'User email address' },
          { name: 'loginType', type: 'string', required: true, description: '"password" or "otp"' },
          { name: 'password', type: 'string', required: false, description: 'Required if loginType is "password"' },
          { name: 'otp', type: 'string', required: false, description: 'Required if loginType is "otp"' },
        ],
        exampleResponse: `{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-...",
      "email": "user@example.com",
      "fullName": "John Doe",
      "role": "learner",
      "roles": ["learner", "trainer"]
    },
    "role": "learner",
    "roles": ["learner", "trainer"],
    "token": "mock-jwt-token-uuid-...",
    "forcePasswordChange": false,
    "requiresProfileSetup": false
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/auth/send-otp',
        title: 'Send OTP',
        description: 'Generates and sends a 6-digit OTP to the user\'s email for passwordless login.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'User email address' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "OTP sent successfully"
}`,
      },
      {
        method: 'PUT',
        path: '/api/auth/update-password',
        title: 'Update Password',
        description: 'Updates a user\'s password. Minimum 6 characters required.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'newPassword', type: 'string', required: true, description: 'New password (min 6 characters)' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Password updated successfully",
  "data": {
    "userId": "uuid-...",
    "email": "user@example.com"
  }
}`,
      },
    ],
  },

  // ─── USER MANAGEMENT ───
  {
    title: 'User Management',
    description: 'Manage users, roles, and accounts within the training provider organization.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/training-provider/add-user',
        title: 'Add User to Organization',
        description: 'Creates a new user account with the given roles (or reactivates a previously-disabled account with the same email).',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'User email address' },
          { name: 'full_name', type: 'string', required: true, description: 'Full name' },
          { name: 'roles', type: 'string[]', required: true, description: 'Array of roles to assign' },
          { name: 'password', type: 'string', required: true, description: 'Account password' },
          { name: 'telephone', type: 'string', required: false, description: 'Contact number (stored on learner_profile)' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "User added successfully",
  "data": {
    "id": "uuid-...",
    "email": "user@example.com",
    "full_name": "Jane Tan",
    "telephone": "91234567",
    "roles": ["Learner"],
    "created_at": "2026-07-22T10:00:00.000Z"
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/training-provider/update-user-roles',
        title: 'Update User Roles',
        description: 'Updates roles for a user. Valid roles: Learner, Trainer, Developer, Admin, Finance, Payroll, Training Provider. Users cannot edit their own roles.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'roles', type: 'string[]', required: true, description: 'Array of roles to assign' },
          { name: 'accountStatus', type: 'string', required: false, description: 'Account status (active/disabled)' },
          { name: 'full_name', type: 'string', required: false, description: 'Updated full name' },
          { name: 'currentUserId', type: 'string', required: false, description: 'Current user ID (to prevent self-editing)' },
        ],
        exampleResponse: `{
  "success": true,
  "data": {
    "userId": "uuid-...",
    "roles": ["Learner", "Trainer"],
    "accountStatus": "active",
    "full_name": "Jane Tan"
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/training-provider/delete-user',
        title: 'Disable User Account',
        description: 'Disables a user account by setting account_status to "disabled". Does not permanently delete the user.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID to disable' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "User deleted successfully"
}`,
      },
      {
        method: 'POST',
        path: '/api/admin/create-learner-account',
        title: 'Create Learner Account',
        description: 'Creates a new learner account with default password from Company Settings. Optionally enrolls in a course run.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'Learner email address' },
          { name: 'fullName', type: 'string', required: true, description: 'Learner full name' },
          { name: 'nric', type: 'string', required: false, description: 'NRIC number' },
          { name: 'courseRunId', type: 'string', required: false, description: 'Course run ID to enroll in' },
          { name: 'courseId', type: 'string', required: false, description: 'Course ID' },
          { name: 'enrolmentId', type: 'string', required: false, description: 'SSG enrolment reference ID' },
          { name: 'enrolmentStatus', type: 'string', required: false, description: 'SSG enrolment status' },
          { name: 'sponsorshipType', type: 'string', required: false, description: '"Individual" or "Employer"' },
          { name: 'enrolmentDate', type: 'string', required: false, description: 'Enrolment date' },
          { name: 'courseReference', type: 'string', required: false, description: 'SSG course reference number' },
          { name: 'tpCode', type: 'string', required: false, description: 'Training partner code' },
          { name: 'paymentCollectionStatus', type: 'string', required: false, description: 'SSG payment collection status — mapped to Paid/Unpaid' },
          { name: 'rawData', type: 'object', required: false, description: 'Raw SSG enrolment payload, stored as-is' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Learner account created and enrolled. Default password from Company Settings applied.",
  "userId": "uuid-...",
  "fullName": "Jane Tan",
  "created": true
}`,
      },
      {
        method: 'POST',
        path: '/api/admin/add-trainer',
        title: 'Add Trainer',
        description: 'Creates a new trainer account with profile. Supports profile picture upload (max 5MB, image only).',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'Supports file upload' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'Trainer email address' },
          { name: 'password', type: 'string', required: true, description: 'Account password' },
          { name: 'fullName', type: 'string', required: true, description: 'Trainer full name' },
          { name: 'telephone', type: 'string', required: true, description: 'Contact number' },
          { name: 'trainerType', type: 'string', required: true, description: '"ACLP", "non-ACLP", or "DACE"' },
          { name: 'status', type: 'string', required: true, description: '"Active" or "Inactive"' },
          { name: 'gender', type: 'string', required: true, description: '"Male", "Female", or "Prefer not to say"' },
          { name: 'linkedinUrl', type: 'string', required: false, description: 'LinkedIn profile URL' },
          { name: 'profilePictureUrl', type: 'string', required: false, description: 'Pre-hosted avatar URL; ignored if a profilePicture file is uploaded' },
          { name: 'profilePicture', type: 'file', required: false, description: 'Profile image upload (max 5MB, image only, multipart field name "profilePicture")' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Trainer added successfully",
  "data": {
    "userId": "uuid-...",
    "email": "trainer@example.com",
    "fullName": "John Doe",
    "trainerType": "ACLP",
    "status": "Active",
    "profilePictureUrl": null,
    "existingAccount": false
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/admin/assign-all-roles',
        title: 'Assign Roles to User',
        description: 'Creates a user (if not existing) and assigns specified roles. Uses default password from Company Settings.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'User email address' },
          { name: 'fullName', type: 'string', required: false, description: 'Full name (defaults to email prefix)' },
          { name: 'roles', type: 'string[]', required: false, description: 'Roles to assign (defaults to all roles)' },
        ],
        exampleResponse: `{
  "success": true,
  "data": {
    "userId": "uuid-...",
    "email": "user@example.com",
    "roles": ["Learner", "Trainer", "Admin", "Developer", "Finance", "Training Provider"]
  }
}`,
      },
    ],
  },

  // ─── COURSES ───
  {
    title: 'Courses',
    description: 'Course catalog management - create, list, update, and delete courses.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/courses/list',
        title: 'List All Courses',
        description: 'Returns all courses ordered by creation date (newest first).',
        headers: [],
        exampleResponse: `{
  "success": true,
  "data": [
    {
      "id": "uuid-...",
      "title": "AI for Business",
      "courseCode": "TGS-2023011234",
      "tscTitle": "AI Applications",
      "tscCode": "ICT-TSC-001",
      "courseRunIds": ["1303232"]
    }
  ]
}`,
      },
      {
        method: 'GET',
        path: '/api/courses/detail',
        title: 'Get Course Detail',
        description: 'Returns course + course-run detail (lesson plan, assessment links, certificate, virtual meeting info) for a specific user\'s enrolment.',
        headers: [],
        queryParams: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID (enrolment owner)' },
          { name: 'courseId', type: 'string', required: true, description: 'Course UUID' },
          { name: 'courseRunId', type: 'string', required: false, description: 'Course run UUID — restricts to that specific run instead of the user\'s first enrolment on the course' },
        ],
      },
      {
        method: 'POST',
        path: '/api/courses/create-course',
        title: 'Create Course',
        description: 'Creates a new course with optional document uploads (lesson plan, assessment plan, guides, slides). Structured course data (learning units, assessments) is passed as a JSON string in the courseData field, not as flat body fields.',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'Supports file uploads' },
        ],
        bodyFields: [
          { name: 'courseData', type: 'string', required: true, description: 'JSON-stringified payload: { title, courseCode, tscTitle?, tscCode?, trainingHours?, assessmentHours?, modeOfLearning?, courseType?, learningOutcomes?, isGamified?, learningUnits?, assessments?, resourceLinks?, ... }. title and courseCode are required.' },
          { name: 'courseImage', type: 'file', required: false, description: 'Course image (uploaded to /uploads/images)' },
          { name: 'lessonPlan', type: 'file', required: false, description: 'Lesson plan document (uploaded to /uploads/plans)' },
          { name: 'assessmentPlan', type: 'file', required: false, description: 'Assessment plan document (uploaded to /uploads/plans)' },
          { name: 'learnerGuide', type: 'file', required: false, description: 'Learner guide (uploaded to /uploads/guides)' },
          { name: 'facilitatorGuide', type: 'file', required: false, description: 'Facilitator guide (uploaded to /uploads/guides)' },
          { name: 'learnerSlides', type: 'file', required: false, description: 'Learner slides (uploaded to /uploads/slides)' },
          { name: 'trainerSlides', type: 'file', required: false, description: 'Trainer slides (uploaded to /uploads/slides)' },
          { name: 'writtenAssessment', type: 'file', required: false, description: 'Written assessment file (uploaded to /uploads/assessments)' },
          { name: 'practicalPerformanceAssessment', type: 'file', required: false, description: 'Practical performance assessment file (uploaded to /uploads/assessments)' },
          { name: 'assessmentFile_<id>', type: 'file', required: false, description: 'Per-assessment file, matched to courseData.assessments[].id' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Course created successfully",
  "data": {
    "courseId": "uuid-...",
    "title": "AI for Business",
    "courseCode": "TGS-2023011234"
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/admin/bulk-upload-courses',
        title: 'Bulk Upload Courses',
        description: 'Imports multiple courses at once from a structured data array. Existing courses (matched by course_code) are updated; new ones are created.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courses', type: 'array', required: true, description: 'Array of course objects with fields: course_code, title, course_type, tsc_title, tsc_code, training_hours, etc.' },
        ],
        exampleResponse: `{
  "success": true,
  "data": {
    "created": 3,
    "updated": 2,
    "failed": 0,
    "results": [
      { "course_code": "TGS-2023011234", "title": "AI for Business", "action": "created", "message": "Course created successfully." }
    ]
  }
}`,
      },
    ],
  },

  // ─── COURSE RUNS & CLASSES ───
  {
    title: 'Course Runs & Classes',
    description: 'Manage course run instances, class scheduling, and course sessions.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/all-course-runs',
        title: 'List All Course Runs',
        description: 'Returns all course runs with their status, dates, and assigned trainers.',
        headers: [],
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Filters by course title, code, run ID, or trainer name' },
          { name: 'status', type: 'string', required: false, description: '"upcoming" | "ongoing" | "completed"' },
          { name: 'upcoming', type: 'string', required: false, description: '"true" to filter to start_date >= today (ignored if status is set)' },
          { name: 'ongoing', type: 'string', required: false, description: '"true" to filter to end_date >= today (ignored if status is set)' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/upcoming-classes',
        title: 'Upcoming Classes',
        description: 'Returns course runs with start dates in the future. Also accepts PUT (id, class_status, class_type, virtual meeting fields) to update a single class.',
        headers: [],
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Filters by course title, code, run ID, TPG/local trainer name' },
          { name: 'courseTitle', type: 'string', required: false, description: 'Filter by course title' },
          { name: 'courseCode', type: 'string', required: false, description: 'Filter by course code' },
          { name: 'courseRunId', type: 'string', required: false, description: 'Filter by SSG course run ID' },
          { name: 'trainer', type: 'string', required: false, description: 'Filter by trainer name' },
          { name: 'classStatus', type: 'string', required: false, description: '"Confirmed" | "Pending" | "Cancelled" | "ActiveOnly"' },
          { name: 'classType', type: 'string', required: false, description: '"Physical" | "Virtual" | "Hybrid" | "External"' },
          { name: 'courseType', type: 'string', required: false, description: '"WSQ" | "IBF" | "Non-WSQ"' },
          { name: 'learnerFilter', type: 'string', required: false, description: '"withLearners" | "noLearners"' },
          { name: 'trainerAssignmentFilter', type: 'string', required: false, description: '"withTrainers" | "noTrainers"' },
          { name: 'startDateFrom', type: 'string', required: false, description: 'DD/MM/YYYY or DD-MM-YYYY' },
          { name: 'endDateUntil', type: 'string', required: false, description: 'DD/MM/YYYY or DD-MM-YYYY' },
          { name: 'thresholdDays', type: 'number', required: false, description: 'Window size in days (default from training_provider setting, clamped to 730)' },
          { name: 'includeOngoing', type: 'string', required: false, description: '"true" to also include currently-ongoing runs (widens window to 365 days)' },
          { name: 'atRiskDays', type: 'number', required: false, description: 'Days-to-start threshold for the "needs attention" flag (default 7, clamped 1-365)' },
          { name: 'attentionFilter', type: 'string', required: false, description: '"needsAttention" to filter to only at-risk runs' },
          { name: 'attentionType', type: 'string', required: false, description: '"no_lms" | "no_tpg" | "exhausted" — narrows attentionFilter' },
          { name: 'page', type: 'number', required: false, description: 'Default 0' },
          { name: 'limit', type: 'number', required: false, description: 'Default 20' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/ongoing-classes',
        title: 'Ongoing Classes',
        description: 'Returns course runs currently in progress. Also accepts PUT (id, class_status) to update a single class.',
        headers: [],
        queryParams: [
          { name: 'page', type: 'number', required: false, description: 'Default 0' },
          { name: 'limit', type: 'number', required: false, description: 'Default 20' },
          { name: 'search', type: 'string', required: false, description: 'Filters by course title, code, or run ID' },
          { name: 'courseTitle', type: 'string', required: false, description: 'Filter by course title' },
          { name: 'courseCode', type: 'string', required: false, description: 'Filter by course code' },
          { name: 'courseRunId', type: 'string', required: false, description: 'Filter by SSG course run ID' },
          { name: 'trainer', type: 'string', required: false, description: 'Filter by trainer name' },
          { name: 'learnerFilter', type: 'string', required: false, description: '"withLearners" | "noLearners"' },
          { name: 'trainerAssignmentFilter', type: 'string', required: false, description: '"withTrainers" | "noTrainers"' },
          { name: 'classStatus', type: 'string', required: false, description: '"Confirmed" | "Pending" | "Cancelled" | "ActiveOnly"' },
          { name: 'classType', type: 'string', required: false, description: '"Physical" | "Virtual" | "Hybrid" | "External"' },
          { name: 'courseType', type: 'string', required: false, description: '"WSQ" | "IBF" | "Non-WSQ"' },
          { name: 'startDateFrom', type: 'string', required: false, description: 'DD/MM/YYYY or DD-MM-YYYY' },
          { name: 'endDateUntil', type: 'string', required: false, description: 'DD/MM/YYYY or DD-MM-YYYY' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/completed-classes',
        title: 'Completed Classes',
        description: 'Returns course runs that have been completed. Also accepts PUT (id, class_status) to update a single class.',
        headers: [],
        queryParams: [
          { name: 'page', type: 'number', required: false, description: 'Default 0' },
          { name: 'limit', type: 'number', required: false, description: 'Default 20' },
          { name: 'search', type: 'string', required: false, description: 'Filters by course title, code, run ID, or trainer name' },
          { name: 'courseTitle', type: 'string', required: false, description: 'Filter by course title' },
          { name: 'courseCode', type: 'string', required: false, description: 'Filter by course code' },
          { name: 'courseRunId', type: 'string', required: false, description: 'Filter by SSG course run ID' },
          { name: 'trainer', type: 'string', required: false, description: 'Filter by trainer name' },
          { name: 'learnerFilter', type: 'string', required: false, description: '"withLearners" | "noLearners"' },
          { name: 'trainerAssignmentFilter', type: 'string', required: false, description: '"withTrainers" | "noTrainers"' },
          { name: 'classStatus', type: 'string', required: false, description: '"Confirmed" | "Pending" | "Cancelled"' },
          { name: 'classType', type: 'string', required: false, description: '"Physical" | "Virtual" | "Hybrid" | "External"' },
          { name: 'courseType', type: 'string', required: false, description: '"WSQ" | "IBF" | "Non-WSQ"' },
          { name: 'startDateFrom', type: 'string', required: false, description: 'DD/MM/YYYY or DD-MM-YYYY' },
          { name: 'endDateUntil', type: 'string', required: false, description: 'DD/MM/YYYY or DD-MM-YYYY' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/save-course-run',
        title: 'Save Course Run from SSG Response',
        description: 'Parses a raw SSG course-run API response and upserts a single course_run row from it. No-op (does not update) if a run with this SSG ID already exists. Auto-creates the course record if missing, and auto-creates/links a trainer account from the SSG payload\'s trainer info.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunData', type: 'object', required: true, description: 'Course-run object from the SSG API (accepts { data: {...} }, { result: {...} }, or the raw object), expected to contain course.run' },
          { name: 'courseRunId', type: 'string', required: true, description: 'The SSG course run ID' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Course run saved to database successfully",
  "data": {
    "courseRunId": "uuid-...",
    "ssgCourseRunId": "1303232",
    "courseId": "uuid-...",
    "courseCode": "TGS-2023011234",
    "digitalAttendanceId": "RA741642",
    "trainerId": "uuid-...",
    "trainerName": "John Doe",
    "trainerEmail": "trainer@example.com",
    "startDate": "2026-03-12",
    "endDate": "2026-03-14",
    "modeOfLearning": "Physical",
    "status": "newly_created"
  }
}`,
      },
      {
        method: 'DELETE',
        path: '/api/admin/delete-course-run',
        title: 'Delete Course Run',
        description: 'Soft-deletes a course run by setting is_deleted = true. Does not remove the row and does not touch enrollments.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: true, description: 'SSG course run ID (matches course_run.course_run_id, not the row UUID)' },
        ],
        exampleResponse: `{
  "success": true,
  "data": {
    "courseReferenceNumber": "TGS-2023011234",
    "courseRunId": "1303232",
    "isDeleted": true
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/admin/import-course-run',
        title: 'Import Course Run from SSG',
        description: 'Imports/upserts a single course run from the SSG API using its course run ID. The course must already exist locally (matched by course_code); the run is created or updated.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'course_run_id', type: 'string', required: true, description: 'The SSG course run ID' },
        ],
        exampleResponse: `{
  "success": true,
  "action": "created",
  "data": {
    "courseRunId": "1303232",
    "courseCode": "TGS-2023011234",
    "courseTitle": "AI for Business",
    "startDate": "2026-03-12",
    "endDate": "2026-03-14",
    "modeOfLearning": "Physical",
    "raCode": "RA741642"
  }
}`,
      },
    ],
  },

  // ─── ENROLMENTS ───
  {
    title: 'Enrolments',
    description: 'Learner enrolment management - enroll, unenroll, search, and update enrolment records.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/enrolment/create',
        title: 'Create Enrolment',
        description: 'Creates a new enrolment directly on the SSG API. On success, syncs the enrolment into the local database.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrolment', type: 'object', required: true, description: 'Full enrolment payload matching the SSG TPG schema (course, run, trainee, trainingPartner, etc.)' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolment/cancel',
        title: 'Cancel Enrolment',
        description: 'Cancels an existing enrolment. Course Run ID is auto-resolved from SSG when omitted.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrolmentId', type: 'string', required: true, description: 'SSG enrolment reference (e.g. ENR-2602-014784)' },
          { name: 'courseRunId', type: 'string', required: false, description: 'Optional. Resolved from SSG via the enrolmentId when omitted.' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolment/search',
        title: 'Search Enrolments',
        description: 'Searches enrolments by course run ID via SSG API, then syncs matching records into the local database.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: true, description: 'SSG course run ID to search enrolments for' },
        ],
      },
      {
        method: 'GET',
        path: '/api/enrolment/view',
        title: 'View Enrolment',
        description: 'Returns full details for a specific enrolment.',
        headers: [],
        queryParams: [
          { name: 'enrolmentId', type: 'string', required: true, description: 'SSG enrolment reference number (e.g. ENR-2602-014784)' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolment/update',
        title: 'Update Enrolment',
        description: 'Moves an enrolment to a different course run on SSG, then syncs the new course_run link locally.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrolmentId', type: 'string', required: true, description: 'SSG enrolment reference number' },
          { name: 'courseRunId', type: 'string', required: true, description: 'Destination SSG course run ID' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolment/update-fees',
        title: 'Update Enrolment Fees',
        description: 'Updates the fee collection status of an enrolment on SSG, then syncs the local payment_status.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'referenceNumber', type: 'string', required: true, description: 'SSG enrolment reference number' },
          { name: 'collectionStatus', type: 'string', required: true, description: 'Fee collection status to set on SSG (e.g. "Full Payment")' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolments/bulk-create',
        title: 'Bulk Create Enrolments',
        description: 'Creates a single local enrolment record (course, learner account, course run, and enrollment row are created as needed). Despite the "bulk" path name, it processes one enrolment per call.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrolment', type: 'object', required: true, description: 'Enrolment payload: traineeEmail, traineeName, traineeNric, courseCode, courseTitle, courseRunId, courseReferenceNumber, sponsorshipType, enrolmentDate, enrolmentStatus, enrolmentId, completionDate, ssgData' },
        ],
      },
    ],
  },

  // ─── ASSESSMENTS & GRADING ───
  {
    title: 'Assessments & Grading',
    description: 'Assessment creation, submission, grading, and SSG assessment integration.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/assessments/detail',
        title: 'Get Assessment Detail',
        description: 'Returns full details for a specific assessment.',
        headers: [],
        queryParams: [
          { name: 'assessmentId', type: 'string', required: true, description: 'Assessment UUID' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/assessments/publish',
        title: 'Publish Assessment',
        description: 'Publishes (or unpublishes) an assessment for a course run, making it available to learners.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: true, description: 'Course run UUID' },
          { name: 'assessmentId', type: 'string', required: true, description: 'Assessment UUID' },
          { name: 'published', type: 'boolean', required: true, description: 'Whether the assessment should be published' },
        ],
      },
      {
        method: 'POST',
        path: '/api/submissions/submit',
        title: 'Submit Assessment',
        description: 'Submits a learner\'s assessment response.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrollmentId', type: 'string', required: true, description: 'Enrollment UUID' },
          { name: 'assessmentId', type: 'string', required: true, description: 'Assessment UUID' },
          { name: 'fileName', type: 'string', required: true, description: 'Submitted file name' },
          { name: 'fileUrl', type: 'string', required: false, description: 'URL of the uploaded file (falls back to a mock-data path when omitted)' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/grading/update-grading',
        title: 'Update Grade',
        description: 'Updates the grade for a learner\'s assessment submission.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrollmentId', type: 'string', required: true, description: 'Enrollment UUID' },
          { name: 'assessmentId', type: 'string', required: true, description: 'Assessment UUID' },
          { name: 'grading', type: 'string', required: true, description: 'One of: Competent, Pending, Not Yet Competent' },
        ],
      },
      {
        method: 'POST',
        path: '/api/assessments/ssg-create',
        title: 'Create SSG Assessment',
        description: 'Creates an assessment record via the SSG TPG API. Silently skipped (200, skipped:true) when the enrolment is cancelled/withdrawn or attendance is below the required threshold.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: true, description: 'SSG course run ID' },
          { name: 'courseReferenceNumber', type: 'string', required: true, description: 'SSG course reference number' },
          { name: 'result', type: 'string', required: true, description: 'Assessment result (e.g. Pass/Fail)' },
          { name: 'traineeId', type: 'string', required: true, description: 'Trainee ID number' },
          { name: 'traineeIdType', type: 'string', required: true, description: 'Trainee ID type' },
          { name: 'traineeFullName', type: 'string', required: true, description: 'Trainee full name' },
          { name: 'skillCode', type: 'string', required: true, description: 'Skill code being assessed' },
          { name: 'assessmentDate', type: 'string', required: true, description: 'Assessment date' },
          { name: 'trainingPartnerUen', type: 'string', required: true, description: 'Training partner UEN' },
          { name: 'trainingPartnerCode', type: 'string', required: true, description: 'Training partner code' },
          { name: 'enrolmentReferenceNumber', type: 'string', required: false, description: 'SSG enrolment reference number, used for the fee-collection follow-up on a Pass result' },
        ],
      },
      {
        method: 'POST',
        path: '/api/assessments/ssg-search',
        title: 'Search SSG Assessments',
        description: 'Searches assessment records via the SSG TPG API.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: true, description: 'SSG course run ID' },
          { name: 'courseReferenceNumber', type: 'string', required: true, description: 'SSG course reference number' },
          { name: 'enrolmentReferenceNumber', type: 'string', required: false, description: 'Filter to a specific enrolment' },
          { name: 'traineeIdNumber', type: 'string', required: false, description: 'Filter to a specific trainee ID' },
        ],
      },
      {
        method: 'POST',
        path: '/api/assessments/ssg-update',
        title: 'Update SSG Assessment',
        description: 'Updates or voids an assessment record via the SSG TPG API. When action is "update" and courseRunId/traineeId are supplied, the request is gated by the same cancelled-enrolment and attendance checks as assessment creation ("void" is always allowed).',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'referenceNumber', type: 'string', required: true, description: 'SSG assessment reference number' },
          { name: 'action', type: 'string', required: true, description: '"update" or "void"' },
          { name: 'result', type: 'string', required: false, description: 'Assessment result (required by SSG when action is "update")' },
          { name: 'traineeFullName', type: 'string', required: false, description: 'Trainee full name (used when action is "update")' },
          { name: 'skillCode', type: 'string', required: false, description: 'Skill code (used when action is "update")' },
          { name: 'assessmentDate', type: 'string', required: false, description: 'Assessment date (used when action is "update")' },
          { name: 'grade', type: 'string', required: false, description: 'Grade (used when action is "update")' },
          { name: 'score', type: 'number', required: false, description: 'Score (used when action is "update")' },
          { name: 'courseRunId', type: 'string', required: false, description: 'SSG course run ID, used for the eligibility gate and fee-collection follow-up' },
          { name: 'traineeId', type: 'string', required: false, description: 'Trainee NRIC, used for the eligibility gate and fee-collection follow-up' },
        ],
      },
    ],
  },

  // ─── ATTENDANCE ───
  {
    title: 'Attendance',
    description: 'Course session attendance tracking and digital attendance management.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/trainer/attendance-sessions',
        title: 'Get Attendance Sessions',
        description: 'Returns all attendance sessions for a course run. The same endpoint also accepts POST to bulk-sync sessions from SSG or create a single manual session.',
        headers: [],
        queryParams: [
          { name: 'courseRunId', type: 'string', required: true, description: 'Course run UUID' },
        ],
      },
      {
        method: 'GET',
        path: '/api/trainer/attendance-records',
        title: 'Get Attendance Records',
        description: 'Returns attendance records for a specific session. The same endpoint also accepts POST to save a batch of attendance records for a session.',
        headers: [],
        queryParams: [
          { name: 'sessionId', type: 'string', required: true, description: 'Session UUID' },
        ],
      },
      {
        method: 'GET',
        path: '/api/trainer/attendance-summary',
        title: 'Get Attendance Summary',
        description: 'Returns attendance summary for a course run across all sessions.',
        headers: [],
        queryParams: [
          { name: 'courseRunId', type: 'string', required: true, description: 'Course run UUID' },
        ],
      },
    ],
  },

  // ─── CERTIFICATES ───
  {
    title: 'Certificates',
    description: 'Certificate generation, management, and distribution.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/admin/setup-certificate',
        title: 'Setup Certificate',
        description: 'Dev/test utility that sets a mock certificate URL on a single hardcoded seed enrollment. Takes no body and does not use the Google Slides template — unrelated to the SG/GH send-certificate flows.',
        headers: [],
      },
      {
        method: 'POST',
        path: '/api/admin/send-certificate-sg',
        title: 'Send Certificate (SG)',
        description: 'Generates a certificate from the training provider\'s Google Slides template and sends it via email to Singapore-based learners.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'studentName', type: 'string', required: true, description: 'Learner full name' },
          { name: 'studentEmail', type: 'string', required: true, description: 'Learner email address' },
          { name: 'courseName', type: 'string', required: true, description: 'Course title' },
          { name: 'courseDates', type: 'string', required: true, description: 'Course date range shown on the certificate' },
          { name: 'userId', type: 'string', required: true, description: 'Training provider user ID used to resolve Google integration settings' },
          { name: 'ccEmails', type: 'string', required: false, description: 'Comma-separated list of CC recipients' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/send-certificate-gh',
        title: 'Send Certificate (GH)',
        description: 'Generates a certificate from the training provider\'s Google Slides template and sends it via email to Ghana-based learners.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'studentName', type: 'string', required: true, description: 'Learner full name' },
          { name: 'studentEmail', type: 'string', required: true, description: 'Learner email address' },
          { name: 'courseName', type: 'string', required: true, description: 'Course title' },
          { name: 'courseDates', type: 'string', required: true, description: 'Course date range shown on the certificate' },
          { name: 'userId', type: 'string', required: true, description: 'Training provider user ID used to resolve Google integration settings' },
          { name: 'ccEmails', type: 'string', required: false, description: 'Comma-separated list of CC recipients' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/admin/delete-certificate',
        title: 'Delete Certificate',
        description: 'Deletes a generated certificate file from Google Drive and clears the certificate URL from the enrollment record.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrollmentId', type: 'string', required: true, description: 'Enrollment UUID' },
        ],
      },
    ],
  },

  // ─── SSG INTEGRATION ───
  {
    title: 'SSG Integration',
    description: 'SkillsFuture Singapore (SSG) API integration endpoints for courses, course runs, and grants.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/ssg/courses',
        title: 'View SSG Course Run',
        description: 'Retrieves a single course run from the SSG API by run ID (not a course listing). The same path also accepts POST/PUT/DELETE to add/edit/delete a course run.',
        headers: [],
        queryParams: [
          { name: 'runId', type: 'string', required: true, description: 'SSG course run ID' },
          { name: 'includeExpired', type: 'string', required: false, description: '"true" to include expired courses' },
          { name: 'trainingProviderId', type: 'string', required: false, description: 'Numeric training provider ID (defaults to the first available)' },
        ],
      },
      {
        method: 'POST',
        path: '/api/ssg/courses/courseRuns/create-new',
        title: 'Create SSG Course Run',
        description: 'Creates a new course run in the SSG system by encrypting and POSTing the payload directly to SSG.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        queryParams: [
          { name: 'includeExpiredCourses', type: 'string', required: false, description: '"true" to include expired courses' },
        ],
        bodyFields: [
          { name: 'course', type: 'object', required: true, description: 'Course payload: courseReferenceNumber, trainingProvider.uen, and a non-empty runs[] array' },
        ],
      },
      {
        method: 'POST',
        path: '/api/ssg/courses/courseRuns/publish',
        title: 'Publish SSG Course Run',
        description: 'Adds a course run in the SSG system via the SSG course-run API client. Accepts either the simple { courseReferenceNumber, runs } shape or the complex nested { course: { runs } } shape from the form.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        queryParams: [
          { name: 'includeExpiredCourses', type: 'string', required: false, description: '"true" to include expired courses' },
        ],
        bodyFields: [
          { name: 'course', type: 'object', required: true, description: 'Course payload with courseReferenceNumber, trainingProvider.uen, and runs[] (or the simple courseReferenceNumber/runs shape)' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolments/post-ssg-enrol',
        title: 'Post Enrolment to SSG',
        description: 'Does not submit to SSG — syncs an already-created SSG enrolment into the local database (idempotent; matched by enrolmentId).',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'traineeEmail', type: 'string', required: true, description: 'Trainee email address' },
          { name: 'courseReferenceNumber', type: 'string', required: true, description: 'SSG course reference number' },
          { name: 'courseRunId', type: 'string', required: true, description: 'SSG course run ID' },
          { name: 'sponsorshipType', type: 'string', required: false, description: 'Sponsorship type' },
          { name: 'traineeName', type: 'string', required: false, description: 'Trainee full name' },
          { name: 'traineeNric', type: 'string', required: false, description: 'Trainee NRIC' },
          { name: 'enrolmentId', type: 'string', required: false, description: 'SSG enrolment reference number (also accepted as referenceNumber)' },
          { name: 'enrolmentStatus', type: 'string', required: false, description: 'Enrolment status' },
        ],
      },
      {
        method: 'POST',
        path: '/api/grants/search',
        title: 'Search Grants',
        description: 'Searches grant records via the SSG TPG API by course run ID.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: true, description: 'SSG course run ID' },
        ],
      },
      {
        method: 'GET',
        path: '/api/grants/view',
        title: 'View Grant Status',
        description: 'Returns grant status details from the SSG system.',
        headers: [],
        queryParams: [
          { name: 'grantId', type: 'string', required: true, description: 'SSG grant ID (e.g. GRN-XXXX-XXXXXX)' },
        ],
      },
      {
        method: 'POST',
        path: '/api/ssg/encrypt',
        title: 'SSG Encrypt',
        description: 'Encrypts data using SSG encryption key for API communication.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'plaintext', type: 'string', required: true, description: 'Plaintext to encrypt' },
        ],
      },
      {
        method: 'POST',
        path: '/api/ssg/decrypt',
        title: 'SSG Decrypt',
        description: 'Decrypts data received from the SSG API.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'ciphertext', type: 'string', required: true, description: 'Ciphertext to decrypt' },
        ],
      },
    ],
  },

  // ─── PROFILES ───
  {
    title: 'Profiles',
    description: 'User profile management for all roles.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/profile-new',
        title: 'Get User Profile',
        description: 'Returns the full profile for the current user based on their role.',
        headers: [],
        queryParams: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'role', type: 'string', required: true, description: 'User role' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/profile-update',
        title: 'Update User Profile',
        description: 'Updates profile fields for the current user (learner only — writes to app_user and learner_profile).',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'profileData', type: 'object', required: true, description: 'Fields to update: name, email, secondaryEmail, profilePictureUrl, password, tel, company, employmentStatus, nationality, ethnicity, dob, nric, gender' },
        ],
      },
      {
        method: 'GET',
        path: '/api/profile/trainer',
        title: 'Get Trainer Profile',
        description: 'Returns trainer-specific profile data.',
        headers: [],
        queryParams: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/profile/update-trainer',
        title: 'Update Trainer Profile',
        description: 'Updates trainer-specific profile fields.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'profileData', type: 'object', required: true, description: 'Fields to update: name, email, tel, gender, trainerType, status, linkedinUrl, cvUrl, profilePictureUrl, areasOfExpertise, qualifications, education, workExperience, newCertifications, certificationsToDelete, password, nric, nationality, ethnicity, dob, etc.' },
        ],
      },
      {
        method: 'GET',
        path: '/api/profile/developer',
        title: 'Get Developer Profile',
        description: 'Returns developer-specific profile data.',
        headers: [],
        queryParams: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/profile/update-developer',
        title: 'Update Developer Profile',
        description: 'Updates developer-specific profile fields.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'profileData', type: 'object', required: true, description: 'Fields to update: name, email, tel, gender, developerType, linkedinUrl, dob, nric, nationality, ethnicity, secondaryEmail, cvUrl, qualifications, education, areasOfSpecialty, workExperience, password, newCertifications, certificationsToDelete' },
        ],
      },
    ],
  },

  // ─── FILE MANAGEMENT ───
  {
    title: 'File Management',
    description: 'File upload, download, and Google Drive integration.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/upload/file',
        title: 'Upload File',
        description: 'Uploads a file to the server. Returns the file URL.',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'File upload' },
        ],
      },
      {
        method: 'POST',
        path: '/api/upload/admin-file',
        title: 'Upload Admin File',
        description: 'Uploads an admin file. Currently only supports fileType "profilePicture" (JPEG/PNG/GIF/WebP, max 10MB); other file types are rejected.',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'File upload' },
        ],
        queryParams: [
          { name: 'fileType', type: 'string', required: true, description: 'Must be "profilePicture"' },
          { name: 'oldFileUrl', type: 'string', required: false, description: 'Existing file URL to delete after the new file is saved' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/upload/delete-file',
        title: 'Delete File',
        description: 'Deletes an uploaded file from the server.',
        headers: [],
        queryParams: [
          { name: 'fileUrl', type: 'string', required: true, description: 'Public URL/path of the file to delete (must resolve inside the public directory)' },
        ],
      },
      {
        method: 'POST',
        path: '/api/upload/google-drive',
        title: 'Upload to Google Drive',
        description: 'Uploads a file to the configured Google Drive folder, filing it under Course → Assessment Records → Session → Learner subfolders (looked up via courseRunId when provided).',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'File upload' },
        ],
        queryParams: [
          { name: 'courseCode', type: 'string', required: false, description: 'Course code, used for Drive folder matching' },
          { name: 'courseName', type: 'string', required: false, description: 'Course title, used for Drive folder matching' },
          { name: 'studentName', type: 'string', required: false, description: 'Learner name, used as the destination subfolder name (defaults to "Unknown Student")' },
          { name: 'courseRunId', type: 'string', required: false, description: 'Course run ID/UUID, used to look up session dates and trainer for folder matching' },
        ],
      },
      {
        method: 'GET',
        path: '/api/files/download',
        title: 'Download File',
        description: 'Downloads a file from the server by file path.',
        headers: [],
        queryParams: [
          { name: 'filePath', type: 'string', required: true, description: 'File path (must start with "uploads/")' },
        ],
      },
    ],
  },

  // ─── TRAINING PROVIDER ───
  {
    title: 'Training Provider',
    description: 'Training provider organization settings, configuration, and management.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/training-provider/info',
        title: 'Get Provider Info',
        description: 'Returns training provider company info, settings, and integration URLs.',
        headers: [],
        queryParams: [
          { name: 'userId', type: 'string', required: false, description: 'User UUID (returns default provider if omitted)' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/training-provider/update',
        title: 'Update Provider Settings',
        description: 'Updates training provider company settings including integrations, security, and admin settings. Also accepts file uploads (company logo, invoice/receipt/certificate/pro-forma templates, SSG cert/key files, Google service account JSON).',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'File upload (body parser disabled; parsed with formidable)' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID (used to resolve the caller\'s training provider organization)' },
          { name: 'profileData', type: 'string (JSON)', required: true, description: 'JSON-encoded settings object: companyName, companyShortname, uen, companyAddress, companyEmail, companyTel, companyWebsite, contactPerson, integrations, adminSettings, securitySettings, gamingSettings, fundingSettings, colorScheme, apiKeys, apiKeyModels, etc.' },
          { name: 'companyLogo, invoiceTemplate, receiptTemplate, certificateTemplate, proFormaInvoiceTemplate, ssgCertFile, ssgPrivateKeyFile, ssgApp1CertFile, ssgApp1PrivateKeyFile, ssgApp3CertFile, ssgApp3PrivateKeyFile, serviceAccountKeyFile', type: 'file', required: false, description: 'Optional file uploads, keyed by field name' },
        ],
      },
      {
        method: 'GET',
        path: '/api/training-provider/users',
        title: 'List Provider Users',
        description: 'Returns all users in the system with their assigned roles (not filtered by training provider organization).',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/training-provider/uen',
        title: 'Get Default Provider UEN',
        description: 'Returns the UEN of the first training provider row in the database. Does not accept a UEN to look up — the endpoint name is legacy.',
        headers: [],
        exampleResponse: `{
  "uen": "201509271W"
}`,
      },
    ],
  },

  // ─── AI & TOOLS ───
  {
    title: 'AI & Tools',
    description: 'AI-powered content generation and chat functionality.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/ai/generate',
        title: 'Generate AI Content',
        description: 'Generates content via Google Gemini (fixed provider, using the server GOOGLE_GEMINI_API_KEY env var — not the training provider\'s configured API keys).',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'prompt', type: 'string', required: true, description: 'Prompt text to send to the model' },
          { name: 'modelName', type: 'string', required: false, description: 'Gemini model name (default: "gemini-1.5-flash")' },
          { name: 'options', type: 'object', required: false, description: 'Optional: { responseFormat: "json", responseSchema }' },
        ],
      },
      {
        method: 'POST',
        path: '/api/ai/chat',
        title: 'AI Chat',
        description: 'Sends a conversation to the training provider\'s configured AI provider (Anthropic, Gemini, OpenAI, MiniMax, Kimi, or DeepSeek, per training_provider_api), with automatic fallback to a secondary provider if the default fails.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'messages', type: 'array', required: true, description: 'Array of { role, content } message objects' },
          { name: 'systemPrompt', type: 'string', required: false, description: 'Optional system prompt' },
        ],
      },
    ],
  },

  // ─── BULK OPERATIONS ───
  {
    title: 'Bulk Operations',
    description: 'Bulk import and upload operations for courses, trainers, and enrolments.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/admin/bulk-upload-courses',
        title: 'Bulk Upload Courses',
        description: 'Imports multiple courses from a structured data array. Upserts by course_code (creates if missing, updates if it already exists).',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courses', type: 'array', required: true, description: 'Array of course objects. Requires course_code and title per row; also accepts course_type, tsc_title, tsc_code, training_hours, assessment_hours, domain, fees, funding, links, and other course fields.' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/bulk-upload-trainers',
        title: 'Bulk Upload Trainers',
        description: 'Imports multiple trainer records. Uses default password from Company Settings. Upserts by matching email/secondary_email against existing app_user rows.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'trainers', type: 'array', required: true, description: 'Array of trainer objects. Requires full_name and email per row; also accepts telephone, trainer_type, gender, status, linkedin_url, common_name, country, cn_plus_email, nric' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolments/bulk-create',
        title: 'Create Enrolment',
        description: 'Creates a single enrolment for a course run despite the "bulk" name — the body takes one enrolment object, not an array. Auto-creates the course, learner account, and course run if they do not already exist.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrolment', type: 'object', required: true, description: 'Single enrolment object: traineeEmail, traineeName, traineeNric, courseCode, courseTitle, courseRunId, courseReferenceNumber, trainingPartnerCode, sponsorshipType, enrolmentDate, enrolmentStatus, enrolmentId, completionDate, ssgData' },
        ],
      },
    ],
  },

  // ─── SYSTEM ───
  {
    title: 'System & Diagnostics',
    description: 'Health checks, logging, and system administration.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/health',
        title: 'Health Check',
        description: 'Returns system health status and database connectivity. Always responds HTTP 200 (even when the database check fails) — check the "database" field, not the status code.',
        headers: [],
        exampleResponse: `{
  "status": "ok",
  "timestamp": "2026-03-29T00:00:00.000Z",
  "version": "1.0.0",
  "database": "connected"
}`,
      },
      {
        method: 'GET',
        path: '/api/admin/automation-logs',
        title: 'Auto-Create Learner Logs',
        description: 'Returns logs from the automatic learner creation process.',
        headers: [],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'Max rows to return (default 100, capped at 500)' },
          { name: 'offset', type: 'number', required: false, description: 'Pagination offset (default 0)' },
          { name: 'runId', type: 'string', required: false, description: 'Filter by a specific run batch ID' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/course-run-date-sync-logs',
        title: 'Course Run Date Sync Logs',
        description: 'Returns logs from the course run date synchronization process.',
        headers: [],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'Max rows to return (default 500, capped at 1000)' },
        ],
      },
      {
        method: 'GET',
        path: '/api/admin/statistics',
        title: 'Dashboard Statistics',
        description: 'Returns class-count statistics for the admin dashboard (ongoing/upcoming/completed classes, and local vs. TPG trainer-assignment counts for upcoming classes).',
        headers: [],
      },
    ],
  },
];

const methodColors: Record<string, string> = {
  GET: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  PUT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const ApiEndpointsView: React.FC = () => {
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({ 0: true });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const resolvedSections = useMemo(() => JSON.parse(
    JSON.stringify(sections).replace(/__BASE_URL__/g, baseUrl)
  ), [baseUrl]);

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleEndpoint = (key: string) => {
    setExpandedEndpoint(prev => prev === key ? null : key);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const totalEndpoints = resolvedSections.reduce((sum: number, s: any) => sum + s.endpoints.length, 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Endpoints</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Complete API documentation for all {totalEndpoints} endpoints across {resolvedSections.length} categories.
        </p>
      </div>

      {/* Authentication Info */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
        <div className="flex items-start gap-3">
          <Icon name={IconName.Admin} className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-blue-800 dark:text-blue-300">Authentication</h3>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              <strong>External APIs</strong> require an <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-xs font-mono">x-api-key</code> header.
              Contact your system administrator to obtain the API key.
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              <strong>Internal APIs</strong> use session-based authentication via JWT tokens from the login endpoint.
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              Base URL: <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-xs font-mono">__BASE_URL__</code>
            </p>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {resolvedSections.map((section: any, sIdx: number) => (
          <div key={sIdx} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 overflow-hidden">
            {/* Section Header */}
            <button
              onClick={() => toggleSection(sIdx)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors bg-gray-50 dark:bg-slate-800/80"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">{section.title}</h2>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300">
                    {section.endpoints.length}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{section.description}</p>
              </div>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${expandedSections[sIdx] ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Section Endpoints */}
            {expandedSections[sIdx] && (
              <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50">
                {section.endpoints.map((ep: any, eIdx: number) => {
                  const epKey = `${sIdx}-${eIdx}`;
                  const isExpanded = expandedEndpoint === epKey;

                  return (
                    <div key={eIdx}>
                      {/* Endpoint Row */}
                      <button
                        onClick={() => toggleEndpoint(epKey)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
                      >
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono w-14 text-center flex-shrink-0 ${methodColors[ep.method]}`}>
                          {ep.method}
                        </span>
                        <code className="text-xs font-mono text-gray-700 dark:text-gray-300 flex-1 truncate">{ep.path}</code>
                        <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline flex-shrink-0">{ep.title}</span>
                        <svg
                          className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Expanded Detail */}
                      {isExpanded && (
                        <div className="border-t border-gray-100 dark:border-gray-700/50 px-4 py-4 space-y-4 bg-gray-50/50 dark:bg-slate-900/30">
                          <p className="text-sm text-gray-600 dark:text-gray-300">{ep.description}</p>

                          {/* Headers */}
                          {ep.headers.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Headers</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                                      <th className="pb-1 pr-4">Name</th>
                                      <th className="pb-1 pr-4">Value</th>
                                      <th className="pb-1">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ep.headers.map((h: any, i: number) => (
                                      <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{h.name}</td>
                                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-500 dark:text-gray-400">{h.value}</td>
                                        <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{h.description}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Query Parameters */}
                          {ep.queryParams && ep.queryParams.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Query Parameters</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                                      <th className="pb-1 pr-4">Name</th>
                                      <th className="pb-1 pr-4">Type</th>
                                      <th className="pb-1 pr-4">Required</th>
                                      <th className="pb-1">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ep.queryParams.map((p: any, i: number) => (
                                      <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{p.name}</td>
                                        <td className="py-1.5 pr-4 text-xs text-gray-500 dark:text-gray-400">{p.type}</td>
                                        <td className="py-1.5 pr-4">
                                          {p.required
                                            ? <span className="text-xs text-red-600 dark:text-red-400 font-medium">Yes</span>
                                            : <span className="text-xs text-gray-400">No</span>
                                          }
                                        </td>
                                        <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{p.description}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Body Fields */}
                          {ep.bodyFields && ep.bodyFields.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Request Body (JSON)</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                                      <th className="pb-1 pr-4">Field</th>
                                      <th className="pb-1 pr-4">Type</th>
                                      <th className="pb-1 pr-4">Required</th>
                                      <th className="pb-1">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ep.bodyFields.map((f: any, i: number) => (
                                      <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{f.name}</td>
                                        <td className="py-1.5 pr-4 text-xs text-gray-500 dark:text-gray-400">{f.type}</td>
                                        <td className="py-1.5 pr-4">
                                          {f.required
                                            ? <span className="text-xs text-red-600 dark:text-red-400 font-medium">Yes</span>
                                            : <span className="text-xs text-gray-400">No</span>
                                          }
                                        </td>
                                        <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{f.description}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Example Request */}
                          {ep.exampleRequest && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Example Request</h4>
                                <button
                                  onClick={() => copyToClipboard(ep.exampleRequest!, `req-${epKey}`)}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                >
                                  {copiedKey === `req-${epKey}` ? 'Copied!' : 'Copy'}
                                </button>
                              </div>
                              <pre className="bg-gray-900 text-gray-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                                {ep.exampleRequest}
                              </pre>
                            </div>
                          )}

                          {/* Example Response */}
                          {ep.exampleResponse && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Example Response</h4>
                                <button
                                  onClick={() => copyToClipboard(ep.exampleResponse!, `res-${epKey}`)}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                >
                                  {copiedKey === `res-${epKey}` ? 'Copied!' : 'Copy'}
                                </button>
                              </div>
                              <pre className="bg-gray-900 text-gray-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                                {ep.exampleResponse}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Error Codes */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 p-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Standard Error Codes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Description</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">200</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Success</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400">400</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Bad request - Missing required fields or invalid data</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">401</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Unauthorized - Invalid or missing API key / session token</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400">403</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Forbidden - Account disabled or insufficient permissions</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">404</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Not found - Resource does not exist</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400">405</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Method not allowed - Wrong HTTP method</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">500</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Internal server error</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ApiEndpointsView;
