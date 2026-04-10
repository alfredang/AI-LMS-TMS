import React, { useState } from 'react';
import { Icon, IconName } from '../ui/Icon';

interface EndpointDoc {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  title: string;
  description: string;
  headers: { name: string; value: string; description: string }[];
  queryParams?: { name: string; type: string; required: boolean; description: string }[];
  bodyFields?: { name: string; type: string; required: boolean; description: string }[];
  exampleRequest?: string;
  exampleResponse?: string;
}

interface EndpointSection {
  title: string;
  description: string;
  endpoints: EndpointDoc[];
}

const sections: EndpointSection[] = [
  // ─── EXTERNAL / AUTOMATION ───
  {
    title: 'External / Automation',
    description: 'Public-facing endpoints for third-party integrations and automation bots. All require x-api-key header.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/external/unassign-trainer',
        title: 'Unassign Trainer from Course Run',
        description: 'Removes the assigned trainer from a course run by clearing the trainer fields.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'course_run_id', type: 'string', required: true, description: 'The SSG course run ID' },
        ],
        exampleRequest: `curl -X POST https://ai-lms-tms.tertiaryinfo.tech/api/external/unassign-trainer \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "course_run_id": "1303232" }'`,
        exampleResponse: `{
  "success": true,
  "message": "Trainer unassigned from course run 1303232"
}`,
      },
      {
        method: 'GET',
        path: '/api/external/get-course-run',
        title: 'Get Course Run Details',
        description: 'Retrieves full details for a specific course run, including assigned trainer and enrolled learner count.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'course_run_id', type: 'string', required: true, description: 'The SSG course run ID' },
        ],
        exampleRequest: `curl -X GET "https://ai-lms-tms.tertiaryinfo.tech/api/external/get-course-run?course_run_id=1303232" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{
  "success": true,
  "data": {
    "uuid": "...",
    "course_run_id": "1303232",
    "start_date": "2026-03-12",
    "end_date": "2026-03-14",
    "class_status": "Confirmed",
    "mode_of_learning": "Virtual",
    "digital_attendance_id": "RA741642",
    "assigned_trainer_name": "John Doe",
    "assigned_trainer_email": "trainer@example.com",
    "course_title": "Virtual Training Course",
    "course_code": "TGS-2023011234",
    "enrolled_learners": "12"
  }
}`,
      },
      {
        method: 'GET',
        path: '/api/external/list-course-runs',
        title: 'List Course Runs',
        description: 'Lists course runs with optional filtering by status and trainer email. Returns up to 200 results ordered by start date descending.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'Filter by class status (e.g. "Confirmed", "Completed")' },
          { name: 'trainer_email', type: 'string', required: false, description: 'Filter by assigned trainer email (case-insensitive)' },
        ],
        exampleRequest: `curl -X GET "https://ai-lms-tms.tertiaryinfo.tech/api/external/list-course-runs?status=Confirmed" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{
  "success": true,
  "count": 5,
  "data": [
    {
      "course_run_id": "1303232",
      "start_date": "2026-03-12",
      "end_date": "2026-03-14",
      "class_status": "Confirmed",
      "assigned_trainer_name": "John Doe",
      "course_title": "Virtual Training Course",
      "course_code": "TGS-2023011234"
    }
  ]
}`,
      },
      {
        method: 'GET',
        path: '/api/external/list-trainers',
        title: 'List Trainers',
        description: 'Lists all trainers with their profile information. Optionally filter by trainer status.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'status', type: 'string', required: false, description: 'Filter by trainer status (e.g. "Active")' },
        ],
        exampleRequest: `curl -X GET "https://ai-lms-tms.tertiaryinfo.tech/api/external/list-trainers?status=Active" \\
  -H "x-api-key: YOUR_API_KEY"`,
        exampleResponse: `{
  "success": true,
  "count": 3,
  "data": [
    {
      "user_id": "...",
      "full_name": "John Doe",
      "email": "trainer@example.com",
      "secondary_email": null,
      "trainer_type": "ACLP",
      "trainer_status": "Active",
      "account_status": "active"
    }
  ]
}`,
      },
      {
        method: 'POST',
        path: '/api/external/auto-create-learners',
        title: 'Auto-Create Learner Accounts',
        description: 'Automatically creates learner accounts for course runs starting tomorrow. Fetches SSG enrollments directly from the SSG API and upserts enrollment records.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Processed 3 course runs",
  "results": [
    {
      "course_run_id": "1303232",
      "status": "success",
      "created_count": 5,
      "existing_count": 2,
      "error_count": 0
    }
  ]
}`,
      },
      {
        method: 'POST',
        path: '/api/external/sync-course-run-dates',
        title: 'Sync Course Run Dates',
        description: 'Syncs course run start/end dates with SSG data for runs starting today. Compares local dates with SSG dates and updates if different.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Synced 2 course runs",
  "results": [
    {
      "course_run_id": "1303232",
      "status": "updated",
      "db_start_date": "2026-03-12",
      "ssg_start_date": "2026-03-13"
    }
  ]
}`,
      },
      {
        method: 'GET',
        path: '/api/external/backfill-enrollments',
        title: 'Backfill Enrollments (Preview)',
        description: 'Lists enrollments missing raw data without executing any changes. Use POST to execute the backfill.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'Max enrollments to process (default: 50, max: 200)' },
        ],
        exampleResponse: `{
  "success": true,
  "total": 10,
  "enrollments": [...]
}`,
      },
      {
        method: 'POST',
        path: '/api/external/backfill-enrollments',
        title: 'Backfill Enrollments (Execute)',
        description: 'Fetches and updates enrollments with raw data directly from the SSG API.',
        headers: [
          { name: 'x-api-key', value: '<API_KEY>', description: 'API key for authentication' },
        ],
        queryParams: [
          { name: 'limit', type: 'number', required: false, description: 'Max enrollments to process (default: 50, max: 200)' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Backfill completed",
  "total": 10,
  "updated": 8,
  "skipped": 2,
  "errors": 0
}`,
      },
    ],
  },

  // ─── AUTHENTICATION ───
  {
    title: 'Authentication',
    description: 'User authentication endpoints for login, OTP, and password management.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/auth/login',
        title: 'User Login',
        description: 'Authenticates a user via password or OTP. Returns user profile, roles, and session token.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'User email address' },
          { name: 'loginType', type: 'string', required: true, description: '"password" or "otp"' },
          { name: 'password', type: 'string', required: false, description: 'Required if loginType is "password"' },
          { name: 'otp', type: 'string', required: false, description: 'Required if loginType is "otp"' },
        ],
        exampleResponse: `{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-...",
      "email": "user@example.com",
      "fullName": "John Doe",
      "role": "Learner",
      "roles": ["Learner", "Trainer"]
    },
    "token": "jwt-token-...",
    "forcePasswordChange": false
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/auth/send-otp',
        title: 'Send OTP',
        description: 'Generates and sends a 6-digit OTP to the user\'s email for passwordless login.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'User email address' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "OTP sent successfully"
}`,
      },
      {
        method: 'PUT',
        path: '/api/auth/update-password',
        title: 'Update Password',
        description: 'Updates a user\'s password. Minimum 6 characters required.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'newPassword', type: 'string', required: true, description: 'New password (min 6 characters)' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Password updated successfully"
}`,
      },
    ],
  },

  // ─── USER MANAGEMENT ───
  {
    title: 'User Management',
    description: 'Manage users, roles, and accounts within the training provider organization.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/training-provider/add-user',
        title: 'Add User to Organization',
        description: 'Adds an existing user to the training provider organization.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID to add' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "User added to organization"
}`,
      },
      {
        method: 'POST',
        path: '/api/training-provider/update-user-roles',
        title: 'Update User Roles',
        description: 'Updates roles for a user. Valid roles: Learner, Trainer, Developer, Admin, Training Provider. Users cannot edit their own roles.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'roles', type: 'string[]', required: true, description: 'Array of roles to assign' },
          { name: 'accountStatus', type: 'string', required: false, description: 'Account status (active/disabled)' },
          { name: 'full_name', type: 'string', required: false, description: 'Updated full name' },
          { name: 'currentUserId', type: 'string', required: false, description: 'Current user ID (to prevent self-editing)' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "User roles updated successfully"
}`,
      },
      {
        method: 'POST',
        path: '/api/training-provider/delete-user',
        title: 'Disable User Account',
        description: 'Disables a user account by setting account_status to "disabled". Does not permanently delete the user.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID to disable' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "User account disabled"
}`,
      },
      {
        method: 'POST',
        path: '/api/admin/create-learner-account',
        title: 'Create Learner Account',
        description: 'Creates a new learner account with default password from Company Settings. Optionally enrolls in a course run.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'Learner email address' },
          { name: 'fullName', type: 'string', required: true, description: 'Learner full name' },
          { name: 'nric', type: 'string', required: false, description: 'NRIC number' },
          { name: 'courseRunId', type: 'string', required: false, description: 'Course run ID to enroll in' },
          { name: 'courseId', type: 'string', required: false, description: 'Course ID' },
          { name: 'enrolmentId', type: 'string', required: false, description: 'SSG enrolment reference ID' },
          { name: 'sponsorshipType', type: 'string', required: false, description: '"Individual" or "Employer"' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Learner account created",
  "data": {
    "userId": "uuid-...",
    "email": "learner@example.com"
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/admin/add-trainer',
        title: 'Add Trainer',
        description: 'Creates a new trainer account with profile. Supports profile picture upload (max 5MB, image only).',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'Supports file upload' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'Trainer email address' },
          { name: 'full_name', type: 'string', required: true, description: 'Trainer full name' },
          { name: 'telephone', type: 'string', required: true, description: 'Contact number' },
          { name: 'roles', type: 'string[]', required: true, description: 'Roles to assign (e.g. ["Trainer"])' },
          { name: 'password', type: 'string', required: true, description: 'Account password' },
          { name: 'trainer_type', type: 'string', required: false, description: '"ACLP", "non-ACLP", or "DACE"' },
          { name: 'gender', type: 'string', required: false, description: '"Male", "Female", or "Prefer not to say"' },
          { name: 'status', type: 'string', required: false, description: '"Active" or "Inactive"' },
          { name: 'linkedin_url', type: 'string', required: false, description: 'LinkedIn profile URL' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Trainer added successfully",
  "data": {
    "userId": "uuid-...",
    "email": "trainer@example.com"
  }
}`,
      },
      {
        method: 'POST',
        path: '/api/admin/assign-all-roles',
        title: 'Assign Roles to User',
        description: 'Creates a user (if not existing) and assigns specified roles. Uses default password from Company Settings.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'email', type: 'string', required: true, description: 'User email address' },
          { name: 'fullName', type: 'string', required: false, description: 'Full name (defaults to email prefix)' },
          { name: 'roles', type: 'string[]', required: false, description: 'Roles to assign (defaults to all roles)' },
        ],
        exampleResponse: `{
  "success": true,
  "data": {
    "userId": "uuid-...",
    "email": "user@example.com",
    "roles": ["Learner", "Trainer", "Admin", "Developer"]
  }
}`,
      },
    ],
  },

  // ─── COURSES ───
  {
    title: 'Courses',
    description: 'Course catalog management - create, list, update, and delete courses.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/courses/list',
        title: 'List All Courses',
        description: 'Returns all courses ordered by creation date (newest first).',
        headers: [],
        exampleResponse: `{
  "success": true,
  "data": [
    {
      "id": "uuid-...",
      "title": "AI for Business",
      "courseCode": "TGS-2023011234",
      "tscTitle": "AI Applications",
      "tscCode": "ICT-TSC-001"
    }
  ]
}`,
      },
      {
        method: 'GET',
        path: '/api/courses/detail',
        title: 'Get Course Detail',
        description: 'Returns full details for a specific course including learning units and assessments.',
        headers: [],
        queryParams: [
          { name: 'courseId', type: 'string', required: true, description: 'Course UUID' },
        ],
      },
      {
        method: 'POST',
        path: '/api/courses/create-course',
        title: 'Create Course',
        description: 'Creates a new course with optional document uploads (lesson plan, assessment plan, guides, slides).',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'Supports file uploads' },
        ],
        bodyFields: [
          { name: 'title', type: 'string', required: true, description: 'Course title' },
          { name: 'course_code', type: 'string', required: true, description: 'Course code (e.g. "TGS-2023011234")' },
          { name: 'course_type', type: 'string', required: false, description: 'Type of course' },
          { name: 'training_hours', type: 'number', required: false, description: 'Total training hours' },
          { name: 'assessment_hours', type: 'number', required: false, description: 'Total assessment hours' },
          { name: 'courseImage', type: 'file', required: false, description: 'Course image (uploaded to /uploads/images)' },
          { name: 'lessonPlan', type: 'file', required: false, description: 'Lesson plan document' },
          { name: 'assessmentPlan', type: 'file', required: false, description: 'Assessment plan document' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/bulk-upload-courses',
        title: 'Bulk Upload Courses',
        description: 'Imports multiple courses at once from a structured data array.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courses', type: 'array', required: true, description: 'Array of course objects with fields: course_code, title, course_type, tsc_title, tsc_code, training_hours, etc.' },
        ],
        exampleResponse: `{
  "success": true,
  "message": "Uploaded 5 courses",
  "created": 5,
  "skipped": 0
}`,
      },
    ],
  },

  // ─── COURSE RUNS & CLASSES ───
  {
    title: 'Course Runs & Classes',
    description: 'Manage course run instances, class scheduling, and course sessions.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/admin/all-course-runs',
        title: 'List All Course Runs',
        description: 'Returns all course runs with their status, dates, and assigned trainers.',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/admin/upcoming-classes',
        title: 'Upcoming Classes',
        description: 'Returns course runs with start dates in the future.',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/admin/ongoing-classes',
        title: 'Ongoing Classes',
        description: 'Returns course runs currently in progress.',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/admin/completed-classes',
        title: 'Completed Classes',
        description: 'Returns course runs that have been completed.',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/admin/search-course-runs',
        title: 'Search Course Runs',
        description: 'Searches course runs by course code, title, trainer, or status.',
        headers: [],
        queryParams: [
          { name: 'q', type: 'string', required: false, description: 'Search query' },
          { name: 'status', type: 'string', required: false, description: 'Filter by status' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/save-course-run',
        title: 'Create / Update Course Run',
        description: 'Creates a new course run or updates an existing one. Auto-creates learner accounts if needed.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: false, description: 'Existing course run UUID (omit to create new)' },
          { name: 'courseId', type: 'string', required: true, description: 'Course UUID' },
          { name: 'ssgCourseRunId', type: 'string', required: false, description: 'SSG course run ID' },
          { name: 'startDate', type: 'string', required: true, description: 'Start date (ISO format)' },
          { name: 'endDate', type: 'string', required: true, description: 'End date (ISO format)' },
          { name: 'classStatus', type: 'string', required: false, description: 'Status (Confirmed, Cancelled, etc.)' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/admin/delete-course-run',
        title: 'Delete Course Run',
        description: 'Permanently deletes a course run and all associated enrollments.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: true, description: 'Course run UUID' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/import-course-run',
        title: 'Import Course Run from SSG',
        description: 'Imports a course run directly from the SSG API using the course reference number.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
    ],
  },

  // ─── ENROLMENTS ───
  {
    title: 'Enrolments',
    description: 'Learner enrolment management - enroll, unenroll, search, and update enrolment records.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/enrolment/create',
        title: 'Create Enrolment',
        description: 'Enrols a learner into a course run.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'courseRunId', type: 'string', required: true, description: 'Course run UUID' },
          { name: 'learnerId', type: 'string', required: true, description: 'Learner user UUID' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolment/cancel',
        title: 'Cancel Enrolment',
        description: 'Cancels an existing enrolment.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'enrolmentId', type: 'string', required: true, description: 'Enrolment UUID' },
        ],
      },
      {
        method: 'GET',
        path: '/api/enrolment/search',
        title: 'Search Enrolments',
        description: 'Searches enrolments by learner name, email, course, or enrolment reference.',
        headers: [],
        queryParams: [
          { name: 'q', type: 'string', required: false, description: 'Search query' },
        ],
      },
      {
        method: 'GET',
        path: '/api/enrolment/view',
        title: 'View Enrolment',
        description: 'Returns full details for a specific enrolment.',
        headers: [],
        queryParams: [
          { name: 'enrolmentId', type: 'string', required: true, description: 'Enrolment UUID' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/enrolment/update',
        title: 'Update Enrolment',
        description: 'Updates enrolment status or details.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/enrolment/update-fees',
        title: 'Update Enrolment Fees',
        description: 'Updates fee-related fields for an enrolment.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolments/bulk-create',
        title: 'Bulk Create Enrolments',
        description: 'Creates multiple enrolments at once for a course run.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
    ],
  },

  // ─── ASSESSMENTS & GRADING ───
  {
    title: 'Assessments & Grading',
    description: 'Assessment creation, submission, grading, and SSG assessment integration.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/assessments/detail',
        title: 'Get Assessment Detail',
        description: 'Returns full details for a specific assessment.',
        headers: [],
        queryParams: [
          { name: 'assessmentId', type: 'string', required: true, description: 'Assessment UUID' },
        ],
      },
      {
        method: 'POST',
        path: '/api/assessments/publish',
        title: 'Publish Assessment',
        description: 'Publishes an assessment, making it available to learners.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/submissions/submit',
        title: 'Submit Assessment',
        description: 'Submits a learner\'s assessment response.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/grading/update-grading',
        title: 'Update Grade',
        description: 'Updates the grade for a learner\'s assessment submission.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/assessments/ssg-create',
        title: 'Create SSG Assessment',
        description: 'Creates an assessment record in the SSG system.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'GET',
        path: '/api/assessments/ssg-search',
        title: 'Search SSG Assessments',
        description: 'Searches assessment records in the SSG system.',
        headers: [],
      },
      {
        method: 'PUT',
        path: '/api/assessments/ssg-update',
        title: 'Update SSG Assessment',
        description: 'Updates an existing SSG assessment record.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
    ],
  },

  // ─── ATTENDANCE ───
  {
    title: 'Attendance',
    description: 'Course session attendance tracking and digital attendance management.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/trainer/attendance-sessions',
        title: 'Get Attendance Sessions',
        description: 'Returns all attendance sessions for a course run.',
        headers: [],
        queryParams: [
          { name: 'courseRunId', type: 'string', required: true, description: 'Course run UUID' },
        ],
      },
      {
        method: 'GET',
        path: '/api/trainer/attendance-records',
        title: 'Get Attendance Records',
        description: 'Returns attendance records for a specific session.',
        headers: [],
        queryParams: [
          { name: 'sessionId', type: 'string', required: true, description: 'Session UUID' },
        ],
      },
      {
        method: 'GET',
        path: '/api/trainer/attendance-summary',
        title: 'Get Attendance Summary',
        description: 'Returns attendance summary for a course run across all sessions.',
        headers: [],
        queryParams: [
          { name: 'courseRunId', type: 'string', required: true, description: 'Course run UUID' },
        ],
      },
    ],
  },

  // ─── CERTIFICATES ───
  {
    title: 'Certificates',
    description: 'Certificate generation, management, and distribution.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/admin/setup-certificate',
        title: 'Setup Certificate',
        description: 'Generates certificates for a course run using Google Slides template.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/send-certificate-sg',
        title: 'Send Certificate (SG)',
        description: 'Sends certificates via email to Singapore-based learners.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/send-certificate-gh',
        title: 'Send Certificate (GH)',
        description: 'Sends certificates via email to Ghana-based learners.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/admin/delete-certificate',
        title: 'Delete Certificate',
        description: 'Deletes a generated certificate.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
    ],
  },

  // ─── SSG INTEGRATION ───
  {
    title: 'SSG Integration',
    description: 'SkillsFuture Singapore (SSG) API integration endpoints for courses, course runs, and grants.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/ssg/courses',
        title: 'Get SSG Courses',
        description: 'Retrieves course listing from SSG API.',
        headers: [],
      },
      {
        method: 'POST',
        path: '/api/ssg/courses/courseRuns/create-new',
        title: 'Create SSG Course Run',
        description: 'Creates a new course run in the SSG system.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/ssg/courses/courseRuns/publish',
        title: 'Publish SSG Course Run',
        description: 'Publishes a course run in the SSG system.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolments/post-ssg-enrol',
        title: 'Post Enrolment to SSG',
        description: 'Submits an enrolment record to the SSG system.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'GET',
        path: '/api/grants/search',
        title: 'Search Grants',
        description: 'Searches grant records in the SSG system.',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/grants/view',
        title: 'View Grant Status',
        description: 'Returns grant status details from the SSG system.',
        headers: [],
      },
      {
        method: 'POST',
        path: '/api/ssg/encrypt',
        title: 'SSG Encrypt',
        description: 'Encrypts data using SSG encryption key for API communication.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/ssg/decrypt',
        title: 'SSG Decrypt',
        description: 'Decrypts data received from the SSG API.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
    ],
  },

  // ─── PROFILES ───
  {
    title: 'Profiles',
    description: 'User profile management for all roles.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/profile-new',
        title: 'Get User Profile',
        description: 'Returns the full profile for the current user based on their role.',
        headers: [],
        queryParams: [
          { name: 'userId', type: 'string', required: true, description: 'User UUID' },
          { name: 'role', type: 'string', required: true, description: 'User role' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/profile-update',
        title: 'Update User Profile',
        description: 'Updates profile fields for the current user.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'GET',
        path: '/api/profile/trainer',
        title: 'Get Trainer Profile',
        description: 'Returns trainer-specific profile data.',
        headers: [],
      },
      {
        method: 'PUT',
        path: '/api/profile/update-trainer',
        title: 'Update Trainer Profile',
        description: 'Updates trainer-specific profile fields.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'GET',
        path: '/api/profile/developer',
        title: 'Get Developer Profile',
        description: 'Returns developer-specific profile data.',
        headers: [],
      },
      {
        method: 'PUT',
        path: '/api/profile/update-developer',
        title: 'Update Developer Profile',
        description: 'Updates developer-specific profile fields.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
    ],
  },

  // ─── FILE MANAGEMENT ───
  {
    title: 'File Management',
    description: 'File upload, download, and Google Drive integration.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/upload/file',
        title: 'Upload File',
        description: 'Uploads a file to the server. Returns the file URL.',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'File upload' },
        ],
      },
      {
        method: 'POST',
        path: '/api/upload/admin-file',
        title: 'Upload Admin File',
        description: 'Uploads an admin-specific file (templates, certificates).',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'File upload' },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/upload/delete-file',
        title: 'Delete File',
        description: 'Deletes an uploaded file from the server.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/upload/google-drive',
        title: 'Upload to Google Drive',
        description: 'Uploads a file to the configured Google Drive folder.',
        headers: [
          { name: 'Content-Type', value: 'multipart/form-data', description: 'File upload' },
        ],
      },
      {
        method: 'GET',
        path: '/api/files/download',
        title: 'Download File',
        description: 'Downloads a file from the server by file path.',
        headers: [],
        queryParams: [
          { name: 'path', type: 'string', required: true, description: 'File path' },
        ],
      },
    ],
  },

  // ─── TRAINING PROVIDER ───
  {
    title: 'Training Provider',
    description: 'Training provider organization settings, configuration, and management.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/training-provider/info',
        title: 'Get Provider Info',
        description: 'Returns training provider company info, settings, and integration URLs.',
        headers: [],
        queryParams: [
          { name: 'userId', type: 'string', required: false, description: 'User UUID (returns default provider if omitted)' },
        ],
      },
      {
        method: 'PUT',
        path: '/api/training-provider/update',
        title: 'Update Provider Settings',
        description: 'Updates training provider company settings including integrations, security, and admin settings.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'GET',
        path: '/api/training-provider/users',
        title: 'List Provider Users',
        description: 'Returns all users belonging to the training provider organization.',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/training-provider/uen',
        title: 'Lookup by UEN',
        description: 'Looks up a training provider by Unique Entity Number (UEN).',
        headers: [],
        queryParams: [
          { name: 'uen', type: 'string', required: true, description: 'Unique Entity Number' },
        ],
      },
    ],
  },

  // ─── AI & TOOLS ───
  {
    title: 'AI & Tools',
    description: 'AI-powered content generation and chat functionality.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/ai/generate',
        title: 'Generate AI Content',
        description: 'Generates content using the configured AI provider (e.g. course descriptions, summaries).',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/ai/chat',
        title: 'AI Chat',
        description: 'Sends a message to the AI chat assistant.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
    ],
  },

  // ─── BULK OPERATIONS ───
  {
    title: 'Bulk Operations',
    description: 'Bulk import and upload operations for courses, trainers, and enrolments.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/admin/bulk-upload-courses',
        title: 'Bulk Upload Courses',
        description: 'Imports multiple courses from a structured data array.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/bulk-upload-trainers',
        title: 'Bulk Upload Trainers',
        description: 'Imports multiple trainer records. Uses default password from Company Settings.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
        bodyFields: [
          { name: 'trainers', type: 'array', required: true, description: 'Array of trainer objects: full_name, email, telephone, trainer_type, gender, status' },
        ],
      },
      {
        method: 'POST',
        path: '/api/enrolments/bulk-create',
        title: 'Bulk Create Enrolments',
        description: 'Creates multiple enrolments for a course run.',
        headers: [
          { name: 'Content-Type', value: 'application/json', description: 'Request body format' },
        ],
      },
    ],
  },

  // ─── SYSTEM ───
  {
    title: 'System & Diagnostics',
    description: 'Health checks, logging, and system administration.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/health',
        title: 'Health Check',
        description: 'Returns system health status and database connectivity.',
        headers: [],
        exampleResponse: `{
  "status": "ok",
  "timestamp": "2026-03-29T00:00:00.000Z",
  "version": "1.0.0",
  "database": "connected"
}`,
      },
      {
        method: 'GET',
        path: '/api/admin/automation-logs',
        title: 'Auto-Create Learner Logs',
        description: 'Returns logs from the automatic learner creation process.',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/admin/course-run-date-sync-logs',
        title: 'Course Run Date Sync Logs',
        description: 'Returns logs from the course run date synchronization process.',
        headers: [],
      },
      {
        method: 'GET',
        path: '/api/admin/statistics',
        title: 'Dashboard Statistics',
        description: 'Returns aggregate statistics for the admin dashboard (user counts, course counts, etc.).',
        headers: [],
      },
    ],
  },
];

const methodColors: Record<string, string> = {
  GET: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  PUT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const ApiEndpointsView: React.FC = () => {
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({ 0: true });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleEndpoint = (key: string) => {
    setExpandedEndpoint(prev => prev === key ? null : key);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const totalEndpoints = sections.reduce((sum, s) => sum + s.endpoints.length, 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Endpoints</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Complete API documentation for all {totalEndpoints} endpoints across {sections.length} categories.
        </p>
      </div>

      {/* Authentication Info */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
        <div className="flex items-start gap-3">
          <Icon name={IconName.Admin} className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-blue-800 dark:text-blue-300">Authentication</h3>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              <strong>External APIs</strong> require an <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-xs font-mono">x-api-key</code> header.
              Contact your system administrator to obtain the API key.
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              <strong>Internal APIs</strong> use session-based authentication via JWT tokens from the login endpoint.
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              Base URL: <code className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-xs font-mono">https://ai-lms-tms.tertiaryinfo.tech</code>
            </p>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {sections.map((section, sIdx) => (
          <div key={sIdx} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 overflow-hidden">
            {/* Section Header */}
            <button
              onClick={() => toggleSection(sIdx)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors bg-gray-50 dark:bg-slate-800/80"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">{section.title}</h2>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300">
                    {section.endpoints.length}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{section.description}</p>
              </div>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${expandedSections[sIdx] ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Section Endpoints */}
            {expandedSections[sIdx] && (
              <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50">
                {section.endpoints.map((ep, eIdx) => {
                  const epKey = `${sIdx}-${eIdx}`;
                  const isExpanded = expandedEndpoint === epKey;

                  return (
                    <div key={eIdx}>
                      {/* Endpoint Row */}
                      <button
                        onClick={() => toggleEndpoint(epKey)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors"
                      >
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono w-14 text-center flex-shrink-0 ${methodColors[ep.method]}`}>
                          {ep.method}
                        </span>
                        <code className="text-xs font-mono text-gray-700 dark:text-gray-300 flex-1 truncate">{ep.path}</code>
                        <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline flex-shrink-0">{ep.title}</span>
                        <svg
                          className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Expanded Detail */}
                      {isExpanded && (
                        <div className="border-t border-gray-100 dark:border-gray-700/50 px-4 py-4 space-y-4 bg-gray-50/50 dark:bg-slate-900/30">
                          <p className="text-sm text-gray-600 dark:text-gray-300">{ep.description}</p>

                          {/* Headers */}
                          {ep.headers.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Headers</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                                      <th className="pb-1 pr-4">Name</th>
                                      <th className="pb-1 pr-4">Value</th>
                                      <th className="pb-1">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ep.headers.map((h, i) => (
                                      <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{h.name}</td>
                                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-500 dark:text-gray-400">{h.value}</td>
                                        <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{h.description}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Query Parameters */}
                          {ep.queryParams && ep.queryParams.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Query Parameters</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                                      <th className="pb-1 pr-4">Name</th>
                                      <th className="pb-1 pr-4">Type</th>
                                      <th className="pb-1 pr-4">Required</th>
                                      <th className="pb-1">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ep.queryParams.map((p, i) => (
                                      <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{p.name}</td>
                                        <td className="py-1.5 pr-4 text-xs text-gray-500 dark:text-gray-400">{p.type}</td>
                                        <td className="py-1.5 pr-4">
                                          {p.required
                                            ? <span className="text-xs text-red-600 dark:text-red-400 font-medium">Yes</span>
                                            : <span className="text-xs text-gray-400">No</span>
                                          }
                                        </td>
                                        <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{p.description}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Body Fields */}
                          {ep.bodyFields && ep.bodyFields.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Request Body (JSON)</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                                      <th className="pb-1 pr-4">Field</th>
                                      <th className="pb-1 pr-4">Type</th>
                                      <th className="pb-1 pr-4">Required</th>
                                      <th className="pb-1">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ep.bodyFields.map((f, i) => (
                                      <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">{f.name}</td>
                                        <td className="py-1.5 pr-4 text-xs text-gray-500 dark:text-gray-400">{f.type}</td>
                                        <td className="py-1.5 pr-4">
                                          {f.required
                                            ? <span className="text-xs text-red-600 dark:text-red-400 font-medium">Yes</span>
                                            : <span className="text-xs text-gray-400">No</span>
                                          }
                                        </td>
                                        <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{f.description}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Example Request */}
                          {ep.exampleRequest && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Example Request</h4>
                                <button
                                  onClick={() => copyToClipboard(ep.exampleRequest!, `req-${epKey}`)}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                >
                                  {copiedKey === `req-${epKey}` ? 'Copied!' : 'Copy'}
                                </button>
                              </div>
                              <pre className="bg-gray-900 text-gray-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                                {ep.exampleRequest}
                              </pre>
                            </div>
                          )}

                          {/* Example Response */}
                          {ep.exampleResponse && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Example Response</h4>
                                <button
                                  onClick={() => copyToClipboard(ep.exampleResponse!, `res-${epKey}`)}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                >
                                  {copiedKey === `res-${epKey}` ? 'Copied!' : 'Copy'}
                                </button>
                              </div>
                              <pre className="bg-gray-900 text-gray-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                                {ep.exampleResponse}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Error Codes */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 p-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Standard Error Codes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Description</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">200</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Success</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400">400</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Bad request - Missing required fields or invalid data</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">401</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Unauthorized - Invalid or missing API key / session token</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400">403</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Forbidden - Account disabled or insufficient permissions</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">404</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Not found - Resource does not exist</td>
              </tr>
              <tr className="border-b dark:border-gray-700/50">
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400">405</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Method not allowed - Wrong HTTP method</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs"><span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">500</span></td>
                <td className="py-2 text-gray-600 dark:text-gray-300">Internal server error</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ApiEndpointsView;
