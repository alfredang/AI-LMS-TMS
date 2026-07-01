---
description: Diagnose and fix the LMS-TMS "Checking your session…" / DB-connectivity outage (the known firewall failure mode).
---

The LMS-TMS is hanging on "Checking your session…" or otherwise can't reach its database. Diagnose and fix using the known runbook. Requires `LMS_SSH_TARGET` + `LMS_APP_CONTAINER` from `.claude/settings.local.json`.

## Confirm the failure mode
1. `curl --max-time 12 "https://${LMS_DOMAIN:-lms-tms.tertiaryinfotech.com}/api/health"` — a ~15s hang or `"database":"disconnected"` confirms it. (Homepage HTML still loads even when the DB is down — that's expected.)
2. SSH in; `docker exec $LMS_APP_CONTAINER node -e "…connect to DB port 6433…"` — TIMEOUT confirms the app→DB path is blocked.

## Root cause (from the 2026-07-01 incident)
A UFW `DENY` on the DB ports (6433/5432/5439) blocks the app container's hairpin path to the DB. UFW does **not** filter Docker-published ports for the internet, but it **does** break the container's INPUT-chain hairpin — so a DENY there causes an outage while securing nothing.

## Fix
```bash
ufw insert 1 allow from 10.0.0.0/8 to any port 6433 proto tcp   # + 5432, 5439 if present
```
If the internet-lockdown (`DOCKER-USER`) rules are missing (e.g. after a Docker restart), re-apply: `/usr/local/sbin/lms-db-firewall.sh`.

## Verify
Re-run `/api/health` → `"database":"connected"`, `<1s`. Confirm `docker exec $LMS_APP_CONTAINER` → DB reaches in ~1ms and the container log shows `Connected to PostgreSQL database`.

Never DENY the DB ports in UFW again, and never rotate/expose the DB as part of this fix. Report what you found and did.
