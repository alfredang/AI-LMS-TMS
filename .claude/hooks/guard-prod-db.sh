#!/usr/bin/env bash
# PreToolUse(Bash) guard for the LMS-TMS project.
# Blocks two high-risk patterns that could damage prod or leak creds:
#   1. Catastrophic DB ops: DROP DATABASE / DROP TABLE / TRUNCATE
#   2. Hardcoding a Postgres connection string (with inline password) INTO a file
#      — this is exactly how a live DB credential leaked onto the public repo (2026-07-01).
# Everything else is allowed. Read-only queries, DELETE/UPDATE with WHERE, etc. pass through.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(((j.tool_input||{}).command)||"")}catch(e){}})' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$1"
  exit 0
}

low="$(printf '%s' "$cmd" | tr 'A-Z' 'a-z')"

# 1. Catastrophic DB operations
if printf '%s' "$low" | grep -qE 'drop[[:space:]]+database|drop[[:space:]]+table|truncate[[:space:]]+(table[[:space:]]+)?[a-z_"]'; then
  deny '"Blocked by guard-prod-db: DROP DATABASE/TABLE or TRUNCATE detected. Destructive schema/data changes must be run manually with a fresh backup and explicit confirmation — not through an automated command."'
fi

# 2. Hardcoding a DB connection string with an inline password into a file
if printf '%s' "$cmd" | grep -qE 'postgres(ql)?://[^ ]*:[^ @/]+@' \
   && printf '%s' "$cmd" | grep -qE '(>>?|[[:space:]]tee[[:space:]]|cat[[:space:]]*>)'; then
  deny '"Blocked by guard-prod-db: writing a Postgres connection string with an inline password into a file. Use DATABASE_URL from .env.local (gitignored) instead — inline DB creds have leaked onto the public repo before."'
fi

exit 0
