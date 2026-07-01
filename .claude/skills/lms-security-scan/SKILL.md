---
name: lms-security-scan
description: Security posture scan of the production LMS-TMS (TLS, headers, exposed DB ports, firewall integrity, secret leaks). Use when asked to security-check/harden the site or verify the hardening is still in place.
---

# LMS-TMS Security Scan

Check the production LMS-TMS security posture and flag regressions. Read-only by default; only re-assert firewall rules when explicitly allowed. Infra specifics come from the gitignored `.claude/settings.local.json` env (`LMS_DOMAIN`, `LMS_SSH_TARGET`). Never hardcode secrets/host IPs here.

Let `DOMAIN="${LMS_DOMAIN:-lms-tms.tertiaryinfotech.com}"`.

## A. External / TLS (no credentials)

1. **TLS cert expiry:** `echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN":443 2>/dev/null | openssl x509 -noout -enddate` → warn if `< 21 days` to expiry.
2. **HTTPS redirect:** `curl -sS -o /dev/null -w "%{http_code} %{redirect_url}" http://$DOMAIN/` → expect `301/302` → `https://`.
3. **Security headers:** `curl -sSI "https://$DOMAIN/"` → check for `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`/CSP. Report any missing (recommendations, not failures).
4. **DB port NOT internet-reachable:** from a non-whitelisted network, TCP-connect to the DB port (6433) on the host → **must be refused/timeout**. (From a whitelisted admin IP it will connect — that's expected.)

## B. Server-side (requires LMS_SSH_TARGET)

SSH in (`ssh "$LMS_SSH_TARGET"`):

1. **Docker-layer DB lockdown present:** `iptables -S DOCKER-USER` must contain the `DROP` for `5432,5439,6433` plus the internal-subnet + admin-allowlist `RETURN`s. If missing (e.g. after a Docker restart), re-apply `/usr/local/sbin/lms-db-firewall.sh` (persisted via the `lms-db-firewall.service` systemd unit).
2. **UFW sanity:** DB ports must have `allow from 10.0.0.0/8` (so the app hairpin works). **Never** add a plain `DENY` on the DB ports — it breaks the app without securing anything (Docker bypasses UFW). See CLAUDE.md runbook.
3. **Blocked-connection log:** `dmesg | grep 'LMS-DB-BLOCKED' | tail` — if a *legitimate* admin IP shows up blocked, add it to `/etc/lms-db-allowed-ips.txt` and re-run the firewall script (or tell them to use the SSH tunnel).

## C. Repo secret hygiene

1. No secrets in tracked files: `git grep -nIE "postgres://[^ ]*:[^ @]+@|BEGIN (RSA|OPENSSH|PRIVATE)|sk-ant-|AKIA[0-9A-Z]{16}"` on the tracked tree → must be empty (env-var *prefix checks* like `startsWith('sk-ant')` are OK).
2. `scratch/` must stay gitignored (it has held live DB creds historically).

## D. Application-layer (reference — see gitignored `.claude/security-findings.md`)

Detailed app-code findings (API auth model, etc.) live in the **gitignored** `.claude/security-findings.md` — do not publish them. When reviewing new API routes, apply the policy in CLAUDE.md: **every data-mutating `pages/api/**` route MUST authenticate/authorize the caller before any write.**

## Reporting

Group findings by severity. For scheduled runs, alert only on a **new** or **regressed** finding (e.g. TLS now expiring, DB port re-exposed, firewall rule dropped, a secret committed). Stay quiet when the posture is unchanged and healthy.
