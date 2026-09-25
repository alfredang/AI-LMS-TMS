---
name: daily-log
description: Maintain and retrieve Femina's daily log of LMS production issues investigated and fixed — one markdown file per calendar day under .claude/daily-logs/. Use whenever she asks for "today's log", "the daily log", "what did we fix today/yesterday/on <date>", or similar — read and show that date's file. Also use these rules proactively every session to log new fixes as they happen, not just when explicitly invoked for retrieval.
---

# Daily Log

Femina's running log of production issues diagnosed and fixed each session,
kept as one file per calendar day (Asia/Singapore) at:

```
.claude/daily-logs/YYYY-MM-DD.md
```

This directory is gitignored (`.claude/*` is excluded except an explicit
allowlist) — safe to reference live course codes, run IDs, trainer/learner
names and emails without worrying about it landing in the public repo.

## Writing entries (do this every session, unmarked/unprompted)

Any time something gets diagnosed and/or fixed against the live LMS —
a Tael report discrepancy, a data mismatch, a sync gap, a duplicate run,
a reschedule, a calendar fix, an SSG/TPGateway issue, a missing-enrolment
gap, etc. — append an entry to **today's** file. This is not limited to
changes committed/pushed to git: production DB fixes, live API calls,
calendar reconciles, scheduled-job triggers, and UI-driven fixes Femina
does herself while being guided all count. Skip pure Q&A/explanation that
changed no state.

- Create the day's file the first time something needs logging that day,
  with a `# YYYY-MM-DD` heading at the top.
- Append entries as the session goes — don't wait until the end to batch
  them, since long sessions can get compacted and early context lost.
- If a session picks up an item from a previous day's still-open list,
  update that item's status in place (or add a new entry cross-referencing
  it) rather than leaving stale "still open" text that's no longer true.

### Entry format

One `## <short topic — course / trainer / run id>` heading per issue:

```markdown
## <topic>

- **Status:** Fixed | Investigated — no action needed | Still open / pending
- **What:** the symptom as reported (Tael report line, screenshot, user description)
- **Root cause:** one or two sentences
- **Fix:** what was actually done — which run UUIDs/SSG run IDs/course codes
  were touched, and how (direct API call, admin UI by Femina, scheduled job,
  reverted, etc.). If still open, say what's blocking it and whose turn it is.
```

Keep entries terse — this is a work log, not a polished report. Plain
markdown, no design pass needed.

## Retrieving a log

When Femina asks for "today's log", "the daily log", "what did we fix
today", or names a specific date — read `.claude/daily-logs/<date>.md`
(default to today, Asia/Singapore, if no date given) and show its contents
directly. Don't summarize or compress unless she asks you to — she wants
the actual log. If the file doesn't exist for that date, say so plainly
rather than fabricating or reconstructing entries from memory.
