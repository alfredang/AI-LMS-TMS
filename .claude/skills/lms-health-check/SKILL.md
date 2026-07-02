---
name: lms-health-check
description: Health, liveness & performance check of the production LMS-TMS site, with known auto-fixes. Use when asked to check if the site/prod is up, healthy, slow, or "loading forever", or to verify after a deploy/firewall change.
---

# LMS-TMS Health Check

Verify the production LMS-TMS is healthy, alive, and fast — and auto-fix the known DB-connectivity failure mode.

Infra specifics (SSH target, app container name) come from environment variables set in the **gitignored** `.claude/settings.local.json` (`LMS_DOMAIN`, `LMS_SSH_TARGET`, `LMS_APP_CONTAINER`). Never hardcode host IPs, container IDs, or credentials in this file.

## Step 1 — External checks (no credentials needed; work from anywhere)

Let `DOMAIN="${LMS_DOMAIN:-lms-tms.tertiaryinfotech.com}"`.

1. **Homepage:** `curl -sS -o /dev/null -w "%{http_code} %{time_total}s" --max-time 12 "https://$DOMAIN/"` → expect `200` in `< 3s`.
2. **DB-backed readiness (the key canary):**
   `curl -sS --max-time 12 "https://$DOMAIN/api/health"` → returns JSON.
   - **Parse the body**, not just the status. The endpoint currently returns HTTP **200 even when the DB is down** (known bug — see CLAUDE.md). Healthy = `"database":"connected"`.
   - A **~15s hang** on this call means the app→DB path is broken (the classic outage).

If both pass → report **healthy** and stop (when running on a schedule, stay silent unless state changed).

## Step 2 — Diagnose (only if the canary fails/hangs or `database` != `connected`)

Requires `LMS_SSH_TARGET` + `LMS_APP_CONTAINER`. SSH in (`ssh "$LMS_SSH_TARGET"`):

1. App container up? `docker ps --filter name=$LMS_APP_CONTAINER --format '{{.Status}}'`
2. App → DB reachable? `docker exec $LMS_APP_CONTAINER node -e "const n=require('net');const s=n.connect({host:'<db-host>',port:6433});s.setTimeout(5000);s.on('connect',()=>{console.log('OK');s.end()});s.on('timeout',()=>console.log('TIMEOUT'));s.on('error',e=>console.log('ERR '+e.message))"`
3. Firewall intact? `ufw status | grep -E '5432|5439|6433'` and `iptables -S DOCKER-USER`

## Step 3 — Known auto-fix (DB connectivity)

**Root cause of the 2026-07-01 outage:** a UFW `DENY` on the DB ports blocked the app container's hairpin path to the DB (UFW does not filter Docker-published ports for the internet, but *does* break the container's INPUT-chain hairpin). Fix:

```bash
ufw insert 1 allow from 10.0.0.0/8 to any port 6433 proto tcp   # + 5432, 5439 if present
```

If the internet-lockdown (`DOCKER-USER`) rules are missing after a Docker restart, re-apply: `/usr/local/sbin/lms-db-firewall.sh`.

Re-run Step 1 to confirm recovery.

## Step 4 — Performance snapshot (optional)

- API/page response times (`time_total` above) should be `< 1s` warm.
- On the server: `docker stats --no-stream $LMS_APP_CONTAINER` (CPU/mem), `uptime` (load), `df -h /` (disk).

## Reporting

- Scheduled/loop runs: report only on a **state change** (healthy→broken, broken→fixed, fix-failed). Stay quiet when healthy.
- Manual runs: give a short table (homepage, DB canary, response times) + any action taken.
