# AI-LMS-TMS

<p align="center">
  <strong>A comprehensive Learning Management System (LMS) and Training Management System (TMS) with AI capabilities, designed for Singapore's SkillsFuture training ecosystem.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?logo=tailwind-css" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Google_AI-Gemini-4285F4?logo=google" alt="Google AI" />
</p>

<p align="center">
  <a href="https://ai-lms-tms.tertiaryinfo.tech/"><img src="https://img.shields.io/badge/Demo-Live%20Site-success?style=for-the-badge" alt="Live Demo" /></a>
  <a href="https://alfredang.github.io/AI-LMS-TMS/"><img src="https://img.shields.io/badge/Docs-GitHub%20Pages-blue?style=for-the-badge&logo=github" alt="Documentation" /></a>
</p>

---

<p align="center">
  <img src="public/screenshots/login-screen-v3.png" alt="AI-LMS-TMS Login Screen" width="800" />
</p>

---

## Overview

AI-LMS-TMS is a **full-stack, enterprise-grade web application** that manages the complete training lifecycle - from course creation and scheduling to learner enrollment, progress tracking, assessments, and certification. Built with modern technologies and deep integration with Singapore's SkillsFuture ecosystem, it provides a seamless experience for training providers, trainers, and learners.

### Why AI-LMS-TMS?

- **AI-Powered Learning**: Nemo AI agent (Claude Agent SDK) with persistent memory and tool use, SEO metadata generator, plus Gemini chatbot and GenAI authoring tools
- **SSG Integration**: Full SkillsFuture Singapore API support for course runs, enrolments, assessments, grants, and claims
- **Multi-Role System**: 7 roles with dedicated dashboards — Learner, Trainer, Admin, Developer, Finance, Payroll, Training Provider
- **Multi-Tenant**: Same codebase deployed for multiple tenants on Coolify — Tertiary builds via **Dockerfile**, other tenants (Chariot, Intellisoft) build via **Docker Compose**
- **Financial Operations**: QuickBooks integration, personal/company invoice workflows, grant calculators, claim tracking, billing history
- **Singapore-Ready**: NRIC/FIN validation, UEN verification, WSQ/IBF course support, funding calculations
- **Automation**: Task Scheduler, webhooks, n8n workflows for trainer invitations, certificate generation, enrollment sync, and more
- **Support System**: Built-in ticket system for learner, trainer, and admin support
- **Workflow Guides**: Interactive documentation for all system workflows (Training, Admin, Finance)
- **External API**: 200+ REST endpoints including external integrations for third-party bots
- **Modern Stack**: Next.js 16, TypeScript, Tailwind CSS, PostgreSQL, Docker, deployed on Coolify

---

## Table of Contents

- [Features](#features)
- [User Roles](#user-roles)
- [Technology Stack](#technology-stack)
- [API Documentation](#api-documentation)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)

## Features

### Learner Features
- Course browsing and enrollment
- Progress tracking through learning units and subtopics
- Assessment submission and grade viewing
- AI chatbot for personalized course assistance
- Certificate download upon completion
- Job search integration
- Calendar view for scheduled classes

### Trainer Features
- View assigned classes (upcoming, ongoing, completed)
- Digital attendance (eAttendance) tracking
- Assessment grading with rubric support
- Past attendance and assessment history
- Training hours tracking
- Lesson delivery guide and assessment guide
- **Ed Tools** — Suite of interactive educational tools:
  - [Ice Breaker](https://alfredang.github.io/ice-breaker/) — Fun activities to engage learners
  - [Pinboard](https://alfredang.github.io/pinboard/) — Collaborative idea sharing board
  - [Break Timer](https://alfredang.github.io/musical-timer-countdown/) — Musical countdown timer
  - [Word Cloud](https://alfredang.github.io/wordcloud/) — Real-time word clouds
  - [Flash Cards](https://alfredang.github.io/flashcard/) — Interactive learning flash cards
  - [Live Q&A](https://alfredang.github.io/live-qna/) — Real-time question and answer board
  - [Whiteboard](https://alfredang.github.io/whiteboard/) — Interactive drawing and annotations
  - [Padlet](https://alfredang.github.io/padlet/) — Collaborative wall for posting notes, links, and media
  - [Collaborative Note](https://alfredang.github.io/collabnote/) — Shared real-time notes
  - [Collaborative Flow](https://alfredang.github.io/collabflow/) — Visual workflow collaboration
  - [Collaborative Kanban](https://alfredang.github.io/kanban/) — Shared kanban task board
  - [Live Poll](https://alfredang.github.io/livepoll/) — Real-time polling and voting
  - [MindMaps](https://alfredang.github.io/mindmapping/) — Collaborative mind mapping
  - [Spinning Wheel](https://alfredang.github.io/spinning-wheel/) — Random selection spinner
  - [5 Whys](https://alfredang.github.io/5whys/) — Root cause analysis tool
  - [Fishbone Diagram](https://alfredang.github.io/fishbone/) — Cause-and-effect (Ishikawa) diagram
  - [Pareto Chart](https://alfredang.github.io/paretochart/) — Identify the most significant factors
  - [System Thinking](https://alfredang.github.io/systemloop/) — Feedback loop visualisation
  - [Mock Data Generator](https://alfredang.github.io/mockdatagen/) — Generate sample datasets
- **Virtual Collaboration Tools** — Google Meet, Microsoft Teams, Zoom
- **Data Analytics Tools** — [Pivot Visualization](https://alfredang.github.io/novapivot/)
- **Statistics Tools** — Descriptive, Correlation, Regression, Hypothesis, Chi-Square, ANOVA ([NovaStats](https://alfredang.github.io/novastats/))
- **Design of Experiments (DOE)** — Full Factorial, Fractional Factorial, Taguchi, Central Composite, Box-Behnken, Plackett-Burman, Latin Square, Response Surface ([NovaDOE](https://alfredang.github.io/novadoe/))
- **Statistical Process Control (SPC)** — c Chart, u Chart, np Chart, p Chart, X-mR Chart, X̄-R Chart, X̄-s Chart, Distribution, Process Capability ([NovaSPC](https://alfredang.github.io/novaspc/))
- **Finance Tools** — [Tax Calculator](https://alfredang.github.io/novataxsg/), [Financial Planning & Analysis](https://alfredang.github.io/novafinance/), [Financial Ratio Calculators](https://alfredang.github.io/novafinancialratiocalculator/)
- **Sustainability Tools** — [Carbon Footprint Calculator](https://alfredang.github.io/sgcarboncalculator/)
- **GenAI Tools** — Curated links to ChatGPT, Gemini, Claude, and UI design tools (Figma, Stitch)
- **Agentic AI Tools** — No/Low Code Platforms (AgentX, Opal, Relevance AI, n8n, Langflow, Flowise), Voice Agents (ElevenLabs, Retell AI, Vapi), Video Agents (HeyGen, Synthesia)

### Admin Features
- **Admin Dashboard** — KPI cards: Ongoing Classes, Upcoming Classes, Completed Classes, Assigned Trainers (Local), Missing Trainers (Local/TPG)
- **Workflow Guides** — Interactive documentation organized by category (Training, Admin, Finance) with 10+ workflow guides including SSG Process Steps
- **Support Tickets** — Ticket management system for handling learner, trainer, and user support requests
- **Calendar & Scheduler** — View and manage training calendar, search by course code/title/name/date
- **Course Management** — View courses, trainers, funding validity
- **Class Management** — View learners, manage upcoming/ongoing/completed classes, assign trainers and learners, search past learners
- **Direct Application** — Upload, view, and manage direct applications
- **TPG Management (SkillsFuture)**
  - Course Run: Create, search, view, upload, delete course runs; manage sessions and attendance
  - Enrolment: Enroll learners, bulk upload, search/view/update/cancel enrolments, manage fees
  - Assessment: Submit, update, search, and view SSG assessments
  - Grant: Search grants and view grant status
- **Certificate Management** — Create, delete, and send certificates (SG and GH variants) with configurable CC email lists
- **Reference Links** — Configurable external links (Master List, TMS, FMS, MMS, TPMS)
- **n8n Links** — Quick access to n8n workflow hosts
- **Useful Links** — Quick access to Magento backend and other tools

### Finance Features
- **Financial Dashboard** — Grants and Claims overview with KPIs: Total Grants, Total Estimated, Total Approved
- **FMS (n8n) Automation** — View All Course Runs, Process Enrolments, Manual Enrolment, Create Enrolments For Error Status, Employer Enrolment, Append Cancelled Class Trainees, Update Assessment, Process Grants, Update Grant Status & Total Grant, Grant Query, Direct Application, Check Duplicates for DA, Update Claim ID
- **TPG Management** — Full SSG course run, enrolment, session, attendance, assessment, grant, and claim management
- **Claim Management** — Search, view, upload, and cancel SSG claims; track outstanding claims
- **QuickBooks Integration** — OAuth2 proxy supporting query, create, send, delete, void, pdf, read actions on estimates, invoices, and payments
- **Bizfile Integration** — Company profile, key dates, address, SSIC, capital, shareholders lookup
- **Workflow Guides** — Billing History, Proforma Invoice, Personal Invoice, Company Invoice, Receipt workflows
- **Useful Links** — Quickbooks, Vendors@gov, GeBiz, Bizfile quick access

### Invoice Workflows
- **Personal Invoice Workflow**
  1. Create enrollment and grant on SSG
  2. Retrieve Enrolment ID and Grant ID from SSG
  3. Trigger QuickBooks to generate invoice and send to learner
  4. Download PDF to Google Drive
  5. Record in learner's billing history
- **Company Invoice Workflow**
  1. Send Excel template to company contact
  2. Receive completed Excel file
  3. Upload Excel file to TMS
  4. Create enrollment and grant for each record on SSG
  5. Retrieve Enrolment ID and Grant ID from SSG
  6. Trigger QuickBooks consolidated invoice and send to company contact
  7. Download PDF to Google Drive
  8. Record in company contact's billing history

### Developer Features
- Course content creation and editing
- Assessment authoring with multiple assessment methods (Written, Practical, Case Study, Role Play, Oral Questioning, Project, Assignment)
- Learning unit and subtopic management
- Course material uploads (lesson plans, slides, guides)
- **SEO Metadata Generator** — AI-powered SEO metadata generation for WSQ and non-WSQ courses using Claude Agent SDK
  - WSQ: Meta title (with WSQ prefix), keywords, description with 70% funding subsidy, course description, and 20 job roles
  - Non-WSQ: Region-specific meta titles (Singapore, Malaysia with HRD Corp, International), keywords, description, course description, and 20 job roles

### Training Provider Features
- **Training Dashboard** — Organization overview and statistics
- **Workflow Guides** — Interactive workflow documentation organized by category (Training, Admin, Finance)
- **Course Management** — Full course catalog and course run management
- **User Management** — Add, remove, and manage users; assign/update roles; enable/disable accounts
- **Role Management** — Manage admin-level accounts and role assignments
- **Finance Management** — Access to all finance features (grants, claims, QuickBooks, billing)
- **Company Setting**
  - Company profile (name, UEN, address, logo, color scheme)
  - Contact person management
  - **Integrations** — Virtual meeting provider selection, course-run meeting links override the company default, Google (Calendar, OAuth, Certificate Folder), Zoom OAuth meeting generation, n8n, Magento, Reference Links
  - **SSG Authentication** — SSG certificate, private key, and encryption key (with support for App1, App3, App4 credentials)
  - **LLM Credentials** — Anthropic, OpenAI, Gemini, MiniMax, Kimi, DeepSeek with default and fallback provider selection
  - **Security Settings** — OTP login, default OTP, force first password change, default password, sensitive data masking
  - **Admin Settings** — Auto-send pro-forma invoices, confirmation emails, invoices on grant success, receipts, certificates, thank-you emails
  - **Gaming Settings** — Leaderboard and points system toggles
  - **Funding Settings** — Normal/enhanced funding rates, GST configuration
  - **Document Templates** — Proforma invoice, invoice, receipt, and certificate templates (text IDs or file uploads)
- **SSG API Summary** — Full summary of SSG API endpoints and their status
- **API Endpoints** — Built-in interactive API documentation covering all 200+ endpoints
- **Task Scheduler** — Schedule and manage automated tasks (auto-create certificates, auto-send emails, sync operations)
- **Webhooks** — Configure and monitor webhooks with webhook logs for debugging
- **Email Templates** — OTP, Certificate, Feedback, Password Reset, Trainer Invitation, Trainer Accept/Decline, Final Class Confirm, Class Confirm, Privacy Policy, Acceptable Use Policy
- **Useful Links** — SSG API Portal, SSG Developer quick access

### Learner Support Features
- **Help & Support** — Built-in support ticket system where learners can raise new tickets for course, connectivity, session, or payment issues
- **Contact Information** — Direct access to company address, hotline (+65 6100 0613), support email (enquiry@tertiaryinfotech.com), and opening hours

### AI-Powered Features
- **Nemo AI Agent** — Claude Agent SDK-powered operational assistant with:
  - Persistent memory via Markdown files and Claude skills (`.claude/skills/nemo-agent/SKILL.md`)
  - Role-based tool access (read-only for learners, full access for admin/finance/training provider)
  - 18 tools including dashboard queries, course run search, trainer management, enrollment operations, proforma/invoice generation, QuickBooks operations, SSG course operations
  - Agentic tool-use loop (up to 10 iterations per request)
- **SEO Metadata Generator** — Claude-powered SEO content generation for WSQ and non-WSQ courses
- **AI Chatbot** — Gemini-powered chatbot for learner assistance on public landing page
- **GenAI Authoring** — AI content generation for course development
- **Quiz Generator** — AI-generated quizzes based on course content

### Automation Features
- **Task Scheduler** — Schedule and run automated tasks: Auto Create Certificates, Auto Send Course Confirmation, Auto Create Learners, Auto Create Assessment Records, etc.
- **Webhook System** — Configure webhooks with full logging for external integrations
- **Trainer Invitation Workflow** — Automated cascading trainer invitations with accept/decline webhooks; if a trainer declines, system auto-sends to next available trainer
- **Certificate Workflow** — Auto-generate certificates after class completion, upload to Google Drive, and email to learners
- **Auto-Create Learners** — Automatically creates learner accounts for course runs starting today (via n8n)
- **Auto-Assign Trainers** — Bot-driven trainer assignment with fallback logic
- **Course Run Date Sync** — Automatic synchronization of dates with SSG
- **Enrolment Backfill** — Batch sync of enrollment data from SSG
- **Auto-Send Emails** — Configurable auto-send for proforma invoices, confirmation emails, invoices, receipts, certificates, and thank-you emails

### Singapore-Specific Features
- **SSG API Integration** - Full SkillsFuture Singapore API support
  - Course run management (create, view, edit, delete, publish)
  - Session and attendance management
  - Enrolment synchronization
  - Assessment submission and updates
  - Grant search and status tracking
  - SSG data encryption/decryption
- **WSQ/IBF Course Support** - Support for WSQ, IBF, and non-WSQ funded courses
- **Funding Calculations** - Normal (50%/70%), enhanced (MCES), and GST calculations
- **Singapore ID Validation** - NRIC/FIN and UEN verification

## User Roles

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| **Learner** | Course participants | Enroll in courses, track progress, submit assessments, download certificates, raise support tickets |
| **Trainer** | Course instructors | View assigned classes, take attendance, grade assessments, access Ed Tools and GenAI tools |
| **Developer** | Course developers | Create and edit course content, assessments, learning materials, SEO metadata generation |
| **Admin** | System administrators | Full class management, trainer/learner assignment, TPG management, certificate generation, ticket system, workflow guides |
| **Finance** | Financial operations | Financial dashboard, FMS automation, QuickBooks, claims, grants, personal/company invoice workflows, Bizfile lookup |
| **Payroll** | Trainer payout operations | Manage payout tiers, per-class trainer payouts, approval workflow, payout history (gated by `payroll_enabled` feature flag) |
| **Training Provider** | Organization admins | Company settings, user/role management, finance management, scheduler, webhooks, email templates, API documentation |

## Technology Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 16 (Pages Router, TypeScript) |
| **Frontend** | React 18, Tailwind CSS |
| **Database** | PostgreSQL 17 |
| **Authentication** | bcryptjs password hashing + OTP flow (no JWT — session held client-side and re-checked against DB) |
| **AI Integration** | Claude Agent SDK, Anthropic SDK, Google Generative AI (Gemini), OpenAI, MiniMax, Kimi, DeepSeek |
| **Finance Integration** | QuickBooks Online (OAuth2), Bizfile API |
| **File Uploads** | Multer, Google Drive API |
| **Email** | Nodemailer (Gmail OAuth2) |
| **Password Hashing** | bcryptjs |
| **Icons** | Lucide React |
| **Database Client** | pg (node-postgres) |
| **Container** | Docker, Docker Compose |
| **Deployment** | Coolify (self-hosted) |
| **Automation** | n8n workflows, Task Scheduler, Webhooks |
| **E-commerce** | Magento integration |

## API Documentation

### External APIs (x-api-key authenticated)

```
POST /api/external/assign-trainer         # Assign trainer to course run
POST /api/external/unassign-trainer       # Remove trainer from course run
GET  /api/external/get-course-run         # Get course run details
GET  /api/external/list-course-runs       # List course runs (with filters)
GET  /api/external/list-trainers          # List trainers (with filters)
POST /api/external/auto-create-learners   # Auto-create learner accounts
POST /api/external/sync-course-run-dates  # Sync dates with SSG
GET  /api/external/backfill-enrollments   # Preview enrollment backfill
POST /api/external/backfill-enrollments   # Execute enrollment backfill
```

### Authentication

```
POST /api/auth/login              # Login (password or OTP)
POST /api/auth/send-otp           # Send OTP to email
PUT  /api/auth/update-password    # Update user password
```

### Courses & Course Runs

```
GET  /api/courses/list            # List all courses
GET  /api/courses/detail          # Get course details
POST /api/courses/create-course   # Create course (multipart)
POST /api/admin/save-course-run   # Create/update course run
GET  /api/admin/search-course-runs # Search course runs
POST /api/admin/import-course-run # Import from SSG
```

### Enrolments

```
POST /api/enrolment/create        # Create enrolment
GET  /api/enrolment/search        # Search enrolments
GET  /api/enrolment/view          # View enrolment details
PUT  /api/enrolment/update        # Update enrolment
POST /api/enrolment/cancel        # Cancel enrolment
POST /api/enrolments/bulk-create  # Bulk create enrolments
```

### Assessments & Grading

```
POST /api/assessments/publish     # Publish assessment
POST /api/submissions/submit      # Submit assessment
POST /api/grading/update-grading  # Grade submission
POST /api/assessments/ssg-create  # Create SSG assessment
PUT  /api/assessments/ssg-update  # Update SSG assessment
```

### User Management

```
POST /api/admin/create-learner-account       # Create learner
POST /api/admin/add-trainer                  # Add trainer
POST /api/admin/assign-all-roles             # Assign roles to user
POST /api/training-provider/update-user-roles # Update user roles
POST /api/training-provider/delete-user      # Disable user
POST /api/admin/bulk-upload-courses          # Bulk import courses
POST /api/admin/bulk-upload-trainers         # Bulk import trainers
```

Full interactive API documentation with example requests/responses is available in-app under **Training Provider > API Endpoints**.

## Project Structure

```
ai-lms-tms/
├── components/                 # React components
│   ├── admin/                  # Admin dashboard & management
│   ├── trainer/                # Trainer views & tools
│   ├── training-provider/      # Training provider management
│   ├── ssg/                    # SSG API integration views
│   ├── ui/                     # Reusable UI components
│   ├── common/                 # Shared components
│   ├── LoginScreen.tsx         # Authentication screen
│   ├── AiChatbot.tsx           # Gemini-powered chatbot
│   ├── CourseDetail.tsx         # Course detail view
│   ├── GradingView.tsx         # Assessment grading
│   └── ...
│
├── pages/                      # Next.js pages & API routes
│   ├── api/
│   │   ├── admin/              # Admin operations (~58 endpoints)
│   │   ├── external/           # External bot APIs (8 endpoints)
│   │   ├── auth/               # Authentication (7 endpoints)
│   │   ├── courses/            # Course management (17 endpoints)
│   │   ├── enrolment/          # Enrolment operations
│   │   ├── assessments/        # Assessment CRUD & SSG
│   │   ├── grading/            # Grading system
│   │   ├── trainer/            # Trainer operations
│   │   ├── training-provider/  # TP management (13 endpoints)
│   │   ├── profile/            # User profiles
│   │   ├── ssg/                # SSG API proxies
│   │   ├── ai/                 # AI endpoints
│   │   ├── upload/             # File uploads
│   │   └── grants/             # Grant management
│   ├── _app.tsx
│   └── index.tsx               # Main SPA entry
│
├── lib/                        # Core libraries
│   ├── services/               # Business logic services
│   │   ├── authService.ts      # Authentication logic
│   │   ├── certificateService.ts # Certificate generation
│   │   ├── geminiService.ts    # AI integration
│   │   └── ...
│   ├── ssg/                    # SSG API utilities
│   ├── config.ts               # Environment configuration
│   └── db.ts                   # PostgreSQL connection pool
│
├── contexts/                   # React context (LmsContext)
├── types/                      # TypeScript definitions
├── database/                   # SQL schema & migrations
├── scripts/                    # Utility scripts
├── styles/                     # Global CSS
└── public/                     # Static assets & uploads
```

## Database Schema

### Entity Relationship Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    app_user     │────>│  user_role_map  │     │ training_provider│
│  (Core User)    │     │   (Roles)       │     │   (Tenant)      │
└────────┬────────┘     └─────────────────┘     └────────┬────────┘
         │                                               │
    ┌────┴────┬────────────┬────────────┐               │
    v         v            v            v               │
┌────────┐┌────────┐┌───────────┐┌───────────┐         │
│learner ││trainer ││ developer ││   admin   │         │
│_profile││_profile││ _profile  ││ _profile  │         │
└───┬────┘└───┬────┘└───────────┘└───────────┘         │
    │         │                                         │
    v         v                                         │
┌─────────────────┐     ┌─────────────────┐            │
│   enrollment    │────>│    course_run   │<───────────┘
│ (User<>Course)  │     │  (Scheduled)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │              ┌────────┴────────┐
         │              v                 v
         │       ┌─────────────┐   ┌─────────────┐
         │       │   course    │   │  assessment │
         │       │ (Template)  │   │   (Tests)   │
         │       └──────┬──────┘   └──────┬──────┘
         │              │                 │
         │       ┌──────┴──────┐         │
         │       v             v         │
         │ ┌──────────┐ ┌──────────┐     │
         │ │ learning │ │  subtopic│     │
         │ │  _unit   │ │          │     │
         │ └──────────┘ └──────────┘     │
         │                               │
         └───────────────────────────────┘
                        │
                 ┌──────┴──────┐
                 v             v
          ┌───────────┐ ┌───────────┐
          │submission │ │assessment │
          │  (Files)  │ │  _grade   │
          └───────────┘ └───────────┘
```

### Core Tables

| Table | Description |
|-------|-------------|
| `app_user` | Core user accounts with email, password hash, and profile |
| `user_role_map` | Maps users to roles (Learner, Trainer, Admin, Developer, Finance, Payroll, Training Provider) |
| `training_provider` | Organization settings, templates, integrations, and security config |
| `training_provider_member` | User membership in training provider organizations |
| `course` | Course templates with metadata, materials, funding info, and assessment methods |
| `course_run` | Scheduled course instances with dates, trainers, and digital attendance |
| `enrollment` | Learner enrollments with progress, payment, and sponsorship tracking |
| `assessment` | Course assessments (Written, Practical, Case Study, Role Play, etc.) |
| `submission` | Learner assessment submissions |
| `learning_unit` | Course chapters/modules |
| `subtopic` | Individual learning topics within units |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 17+
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/alfredang/AI-LMS-TMS.git
   cd AI-LMS-TMS
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

4. **Set up the database**
   ```bash
   # Run schema migration
   psql -f database/01-schema.sql

   # Seed initial data (optional)
   psql -f database/02-data-clean-fixed.sql
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

   The application will be available at `http://localhost:3000`

## Environment Variables

Create a `.env.local` file with the following variables:

```env
# Database Connection
DATABASE_URL=postgresql://user:password@host:port/database

# Application URLs
NEXT_PUBLIC_BASE_URL=http://localhost:3000
BASE_URL=http://localhost:3000

# Google Gemini AI
NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY=your-gemini-api-key

# SSG API Integration
SSG_API_BASE_URL=https://api.ssg-wsg.sg

# External API Authentication
EXTERNAL_API_KEY_FOR_CLAWDBOT=your-external-api-key
```

## Deployment

### Coolify (Multi-Tenant)

The same codebase is deployed across multiple tenants on **Coolify** (self-hosted PaaS — not Vercel, not Nixpacks). Pushes to `main` trigger automatic redeployment for each tenant.

| Tenant | Build Pack | URL |
|--------|------------|-----|
| **Tertiary Infotech Academy** | Dockerfile | https://ai-lms-tms.tertiaryinfo.tech |
| **Chariot / Intellisoft** | Docker Compose | (per-tenant) |

Tenant-specific behavior is gated via DB config, env vars, or feature flags (e.g. `payroll_enabled` in `lib/payroll/featureFlag.ts`) — never by forking shared code.

### Local Docker

A `docker-compose.yml` is provided for local development (Next.js app + Postgres 17, ports 3003 / 6434).

```bash
# Build for production
npm run build

# Start production server
npm start
```

## Documentation

Full documentation is available at **[https://alfredang.github.io/AI-LMS-TMS/](https://alfredang.github.io/AI-LMS-TMS/)**

| Role | Guide |
|------|-------|
| **Learner** | [Learner User Guide](https://alfredang.github.io/AI-LMS-TMS/user-guide-learner) |
| **Trainer** | [Trainer User Guide](https://alfredang.github.io/AI-LMS-TMS/user-guide-trainer) |
| **Developer** | [Developer User Guide](https://alfredang.github.io/AI-LMS-TMS/user-guide-developer) |
| **Admin** | [Admin User Guide](https://alfredang.github.io/AI-LMS-TMS/user-guide-admin) |
| **Finance** | [Finance User Guide](https://alfredang.github.io/AI-LMS-TMS/user-guide-finance) |
| **Training Provider** | [Training Provider Guide](https://alfredang.github.io/AI-LMS-TMS/user-guide-training-provider) |

## License

This project is proprietary software developed by Tertiary Infotech Pte Ltd. All rights reserved.

---

<p align="center">
  <strong>Developed by Tertiary Infotech Pte Ltd</strong><br>
  <em>Empowering Training Excellence in Singapore</em>
</p>
