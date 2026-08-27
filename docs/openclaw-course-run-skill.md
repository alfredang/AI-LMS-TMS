# OpenClaw Course Run Skill

The procedure an OpenClaw agent follows when asked about missing course runs, and
the API it calls to create them.

Base URL: `https://<lms-domain>`
Auth: `x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>` on every request.

**Delivery:** agents do not read this file. Paste the plain-text block at the
bottom into the agent's WhatsApp group addressed `@~Kael` and ask it to confirm
it saved. This file is the master copy — keep it in step with the endpoints, and
re-send when it changes.

Proven working 27 Aug 2026: Kael created SSG run `1421562` (TGS-2021005538,
19–20 Sep 2026) from a WhatsApp request.

---

## Endpoints

| Purpose | Call |
|---|---|
| What is missing, and why | `GET /api/external/wsq-schedule-gap` |
| One course only | `GET /api/external/wsq-schedule-gap?course_code=TGS-…` |
| Preview / submit | `POST /api/external/wsq-submit-runs` |
| Outcome of a submission | `GET /api/external/wsq-sync-status` |

### Do not use

| Endpoint | Why |
|---|---|
| `/api/external/create-course-run` | **Broken.** Builds a payload in a shape SSG rejects — see the notice at the top of that file. Fails safely; creates nothing. |
| `/api/external/auto-sync-wsq-schedule` | Daily cron. Skips any date that has ever failed. |
| `/api/external/auto-retry-wsq-blocked` | Weekly cron. Retries only eligibility failures. |

Measured 26 Aug 2026: of 712 genuinely submittable dates, the two crons between
them would pick up **4**. They are schedules, not tools for a user request.

---

## Why the gap endpoint never returns a bare number

On 26 Aug 2026 the storefront carried 1,815 future dates with no matching run.
Only 712 could actually be submitted. A single figure invites an agent to submit
all of them, so every date is bucketed by what is blocking it, and each bucket
carries the action a human would have to take.

| Bucket | Meaning | Who resolves it |
|---|---|---|
| `submittable_now` | Ready | The agent, after a yes |
| `past_funding_end` | Start date is after the course's funding support period ends; SSG will reject it | A person, with SSG — funding renewal |
| `no_session_timing` | No session timing template, so no sessions can be built | A person, in Course Session Timing |
| `no_wsq_funding` | No readable funding window. CASL and IBF land here **even when funded** | Unknown — must not be reported as blocked |
| `course_not_in_lms` | The storefront code matches no course at all | A person — create the course |

---

## Safety model

The rules below are also enforced in `wsq-submit-runs`, deliberately. A rule that
lives only in a skill file is one the model can talk itself out of.

1. **Dry run by default.** Without `"confirm": true` nothing is submitted.
2. **Eligibility re-derived server-side**, never trusted from the caller.
3. **SSG is asked what it already holds** before anything is sent, and the whole
   request is refused if SSG cannot be reached. The local `course_run` table is
   not a reliable mirror of SSG — verified on TGS-2026064861, where SSG held 9
   published runs and the LMS knew about 1.

---

## Background the agent needs

**Renewal codes.** SSG issues a new course reference number when funding is
renewed, and the storefront switches to it immediately. `TGS-2026064861` and
`TGS-2022014978` are the same course. The endpoints resolve this; the
`resolved_course_code` field shows which course a storefront code maps to.

**Sessions.** Created when a run is confirmed, not when it is created. A
"session not created" warning on a new run is expected and is not an error.

**Duplicates.** Never submit a date "to make sure" — SSG may already hold a run
the LMS cannot see, and the result would be a duplicate in a government system.

---

## The message to send

Copy everything below into the agent's WhatsApp group.

```text
@~Kael Please store this as your procedure for course runs, replacing anything you currently have about creating them. Confirm when saved.

SKILL: WSQ / CASL COURSE RUNS

Use this whenever someone asks about missing course runs, course dates, or the course schedule — "check the course runs", "are we missing classes", "create the missing course runs".

Auth: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT> on every call.

THE ONE RULE
Look, report, ask, then act. Never act first.

ENDPOINTS
1. See what is missing and why:
   GET /api/external/wsq-schedule-gap
   One course: GET /api/external/wsq-schedule-gap?course_code=TGS-...
2. Preview or submit:
   POST /api/external/wsq-submit-runs
3. What happened:
   GET /api/external/wsq-sync-status

DO NOT USE these for a user request:
- /api/external/create-course-run — sends a payload shape SSG rejects. Known broken as of 27 Aug 2026.
- /api/external/auto-sync-wsq-schedule and /auto-retry-wsq-blocked — scheduled jobs that filter on the failure log; they skip almost everything the gap reports as submittable.

PROCEDURE

Step 1 — Ask what the situation is
GET /api/external/wsq-schedule-gap
Returns headline, totals and buckets. Each bucket has an "action" field saying what a human must do. Read that action. Do not invent one.

Step 2 — Report in three parts, never as one number
- Submittable: can go to SSG now
- Blocked: a person must act first
- Unknown: cannot tell (CASL/IBF funding this check cannot read)
Name the blockers with counts. "988 dates across 105 courses are past their funding end and need an SSG renewal" is useful. "1083 blocked" is not.

Step 3 — Preview before asking
POST /api/external/wsq-submit-runs WITHOUT "confirm". It returns would_submit and rejected, and sends nothing.

Step 4 — Ask, and show your work
Never ask someone to approve a number. A confirmation request must contain:
- the course title and code
- EVERY date you would create, listed
- how many you are skipping and why
- the venue and the session times
- then the question
If more than about 15 dates, show ten, say how many more, offer the full list.
The person saying yes is accountable for what gets published to a government system. Give them enough to say no.

Step 5 — Submit only what was agreed
POST /api/external/wsq-submit-runs
{"course_code":"TGS-2026064861","confirm":true}
or
{"items":[{"course_code":"...","start_date":"2026-09-19","end_date":"2026-09-20"}],"confirm":true}
The endpoint re-checks every date itself and returns anything it refused in "rejected", with a reason. Report those rejections. Do not quietly drop them.

Step 6 — Report the outcome, and only after checking
Submission runs in the background. It is NOT done when the call returns.
GET /api/external/wsq-sync-status?job_id=<job_id>
Wait for job.status = completed, then report submitted, already_existed, ssg_errors, skipped, and any failure_groups.
Never report success from the submit call alone. It only means the job started.

RULES
- Never submit a blocked date. If the gap endpoint did not put it in submittable_now, the endpoint will refuse it anyway.
- Never submit without a yes, even if told to "do everything". The endpoint enforces this too: without "confirm": true it does nothing.
- Never retry an eligibility failure. "Outside support period" / "not eligible" means SSG refused on funding grounds. Retrying cannot change that. Say it needs a funding renewal.
- Never quote the storefront price as the funded price. Use /api/external/course-info.
- Say "I don't know" rather than guessing. The unknown bucket exists because CASL and IBF funding cannot currently be read. Report it as unknown, not blocked and not fine.
- One course at a time. Current policy while this is new; will be relaxed to bulk later. Keep offering one first until told otherwise.
- Report to whoever asked. Do not tag or escalate to a named person, even when the fix is clearly someone else's job.
- Your job ends at submission. Do not confirm the run, create sessions, or assign a trainer, and do not tell the user those are outstanding. A "session not created" warning on a new run is expected and is not an error.

BUCKETS AND WHO FIXES THEM
- submittable_now — ready. You, after a yes.
- past_funding_end — start date is after the course funding period ends. SSG will reject it. A person must renew funding with SSG.
- no_session_timing — no session timing template, so no sessions can be built. A person sets it in Course Session Timing.
- no_wsq_funding — no readable funding window. CASL and IBF land here even when funded. Report as UNKNOWN, not blocked.
- course_not_in_lms — the storefront code matches no course. A person must create the course.

BACKGROUND
Renewal codes: SSG issues a NEW course reference number when funding is renewed and the storefront switches to it at once. TGS-2026064861 and TGS-2022014978 are the same course. The endpoints resolve this; the resolved_course_code field shows which course a storefront code maps to.

Duplicates: SSG can already hold runs the LMS does not know about. Never submit a date "to make sure" — you would create a duplicate in a government system. Only submit what submittable_now lists. The endpoint checks SSG before submitting and refuses the whole request if SSG cannot be reached.

Please confirm you have updated your memory/skills accordingly.
```

---

## Known gaps

- The agent's formal "skill activation" needs an approval route WhatsApp does not
  provide. The memory copy works regardless.
- Bulk submission across many courses will hit SSG rate limiting — the duplicate
  check makes one SSG call per course with no pacing. One course at a time until
  that is addressed.
- `wsq-submit-runs` submits through `run-sync`, which uses a single hardcoded
  venue rather than cloning per course.
