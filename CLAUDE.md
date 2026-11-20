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

**A push to `main` is a production deploy, and the build runs on the app + DB host.** For 5–10 minutes the live app can lose DB connections (OTP sign-in and self-registration fail with "timeout exceeded when trying to connect"). So: one change set = one push, never stack pushes, and do not deploy while a class session is running unless the user explicitly agrees. `.claude/hooks/guard-live-deploy.sh` blocks `git push` to main when a deploy is already queued/running or a session is in progress; its override (`LMS_DEPLOY_OK=1` prefix) is for the user's go-ahead only. When a class is live, prefer a data fix or wait for the break.

**"Who is in this class" has one rule — `classMemberSql()` in `lib/enrolment/classMembership.ts`; do not re-derive it per screen.** A learner joins a class through any of three sources, each enough on its own: self-registration (sign-in help form, SWDA Enrolment QR form, manual enrolment), digital attendance (marked present in the run), or an SWDA/TPGateway enrolment. Only *Admin Removed* / *Withdrawn* takes a learner off. *Cancelled* describes the TPGateway enrolment (staff cancel and re-create them mid-class), so a Cancelled row still counts when the learner attended or self-registered. The grading roster (`pages/api/trainer/class-students.ts`) and the learner's class list (`pages/api/courses/enrolled.ts`) use it; any new roster, class list, certificate or assessment query must too (call `ensureClassMembershipTables()` first). 2026-11-19: 18 of 32 learners vanished from grading and lost their class mid-session because each screen filtered `Cancelled` on its own.

**A Virtual or Hybrid class's Google Meet link must match its Google Calendar event (user rule, 2026-11-21).** The class's own calendar event (matched by the `course_run_calendar_event` mapping or `Course Run ID: <id>` in the description, never by title) is the only source of the Meet link: `course_run.virtual_meeting_link` is read from it, not typed or generated separately. `lib/calendar/meetLinkRule.ts` holds the check; `pages/api/trainer/update-virtual-meeting-link.ts` rejects a Google Meet link that is not the event's, and the calendar sync (`pages/api/external/sync-google-calendar.ts`) overwrites a differing link and reports `meet_link_not_on_calendar`. To give a class a Meet link, add the Meet to its calendar event and tag the title `[HYBRID]` or `[VIRTUAL]`; any new code that writes a Meet link must go through the same check. 2026-11-21: a duplicate run (1200356, no longer on SSG) held the Meet link while the real run (1361797) showed Physical with none.

**Never close registration for an active course (user rule, 2026-11-20).** The SSG availability status (`course.course_availability_status`, `lib/ssg/courseAvailabilityRules.ts`) is information only: it must not hide a course, close its registration or drop it from a feed, here or on the storefront (ai-mms, which enforces the same rule with `scripts/audit/check-registration-open.sh`, an edit hook and its push gate). When SSG has no future run for an enabled website course, the storefront's answer to the daily availability sync lists it under `runs_needed`, and `lib/ssg/courseRunsNeeded.ts` publishes that course's website schedule to TPGateway through the WSQ schedule sync and emails staff (`COURSE_RUNS_NEEDED_RECIPIENTS`, else `FUNDING_REMINDER_RECIPIENTS`). The fix for "no course run on SSG" is always to add the run, never to close registration.

## Commands

```bash
npm run dev          # Next.js 16, Turbopack — ALWAYS start localhost on port 3003 (override the default 3000), e.g. `npx next dev -p 3003` with the same env vars as the dev script
npm run build        # Production — explicitly --webpack
npm run lint
npm run type-check   # see caveat
npm run check:design-tokens   # no new raw colour classes (also in lint/build)
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

### Design system (one shared style set — no page-level colours)

- **Tokens** in `styles/globals.css` (`@layer base`): RGB-channel CSS variables, one light set (ai-mms back-office palette) and one dark set with the same names, all text ≥4.5:1. **Default preference is System** (follows the device) for all users; an explicit Light/Dark choice from Profile → Appearance or the header toggle is stored in localStorage `lmsThemePreference` (the old auto-written `trainingProviderTheme` key is dropped). Pre-paint in `pages/_document.tsx` mirrors `utils/colorUtils.ts`. `tailwind.config.js` maps them as `rgb(var(--c-x) / <alpha-value>)`, so every variant works.
- **Use**: `bg-background`, `bg-surface` / `bg-surface-elevated` / `hover:bg-surface-hover`, `text-on-surface` / `text-on-surface-secondary` / `text-muted`, `border-default` (cards) / `border-strong` (inputs), `text-primary` / `bg-primary` / `text-on-primary`, status `text-success|warning|danger|info` + `bg-*-bg`.
- **Shared classes** (`@layer components`): `.card` `.card-header` `.page-title` `.btn` + `.btn-primary|outline|secondary|ghost|danger` `.input` `.table` `.tabs`/`.tab`/`.tab-active` `.chip-*` `.pill-role-*` `.nav-item`/`.nav-item-active` `.view-as-pill` `.icon-btn-round`. Primitives in `components/ui/` (Button, Card, Tabs, Badge, Alert) are built on them.
- **Brand colour** (tenant `training_provider` colour scheme): `utils/colorUtils.ts` `applyPrimaryColor` keeps the hue and adjusts the shade per theme for contrast; re-applied on every theme switch. Never hardcode a tenant colour.
- **Guardrail**: `scripts/check-design-tokens.js` (in `npm run lint` and `npm run build`) fails if a file gains raw `gray/slate/white/black/[#hex]` colour classes (baseline `scripts/design-tokens-baseline.json`, which may only go down; `--update` after migrating a file). Deliberate exceptions (always-white document previews, the dark login panel) carry `// design-tokens-allow`.
- **Visual check**: `scripts/ui-theme-sweep.mjs` screenshots every role's key screens in light and dark against the local DB copy and counts axe-core colour-contrast violations (usage in its header).

### Roles

7 roles (`UserRole` in `types/index.ts`): Admin, TrainingProvider, Finance, Payroll, Trainer, Developer, Learner. Each has a layout in `layouts/` and either a standalone sidebar (`components/<role>/<Role>Sidebar.tsx`) or one inlined into the layout. Per-role page enums in `types/index.ts`.

## Integrations

- **SSG / TPGateway** (`lib/ssg/`, `types/ssg.ts`) — publishing, enrollment, grants, claims. `training_provider.ssg_app_count` (1–4) + `ssg_app_names` jsonb edited under Training Provider profile.
- **Google APIs** (`lib/google-auth/`, `google-calendar/`, `google-drive/`) — OAuth, calendar sync, Drive storage, Gmail for cert emails.
- **QuickBooks** (`lib/quickbooks/`, `/pages/api/quickbooks/`) — invoices, payments.
- **Tertiary Exams / AI Exam** (`lib/practiceExam/examsApi.ts`, `/pages/api/practice-exam/{course-run,course}.ts`, `components/trainer/PracticeExamPanel.tsx`, `components/developer/CoursePracticeExamSetting.tsx`) — class page → **Practice Exam** section (after Lesson): trainers register the class's learners **and its trainers** (name + email) via the exams `POST /api/v1/registrations`, which creates the account and records Course Run ID / Register Date / "Registered from TMS". A **Self-Register** button shows a QR code to the public `/practice-exam/[runId]` form (`pages/api/public/practice-exam-register.ts`, keyed by the class UUID, rate limited) where learners register themselves. A course is linked to its exam (`course.practice_exam_code`, e.g. TGS-2026061312 → CCAR-F) in the course editor → Course Settings → Practice Exam. Token (scope `assign:practice-exams`) + site URL live in Company Settings → Integrations → **AI Exam** (`training_provider.exams_api_token` / `exams_api_url`, staff-only in the profile API); `EXAMS_API_TOKEN` / `EXAMS_API_URL` env are the fallback. Off without a token.
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

- **Skills:** `/lms-health-check` (health/liveness/perf + known auto-fix), `/lms-security-scan` (TLS, headers, DB exposure, firewall integrity, secret hygiene), `/daily-log` (every session: log production issues diagnosed/fixed to `.claude/daily-logs/YYYY-MM-DD.md`, gitignored; retrieve on request — "today's log", "what did we fix on <date>").
- **Agents:** `lms-monitor` (scheduled health/perf/log monitor + DB auto-fix), `lms-security-scanner` (posture scan). Both sanitized; infra specifics come from env in the gitignored `.claude/settings.local.json`.
- **Commands:** `/lms-status` (quick snapshot), `/lms-fix-db` (outage runbook).
- **Hooks:** `PreToolUse(Bash)` guards — `.claude/hooks/guard-prod-db.sh` blocks `DROP/TRUNCATE` and writing inline DB creds to files; `.claude/hooks/guard-live-deploy.sh` blocks a push to `main` while a deploy is running or a class is in session (needs `LMS_SSH_TARGET`, `LMS_DB_CONTAINER`, `LMS_COOLIFY_APP_UUID` in the ops env). Both parse the hook input with `/usr/bin/python3` (node is not on PATH in the hook shell).
- **Ops env** (host/container/domain) lives in gitignored `.claude/settings.local.json`; sanitized tooling is pushed, secrets/infra are not.
