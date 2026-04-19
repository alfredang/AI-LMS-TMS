# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Platform Context

- **Company:** Tertiary Infotech Academy (Singapore-based IT training provider, UEN: 201509271W)
- **System:** LMS/TMS platform managing WSQ/IBF courses, trainers, learners, enrollments
- **Hosting:** Coolify (self-hosted PaaS), Docker containers — NOT Vercel
- **Database:** PostgreSQL 17 via `pg` client (raw SQL, no ORM)

## Commands

```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build (uses --webpack flag)
npm run start        # Start production server
npm run lint         # ESLint
npm run type-check   # TypeScript check (tsc --noEmit)
npm run db:migrate   # Run database migrations
npm run db:seed      # Seed database
```

Note: `type-check` currently has a pre-existing tsconfig error (`ignoreDeprecations: "6.0"`) that causes tsc to fail. The build command uses webpack and works independently.

## Architecture

### Framework & Stack
- **Next.js 16 with Pages Router** (`/pages/` and `/pages/api/`)
- **React 18** with TypeScript 5
- **Tailwind CSS 3.4** with dark mode (class-based)
- **PostgreSQL** — direct `pool.query()` via `lib/db.ts` (max 5 connections, SSL in production)

### Path Aliases (tsconfig)
`@components`, `@lib`, `@hooks`, `@contexts`, `@app-types`, `@styles`, `@utils`

### State Management
- Single React Context: `contexts/LmsContext.tsx` (large file, wraps entire app)
- Custom hooks in `/hooks/` for data fetching (useTrainerCourses, useProfile, useCourses, etc.)

### Authentication
- JWT-based auth with bcrypt password hashing
- OTP support, multi-role system
- Auth endpoints in `/pages/api/auth/`
- 6 roles: Admin, TrainingProvider, Finance, Trainer, Developer, Learner

### Role-Based Layouts
Each role has a dedicated layout (`layouts/`) and sidebar (`components/{role}/`):
- `AdminLayout` → `AdminSidebar`
- `TrainerLayout` → `TrainerSidebar`
- `LearnerLayout` (inline nav)
- `DeveloperLayout` → `DeveloperSidebar`
- `FinanceLayout` → `FinanceSidebar`
- `TrainingProviderLayout` → `TrainingProviderSidebar`

All sidebars follow the same collapsible icon-rail pattern: expanded by default, collapsed shows only icons, toggle arrow at top.

### API Route Pattern
```typescript
// Standard pattern across all 340+ endpoints
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  // ... pool.query() for DB, return JSON
}
```

### Key Enums
- `View` — navigation views
- `UserRole` — role enum
- `AdminPage`, `TrainerPage`, `DeveloperPage` — page routing within each role
- All defined in `types/index.ts`

## Key Integrations

### SkillsFuture Singapore (SSG/TPG)
- `lib/ssg/` — course publishing, enrollment submission, grant/claim management
- TPGateway API for trainer assignment and course run management
- Types in `types/ssg.ts`

### Google APIs (`lib/google-auth/`, `lib/google-calendar/`, `lib/google-drive/`)
- Google Slides → PDF certificate generation
- Gmail API for sending certificates with PDF attachments
- Google Calendar sync for class scheduling
- Google Drive for file storage

### QuickBooks (`lib/quickbooks/`)
- Invoice sync and management
- OAuth 2.0 flow (connect + callback endpoints)
- Proxy endpoints in `/pages/api/quickbooks/`

### AI Services
- **Nemo AI Agent** (`lib/nemo-tools.ts`) — Claude Agent SDK with 20+ tools for system operations, persistent memory in `data/nemo-memory.md`
- **Gemini** (`lib/services/geminiService.ts`) — chatbot and content generation
- **Claude Agent SDK** — CP Generator and SEO metadata generator (use `apiKey` option, not env vars)

### Scheduler (`lib/scheduler/scheduler.ts`)
- node-cron with Asia/Singapore timezone
- Config stored in `scheduler_config` DB table
- Singleton via `globalThis.__lmsScheduler` to prevent duplicate firing
- Initialized in `instrumentation.ts` on production server startup
- Admin API: GET/PUT/POST at `/api/admin/scheduler`
- 14+ scheduled tasks (certificates, enrollment sync, calendar sync, etc.)

## Key Workflows

1. **Course Lifecycle:** Course Application → Course Run creation → Trainer Assignment → Enrollment → Attendance → Assessment → Certificate
2. **Billing:** Proforma Invoice → SkillsFuture Credit → Invoice → Payment → Receipt
3. **SSG:** Course publishing on TPGateway → Enrollment submission → Grant application → Claim submission
4. **Certificates:** Auto-generated at 6:30 PM SGT daily for course runs ended within 7 days, requires ≥60% attendance (configurable), generated from Google Slides template

## Database

- Raw SQL queries via `pool.query()` from `lib/db.ts`
- 30+ tables: `app_user`, `course`, `course_run`, `enrollment`, `trainer_profile`, `course_session`, `course_attendance`, `ssg_claims`, `ssg_grants`, `billing_history`, `scheduler_config`, `auto_create_certificates_log`, etc.
- Schema in `database/01-schema.sql`
- Junction table pattern: `course_run_trainer` for many-to-many trainer assignments (alongside legacy scalar columns `assigned_trainer_id`, `tpg_assigned_trainer_id`)

## File Uploads

- Multer with disk storage to `public/uploads/{type}/`
- Dynamic destination based on form field name
- Max 5MB, supported: PDF, DOC, DOCX, PPT, PPTX, TXT, images
- URL rewrite: `/uploads/*` → `/api/uploads/*`

## Docker

- `docker-compose.yml` at root — Next.js app + PostgreSQL 17
- Node 20-alpine, standalone output mode
- Ports: 3003 (app), 6434 (DB)
- Volumes: postgres_data, uploads_data, nemo_data
