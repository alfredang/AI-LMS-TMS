---
layout: default
title: API Reference
nav_order: 4
---

# API Reference

Complete REST API documentation for AI-LMS-TMS.

---

## Base URL

```
Development: http://localhost:3000/api
Production:  https://ai-lms-tms.vercel.app/api
```

---

## Authentication

### Login

**POST** `/auth/login`

Authenticate user with email and password or OTP.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "<your-password>",
  "loginType": "password"
}
```

Or with OTP:
```json
{
  "email": "user@example.com",
  "otp": "123456",
  "loginType": "otp"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "fullName": "John Doe",
      "role": "learner",
      "roles": ["learner", "trainer"]
    },
    "token": "jwt-token",
    "roles": ["learner", "trainer"]
  }
}
```

---

### Send OTP

**POST** `/auth/send-otp`

Send OTP code to user's email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP has been sent to your email address"
}
```

---

### Logout

**POST** `/auth/logout`

Logout current user.

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Courses

### List Courses

**GET** `/courses`

Retrieve all available courses.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by title or description |
| `category` | string | Filter by category |
| `status` | string | Filter by status (active, draft) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Course Title",
      "description": "Course description",
      "duration": 40,
      "fee": 500.00,
      "status": "active"
    }
  ]
}
```

---

### Get Course Details

**GET** `/courses/[id]`

Retrieve detailed course information.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Course Title",
    "description": "Full description",
    "objectives": ["Objective 1", "Objective 2"],
    "learningUnits": [
      {
        "id": "uuid",
        "title": "Unit 1",
        "subtopics": [
          {
            "id": "uuid",
            "title": "Subtopic 1.1",
            "content": "Content..."
          }
        ]
      }
    ]
  }
}
```

---

### Create Course

**POST** `/courses/create-course`

Create a new course (Developer/Admin only).

**Request Body:**
```json
{
  "title": "New Course",
  "description": "Course description",
  "duration": 40,
  "fee": 500.00,
  "objectives": ["Objective 1"]
}
```

---

## Enrollments

### List Enrollments

**GET** `/enrollments`

Get enrollments for current user.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Filter by user ID (Admin) |
| `courseRunId` | string | Filter by course run |
| `status` | string | Filter by status |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "courseRunId": "uuid",
      "status": "enrolled",
      "progress": 45,
      "enrolledAt": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### Enroll in Course

**POST** `/enrolments/enroll`

Enroll current user in a course run.

**Request Body:**
```json
{
  "courseRunId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "enrollmentId": "uuid",
    "status": "enrolled"
  }
}
```

---

### Unenroll

**POST** `/enrolments/unenroll`

Remove enrollment from course.

**Request Body:**
```json
{
  "enrollmentId": "uuid"
}
```

---

## Assessments

### List Assessments

**GET** `/assessments`

Get assessments for a course.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `courseId` | string | Filter by course |
| `type` | string | Filter by type (exam, project, etc.) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Final Exam",
      "type": "exam",
      "dueDate": "2024-02-01T23:59:59Z",
      "maxScore": 100
    }
  ]
}
```

---

### Create Assessment

**POST** `/assessments`

Create new assessment (Developer/Admin).

**Request Body:**
```json
{
  "courseId": "uuid",
  "title": "Assessment Title",
  "type": "exam",
  "description": "Instructions...",
  "dueDate": "2024-02-01T23:59:59Z",
  "maxScore": 100
}
```

---

### Submit Assessment

**POST** `/submissions/submit`

Submit assessment work.

**Request Body (multipart/form-data):**
```
assessmentId: uuid
file: [File]
comments: "Submission notes"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "submissionId": "uuid",
    "submittedAt": "2024-01-20T14:30:00Z"
  }
}
```

---

## Grading

### Get Submissions

**GET** `/grading/learner-submissions`

Get submissions for grading (Trainer/Admin).

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `assessmentId` | string | Filter by assessment |
| `courseRunId` | string | Filter by course run |
| `status` | string | pending, graded |

---

### Grade Submission

**PUT** `/grading/update-grading`

Grade a submission.

**Request Body:**
```json
{
  "submissionId": "uuid",
  "score": 85,
  "feedback": "Good work! Areas for improvement...",
  "status": "graded"
}
```

---

## Admin Operations

### Get Statistics

**GET** `/admin/statistics`

Get dashboard statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalUsers": 150,
    "totalCourses": 25,
    "activeEnrollments": 320,
    "completedCourses": 180
  }
}
```

---

### List Classes

**GET** `/admin/classes`

Get all class runs.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | upcoming, ongoing, completed |

---

### Assign Trainer

**POST** `/admin/assign-trainer`

Assign trainer to course run.

**Request Body:**
```json
{
  "courseRunId": "uuid",
  "trainerId": "uuid"
}
```

---

## User Profile

### Get Profile

**GET** `/profile`

Get current user's profile.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | User ID |

---

### Update Profile

**PUT** `/profile-update`

Update user profile.

**Request Body:**
```json
{
  "fullName": "Updated Name",
  "phone": "+65 9123 4567",
  "address": "123 Street"
}
```

---

## File Upload

### Upload File

**POST** `/upload/[type]`

Upload file (learner, trainer, developer, admin).

**Types:** `learner`, `trainer`, `developer`, `admin`

**Request (multipart/form-data):**
```
userId: uuid
file: [File]
category: profile_picture | cv | certificate
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fileUrl": "/uploads/learner/uuid/filename.jpg"
  }
}
```

---

## SSG Integration

### List SSG Courses

**GET** `/ssg/courses`

Get courses registered with SSG.

---

### Create Course Run

**POST** `/ssg/courses/courseRuns/create-new`

Create course run in SSG.

**Request Body:**
```json
{
  "courseReferenceNumber": "CRS-001",
  "startDate": "2024-03-01",
  "endDate": "2024-03-15",
  "sessions": [
    {
      "date": "2024-03-01",
      "startTime": "09:00",
      "endTime": "17:00"
    }
  ]
}
```

---

### Encrypt Data

**POST** `/ssg/encrypt`

Encrypt sensitive data for SSG.

**Request Body:**
```json
{
  "data": "S1234567D"
}
```

---

## Error Responses

All endpoints return consistent error format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

[Back to Home](./)
