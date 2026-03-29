# AI-LMS-TMS

<p align="center">
  <strong>A comprehensive Learning Management System (LMS) and Training Management System (TMS) with AI capabilities, designed for Singapore's SkillsFuture training ecosystem.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" alt="Next.js" />
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

- **AI-Powered Learning**: Google Gemini chatbot and GenAI authoring tools for trainers
- **SSG Integration**: Full SkillsFuture Singapore API support for course runs, enrolments, assessments, grants, and claims
- **Multi-Role System**: 5 roles with dedicated dashboards - Learner, Trainer, Admin, Developer, Training Provider
- **Singapore-Ready**: NRIC/FIN validation, UEN verification, WSQ/IBF course support, funding calculations
- **Automation**: Auto-create learner accounts, auto-assign trainers, auto-sync course run dates via n8n workflows
- **External API**: 8 REST endpoints for third-party bot and automation integration
- **Modern Stack**: Next.js 14, TypeScript, Tailwind CSS, PostgreSQL, deployed on Coolify

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
- Task list management
- **GenAI Authoring** - AI-powered content generation tools
- **EdTools** - Educational tools integration (Whiteboard, etc.)

### Admin Features
- **Calendar Management** - View and manage training calendar
- **Class Management** - View courses, trainers, learners; manage upcoming/ongoing/completed classes; assign trainers and learners; search past learners
- **Direct Application** - Upload, view, and manage direct applications
- **TPG Management (SkillsFuture)**
  - Course Run: Create, search, view, upload, delete course runs; manage sessions and attendance
  - Enrolment: Enroll learners, bulk upload, search/view/update/cancel enrolments, manage fees
  - Assessment: Submit, update, search, and view SSG assessments
  - Grant: Search grants and view grant status
- **Certificate Management** - Create, delete, and send certificates (SG and GH variants) with configurable CC email lists
- **Automation Logs** - Auto-create learner logs, assign trainer logs, course run date sync logs
- **Reference Links** - Configurable external links (Master List, TMS, FMS, MMS, TPMS)
- **n8n Links** - Quick access to n8n workflow hosts
- **Useful Links** - Quick access to Magento backend and other tools

### Developer Features
- Course content creation and editing
- Assessment authoring with multiple assessment methods (Written, Practical, Case Study, Role Play, Oral Questioning, Project, Assignment)
- Learning unit and subtopic management
- Course material uploads (lesson plans, slides, guides)

### Training Provider Features
- **Dashboard** - Organization overview and statistics
- **User Management** - Add, remove, and manage users; assign/update roles; enable/disable accounts
- **Admin Management** - Manage admin-level accounts
- **Company Settings**
  - Company profile (name, UEN, address, logo, color scheme)
  - Contact person management
  - **Integrations** - Google (Calendar, OAuth, Certificate Folder), n8n (Host URLs), Magento (Backend URL), Reference Links
  - **SSG Authentication** - SSG certificate, private key, and encryption key
  - **Credentials** - LLM API keys with model selection
  - **Security Settings** - OTP login, default OTP, force first password change, default password, sensitive data masking
  - **Admin Settings** - Auto-send pro-forma invoices, confirmation emails, invoices on grant success, receipts, certificates, thank-you emails
  - **Gaming Settings** - Leaderboard and points system toggles
  - **Funding Settings** - Normal/enhanced funding rates, GST configuration
  - Financial document templates (invoice, receipt, certificate, pro-forma)
- **API Endpoints** - Built-in interactive API documentation with 15 collapsible sections covering all 80+ endpoints
- **Documents** - Template downloads

### AI-Powered Features
- **AI Chatbot** - Google Gemini-powered chatbot for learner assistance
- **GenAI Authoring** - AI content generation for trainers
- **Quiz Generator** - AI-generated quizzes based on course content

### Automation Features
- **Auto-Create Learners** - Automatically creates learner accounts for course runs starting today (via n8n)
- **Auto-Assign Trainers** - Bot-driven trainer assignment to course runs
- **Course Run Date Sync** - Automatic synchronization of dates with SSG
- **Enrolment Backfill** - Batch sync of enrollment data from SSG
- **Auto-Send Emails** - Configurable auto-send for invoices, receipts, certificates, and notifications

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
| **Learner** | Course participants | Enroll in courses, track progress, submit assessments, download certificates |
| **Trainer** | Course instructors | View assigned classes, take attendance, grade assessments, GenAI authoring |
| **Admin** | System administrators | Full TPG management, SSG integration, user management, certificate generation |
| **Developer** | Course developers | Create and edit course content, assessments, and learning materials |
| **Training Provider** | Organization admins | Company settings, user management, integrations, API documentation |

## Technology Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 14 (Pages Router, TypeScript) |
| **Frontend** | React 18, Tailwind CSS |
| **Database** | PostgreSQL 17 |
| **Authentication** | JWT + OTP (bcryptjs, jsonwebtoken) |
| **AI Integration** | Google Generative AI (Gemini) |
| **File Uploads** | Multer |
| **Email** | Nodemailer (Gmail OAuth2) |
| **Password Hashing** | bcryptjs |
| **Icons** | Lucide React |
| **Database Client** | pg (node-postgres) |
| **Deployment** | Coolify (self-hosted) |
| **Automation** | n8n workflows |
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
| `user_role_map` | Maps users to roles (Learner, Trainer, Admin, Developer, Training Provider) |
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

# JWT Authentication
JWT_SECRET=your-secure-jwt-secret

# Google Gemini AI
NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY=your-gemini-api-key

# SSG API Integration
SSG_API_BASE_URL=https://api.ssg-wsg.sg

# External API Authentication
EXTERNAL_API_KEY_FOR_CLAWDBOT=your-external-api-key
```

## Deployment

### Coolify (Current)

The application is deployed on Coolify at `https://ai-lms-tms.tertiaryinfo.tech`. Pushes to `main` trigger automatic redeployment.

### Manual Deployment

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
| **Training Provider** | [Training Provider Guide](https://alfredang.github.io/AI-LMS-TMS/user-guide-training-provider) |

## License

This project is proprietary software developed by Tertiary Infotech Pte Ltd. All rights reserved.

---

<p align="center">
  <strong>Developed by Tertiary Infotech Pte Ltd</strong><br>
  <em>Empowering Training Excellence in Singapore</em>
</p>
