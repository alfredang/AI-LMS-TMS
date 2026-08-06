# OpenClaw LMS Reschedule API

Base URL: `https://<lms-domain>`  
Auth: `x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>` on every request.

All endpoints below are under `/api/external/reschedule/`.

---

## Quick Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/learner-readiness` | GET | Pre-flight check before moving a learner |
| `/learner` | POST | Move learner between runs |
| `/run-attendee` | POST | Add or drop a single learner on a run |
| `/move-class` | POST | Move all active learners (and trainer) to another run |
| `/assign-trainer` | POST | Assign or unassign trainer on a run |
| `/sessions` | GET | List sessions for a run |
| `/session` | POST | Reschedule one session to a new date |
| `/day` | POST | Reschedule all sessions on a given date to a new date |
| `/cancel-session` | POST | Permanently delete one session (irreversible) |
| `/cancel-day` | POST | Permanently delete all sessions on a date (irreversible) |
| `/ensure-calendar` | POST | Create missing GCal events for a run |
| `/calendar-attendees` | GET/POST | List or patch GCal attendees |

---

## The Three Systems

Every action touches up to three systems. You interact with all of them through this API — never directly.

| System | Is the authority for |
|--------|--------------------|
| **LMS** | Enrollments, trainers, session cache, GCal event links |
| **SSG / TPGateway** | Official session dates/times, learner enrolment references (enrolmentId), official trainer per run |
| **Google Calendar** | Operational trainer + learner calendar; derived from LMS data |

**Commit order — SSG/TPG first, LMS second, GCal last.** A failed SSG call leaves nothing changed locally. GCal is always best-effort — a GCal failure never rolls back SSG or LMS.

One exception: when *adding* a learner or trainer, LMS is written first (the SSG push reads their profile from LMS). If SSG then fails, the LMS row exists without a TPG reference — this is recoverable by retrying the push.

| Action | Step 1 | Step 2 | Step 3 |
|--------|--------|--------|--------|
| Move learner | SSG re-point | LMS enrollment update | GCal attendee move |
| Drop learner | SSG cancel | LMS soft-remove | GCal remove |
| Add learner | LMS insert | SSG enrol push | GCal add |
| Unassign trainer | SSG clear | LMS delete | GCal remove |
| Assign trainer | LMS insert | SSG push | GCal add |
| Move class | LMS transaction | SSG re-points + trainer push | GCal sync |
| Session date change | SSG update | LMS sync | GCal reconcile |

---

## Key Identifiers

- **`run_id`** — SSG course run ID (e.g. `TGS-2024SG0123456-01`) or internal LMS UUID. All endpoints accept either.
- **`session_id`** — SSG session ID within a run. Obtain from `GET /sessions`.
- **`email`** / **`learner_email`** / **`trainer_email`** — email address as stored in the LMS (case-insensitive).

---

## Sync Flags

All mutating endpoints accept `sync_tpg` and/or `sync_calendar` (default `true`). Set to `false` to skip that system. Both JSON `false` and the string `"false"` are accepted.

GCal skips automatically when the server has `ENABLE_CALENDAR_WRITES` unset — responses will include `calendar.status: 'skipped'`.

---

## Confirmation Protocol

**Before executing any mutating operation the agent MUST:**

1. **Validate the request** — run the relevant readiness check (`GET /learner-readiness` for moves; `GET /sessions` before session mutations) and resolve all hard blockers. If the request is invalid, surface the blockers to the user and stop.

2. **Present a confirmation summary in plain, non-technical language** — no API field names, run IDs, or JSON. Translate everything into what the user actually cares about:
   - What will happen (e.g. "Move Jane Tan from the 4 Aug class to the 11 Aug class")
   - Which systems will be affected — only list the ones that apply, described in plain terms:
     - **Course records** (LMS) — enrollment or session dates will be updated in the system
     - **SSG / SkillsFuture** — the official government training record will be updated
     - **Google Calendar** — calendar invites will be updated for the relevant trainer and learners
   - Any caveats or warnings in plain terms (e.g. "Jane has submitted an assessment on this class — it will remain on the original class and won't be transferred")
   - A human-readable restatement of the key details (names, course titles, dates) so the user can spot any mistakes before committing

3. **Wait for explicit confirmation before calling any mutating endpoint.**

If the user already specified sync flags (e.g. `sync_tpg: false`) in their original request, reflect that in the summary ("TPGateway will **not** be updated"). Only skip the confirmation step if the user explicitly asks to proceed without it.

**System impact by operation type:**

| Operation | LMS | SSG/TPG | GCal |
|-----------|-----|---------|------|
| Move learner | enrollment re-pointed | enrolment ref re-pointed | attendee moved |
| Add learner | enrollment created | enrolment pushed | attendee added |
| Drop learner | enrollment soft-removed | enrolment cancelled | attendee removed |
| Assign trainer | trainer record added | official trainer updated | attendee added |
| Unassign trainer | trainer record removed | official trainer cleared | attendee removed |
| Move class (all learners + trainer) | enrollments re-pointed, trainer moved | enrolments re-pointed/cancelled, trainer moved | events synced on both runs |
| Session reschedule | session cache updated | session date changed + trainer re-asserted | event updated |
| Day reschedule | session cache updated | session dates changed + trainer re-asserted | events updated |
| Cancel session/day | session removed | session deleted + trainer re-asserted | event removed |

**After-the-fact advisory — sibling run date conflict:** `POST /session` and `POST /day` both return an optional `sibling_run_conflict` field when the move lands a session on a date another active run of the *same course* already has a session on. This is discovered only after the move executes (it does not block the operation). When present, tell the user in plain language — e.g. "Heads up: this new date now overlaps with another run of the same course (run TGS-...-02) that's already scheduled that day. Did you mean to consolidate into that run instead, using `/move-class`?" — and let them decide whether to follow up.

---

## Endpoints

### GET /learner-readiness

Pre-flight check before moving a learner. **Always call this before `POST /learner`.**

Query params: `current_run_id`, `target_run_id`, `learner_email`

```json
{
  "canExecute": true,
  "blockers": [],
  "warnings": ["Learner has 2 assessment submission(s) on the source run. Moving them will not transfer these submissions."],
  "lms": {
    "same_run": false,
    "current_enrolment_found": true,
    "target_in_lms": true,
    "same_course": true,
    "target_not_cancelled": true,
    "has_sessions": true,
    "no_conflict": true
  },
  "cal": { "canSync": true, "target_has_calendar": true, "current_has_calendar": true, "blockers": [] }
}
```

- `canExecute: false` → resolve `blockers` before proceeding.
- `lms.same_run: true` → learner is already on the target run; no action needed.
- `lms.no_conflict: false` → **any** enrollment row exists in the target (including soft-deleted / previously-removed ones). Blocker message: `"Learner is already enrolled in the target run."` See decision flow for how to handle.
- `warnings[]` are advisory (proceed is still allowed): assessment submissions stay on source after move; target run past end date (TPG may reject).
- `cal.blockers[]` advisory: `target_has_calendar: false` → call `POST /ensure-calendar` with the target run first.

---

### POST /learner

Moves a learner from one run to another. Commit order: TPGateway re-point → LMS → GCal.

```json
{
  "current_run_id": "TGS-123456-01",
  "target_run_id":  "TGS-123456-02",
  "learner_email":  "jane@example.com",
  "skip_readiness": false
}
```

```json
{
  "success": true,
  "result": {
    "tpg_synced": true,
    "tpg_status": "skipped_no_enrolment_id",
    "enrollment_moved": true,
    "calendar_synced": true
  }
}
```

`tpg_status` non-error values: `synced` (re-pointed on TPG), `skipped_no_enrolment_id` (learner was never TPG-enrolled — LMS move still proceeds normally, this is not an error).

**If `tpg_synced: true` + `enrollment_moved: false` — ESCALATE TO STAFF immediately. Do not retry.** TPGateway already committed; the LMS must be fixed manually.

If `calendar_synced: false` after a successful move, recover with:
```
POST /calendar-attendees  { run_id: A, email: X, action: "remove" }
POST /calendar-attendees  { run_id: B, email: X, action: "add" }
```

---

### POST /run-attendee

Add or drop a single learner on a run across LMS + TPGateway + GCal.

```json
{
  "run_id":        "TGS-123456-01",
  "email":         "jane@example.com",
  "action":        "add",
  "sync_tpg":      true,
  "sync_calendar": true
}
```

**ADD:**
- 409 if run is cancelled or past its end date.
- 404 if the email has no LMS account. There is no email-only/external-learner enrolment path — `enrollment.user_id` is required, so the learner's account must exist first.
- Re-adding a previously-removed learner reactivates their existing record (`lms.reactivated: true`) rather than creating a duplicate.

```json
{
  "lms": { "enrolled": true, "enrollment_id": "<uuid>", "reactivated": false },
  "tpg": { "status": "synced", "enrolmentRef": "ENR-..." },
  "calendar": { "status": "ok", "changed": 1 }
}
```

Non-error TPG statuses (add): `synced`, `already_enrolled`, `skipped_no_nric` (add NRIC to learner profile first), `skipped_no_dob`, `skipped_no_phone`.

Non-error TPG statuses (drop): `synced`, `skipped_no_enrolment_id` (learner was never TPG-enrolled — LMS and GCal drop still proceed normally).

**DROP:**
- 409 `SUBMISSION_EXISTS` if the learner has submitted assessments on this run (`submission_count` in body). Use `force: true` to override — submissions cannot be transferred and remain on the source run.
- 422 if TPG cancel fails — learner still active on both systems. **ESCALATE; do not force-remove from LMS.**

```json
{
  "tpg": { "status": "synced" },
  "lms": { "removed": true },
  "calendar": { "status": "ok" }
}
```

---

### POST /assign-trainer

Assign or unassign a trainer on a run across LMS + TPGateway + GCal.

```json
{
  "run_id":        "TGS-123456-01",
  "trainer_email": "trainer@tia.sg",
  "trainer_name":  "Dr. Alfred Ang",
  "action":        "assign",
  "is_official":   true,
  "sync_tpg":      true,
  "sync_calendar": true
}
```

- `is_official` (default `true`): only the official trainer is pushed to TPGateway. Multiple trainers can be on a run in LMS; only one is the official TPGateway trainer.
- `trainer_name` required for assign when trainer has no LMS account. Returns 400 if `trainer_email` is provided but not found in LMS and `trainer_name` is absent.
- ASSIGN response may include `warning` if the email belongs to a Learner-role account — confirm the account is correct.

Non-error TPG statuses: `synced`, `skipped_no_nric` (cannot assign on TPG — manual step), `no_tpg_profile` (trainer not registered as a Training Provider on SSG).

---

### POST /move-class

Moves all active learners (and trainer) from a source run to a target run of the **same course**. If the source is vacated, its GCal events are removed.

```json
{
  "source_run_id": "TGS-123456-01",
  "target_run_id": "TGS-123456-02",
  "drop_emails":   ["drop@example.com"],
  "trainer_email": "trainer@tia.sg",
  "trainer_name":  "Dr. Alfred Ang",
  "sync_tpg":      true,
  "sync_calendar": true,
  "force":         false
}
```

- `drop_emails` must be an array (not a string). Those learners are soft-removed from source rather than moved. Blocked if they have assessment submissions unless `force: true`.
- `trainer_email`: official trainer for the target. If omitted, carries over the source trainer. Returns 400 if email is not in LMS and `trainer_name` is also absent.
- Learners already enrolled in the target are auto-removed from source without moving (`skipped_conflicts`).

```json
{
  "summary": { "moved": 12, "removed": 1, "skipped_conflicts": ["already@tia.sg"], "source_vacated": true },
  "tpg_enrolment": {
    "repointed": [{ "userId": "<uuid>", "status": "synced" }],
    "cancelled":  [{ "userId": "<uuid>", "status": "synced" }]
  },
  "tpg_trainer": { "target": { "status": "synced" }, "source": { "status": "synced" } },
  "calendar": { "target": { "status": "ok" }, "source_events_removed": true }
}
```

Any `tpg_enrolment.repointed[]` entry with `status: 'error'` means that learner's TPGateway enrolment was not re-pointed — **log for staff to fix manually.**

---

### GET /sessions

Lists sessions for a run from the LMS database.

Query params: `run_id`, `refresh` (bool, default `false` — set `true` to pull latest from SSG before returning)

```json
{
  "sessions": [
    {
      "session_id": "TGS-123456-01-S001",
      "start_date": "20260804",
      "end_date":   "20260804",
      "start_time": "09:00",
      "end_time":   "18:00",
      "mode_of_training": "1"
    }
  ],
  "total": 3
}
```

> **Date format:** `start_date` / `end_date` are returned in SSG's native `YYYYMMDD` format (e.g. `"20260804"`), **not** `YYYY-MM-DD`. Convert before passing to `/session` (`new_date`) or `/day` (`from_date` / `to_date`), which require `YYYY-MM-DD`. Example: `"20260804"` → `"2026-08-04"`.

Call with `refresh=true` before any session mutation if the local data may be out of date.

---

### POST /session

Reschedule a single session to a new date. Commit order: SSG → LMS sync → GCal reconcile.

> SSG wipes the run's official trainer on any session edit. This endpoint automatically re-asserts it afterwards.

`tpg_trainer` non-error values: `synced` (pushed OK), `skipped` (no trainer assigned to this run — not an error), `skipped_no_nric` (trainer has no NRIC on file — push TPG manually), `no_tpg_profile` (trainer not registered as TP on SSG — manual step). Only `error` warrants a retry via `POST /assign-trainer`.

```json
{
  "run_id":         "TGS-123456-01",
  "session_id":     "TGS-123456-01-S001",
  "new_date":       "2026-09-15",
  "new_start_time": "09:00",
  "new_end_time":   "18:00",
  "sync_calendar":  true
}
```

- `new_start_time` / `new_end_time` optional — existing times kept if omitted.
- 400 if `new_date` is the same date with the same times (no-op detected).
- 400 if `new_date` is not a valid calendar date (e.g. `2026-02-30`).
- Response includes `past_date_warning` (string) if `new_date` is in the past — TPGateway may reject.
- Multi-day sessions: end date shifts by the same offset. Response includes `new_end_date` when it differs from `new_date`.
- Response includes `sibling_run_conflict` (array, optional) if another active run of the same course already has a session on the new date(s). Advisory only — the move still executes. See Confirmation Protocol above for how to relay this.

```json
{
  "session_id": "TGS-123456-01-S001",
  "new_date":   "2026-09-15",
  "sibling_run_conflict": [
    { "course_run_id": "TGS-123456-02", "matched_dates": ["2026-09-15"] }
  ],
  "ssg":        { "status": "ok" },
  "lms_sync":   { "ok": true, "upserted": 3 },
  "tpg_trainer":{ "status": "synced" },
  "calendar":   { "status": "ok" }
}
```

---

### POST /day

Reschedule all sessions on `from_date` to `to_date`. Same commit order as `/session`.

```json
{
  "run_id":         "TGS-123456-01",
  "from_date":      "2026-08-04",
  "to_date":        "2026-08-11",
  "new_start_time": "09:00",
  "new_end_time":   "18:00",
  "sync_calendar":  true
}
```

- 404 if no active sessions exist on `from_date`.
- 400 if either date is not a valid calendar date.
- Response includes `warnings[]` for: `to_date < from_date` (compresses run window); `to_date` already has sessions for this run (double-booking risk). These are advisory — the operation still proceeds.
- Response includes `sibling_run_conflict` (array, optional) if another active run of the same course already has a session on any of the new date(s). Advisory only — the move still executes. See Confirmation Protocol above.
- `new_start_time` / `new_end_time` optional — applied to all sessions on the day.

```json
{
  "from_date": "2026-08-04",
  "to_date":   "2026-08-11",
  "sessions_moved": 2,
  "warnings": [],
  "sibling_run_conflict": [
    { "course_run_id": "TGS-123456-02", "matched_dates": ["2026-08-11"] }
  ],
  "ssg": { "status": "ok" },
  "lms_sync": { "ok": true },
  "tpg_trainer": { "status": "synced" },
  "calendar": { "status": "ok" }
}
```

---

### POST /cancel-session

Permanently deletes one session from SSG. **Irreversible.**

```json
{ "run_id": "TGS-123456-01", "session_id": "TGS-123456-01-S001", "sync_calendar": true }
```

```json
{
  "session_id":       "TGS-123456-01-S001",
  "was_last_session": false,
  "ssg":        { "status": "ok" },
  "lms_sync":   { "ok": true },
  "tpg_trainer":{ "status": "synced" },
  "calendar":   { "status": "ok" }
}
```

- `was_last_session: true` — the run now has no sessions. Alert staff — the run is incomplete.
- `past_session_warning` (string) — session was in the past and had attendance records that will be permanently deleted from LMS. Confirm with the user before proceeding.

---

### POST /cancel-day

Permanently deletes all sessions on `date` from SSG. **Irreversible.**

```json
{ "run_id": "TGS-123456-01", "date": "2026-08-04", "sync_calendar": true }
```

- 400 if `date` is not a valid calendar date.

```json
{
  "date":               "2026-08-04",
  "sessions_cancelled": 2,
  "was_last_day_of_run": false,
  "ssg":        { "status": "ok" },
  "lms_sync":   { "ok": true },
  "tpg_trainer":{ "status": "synced" },
  "calendar":   { "status": "ok" }
}
```

- `was_last_day_of_run: true` — run is now sessionless. Alert staff.
- `past_day_warning` (string) — the day is in the past and had attendance records that will be permanently deleted. Confirm with the user.

---

### POST /ensure-calendar

Creates GCal events for a run that has none. Idempotent — existing events are adopted, not duplicated. One event per session day.

```json
{ "run_id": "TGS-123456-02" }
```

- 422 if the run has no active sessions — sync sessions from SSG first (`GET /sessions?run_id=X&refresh=true`), then retry.

```json
{ "status": "ok", "created": 3, "adopted": 0, "kept": 0 }
```

`status: "skipped"` means GCal writes are not enabled on this server.

---

### GET /calendar-attendees

Lists GCal events and attendees for a run.

Query params: `run_id`

```json
{
  "events": [
    {
      "eventId": "abc123",
      "date": "2026-08-04",
      "attendees": [
        { "email": "jane@example.com", "responseStatus": "accepted", "classification": "desired" }
      ]
    }
  ]
}
```

`classification`: `desired` = on LMS roster; `departed` = removed from LMS but still on calendar; `external` = on calendar only (not in LMS).

### POST /calendar-attendees

Adds or removes a single email from all GCal events for a run. Affects GCal only — no LMS or TPGateway change.

```json
{ "run_id": "TGS-123456-02", "email": "jane@example.com", "action": "add" }
```

Use for manual GCal recovery when `calendar_synced: false` after a reschedule.

---

## Error Reference

| HTTP | When |
|------|------|
| 400 | Missing required field; invalid or impossible date (`2026-02-30`); same-date no-op; `drop_emails` not an array; `trainer_email` not in LMS without `trainer_name` |
| 401 | Invalid or missing `x-api-key` |
| 404 | Run, session, learner, or trainer not found; email has no LMS account (`POST /run-attendee` add) |
| 409 | Already enrolled; `SUBMISSION_EXISTS` — assessment submissions block drop/move (see `submission_count`) |
| 422 | Step execution failed (inspect `step` field); run has no sessions (ensure-calendar) |
| 500 | Server error; API key not configured server-side |

---

## Escalation vs Retry

**Escalate to staff — do not auto-retry:**
- `POST /learner` → `result.tpg_synced: true` + `result.enrollment_moved: false`
- `POST /run-attendee` DROP → `tpg.status: 'error'` (422)
- `POST /move-class` → any `tpg_enrolment.repointed[]` entry with `status: 'error'`
- Any SSG/TPGateway error code starting with `TGS-4xx` (data validation, not transient)

**Safe to retry:**
- `tpg_synced: false` on learner reschedule — nothing was committed; run from step 1
- Any `status: 'skipped'` — sync flag was off; re-enable and retry
- HTTP 5xx — transient; exponential backoff

---

## Agent Decision Flows

### Move a learner between runs

```
1. GET /learner-readiness?current_run_id=A&target_run_id=B&learner_email=X
   lms.same_run=true       → already on target, no action
   blockers[]              → resolve:
     "Target run not found"               → run not synced yet; wait
     "No active enrollment [in source]"   → learner may already be on target; check
     "Target run is cancelled"            → cannot move; inform user
     "Learner is already enrolled in the target run"
       → lms.no_conflict=false fires on ANY enrollment row (incl. previously-removed).
         If the existing row is stale/inactive, proceed with skip_readiness:true —
         the endpoint auto-removes the inactive row before moving.
         If you are unsure, check with staff before bypassing.
   warnings[]              → note for user but proceed
     assessment submissions        → they stay on source run after the move
     target run end date past      → TPG may reject; inform user
   cal.blockers[]          → target_has_calendar=false:
     POST /ensure-calendar { run_id: B }
       422 (no sessions)   → GET /sessions?run_id=B&refresh=true first, retry

2. POST /learner { current_run_id: A, target_run_id: B, learner_email: X, skip_readiness: true }
   tpg_synced=true + enrollment_moved=false  → ESCALATE immediately
   tpg_synced=false                          → safe retry from step 1
   calendar_synced=false                     → POST /calendar-attendees (remove A, add B)
   result.tpg_status=skipped_no_enrolment_id → normal; learner was never TPG-enrolled
```

### Add a learner to a run

```
POST /run-attendee { run_id, email, action: "add" }
  409 cancelled/past run       → inform user; cannot add
  tpg: skipped_no_nric         → add NRIC to learner profile first
  lms.reactivated=true         → previously removed; now reactivated (inform user)
```

### Drop a learner from a run

```
POST /run-attendee { run_id, email, action: "drop" }
  409 SUBMISSION_EXISTS        → inform user of submission_count; get explicit confirmation; retry with force: true
  422 (TPG error)              → ESCALATE; do not force-remove from LMS
```

### Reschedule a session or day

```
1. GET /sessions?run_id=X&refresh=true   ← always refresh before session mutations

2a. POST /session { run_id, session_id, new_date, new_start_time?, new_end_time? }
2b. POST /day     { run_id, from_date, to_date, new_start_time?, new_end_time? }

  ssg.status != 'ok'           → SSG rejected; surface error to staff; do not auto-retry
  warnings[]                   → inform user (double-booking, window narrowing, past date)
  tpg_trainer.status:
    'synced'              → OK
    'skipped'             → no trainer on this run; no action needed
    'skipped_no_nric'     → trainer has no NRIC; push to TPG manually
    'no_tpg_profile'      → trainer not registered on SSG; manual step
    'error'               → POST /assign-trainer to re-push
  calendar.status='error'      → LMS/SSG already updated; retry GCal via POST /calendar-attendees
```

### Cancel a session or day

```
1. GET /sessions?run_id=X     ← confirm the session exists before cancelling

2a. POST /cancel-session { run_id, session_id }
2b. POST /cancel-day     { run_id, date }

  past_session_warning / past_day_warning  → alert user: attendance records will be permanently deleted; get confirmation
  was_last_session / was_last_day_of_run=true → run is now sessionless; alert staff
  ssg.status != 'ok'          → delete failed; session still exists; surface to staff
```

### Move an entire class

```
POST /move-class { source_run_id, target_run_id, trainer_email?, drop_emails?: [], force?: false }
  400 (trainer not in LMS)    → provide trainer_name alongside trainer_email
  409 SUBMISSION_EXISTS       → a drop_emails learner has submissions; use force:true or remove from drop list
  tpg_enrolment.repointed[] with status='error' → log for staff; those enrolments need manual TPGateway fix
  tpg_trainer.target != 'synced' → POST /assign-trainer to push trainer to TPGateway
```
