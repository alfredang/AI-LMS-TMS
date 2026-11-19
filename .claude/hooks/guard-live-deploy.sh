#!/usr/bin/env bash
# PreToolUse(Bash) guard: a push to main deploys production.
#
# The production build runs on the same host as the live app and its database.
# While it runs (5-10 min) the app can lose its DB connections: OTP sign-in and
# self-registration fail with "timeout exceeded when trying to connect"
# (2026-11-19: three pushes in 25 minutes during a class, ~10 min of failed sign-ins).
#
# This hook stops `git push` to main when
#   1. a deployment is already queued or in progress (never stack builds), or
#   2. a class session is running right now (learners are signing in / submitting).
# After the USER has explicitly agreed to deploy anyway, re-run the push with the
# prefix  LMS_DEPLOY_OK=1  (e.g. `LMS_DEPLOY_OK=1 git push origin main`).
#
# Infra specifics come from the environment (gitignored .claude/settings.local.json
# or .env.local): LMS_SSH_TARGET, LMS_DB_CONTAINER, LMS_COOLIFY_APP_UUID.
# If the host cannot be reached the hook lets the push through with a warning.
set -uo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | /usr/bin/python3 -c 'import json,sys
try: print((json.load(sys.stdin).get("tool_input") or {}).get("command") or "")
except Exception: pass' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Only real pushes.
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push([[:space:]]|$)' || exit 0
printf '%s' "$cmd" | grep -qE -- '--dry-run|[[:space:]]-n([[:space:]]|$)' && exit 0
printf '%s' "$cmd" | grep -q 'LMS_DEPLOY_OK=1' && exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
# Production deploys from main: a push that names main, or a bare push while on main.
if ! printf '%s' "$cmd" | grep -qE '(^|[[:space:]:/])main([[:space:]]|$)' && [ "$branch" != "main" ]; then
  exit 0
fi

envval() { # value from the environment, else .claude/settings.local.json, else .env.local
  local name="$1" v="${!1:-}"
  if [ -z "$v" ] && [ -f "$root/.claude/settings.local.json" ]; then
    v="$(/usr/bin/python3 -c 'import json,sys
try: print((json.load(open(sys.argv[1])).get("env") or {}).get(sys.argv[2],""))
except Exception: pass' "$root/.claude/settings.local.json" "$name" 2>/dev/null || true)"
  fi
  if [ -z "$v" ] && [ -f "$root/.env.local" ]; then
    v="$(grep -E "^${name}=" "$root/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
  fi
  printf '%s' "$v"
}

target="$(envval LMS_SSH_TARGET)"
dbc="$(envval LMS_DB_CONTAINER)"
app="$(envval LMS_COOLIFY_APP_UUID)"

say() { # non-blocking note back to the model
  /usr/bin/python3 -c 'import json,sys
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":sys.argv[1]}}))' "$1"
  exit 0
}
deny() {
  /usr/bin/python3 -c 'import json,sys
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.argv[1]}}))' "$1"
  exit 0
}

if [ -z "$target" ] || [ -z "$dbc" ] || [ -z "$app" ]; then
  say "guard-live-deploy: LMS_SSH_TARGET / LMS_DB_CONTAINER / LMS_COOLIFY_APP_UUID not set, so the live-class check did not run. A push to main deploys production: confirm no class is running and no deploy is in progress before pushing."
fi

out="$(ssh -o BatchMode=yes -o ConnectTimeout=6 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 "$target" \
  "APP='$app' DBC='$dbc' bash -s" 2>/dev/null <<'REMOTE'
docker exec -i coolify-db psql -U coolify -d coolify -At -F'|' <<SQL | sed 's/^/DEPLOY|/'
SELECT left(commit,8), status FROM application_deployment_queues
WHERE application_id = (SELECT id::text FROM applications WHERE uuid='$APP')
  AND status IN ('queued','in_progress') AND created_at > now() - interval '45 minutes';
SQL
docker exec -i "$DBC" psql -U postgres -d postgres -At -F'|' <<'SQL' | sed 's/^/CLASS|/'
SELECT cr.course_run_id, left(c.title, 60), s.start_time || '-' || s.end_time,
       (SELECT count(*) FROM enrollment e WHERE e.course_run_id = cr.id
          AND COALESCE(e.enrolment_status,'') NOT IN ('Admin Removed','Withdrawn'))
FROM course_session s
JOIN course_run cr ON cr.id = s.course_run_id
JOIN course c ON c.id = cr.course_id
WHERE NOT COALESCE(s.deleted, false)
  AND cr.class_status IS DISTINCT FROM 'Cancelled'
  AND replace(s.start_date,'-','') <= to_char(now() AT TIME ZONE 'Asia/Singapore','YYYYMMDD')
  AND replace(s.end_date,'-','')   >= to_char(now() AT TIME ZONE 'Asia/Singapore','YYYYMMDD')
  AND s.start_time <= to_char((now() AT TIME ZONE 'Asia/Singapore') + interval '30 minutes','HH24:MI')
  AND s.end_time   >= to_char((now() AT TIME ZONE 'Asia/Singapore') - interval '15 minutes','HH24:MI')
ORDER BY 3;
SQL
echo "DONE|"
REMOTE
)"

if ! printf '%s\n' "$out" | grep -q '^DONE|'; then
  say "guard-live-deploy: could not reach the production host, so the live-class check did not run. A push to main deploys production: confirm no class is running and no deploy is in progress before pushing."
fi

deploys="$(printf '%s\n' "$out" | grep '^DEPLOY|' | cut -d'|' -f2- | tr '\n' ';' | sed 's/;$//')"
classes="$(printf '%s\n' "$out" | grep '^CLASS|' | sort -t'|' -k5,5nr | awk -F'|' '$5 > 0 {n++; t+=$5; if (n<=3) top = top sprintf("%s %s (%s, %s learners); ", $2, $3, $4, $5)} END {if (n) printf "%d session(s), %d learner(s) in total. Largest: %s", n, t, top}')"

if [ -n "$deploys" ]; then
  deny "Blocked by guard-live-deploy: a production deployment is already running or queued (${deploys}). Stacked builds starve the live app of database connections (OTP and self-registration fail). Wait for it to finish, then push everything as ONE push. Do not override without the user's explicit go-ahead (prefix LMS_DEPLOY_OK=1)."
fi
if [ -n "$classes" ]; then
  deny "Blocked by guard-live-deploy: a class is in session right now: ${classes}A push to main starts a 5-10 minute production build on the same host, during which learners may fail to sign in, register or submit. Commit locally and push after the session, or ask the user; only if they explicitly agree to deploy now, re-run with the prefix LMS_DEPLOY_OK=1 and put every pending fix in that single push."
fi
exit 0
