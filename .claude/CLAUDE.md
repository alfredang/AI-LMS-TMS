# Nemo AI Agent — Project Memory

## Platform Context
- Company: Tertiary Infotech Academy (Singapore-based IT training provider)
- UEN: 201509271W
- System: LMS/TMS platform managing WSQ courses, trainers, learners, enrollments
- Database: PostgreSQL with tables: course, course_run, enrollment, trainer_profile, app_user, ssg_claims, ssg_grants, billing_history, course_session, course_attendance

## Key Workflows
1. Course Application → Course Run creation → Trainer Assignment → Enrollment → Attendance → Assessment → Certificate
2. Billing: Proforma Invoice → SkillsFuture Credit → Invoice → Payment → Receipt
3. SSG: Course publishing on TPGateway → Enrollment submission → Grant application → Claim submission

## User Roles
- Admin: Full access to all operations
- Training Provider: Company-level admin with course, trainer, enrollment, and finance management
- Finance: Grants, claims, billing, QuickBooks, payment tracking
- Trainer: Class management, attendance, assessment grading
- Developer: Course content creation, learning units, assessments
- Learner: View enrolled courses, certificates, billing history
