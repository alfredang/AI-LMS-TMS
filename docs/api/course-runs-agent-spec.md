# Course Runs API — agent spec

Two endpoints on the LMS-TMS that answer two *different* questions. Picking the
wrong one is the main failure mode, so start here:

| If the question is… | Use |
|---|---|
| "Which classes are we actually running? Who do I invite / remind / invoice?" | **A. Upcoming course runs** |
| "What does SkillsFuture show? Does our schedule match the portal?" | **B. SSG course runs** |

**Base URL:** `https://lms-tms.tertiaryinfotech.com`
**Auth (both):** header `x-api-key: $EXTERNAL_API_KEY_FOR_CLAWDBOT`

Never use `NEXT_PUBLIC_SCHEDULER_SECRET` — it is exposed in the client bundle
and is rejected. Both endpoints are `GET` only and read-only; neither one
writes, so they are always safe to retry.

---

## A. Upcoming course runs — runs WITH enrolment

```
GET /api/external/course-runs?has_enrolments=true
```

Reads the LMS's own `course_run` table: the operational truth about classes we
are actually delivering. These are the runs that have learners, trainers,
sessions, attendance and invoices hanging off them.

**Use for:** trainer invitations, class reminders, attendance chasing,
invoicing, "what's on next week", anything that touches a real learner.

### Parameters

| Param | Default | Notes |
|---|---|---|
| `has_enrolments` | *(off)* | **Set `true`** for the "runs with enrolment" sense. Omitted, you also get empty runs that happen to be in the DB. |
| `course_code` | — | e.g. `TGS-2025052468` |
| `course_run_id` | — | exact SSG run id, e.g. `1127324` |
| `status` | — | `Confirmed` \| `Pending` \| `Cancelled` \| `Reschedule` |
| `from` / `to` | — | filters on **start_date**, `YYYY-MM-DD`. There is no implicit "upcoming" — pass `from` = today for future-only. |
| `include_sessions` | `false` | `true` nests each run's day/session rows |
| `limit` / `offset` | `100` / `0` | max `limit` 500 |

### Example

```bash
curl -H "x-api-key: $EXTERNAL_API_KEY_FOR_CLAWDBOT" \
  "https://lms-tms.tertiaryinfotech.com/api/external/course-runs?course_code=TGS-2025052468&from=2026-09-15&has_enrolments=true&limit=500"
```

```json
{ "success": true, "total": 1,
  "data": [{
    "course_run_uuid": "…", "course_run_id": "1127324",
    "class_status": "Confirmed",
    "start_date": "2026-09-26", "end_date": "2026-09-26",
    "mode_of_learning": "Physical",
    "assigned_trainer_name": "…", "assigned_trainer_email": "…",
    "course_title": "…", "course_code": "TGS-2025052468",
    "course_fee": "…", "training_hours": "…", "assessment_hours": "…",
    "venue_block": "…", "venue_street": "…", "venue_building": "…",
    "venue_floor": "…", "venue_unit": "…", "venue_postal_code": "…", "venue_room": "…",
    "registration_opening_date": "…", "registration_closing_date": "…",
    "course_admin_email": "…",
    "enrolled_count": 2
  }]
}
```

Note: `course_run_id` is the SSG run id (the join key to endpoint B);
`course_run_uuid` is the LMS internal id used by other LMS endpoints.

**Gotcha — `include_sessions` dates.** Run-level dates are `YYYY-MM-DD`, but
nested `sessions[].start_date` / `end_date` come back as raw 8-digit strings
(`"20260926"`), because that column is stored as text. Normalise before
comparing them to run-level dates.

---

## B. SSG course runs — WITH and WITHOUT enrolment (tallies with SSG)

```
GET /api/external/ssg-course-runs?course_code=TGS-2025052468
```

Calls SSG live and returns **every run SSG publishes** for the code — including
runs nobody has signed up for. This is the list that matches the MySkillsFuture
"Course Dates" tab.

**Use for:** schedule audits, "does our calendar match the portal", spotting
runs SSG has that the LMS doesn't, checking a published schedule before
marketing.

**Do NOT use it** to decide who to email or invoice — most of these runs have no
learners.

### Why the two counts differ

The nightly sync deliberately **skips SSG runs with zero enrolments**, so those
runs never enter the LMS database at all. Endpoint A physically cannot see them.
Endpoint B bypasses the DB and asks SSG directly, which is why it tallies.

### Parameters

| Param | Default | Notes |
|---|---|---|
| `course_code` | **required** | e.g. `TGS-2025052468` |
| `from` | **today (SGT)** | `YYYY-MM-DD`, or `from=all` for every run including past ones |
| `to` | — | `YYYY-MM-DD`, filters on start date |
| `include_expired` | `false` | ask SSG for expired courses too |
| `page_size` | `100` | SSG page size, max 100 |

Note the asymmetry: **B defaults to upcoming-only, A does not.** Pass `from`
explicitly on A whenever you mean "future".

### Example

```bash
curl -H "x-api-key: $EXTERNAL_API_KEY_FOR_CLAWDBOT" \
  "https://lms-tms.tertiaryinfotech.com/api/external/ssg-course-runs?course_code=TGS-2025052468"
```

```json
{ "success": true,
  "course_code": "TGS-2025052468",
  "total": 23,
  "ssg_total_returned": 90,
  "with_enrolments": 1,
  "without_enrolments": 22,
  "data": [{
    "course_run_id": "1382016",
    "course_code": "TGS-2025052468",
    "start_date": "2027-01-23", "end_date": "2027-01-23",
    "mode_of_learning": "Physical",
    "registration_opening_date": "2026-07-03",
    "registration_closing_date": "2027-01-22",
    "vacancy_code": "A", "vacancy_description": "Available",
    "venue": { "block": "", "building": "", "floor": "07",
               "postalCode": "737715", "room": "Training room",
               "street": "", "unit": "85-87", "wheelChairAccess": false },
    "in_lms": true,
    "enrolled_count": 0
  }]
}
```

- `total` — runs after the date filter (what to report as "upcoming")
- `ssg_total_returned` — everything SSG returned before filtering
- `in_lms` — `false` means SSG has this run but the LMS does not
- `enrolled_count` — active enrolments in the LMS (`0` when `in_lms` is false)

`venue` here is a nested object from SSG; endpoint A returns flat `venue_*`
columns instead. They are not interchangeable.

---

## Shared semantics

**"Active enrolment"** means the same thing in both endpoints: an enrolment
whose status is *not* `admin removed`, `cancelled` or `withdrawn`. So
`has_enrolments=true` on A and `enrolled_count > 0` on B always agree.

**Dates** are `YYYY-MM-DD` Singapore calendar dates (except the session quirk
noted above). Do not re-interpret them in UTC.

**Joining the two:** `course_run_id` is the shared key.
`B minus A` = runs SSG publishes that we are not tracking.

### Errors

| Code | Meaning | Agent action |
|---|---|---|
| `200` | OK | — |
| `400` | missing `course_code` (B only) | fix the call |
| `401` | bad/missing `x-api-key` | check the env var; do not retry blindly |
| `405` | wrong method | use GET |
| `502` | SSG unreachable / SSG credential problem (B only) | transient — back off and retry; fall back to A and say the figure is LMS-only |
| `500` | server error | report it, don't hammer |

Errors are `{ "success": false, "error": "…" }`. **Check `success`, not just the
HTTP status.** Endpoint B depends on a live SSG call, so it is slower (seconds)
and can fail when SSG is down; A is a local DB read and is fast and reliable.

---

## Worked example — TGS-2025052468 (verified 2026-09-15)

- **A** (`has_enrolments=true`, from today): **1** run — `1127324`, 26 Sep 2026, 2 learners.
- **B** (from today): **23** runs — matching the MySkillsFuture portal exactly.
- 22 of the 23 have no enrolments; 9 are not in the LMS at all (`in_lms: false`);
  the 23 collapse to 14 distinct dates (see the caveat below).

So: "we are running 1 class" and "SSG lists 23 dates" are both true and not in
conflict. Report whichever the question actually asked for, and if a human asks
why the numbers differ, the answer is that empty runs never enter the LMS.

### Known data-quality caveat

SSG currently publishes this course in two overlapping series. Of the 23 runs,
there are only **14 distinct start/end date pairs** — 9 dates carry two run ids
each, e.g. `1361792` and `1200351` are both 7–8 Oct 2026. In every one of the 9
cases the `136xxxx` run is in the LMS and the `120xxxx` twin is not
(`in_lms: false`), which accounts for all 9 `in_lms: false` rows.

So the portal's "23 upcoming" is 14 real classroom dates plus 9 duplicate
listings. Endpoint B reports SSG faithfully rather than silently de-duplicating.
When counting *classes*, group by `(start_date, end_date)`; when reconciling
against the portal, use the raw count. Flag same-date pairs for a human — the
stale `120xxxx` series probably wants deleting on the SSG side.
