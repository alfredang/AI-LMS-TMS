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
npm run dev          # Next.js 16, Turbopack
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
- **No real JWT** — `pages/api/auth/login.ts` returns placeholder `mock-jwt-token-${user.id}`; session held in `LmsContext`, re-checked against DB. No `JWT_SECRET`.

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
