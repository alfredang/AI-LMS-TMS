# Scheduler: Fetch TGS Enrolments & Assign Trainers

**File:** `pages/api/external/upcoming-course-runs.ts`
**Schedule:** Daily at 2:00 AM SGT
**Trigger:** `POST /api/external/upcoming-course-runs` with header `x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>`

---

## Overview

This scheduler syncs SkillsFuture (SSG) enrolment data into the local database for all upcoming TGS- course runs, then auto-assigns trainers where none have been set.

---

## Phase 1 — Course Code Discovery

Queries the local `course` table for all distinct `TGS-` prefixed course codes.

```sql
SELECT DISTINCT course_code, title FROM course WHERE course_code LIKE 'TGS-%'
```

---

## Phase 2 — Find In-Window Course Runs (per course code)

For each course code, calls **SSG Search Course Runs by Course Code** (`pageSize=40`, `includeExpired=false`).

The returned runs are scanned **bottom-up** (newest → oldest):
- If `startDate > today + thresholdDays` → stop early (no need to scan further back)
- If `today ≤ startDate ≤ cutoff` → add to in-window list
- If `startDate < today` → skip but continue scanning upward

`thresholdDays` is read from `training_provider.upcoming_classes_threshold_days` (default: 21 days).

---

## Phase 3 — Fetch SSG Enrolments (per in-window run)

For each in-window run, calls **SSG Search Enrolments** (`POST /tpg/enrolments/search`) — an AES-256-CBC encrypted endpoint — using the course run ID.

### Enrolment Processing Rules

| Scenario | Action |
|---|---|
| 0 enrolments returned | Skip entirely — do not touch `course_run` table |
| Not in DB + SSG status = Cancelled | Skip — no learner account created |
| Not in DB + SSG status = Active/Confirmed | Call `syncEnrolmentToDB` — creates learner account + `enrollment` row with course run assignment |
| Already in DB + status ≠ `Admin Removed` | UPDATE `enrolment_status` and `raw_data` from SSG |
| Already in DB + status = `Admin Removed` | **Skip** — admin decision takes precedence, SSG sync will not overwrite |

> **Key protection:** If an admin manually removed a learner from a class (`enrolment_status = 'Admin Removed'`), the SSG sync will never re-add them. If the admin later re-assigns the same learner, the enrollment is restored to `Confirmed` instead of creating a duplicate.

---

## Phase 4 — Upsert `course_run` (Gated)

Only runs if **at least one active (non-cancelled) enrolment** exists for that run.

### Insert (run not in DB)
```
class_status        = 'Pending'
start_date          = SSG start date
end_date            = SSG end date
mode_of_learning    = mapped from SSG modeOfTraining code (see table below)
digital_attendance_id = RA code extracted from qrCodeLink
course_vacancy_code/description = from SSG
```

### Update (run already in DB)
Only the following fields are overwritten from SSG:
- `start_date`, `end_date`
- `mode_of_learning`
- `digital_attendance_id` (only if SSG provides a non-null RA code — uses `COALESCE`)
- `course_vacancy_code`, `course_vacancy_description`

The following are **never touched** by the scheduler:
- `class_status` — preserves admin-set status (Confirmed / Pending / Cancelled)
- `class_type` — preserves admin-set type (Physical / Virtual / Hybrid)
- `assigned_trainer_*` — preserves manually assigned trainer
- `tpg_assigned_trainer_*` — preserves SSG-synced trainer

### SSG `modeOfTraining` Code Mapping

| SSG Code | Local Value |
|---|---|
| 1 | Physical |
| 2 | Online |
| 3 | On the Job |
| 4 | Hybrid |
| 5 | Practical |
| (other) | Physical (fallback) |

---

## Phase 5 — Trainer Assignment Pass

After all enrolment processing, the scheduler checks every course run touched in this batch that **has no assigned trainer yet** (no `assigned_trainer_id` AND no entry in `course_run_trainer`). For each unassigned run, it attempts trainer resolution in priority order:

### Priority 1 — SSG `linkCourseRunTrainer`
Calls `viewCourseRun` on SSG. If trainer links are returned, resolves each by email against `app_user`. Sets `fromSSG = true`.

### Priority 2 — `trainers_email_list` (fallback)
If no SSG trainer found, splits `course.trainers_email_list` by comma and looks up each email in `app_user`. `fromSSG = false`.

### Priority 3 — `trainers_list` (fallback)
If still no trainer found, splits `course.trainers_list` by comma and looks up each name in `app_user`. `fromSSG = false`.

### Write Rules

| Column | Written when `fromSSG = true` | Written when `fromSSG = false` |
|---|---|---|
| `assigned_trainer_id/name/email` (legacy) | ✅ first trainer | ✅ first trainer |
| `tpg_assigned_trainer_name/email` (TPG column) | ✅ first trainer | ❌ never |
| `course_run_trainer` junction table (Local column) | ✅ all trainers | ❌ never |

> **Key rules:**
> - **Trainer (Local)** is only populated when the trainer was explicitly assigned by SSG (`linkCourseRunTrainer`). Fallback trainers from `trainers_email_list`/`trainers_list` do **not** appear in the Local column.
> - **Trainer (TPG)** (`tpg_assigned_trainer_name`) is only set when `fromSSG = true`. A manually assigned local trainer will **never** overwrite the TPG column.
> - The entire trainer assignment pass is **skipped** if the run already has an assigned trainer — it will not overwrite any existing assignment.

---

## Trainer Column Mapping (Upcoming Classes Table)

| Column | Source |
|---|---|
| Trainer (TPG) | `course_run.tpg_assigned_trainer_name` — set only by SSG sync |
| Trainer (Local) | First entry in `course_run_trainer` junction table — set by admin or SSG `linkCourseRunTrainer` |
| Next Trainer | Auto-computed from `course.trainers_list`, skipping locally assigned and declined trainers |

---

## Rate Limiting

A 2-second delay (`RATE_LIMIT_MS = 2000`) is applied between each SSG API call to avoid hitting rate limits.

---

## Logging

Every processed course run is logged to the `upcoming_course_runs_log` table with:
- `run_id` — batch identifier
- `course_run_id`, `course_code`, `course_title`
- `ssg_start_date`, `ssg_end_date`
- `mode_of_learning`, `vacancy_code`
- `status` — `success`, `no_enrolments`, or `error`
- `error_message` — populated on failure
