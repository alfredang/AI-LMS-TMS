# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

LMS/TMS for **Tertiary Infotech Academy** (Singapore IT training, UEN: 201509271W) — WSQ/IBF courses, trainers, learners, enrollments, SSG/TPGateway integration.

**Stack:** Next.js 16 (Pages Router) + React 18 + TypeScript 5 + Tailwind 3.4 + PostgreSQL 17 (raw SQL via `pg`, no ORM).

## Multi-tenant

Same codebase deployed for multiple tenants on **Coolify** (self-hosted, not Vercel). Tertiary uses a **Dockerfile** build pack; other tenants (Chariot, Intellisoft) use **Docker Compose**. Do not unify them.

**Tenant-specific behavior must never overwrite shared code.** Branch on tenant config (DB row, env var, or feature flag like `payroll_enabled` in `lib/payroll/featureFlag.ts`) — do not fork files, hardcode tenant names in shared logic, or tweak shared components for one tenant's UI. If a tenant needs different behavior, gate it; if it needs a different asset, load by tenant key.

## Workflow

**Scan `git status` at session start.** If pre-existing modified/untracked files relate to the current task, surface them and ask whether to include in the commit. Silently leaving them caused real prod drift (Payroll role broke on live because dependent files were never committed). Untracked files imported by tracked files will fail the live build.

**Test on localhost before pushing.** DB migrations: throwaway Postgres (`docker run --rm postgres:17-alpine`), load `database/01-schema.sql`, apply, diff, run twice for idempotency. UI: `npm run dev` and exercise it.

**"Live ≠ localhost":** check `git status` and `git log origin/main..HEAD` first — usually uncommitted/unpushed work, not a runtime bug.

## Commands

```bash
npm run dev          # Next.js 16, Turbopack — ALWAYS start localhost on port 3003 (override the default 3000), e.g. `npx next dev -p 3003` with the same env vars as the dev script
npm run build        # Production — explicitly --webpack
npm run lint
npm run type-check   # see caveat
npm run db:migrate
```

**`type-check` caveat:** `tsconfig.json` has `ignoreDeprecations: "6.0"` which tsc rejects (`TS5103`). Webpack build works. Don't remove the line without checking the TS 5.x deprecation suppressions.

## Architecture

- DB pool from `lib/db.ts` (max 5 conns, SSL in prod)
- Path aliases: `@components`, `@lib`, `@hooks`, `@contexts`, `@app-types`, `@styles`, `@utils`, `@/*`
- State: single `contexts/LmsContext.tsx` (~70 KB — scan, don't grep). Hooks in `/hooks/`.
- API routes: standard `NextApiRequest/Response` + method check + `pool.query()`.

### Authentication

- `bcryptjs` + **OTP** flow for first-time login / verification
- **DB-backed session tokens** (2026-08): login issues an opaque `lms_…` token; only its SHA-256 hash is stored in `user_session` (30-day expiry, revoked on logout/password change). Legacy `mock-jwt-token-*` values are rejected. Core: `lib/auth/session.ts`, `lib/auth/requireRole.ts`.
- **Every API route is wrapped in `withAuth()`/`withServiceAuth()`** (`lib/auth/withAuth.ts`) except an explicit public allowlist (login screen, OAuth callbacks, asset serving, webhook-token routes). `scripts/check-api-auth.js` (runs in `npm run lint`) fails if a new route ships without auth — add public routes to its allowlist deliberately.
- **Machine callers** (in-process scheduler, OpenClaw agents, other tenant systems) authenticate with `x-api-key: $EXTERNAL_API_KEY_FOR_CLAWDBOT` (or `SCHEDULER_SECRET`) on any route; `NEXT_PUBLIC_SCHEDULER_SECRET` is never accepted (client-bundle-exposed).
- **Client side**: `lib/clientAuthFetch.ts` (installed in `_app.tsx`) injects the Bearer header on every same-origin `/api/` fetch and clears auth + reloads on 401 — new fetch call sites need no auth code.

### Roles

7 roles (`UserRole` in `types/index.ts`): Admin, TrainingProvider, Finance, Payroll, Trainer, Developer, Learner. Each has a layout in `layouts/` and either a standalone sidebar (`components/<role>/<Role>Sidebar.tsx`) or one inlined into the layout. Per-role page enums in `types/index.ts`.

## Integrations

- **SSG / TPGateway** (`lib/ssg/`, `types/ssg.ts`) — publishing, enrollment, grants, claims. `training_provider.ssg_app_count` (1–4) + `ssg_app_names` jsonb edited under Training Provider profile.
- **Google APIs** (`lib/google-auth/`, `google-calendar/`, `google-drive/`) — OAuth, calendar sync, Drive storage, Gmail for cert emails.
- **QuickBooks** (`lib/quickbooks/`, `/pages/api/quickbooks/`) — invoices, payments.
- **Scheduler** (`lib/scheduler/scheduler.ts`) — `node-cron`, `Asia/Singapore`, config in `scheduler_config`. Singleton via `globalThis.__lmsScheduler`, initialized in `instrumentation.ts`.

## Database

- ~40 tables. Full schema: `database/01-schema.sql`.
- **Trainer assignment has two representations that must stay consistent:** `course_run_trainer` junction (canonical, many-to-many) and legacy scalars `assigned_trainer_id` / `tpg_assigned_trainer_id` on `course_run`. Writes update both.

## Production ops (prod host = same box as the DB)

**Architecture invariant:** only the LMS app connects to the database; **every other system (OpenClaw agents — Kael/Jarvis/Orion — Hermes, other tenant apps) exchanges data via the HTTPS API (443), never the DB directly.** Keep it that way — it's what makes DB network-hardening safe.

### DB connectivity outage runbook ("Checking your session…" hangs forever)
Symptom: homepage HTML loads, but `/api/health` hangs ~15s and the app logs `Connection terminated due to connection timeout` on every query. **The DB is fine; the app can't reach it.**
- **Root cause seen 2026-07-01:** a UFW `DENY` on the DB ports (6433/5432/5439) blocked the app **container's hairpin path** to the DB. Key gotcha: **UFW does NOT filter Docker-published ports from the internet** (Docker's DNAT bypasses UFW's INPUT), **but it DOES break the container→host-public-IP hairpin** (that path goes through INPUT). So a UFW DENY on a DB port secures nothing yet causes an outage.
- **Fix:** `ufw insert 1 allow from 10.0.0.0/8 to any port 6433 proto tcp` (+ 5432/5439). **Never put a plain `DENY` on the DB ports.**
- Or run `/loop`-style `/lms-fix-db`. Health canary: `/api/health` — but it currently returns HTTP **200 even when the DB is down**, so parse the JSON `database` field, not the status code.

### DB network security (the correct layer)
- Internet access to the DB is blocked at the **Docker layer** via `DOCKER-USER` (script `/usr/local/sbin/lms-db-firewall.sh`, persisted by `lms-db-firewall.service`), allowing internal `10/172.16` + an admin IP allowlist (`/etc/lms-db-allowed-ips.txt`). UFW cannot do this (bypassed by Docker).
- **Admin/DBA DB access is via SSH tunnel** (works from any IP; roaming-safe): `./scratch/db-tunnel.sh` → connect tools to `127.0.0.1:15432`. Do not re-expose the DB to the internet.
- **Never hardcode a DB connection string with a password** in any file — use `DATABASE_URL` from `.env.local` (gitignored). A live cred leaked via tracked `scratch/*` before; `scratch/` is now gitignored and a `PreToolUse` hook blocks the pattern.

## API security policy (forward-looking — apply to all new work)

- **Every data-mutating `pages/api/**` route MUST authenticate and authorize the caller** (`requireRole`/`getAuthedUser`) before any INSERT/UPDATE/DELETE/ALTER. No exceptions for admin/finance/ssg routes.
- Never `console.log` passwords, hashes, or tokens. Never ship an auth secret with a fallback default.
- Parameterize SQL with `$n`; only interpolate identifiers from server-defined allowlists.
- Detailed live findings + the phased remediation plan are in the **gitignored** `.claude/security-findings.md` (this repo is public — do not paste them into tracked files).

## Project tooling (`.claude/`)

- **Skills:** `/lms-health-check` (health/liveness/perf + known auto-fix), `/lms-security-scan` (TLS, headers, DB exposure, firewall integrity, secret hygiene).
- **Agents:** `lms-monitor` (scheduled health/perf/log monitor + DB auto-fix), `lms-security-scanner` (posture scan). Both sanitized; infra specifics come from env in the gitignored `.claude/settings.local.json`.
- **Commands:** `/lms-status` (quick snapshot), `/lms-fix-db` (outage runbook).
- **Hook:** `PreToolUse(Bash)` guard blocks `DROP/TRUNCATE` and writing inline DB creds to files (`.claude/hooks/guard-prod-db.sh`).
- **Ops env** (host/container/domain) lives in gitignored `.claude/settings.local.json`; sanitized tooling is pushed, secrets/infra are not.
