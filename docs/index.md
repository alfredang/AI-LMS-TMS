---
layout: default
title: AI-LMS-TMS Documentation
---

# AI-LMS-TMS

**A comprehensive Learning Management System (LMS) and Training Management System (TMS) with AI capabilities, designed for Singapore's SkillsFuture training ecosystem.**

[Live Demo](https://ai-lms-tms.vercel.app/){: .btn .btn-primary }
[GitHub Repository](https://github.com/alfredang/AI-LMS-TMS){: .btn }

---

## Overview

AI-LMS-TMS is a full-stack, enterprise-grade web application that manages the complete training lifecycle:

- **Course Creation & Scheduling** - Design courses with learning units and subtopics
- **Learner Enrollment** - Manage enrollments with progress tracking
- **Assessments & Grading** - Create exams, projects, and assignments
- **Certification** - Auto-generate certificates upon completion
- **AI Chatbot** - Google Gemini-powered learner assistance

---

## Key Features

### AI-Powered Learning
Google Gemini chatbot provides personalized assistance to learners, answering questions about course content, schedules, and more.

### SSG Integration
Full integration with SkillsFuture Singapore APIs for:
- Course run management
- Enrolment synchronization
- Grant and claims tracking
- NRIC/FIN validation

### Multi-Role System
Comprehensive role-based access control:

| Role | Description |
|------|-------------|
| **Learner** | Enroll in courses, track progress, submit assessments |
| **Trainer** | Manage classes, grade submissions, upload materials |
| **Developer** | Create and edit course content |
| **Admin** | System administration and user management |
| **Training Provider** | Organization settings and SSG integration |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 14 |
| Language | TypeScript 5 |
| Frontend | React 18, Tailwind CSS |
| Database | PostgreSQL 17 (Supabase) |
| Authentication | JWT + OTP |
| AI | Google Generative AI (Gemini) |
| Email | Nodemailer (SMTP) |

---

## Quick Links

- [Getting Started](./getting-started) - Installation and setup guide
- [Features](./features) - Detailed feature documentation
- [API Reference](./api-reference) - REST API documentation
- [Deployment](./deployment) - Deploy to Vercel or other platforms

---

## Support

For support and questions, please [open an issue](https://github.com/alfredang/AI-LMS-TMS/issues) on GitHub.

---

**Developed by Tertiary Infotech Pte Ltd**
*Empowering Training Excellence in Singapore*
