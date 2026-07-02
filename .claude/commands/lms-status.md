---
description: Quick production status snapshot of the LMS-TMS (homepage, DB readiness, response times).
---

Give me a quick production status snapshot of the LMS-TMS. Run the `lms-health-check` skill (external checks are enough for a snapshot — no need to SSH unless something is down):

1. Homepage `https://${LMS_DOMAIN:-lms-tms.tertiaryinfotech.com}/` — HTTP status + response time.
2. `/api/health` — parse the JSON body; report `database` = connected/disconnected (it returns 200 even when the DB is down, so trust the body).
3. Note response times.

Report a compact table: check | result | timing. If anything is unhealthy, offer to run the full `lms-health-check` (which can SSH in and auto-fix the known DB-connectivity issue). Don't take any fixing action from this command unless I ask.
