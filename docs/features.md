---
layout: default
title: Features
---

# Features

Comprehensive documentation of all AI-LMS-TMS features.

[Back to Home](./)

---

## Course Management

### Create & Edit Courses

- Design courses with rich metadata (title, description, objectives)
- Organize content into **Learning Units** and **Subtopics**
- Set course duration, fees, and funding eligibility
- Upload course materials and resources
- Support for WSQ and IBF course types

### Course Runs

- Schedule multiple runs per course
- Assign trainers to each run
- Set start/end dates and session times
- Define venue and capacity
- Integration with SSG for course run registration

---

## Enrollment System

### Learner Enrollment

- Browse and search available courses
- View course details and schedules
- Enroll in course runs
- Track enrollment status

### Progress Tracking

- Monitor completion of subtopics
- View overall course progress percentage
- Track time spent on each module
- Receive notifications on milestones

### Certificate Generation

- Auto-generate certificates upon completion
- Customizable certificate templates
- Download certificates as PDF
- Verify certificates with unique IDs

---

## Assessment System

### Assessment Types

| Type | Description |
|------|-------------|
| **Exam** | Timed online examinations |
| **Project** | Practical project submissions |
| **Assignment** | Written assignments and reports |
| **Interview** | Scheduled assessment interviews |
| **Quiz** | Quick knowledge checks |

### Grading Features

- Rubric-based grading
- Grade submissions with feedback
- Bulk grading support
- Grade history and audit trail

### AI Quiz Generator

- Generate quizzes from course content
- Multiple choice and short answer formats
- Automatic grading for MCQ
- Randomized question order

---

## AI Chatbot

### "Tertiary" AI Assistant

Powered by Google Gemini 2.5 Flash, the AI chatbot provides:

- **Course Information** - Answer questions about courses, schedules, requirements
- **Learning Support** - Explain concepts, provide examples
- **Navigation Help** - Guide users through the platform
- **Personalized Responses** - Context-aware based on user's enrolled courses

### Features

- Real-time streaming responses
- Conversation history
- Context-aware suggestions
- Multi-turn conversations

---

## User Roles

### Learner

- View and enroll in courses
- Track learning progress
- Submit assessments
- Download certificates
- Chat with AI assistant
- View calendar events

### Trainer

- View assigned classes
- Grade submissions
- Upload course materials
- Manage attendance
- View trainer calendar

### Developer

- Create and edit courses
- Design assessments
- Manage learning units
- Preview course content

### Admin

- Manage all users
- View system statistics
- Manage enrollments
- Create class runs
- Assign trainers
- View all classes

### Training Provider

- Organization settings
- Manage trainers
- SSG API integration
- Branding customization
- Financial templates

---

## Multi-Role Support

Users can have multiple roles simultaneously:

- Login reveals all assigned roles
- Role switcher in header for quick switching
- Each role has dedicated dashboard
- Permissions are role-specific

---

## SSG Integration

### SkillsFuture Singapore APIs

Full integration with SSG for:

#### Course Runs
- Create course runs in SSG
- Update course run details
- Delete cancelled runs
- Sync sessions

#### Enrolments
- Sync learner enrolments
- Update enrolment status
- View enrolment details

#### Grants & Claims
- Apply for training grants
- Track grant status
- Submit claims
- View claim payments

### Data Encryption

- AES-256 encryption for sensitive data
- NRIC/FIN encryption before SSG submission
- Secure credential storage

---

## Singapore-Specific Features

### ID Validation

- NRIC format validation
- FIN format validation
- UEN (company registration) validation

### Funding Support

| Funding Type | Description |
|--------------|-------------|
| **WSQ** | Workforce Skills Qualifications |
| **IBF** | Institute of Banking and Finance |
| **PSEA** | Post-Secondary Education Account |
| **MCES** | Mid-Career Enhanced Subsidy |
| **UTAP** | Union Training Assistance Programme |

---

## Training Provider Settings

### Branding

- Upload company logo
- Set company name and short name
- Configure primary colors
- Custom email templates

### Automation

- Auto-send enrollment confirmations
- Auto-generate invoices
- Auto-issue certificates
- Email notifications

### Templates

- Pro-forma invoice template
- Tax invoice template
- Receipt template
- Certificate template

### Calendar Integration

- Google Calendar sync
- Microsoft Calendar sync
- iCal export

---

## Authentication

### Login Methods

1. **Password Login**
   - Email + password authentication
   - Password hashing with bcrypt
   - Session management with JWT

2. **OTP Login**
   - Email-based OTP
   - 30-minute expiry
   - 6-digit codes
   - Resend functionality

### Security Features

- JWT token authentication
- Secure password storage
- Session timeout
- Rate limiting

---

## File Management

### Upload Support

- Profile pictures
- CV/Resume uploads
- Certificate uploads
- Course materials
- Assessment submissions

### File Types

- Images: JPG, PNG, GIF
- Documents: PDF, DOC, DOCX
- Spreadsheets: XLS, XLSX

---

## Notifications

### Email Notifications

- Enrollment confirmations
- OTP codes
- Assessment submissions
- Grade notifications
- Certificate issuance

### In-App Notifications

- Dashboard announcements
- Calendar reminders
- Progress milestones

---

[Back to Home](./)
