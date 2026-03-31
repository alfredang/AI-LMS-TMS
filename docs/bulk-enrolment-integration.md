# Bulk Enrolment Integration Guide

## Overview

The bulk enrolment system allows administrators to upload an Excel file with multiple enrolment records, which are then processed sequentially and stored in the database.

## Architecture

```
Excel Upload → Frontend (React) → Next.js API → SSG API → PostgreSQL
```

## Features Implemented

### 1. Download Template Button
- Added download button for `Enrolment_Upload_Template.xlsx`
- Located in the Bulk Upload Enrolments view
- Template file: `/public/ssg_templates/Enrolment_Upload_Template.xlsx`

### 2. Database API Endpoint

**Endpoint:** `POST /api/enrolments/bulk-create`

**Functionality:**
- Checks if course exists by `course_code`, creates if missing
- Checks if learner account exists by email, creates if missing
- Checks if course run exists, creates if missing
- Prevents duplicate enrolments
- Inserts enrolment data into `enrollment` table
- Tracks enrolment in `ssg_enrolments` table

**Request Body:**
```json
{
  "enrolment": {
    "traineeEmail": "john@example.com",
    "traineeName": "John Doe",
    "traineeNric": "S1234567A",
    "courseCode": "TGS-2020503177",
    "courseTitle": "Data Visualization with Tableau",
    "courseRunId": "1234567",
    "courseReferenceNumber": "REF-001",
    "sponsorshipType": "Company",
    "enrolmentDate": "2026-02-04",
    "enrolmentStatus": "Confirmed",
    "enrolmentId": "ENR-2602-013657"
  }
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "enrolment": {
      "referenceNumber": "ENR-2602-013657",
      "status": "Confirmed"
    }
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": {
    "message": "Duplicate enrolment",
    "details": [
      {
        "field": "enrolment",
        "message": "Duplicate record found"
      }
    ]
  }
}
```

## Backend Processing Flow

The backend endpoint `/api/enrolments/bulk-create` receives the processed Excel records and performs the following for each record:

1. **Submit to SSG API (external)**
2. **Call database inserts**
3. **Return aggregated results** to frontend

## Database Schema

### Tables Involved

#### 1. `course` Table
- Stores course information
- Unique constraint on `course_code`
- Auto-created if course doesn't exist

#### 2. `app_user` Table
- Stores user accounts (learner role)
- Unique constraint on `email`
- Auto-created with temporary password if user doesn't exist

#### 3. `learner_profile` Table
- Stores learner-specific information
- Linked to `app_user` via `user_id`

#### 4. `course_run` Table
- Stores specific course run instances
- Linked to `course` via `course_id`

#### 5. `enrollment` Table
- Main enrolment records
- Links `user_id`, `course_id`, and `course_run_id`
- Unique constraint prevents duplicate enrolments

#### 6. `ssg_enrolments` Table
- Tracks SSG-imported enrolments
- Stores raw JSON data for audit trail

## Error Handling

### Frontend Error Display

The frontend shows user-friendly error messages:

- **Success:** Green box with checkmark icon
- **Failure:** Red box with X icon
- **Format:** "Enrolment Created Unsuccessfully" header with specific error messages

### Common Errors

1. **Duplicate Enrolment**
   - Status: 400
   - Message: "Duplicate record found"
   - Cause: Learner already enrolled in the same course run

2. **Missing Data**
   - Status: 400
   - Message: "Required field missing"
   - Cause: Missing required fields in Excel file

3. **Database Error**
   - Status: 500
   - Message: "Internal server error"
   - Cause: Database connection or constraint violation

## Excel Template Structure

The `Enrolment_Upload_Template.xlsx` should contain these columns:

- Trainee Email
- Trainee Name
- Trainee NRIC
- Course Code
- Course Title
- Course Run ID
- Course Reference Number
- Sponsorship Type
- Enrolment Date (DD/MM/YYYY)
- Enrolment Status
- Enrolment ID

## Testing

### Manual Testing

1. Download the template
2. Fill in sample data
3. Upload the file
4. Verify results in the UI
5. Check database for inserted records

### SQL Verification Queries

```sql
-- Check created courses
SELECT * FROM course WHERE course_code = 'YOUR_COURSE_CODE';

-- Check created learners
SELECT * FROM app_user WHERE email = 'learner@example.com';

-- Check enrolments
SELECT e.*, u.email, c.course_code, cr.course_run_id
FROM enrollment e
JOIN app_user u ON e.user_id = u.id
JOIN course c ON e.course_id = c.id
JOIN course_run cr ON e.course_run_id = cr.id
WHERE u.email = 'learner@example.com';

-- Check SSG enrolment tracking
SELECT * FROM ssg_enrolments ORDER BY created_date DESC LIMIT 10;
```

## Security Considerations

1. **Learner Account Creation**
   - Temporary passwords are generated using crypto.randomBytes
   - Password reset email should be sent (TODO: implement email service)

2. **Data Validation**
   - Email format validation
   - NRIC format validation (if applicable)
   - Date format validation

3. **Authorization**
   - Only admin users should access bulk upload
   - API endpoint should check user permissions (TODO: add auth middleware)

## Future Improvements

1. **Email Notifications**
   - Send welcome email to new learners
   - Include password reset link
   - Send enrolment confirmation

2. **Batch Processing**
   - Process large files in batches
   - Show progress bar
   - Allow cancellation

3. **Data Validation**
   - Pre-validate Excel data before submission
   - Show validation errors before upload
   - Highlight problematic rows

4. **Audit Trail**
   - Log who performed the bulk upload
   - Track changes to enrolment records
   - Generate upload summary report

5. **Course Enrichment**
   - Fetch course details from SSG API when creating new courses
   - Populate course metadata automatically

## Support

For issues or questions, contact the development team or refer to:
- [User Guide - Admin](/docs/user-guide-admin.md)
- [API Reference](/docs/api-reference.md)
