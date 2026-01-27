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
  <a href="https://ai-lms-tms.vercel.app/"><img src="https://img.shields.io/badge/Demo-Live%20Site-success?style=for-the-badge&logo=vercel" alt="Live Demo" /></a>
  <a href="./docs/"><img src="https://img.shields.io/badge/Docs-View%20Documentation-blue?style=for-the-badge&logo=readthedocs" alt="Documentation" /></a>
</p>

---

## Overview

AI-LMS-TMS is a **full-stack, enterprise-grade web application** that manages the complete training lifecycle - from course creation and scheduling to learner enrollment, progress tracking, assessments, and certification. Built with modern technologies and deep integration with Singapore's SkillsFuture ecosystem, it provides a seamless experience for training providers, trainers, and learners.

### Why AI-LMS-TMS?

- **AI-Powered Learning**: Google Gemini chatbot for personalized learner assistance
- **SSG Integration**: Full SkillsFuture Singapore API support for course runs, grants, and claims
- **Multi-Role System**: Comprehensive role-based access for learners, trainers, admins, developers, and training providers
- **Singapore-Ready**: NRIC/FIN validation, UEN verification, WSQ/IBF course support
- **Modern Stack**: Next.js 14, TypeScript, Tailwind CSS, PostgreSQL

---

## Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Documentation](#documentation)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [User Roles](#user-roles)
- [API Documentation](#api-documentation)
- [SSG API Integration](#ssg-api-integration)
- [Deployment](#deployment)

## Features

### Core LMS/TMS Features
- **Course Management**: Create, edit, and manage courses with learning units and subtopics
- **Course Runs**: Schedule multiple runs per course with trainer assignments
- **Enrollment Management**: Track learner enrollments, progress, and completions
- **Assessment System**: Create assessments, manage submissions, and grade learners
- **Progress Tracking**: Monitor learner progress through subtopic completions
- **Certificate Generation**: Issue certificates upon course completion

### AI-Powered Features
- **AI Chatbot**: Google Gemini-powered chatbot for learner assistance
- **Quiz Generator**: AI-generated quizzes based on course content
- **Smart Recommendations**: Personalized course suggestions

### Singapore-Specific Features
- **SSG API Integration**: Full integration with SkillsFuture Singapore APIs
  - Course run management (view, add, edit, delete)
  - Session management
  - Enrolment synchronization
  - Grant and claims tracking
- **WSQ/IBF Course Support**: Support for WSQ and IBF funded courses
- **SkillsFuture Credit**: PSEA, MCES, and UTAP eligibility tracking
- **Singapore ID Validation**: NRIC/FIN and UEN validation

### Training Provider Features
- **Multi-tenant Support**: Multiple training providers on single platform
- **Trainer Management**: Manage trainer profiles, certifications, and assignments
- **Financial Templates**: Pro-forma, invoice, receipt, and certificate templates
- **Automation Options**: Auto-send emails, invoices, and certificates
- **Calendar Integration**: Google Calendar and Microsoft Calendar sync

### User Management
- **Multi-role Support**: Learner, Trainer, Admin, Developer, Training Provider
- **Profile Management**: Comprehensive profile management per role
- **File Uploads**: CV, certificates, and profile picture uploads

## Technology Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 14 (TypeScript) |
| **Frontend** | React 18, Tailwind CSS |
| **Database** | PostgreSQL 17 (Supabase) |
| **Authentication** | JWT (jsonwebtoken) |
| **AI Integration** | Google Generative AI (Gemini) |
| **File Uploads** | Multer |
| **Icons** | Lucide React |
| **Database Client** | pg (node-postgres) |

## Documentation

Full documentation is available in the [docs folder](./docs/).

### User Guides

| Role | Guide |
|------|-------|
| **Learner** | [Learner User Guide](./docs/user-guide-learner.md) |
| **Trainer** | [Trainer User Guide](./docs/user-guide-trainer.md) |
| **Developer** | [Developer User Guide](./docs/user-guide-developer.md) |
| **Admin** | [Admin User Guide](./docs/user-guide-admin.md) |
| **Training Provider** | [Training Provider Guide](./docs/user-guide-training-provider.md) |

### Additional Documentation

- [Getting Started Guide](./docs/getting-started.md)
- [Features Overview](./docs/features.md)
- [API Reference](./docs/api-reference.md)
- [Deployment Guide](./docs/deployment.md)

## Project Structure

```
ai-lms-tms/
├── components/                 # React components
│   ├── admin/                  # Admin dashboard components
│   │   ├── ClassDetailView.tsx
│   │   ├── ClassManagementViews.tsx
│   │   ├── CompletedClasses.tsx
│   │   ├── CreateNewClassView.tsx
│   │   ├── EnrollLearners.tsx
│   │   ├── OngoingClasses.tsx
│   │   └── ViewTrainers.tsx
│   ├── ssg/                    # SSG API integration components
│   │   ├── SSGCourses.tsx
│   │   ├── ViewCourseRun.tsx
│   │   ├── AddCourseRun.tsx
│   │   └── EncryptionDecryption.tsx
│   ├── ui/                     # Reusable UI components
│   ├── common/                 # Shared components
│   ├── AdminDashboard.tsx
│   ├── AiChatbot.tsx           # Gemini-powered chatbot
│   ├── CalendarView.tsx
│   ├── CourseDetail.tsx
│   ├── CourseEditor.tsx
│   ├── CourseList.tsx
│   ├── GradingView.tsx
│   ├── LoginScreen.tsx
│   ├── ProfileView.tsx
│   ├── QuizGenerator.tsx
│   └── TrainingProviderDashboard.tsx
│
├── pages/                      # Next.js pages & API routes
│   ├── api/                    # API endpoints
│   │   ├── admin/              # Admin operations
│   │   ├── ai/                 # AI endpoints
│   │   ├── assessments/        # Assessment CRUD
│   │   ├── auth/               # Authentication
│   │   ├── courses/            # Course management
│   │   ├── enrollments/        # Enrollment operations
│   │   ├── grading/            # Grading system
│   │   ├── profile/            # User profiles
│   │   ├── ssg/                # SSG API proxies
│   │   ├── submissions/        # Assignment submissions
│   │   └── upload/             # File uploads
│   ├── _app.tsx
│   ├── index.tsx               # Main application page
│   └── profile.tsx
│
├── lib/                        # Core libraries
│   ├── services/               # Business logic services
│   │   ├── authService.ts
│   │   ├── courseService.ts
│   │   ├── geminiService.ts    # AI integration
│   │   └── profileService.ts
│   ├── ssg/                    # SSG API utilities
│   ├── config.ts               # Environment configuration
│   ├── db.ts                   # Database connection pool
│   └── urlHelpers.ts           # URL construction helpers
│
├── database/                   # Database files
│   ├── 01-schema.sql           # Database schema
│   ├── 02-data-clean-fixed.sql # Seed data
│   └── tertiarydb_supabase.sql # Full database dump
│
├── contexts/                   # React context providers
├── hooks/                      # Custom React hooks
├── layouts/                    # Page layouts
├── types/                      # TypeScript type definitions
├── utils/                      # Utility functions
├── scripts/                    # Migration & utility scripts
├── styles/                     # Global CSS styles
└── public/                     # Static assets
    └── uploads/                # User uploaded files
```

## Database Schema

### Entity Relationship Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    app_user     │────▶│  user_role_map  │     │ training_provider│
│  (Core User)    │     │   (Roles)       │     │   (Tenant)      │
└────────┬────────┘     └─────────────────┘     └────────┬────────┘
         │                                               │
    ┌────┴────┬────────────┬────────────┐               │
    ▼         ▼            ▼            ▼               │
┌────────┐┌────────┐┌───────────┐┌───────────┐         │
│learner ││trainer ││ developer ││   admin   │         │
│_profile││_profile││ _profile  ││ _profile  │         │
└───┬────┘└───┬────┘└───────────┘└───────────┘         │
    │         │                                         │
    │         │    ┌─────────────────┐                 │
    │         └───▶│  certification  │                 │
    │              │ work_experience │                 │
    │              └─────────────────┘                 │
    │                                                   │
    ▼                                                   │
┌─────────────────┐     ┌─────────────────┐            │
│   enrollment    │────▶│    course_run   │◀───────────┘
│ (User↔Course)   │     │  (Scheduled)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │              ┌────────┴────────┐
         │              ▼                 ▼
         │       ┌─────────────┐   ┌─────────────┐
         │       │   course    │   │  assessment │
         │       │ (Template)  │   │   (Tests)   │
         │       └──────┬──────┘   └──────┬──────┘
         │              │                 │
         │       ┌──────┴──────┐         │
         │       ▼             ▼         │
         │ ┌──────────┐ ┌──────────┐     │
         │ │ learning │ │  subtopic│     │
         │ │  _unit   │ │          │     │
         │ └──────────┘ └──────────┘     │
         │                               │
         └───────────────────────────────┘
                        │
                 ┌──────┴──────┐
                 ▼             ▼
          ┌───────────┐ ┌───────────┐
          │submission │ │assessment │
          │  (Files)  │ │  _grade   │
          └───────────┘ └───────────┘
```

### Core Tables

| Table | Description |
|-------|-------------|
| `app_user` | Core user accounts with email, password, and profile |
| `user_role_map` | Maps users to roles (Learner, Trainer, Admin, Developer, Training Provider) |
| `training_provider` | Training organization details, templates, and settings |
| `course` | Course templates with metadata, materials, and funding info |
| `course_run` | Scheduled instances of courses with dates and trainers |
| `enrollment` | Learner enrollments with progress and payment status |
| `assessment` | Course assessments (exams, projects, assignments) |
| `submission` | Learner assessment submissions |
| `learning_unit` | Course chapters/modules |
| `subtopic` | Individual learning topics within units |

### Profile Tables

| Table | Description |
|-------|-------------|
| `learner_profile` | Learner demographics, employment, NRIC |
| `trainer_profile` | Trainer qualifications, expertise, certifications |
| `developer_profile` | Course developer information |
| `admin_profile` | Admin contact information |

### SSG Integration Tables

| Table | Description |
|-------|-------------|
| `ssg_enrolments` | SSG enrolment records synced from API |
| `ssg_grants` | Grant applications and approvals |
| `ssg_claims` | Funding claims and payment status |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 17+ (or Supabase account)
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
   npm run db:migrate

   # Seed initial data (optional)
   npm run db:seed
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

   The application will be available at `http://localhost:3000`

## Environment Variables

Create a `.env.local` file with the following variables:

```env
# Database Connection (Supabase Transaction Pooler recommended)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-1-[region].pooler.supabase.com:6543/postgres

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co

# Application URLs
NEXT_PUBLIC_BASE_URL=http://localhost:3000
BASE_URL=http://localhost:3000

# JWT Authentication
JWT_SECRET=your-secure-jwt-secret

# Google Gemini AI (for chatbot & quiz generation)
NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY=your-gemini-api-key

# SSG API Integration
SSG_API_BASE_URL=https://api.ssg-wsg.sg
SSG_API_VERSION=v1
SSG_AUTH_TOKEN=your-ssg-bearer-token
SSG_ENCRYPTION_KEY=your-base64-aes-256-key

# File Uploads
MAX_FILE_SIZE=5MB
UPLOAD_DIR=./public/uploads
```

## User Roles

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| **Learner** | Course participants | Enroll in courses, track progress, submit assessments |
| **Trainer** | Course instructors | View assigned classes, grade submissions, manage materials |
| **Admin** | System administrators | Manage users, courses, enrollments, and system settings |
| **Developer** | Course developers | Create and edit course content and assessments |
| **Training Provider** | Organization admins | Manage organization settings, trainers, and SSG integration |

## API Documentation

### Authentication

```
POST /api/auth/login          # User login
POST /api/auth/register       # User registration
POST /api/auth/logout         # User logout
```

### Courses

```
GET    /api/courses           # List all courses
GET    /api/courses/[id]      # Get course details
POST   /api/courses           # Create course
PUT    /api/courses/[id]      # Update course
DELETE /api/courses/[id]      # Delete course
```

### Enrollments

```
GET    /api/enrollments       # List enrollments
POST   /api/enrollments       # Create enrollment
PUT    /api/enrollments/[id]  # Update enrollment
```

### Assessments & Grading

```
GET    /api/assessments       # List assessments
POST   /api/assessments       # Create assessment
POST   /api/submissions       # Submit assessment
PUT    /api/grading/[id]      # Grade submission
```

### Profile Management

```
GET    /api/profile           # Get user profile
PUT    /api/profile-update    # Update profile
POST   /api/upload/[type]     # Upload files (CV, certificates, etc.)
```

### Admin Operations

```
GET    /api/admin/users       # List users
GET    /api/admin/classes     # List class runs
POST   /api/admin/enroll      # Enroll learners
PUT    /api/admin/assign-trainer  # Assign trainer to class
```

## SSG API Integration

The application integrates with SkillsFuture Singapore APIs for:

- **Course Runs**: Create, view, edit, and delete course runs
- **Sessions**: Manage course session schedules
- **Enrolments**: Sync learner enrolments
- **Grants & Claims**: Track funding applications

For detailed SSG integration documentation, see [SSG_API_INTEGRATION.md](SSG_API_INTEGRATION.md).

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy

### Manual Deployment

```bash
# Build for production
npm run build

# Start production server
npm start
```

For detailed deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run type-check   # Run TypeScript type checking
npm run db:migrate   # Run database migrations
npm run db:seed      # Seed database with initial data
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary software developed by Tertiary Infotech Pte Ltd. All rights reserved.

## Support

For support and questions, please open an issue on GitHub.

## Acknowledgments

- [Next.js](https://nextjs.org/) - The React Framework
- [Supabase](https://supabase.com/) - Open Source Firebase Alternative
- [Google Generative AI](https://ai.google.dev/) - AI/ML Platform
- [Tailwind CSS](https://tailwindcss.com/) - Utility-First CSS Framework
- [SkillsFuture Singapore](https://www.skillsfuture.gov.sg/) - National Skills Development

---

<p align="center">
  <strong>Developed by Tertiary Infotech Pte Ltd</strong><br>
  <em>Empowering Training Excellence in Singapore</em>
</p>
