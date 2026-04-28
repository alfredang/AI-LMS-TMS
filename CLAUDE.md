# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

> **Note:** `NEMO.md` at the repo root is unrelated — it's the product spec for **Nemo**, the in-app AI assistant exposed to Admin/Training Provider users. Not to be confused with the emerging `AGENTS.md` convention (vendor-neutral coding-agent instructions); we don't use that file here.

## Platform Context

- **Company:** Tertiary Infotech Academy (Singapore-based IT training provider, UEN: 201509271W)
- **System:** LMS/TMS platform managing WSQ/IBF courses, trainers, learners, enrollments
- **Hosting:** Coolify (self-hosted PaaS), Docker containers — NOT Vercel
- **Database:** PostgreSQL 17, accessed via `pg` client with raw SQL (no ORM)

## Commands

```bash
npm run dev          # Start dev server (Next.js 16 uses Turbopack by default)
npm run build        # Production build — explicitly uses --webpack (Turbopack prod build not adopted)
npm run start        # Start production server
npm run lint         # ESLint
npm run type-check   # tsc --noEmit (see caveat below)
npm run db:migrate   # Run database migrations
npm run db:seed      # Seed database
```

**`type-check` caveat:** `tsconfig.json` has `ignoreDeprecations: "6.0"`, which tsc rejects with `TS5103: Invalid value for '--ignoreDeprecations'`. The webpack build doesn't go through this path, so it works. Don't "fix" the tsconfig by removing the line without checking what depends on the TS 5.x deprecation suppressions.

## Architecture

### Stack
- **Next.js 16** with **Pages Router** (`/pages/` and `/pages/api/`)
- React 18, TypeScript 5, Tailwind CSS 3.4 (class-based dark mode)
- PostgreSQL via `pool.query()` from `lib/db.ts` (max 5 connections, SSL in production)

### Path aliases (tsconfig)
`@components`, `@lib`, `@hooks`, `@contexts`, `@app-types`, `@styles`, `@utils`, plus `@/*` catch-all.

### State management
- Single React Context `contexts/LmsContext.tsx` wraps the whole app (large file, ~70 KB — expect to scan rather than grep)
- Data-fetching hooks in `/hooks/` (`useCourses`, `useProfile`, `useTrainerCourses`, `useDeveloperCourses`, `useTrainerProfile`, `useAppVersion`)

### Authentication
- JWT (`jsonwebtoken`) + bcrypt + OTP flow
- Endpoints under `/pages/api/auth/`
- 6 roles (`UserRole` in `types/index.ts`): Admin, TrainingProvider, Finance, Trainer, Developer, Learner

### Role-based layouts
Every role has a layout in `layouts/`. Some pair with a standalone sidebar component; others keep the sidebar inline:

| Layout | Sidebar |
|---|---|
| `AdminLayout` | `components/admin/AdminSidebar.tsx` |
| `TrainerLayout` | `components/trainer/TrainerSidebar.tsx` |
| `DeveloperLayout` | `components/developer/DeveloperSidebar.tsx` |
| `TrainingProviderLayout` | `components/training-provider/TrainingProviderSidebar.tsx` |
| `FinanceLayout` | *(inline in the layout file)* |
| `LearnerLayout` | *(inline in the layout file)* |

All sidebars — standalone or inline — follow the same collapsible icon-rail pattern: expanded by default, collapsed shows icons only, toggle at the top.

### API route pattern
```typescript
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  // pool.query() for DB, return JSON
}
```
Hundreds of endpoints under `/pages/api/` follow this shape. `GET` is the other common method.

### Key enums (`types/index.ts`)
`View` (top-level navigation), `UserRole`, `AdminPage`, `TrainerPage`, `DeveloperPage` (per-role routing within a dashboard).

## Key Integrations

### SkillsFuture Singapore (SSG/TPG)
- `lib/ssg/` — course publishing, enrollment submission, grant/claim management
- Types in `types/ssg.ts`
- TPGateway API for trainer assignment and course run management

### Google APIs
- `lib/google-auth/` — OAuth + token management
- `lib/google-calendar/` — class schedule sync
- `lib/google-drive/` — file storage, profile images
- Gmail API for sending certificates (PDF attachments generated from Google Slides templates)

### QuickBooks (`lib/quickbooks/`)
- Invoice sync, OAuth flow, customer/estimate/payment helpers
- Proxy endpoints under `/pages/api/quickbooks/`

### AI Services
- **Gemini** (`lib/services/geminiService.ts`) — public-facing chatbot and content generation
- **Nemo AI Agent** (`lib/nemo-tools.ts`) — in-app assistant for Admin/TrainingProvider. Built on the Claude Agent SDK with ~20 tools. Persistent memory read/appended by `lib/nemo-memory.ts`, persisted to `data/nemo-memory.md`. Full spec in `NEMO.md`.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) powers Nemo, CP Generator, Courseware Generator, and SEO Metadata Generator. **Always authenticate by passing `env: buildClaudeEnv(token)` from `lib/anthropic-auth.ts`** — the `apiKey` SDK option is no longer supported. The helper auto-routes `sk-ant-oat*` (subscription tokens from `claude setup-token`) to `CLAUDE_CODE_OAUTH_TOKEN`, everything else to `ANTHROPIC_API_KEY`, and strips conflicting auth env vars so stale Coolify values can't shadow the token. Tokens live in `training_provider_api` under `key_name = 'ANTHROPIC_API_KEY'` regardless of actual type. Localhost works without env vars because the CLI reads `~/.claude/.credentials.json`; Docker/Coolify has no such file.

### Web Scraping
- **Firecrawl** (`firecrawl-mcp`) — public-page scraping for trainer-profile enrichment (LinkedIn, personal sites). API key stored in `training_provider_api` under `key_name = 'FIRECRAWL_API_KEY'`. Configured as an MCP server in `.mcp.json` for Claude Code dev sessions; reads the key from `FIRECRAWL_API_KEY` shell env. UI for editing the key lives under **Training Provider profile → Credentials → Firecrawl**.

### Scheduler (`lib/scheduler/scheduler.ts`)
- `node-cron` with `Asia/Singapore` timezone
- Config stored in the `scheduler_config` table
- Singleton pattern via `globalThis.__lmsScheduler` to prevent duplicate firing under hot reload
- Initialized in `instrumentation.ts` on production server startup
- Admin API at `/pages/api/admin/scheduler.ts` (GET/PUT/POST)
- ~14 registered tasks: certificate generation, enrollment sync to SSG, Google Calendar sync, confirmation emails, trainer invitations, data sanitization, etc.

## Key Workflows

1. **Course lifecycle:** Course Application → Course Run creation → Trainer Assignment → Enrollment → Attendance → Assessment → Certificate
2. **Billing:** Proforma Invoice → SkillsFuture Credit → Invoice → Payment → Receipt
3. **SSG:** Course publishing on TPGateway → Enrollment submission → Grant application → Claim submission
4. **Certificates:** Auto-generated daily at 6:30 PM SGT for course runs ended within the last 7 days, requires ≥60% attendance (configurable), rendered from a Google Slides template and emailed as PDF

## Database

- Raw SQL via `pool.query()` from `lib/db.ts`
- ~40 tables. Key ones: `app_user`, `course`, `course_run`, `enrollment`, `trainer_profile`, `course_session`, `course_attendance`, `ssg_claims`, `ssg_grants`, `billing_history`, `scheduler_config`, `auto_create_certificates_log`, `training_provider_api`
- Full schema in `database/01-schema.sql`
- **Trainer assignment has two representations that must stay consistent:** the `course_run_trainer` junction table (many-to-many, canonical) and legacy scalar columns `assigned_trainer_id` / `tpg_assigned_trainer_id` on `course_run`. Writes typically update both.

## File Uploads

- Multer with disk storage to `public/uploads/{type}/` (destination picked by form field name)
- 5 MB limit; accepts PDF, DOC, DOCX, PPT, PPTX, TXT, images
- Public URL rewrite `/uploads/*` → `/api/uploads/*` configured in `next.config.js`

## Docker

- `docker-compose.yml` at root: Next.js app + PostgreSQL 17
- `node:20-alpine`, Next.js `output: 'standalone'`
- Ports: **3003** (app), **6434** (host) → 5432 (Postgres in container)
- Named volumes: `postgres_data`, `uploads_data`, `nemo_data`

## Development MCP servers (`.mcp.json`)

Project-scoped MCP servers loaded by Claude Code in this repo:
- **playwright** — `@playwright/mcp` — browser automation (visual testing, scraping authenticated pages). The npm `playwright` dep in `package.json` is separate and used by `scripts/refresh-linkedin-profile-images-playwright.mjs`.
- **firecrawl** — `firecrawl-mcp` — public-page scraping. Reads `FIRECRAWL_API_KEY` from the shell env; canonical value lives in `training_provider_api`.

`.playwright-mcp/` and `.playwright-cli/` are gitignored MCP/CLI session artifacts (page snapshots, console logs) — safe to delete; they regenerate on use.

## One-shot import scripts

`scripts/` holds re-runnable, idempotent data backfills. Recent ones for trainer profile enrichment from the legacy TMS Google Sheet:
- `import-cv-folder-urls-v3.js` — fills `trainer_profile.cv_folder_url` from sheet column `CV` (matches by email then name; only updates rows where the field is NULL/empty).
- `import-trainer-skill-tags.js` — fills `trainer_profile.skills_tags` from `Domain + Skill Sets` and `certification_tags` from `Certifications`; deduped, max 5 each; skips trainers who already have non-empty `skills_tags`.

Both default to dry-run; pass `--apply` to write to DB.
