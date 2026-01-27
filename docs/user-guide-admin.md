---
layout: default
title: Admin User Guide
---

# Admin User Guide

Complete guide for administrators using AI-LMS-TMS.

[Back to Home](./)

---

## Overview

As an **Admin**, you have comprehensive control over the training management system. You can manage classes, trainers, enrollments, and integrate with SkillsFuture Singapore (SSG) for grants and claims. This guide covers all administrative functions.

---

## Getting Started

### Logging In

1. Navigate to the AI-LMS-TMS platform
2. Enter your registered email address
3. Click **"Send OTP"** to receive a verification code
4. Enter the 6-digit OTP sent to your email
5. Click **"Verify & Login"**

### First-Time Setup

Complete your admin profile:

1. Click on your profile icon
2. Select **"Profile"**
3. Fill in your contact details
4. Click **"Save"**

---

## Admin Dashboard

### Dashboard Statistics

Your dashboard displays real-time metrics:

| Metric | Description |
|--------|-------------|
| **Total Learners** | Number of registered learners |
| **Total Trainers** | Number of active trainers |
| **Ongoing Classes** | Course runs currently in session |
| **Classes (Next 7 Days)** | Upcoming classes this week |
| **Classes (Next 30 Days)** | Upcoming classes this month |
| **Completed Classes** | Total finished course runs |

### Upcoming Classes Widget

View immediately upcoming classes with:
- Course name
- Start date
- Enrolled learner count
- Assigned trainer

---

## Navigation

### Main Menu

The admin sidebar provides access to:

**Class Management**
- View Courses
- View Trainers
- Upcoming Classes
- Ongoing Classes
- Completed Classes
- Create New Class
- Enroll Learners
- Add Trainers

**TPG Management** (Training Provider Gateway)
- Apply New Grant
- Search Grant
- View Grant Status
- Submit Assessment
- View Assessments
- Apply New Claim
- View Claim Status
- Upload Course Runs

---

## Class Management

### View Courses

Browse all course templates:

1. Go to **Class Management > View Courses**
2. View course list with:
   - Course name and code
   - Course type (WSQ, IBF, General)
   - Duration
   - Status
3. Click on a course for details

### View Trainers

Manage trainer information:

1. Go to **Class Management > View Trainers**
2. View trainer list:
   - Name and contact
   - Email
   - Expertise areas
   - Status (Active/Inactive)
3. Click on a trainer for detailed profile

#### Updating Trainer Status

1. Click on a trainer
2. Click **"Edit Status"**
3. Change status (Active/Inactive)
4. Click **"Save"**

### Upcoming Classes

View scheduled future classes:

1. Go to **Class Management > Upcoming Classes**
2. View list of upcoming course runs
3. Each entry shows:
   - Course name
   - Start and end dates
   - Trainer assigned
   - Enrollment count
4. Click for details or to edit

### Ongoing Classes

Monitor active classes:

1. Go to **Class Management > Ongoing Classes**
2. View classes currently in session
3. Track:
   - Progress status
   - Learner attendance
   - Assessment completion
4. Take action if needed

### Completed Classes

Review finished classes:

1. Go to **Class Management > Completed Classes**
2. View historical class data
3. Access:
   - Final grades
   - Completion certificates
   - Attendance records
4. Generate reports as needed

---

## Creating a New Class (Course Run)

### Step-by-Step Guide

#### Step 1: Select Course Template

1. Go to **Class Management > Create New Class**
2. Browse available course templates
3. Click **"Select"** on the desired course

#### Step 2: Set Class Details

Enter course run information:

| Field | Description |
|-------|-------------|
| **Start Date** | First day of the class |
| **End Date** | Last day of the class |
| **Training Location** | Physical address or "Online" |
| **Max Participants** | Maximum enrollment capacity |
| **Registration Deadline** | Last date for enrollment |

#### Step 3: Assign Trainer

1. Click **"Assign Trainer"**
2. Browse available trainers
3. Review trainer qualifications
4. Select appropriate trainer
5. Confirm assignment

#### Step 4: Configure Sessions

Set up class sessions:

1. Click **"Add Session"**
2. Enter session details:
   - Date
   - Start time
   - End time
   - Location/Room
3. Repeat for all sessions

#### Step 5: Review and Create

1. Review all entered information
2. Verify dates and assignments
3. Click **"Create Class"**
4. Class is now available for enrollment

---

## Enrolling Learners

### Manual Enrollment

1. Go to **Class Management > Enroll Learners**
2. Select the class (course run)
3. Search for learners:
   - By name
   - By email
   - By NRIC/FIN
4. Select learners to enroll
5. Click **"Enroll Selected"**

### Enrollment Options

| Option | Description |
|--------|-------------|
| **Individual** | Enroll one learner at a time |
| **Bulk** | Upload Excel file with learner list |
| **Transfer** | Move learner between classes |

### Managing Enrollment Status

Update enrollment status:

1. Go to the class details
2. Click **"Learners"** tab
3. Select a learner
4. Change status:
   - **Confirmed**: Enrollment confirmed
   - **Pending**: Awaiting confirmation
   - **Waitlist**: On waiting list
   - **Cancelled**: Enrollment cancelled
   - **Completed**: Course finished

### Removing Learners

1. Go to class details > Learners
2. Find the learner
3. Click **"Remove"**
4. Confirm removal

---

## Managing Trainers

### Adding New Trainers

1. Go to **Class Management > Add Trainers**
2. Enter trainer information:

| Field | Required | Description |
|-------|----------|-------------|
| **Full Name** | Yes | Legal name |
| **Email** | Yes | Login email |
| **Phone** | Yes | Contact number |
| **Expertise** | Yes | Areas of expertise |
| **Qualifications** | No | Educational background |
| **Certifications** | No | Professional certifications |

3. Click **"Create Trainer"**
4. Trainer receives login credentials via email

### Editing Trainer Information

1. Go to **View Trainers**
2. Click on the trainer
3. Click **"Edit"**
4. Update information
5. Click **"Save"**

### Assigning Trainers to Classes

1. Go to class details
2. Click **"Change Trainer"**
3. Select new trainer
4. Confirm assignment

---

## TPG Management (SSG Integration)

### Overview

TPG (Training Provider Gateway) Management allows integration with SkillsFuture Singapore (SSG) for:
- Grant applications
- Enrollment submissions
- Assessment result reporting
- Claims processing

### Apply New Grant

Submit grant applications for funded courses:

1. Go to **TPG Management > Apply New Grant**
2. Select course and course run
3. Enter grant details:
   - Grant type
   - Funding category
   - Supporting documents
4. Click **"Submit Application"**

### Search Grant

Look up existing grants:

1. Go to **TPG Management > Search Grant**
2. Enter search criteria:
   - Reference number
   - Course name
   - Date range
3. View matching grants

### View Grant Status

Monitor grant application progress:

1. Go to **TPG Management > View Grant Status**
2. View all submitted grants
3. Check status:
   - **Pending**: Under review
   - **Approved**: Grant approved
   - **Rejected**: Application denied
4. View feedback/comments

### Submit Assessment

Report assessment results to SSG:

1. Go to **TPG Management > Submit Assessment**
2. Select course run
3. Enter learner assessment results:
   - Competency outcome (Competent/Not Yet Competent)
   - Assessment date
   - Assessor information
4. Click **"Submit to SSG"**

### View Assessments

Review submitted assessment records:

1. Go to **TPG Management > View Assessments**
2. View all submitted assessments
3. Check SSG acknowledgment status
4. Download reports if needed

### Apply New Claim

Submit funding claims:

1. Go to **TPG Management > Apply New Claim**
2. Select course run with completed learners
3. Enter claim details:
   - Claim amount
   - Supporting attendance records
4. Click **"Submit Claim"**

### View Claim Status

Track claim processing:

1. Go to **TPG Management > View Claim Status**
2. View all submitted claims
3. Monitor payment status:
   - **Submitted**: Claim received
   - **Processing**: Under review
   - **Approved**: Claim approved
   - **Paid**: Payment disbursed
   - **Rejected**: Claim denied

### Upload Course Runs

Bulk upload course runs:

1. Go to **TPG Management > Upload Course Runs**
2. Download Excel template
3. Fill in course run data
4. Upload completed file
5. Review import results
6. Confirm successful imports

---

## Certificate Management

### Configuring Certificates

1. Go to class details
2. Click **"Certificate Settings"**
3. Configure:
   - Certificate template
   - Signatory name and title
   - Logo placement
4. Save settings

### Issuing Certificates

1. Verify learner has completed requirements
2. Go to learner's enrollment
3. Click **"Issue Certificate"**
4. Certificate is generated and available

### Bulk Certificate Issuance

1. Go to completed class
2. Click **"Issue All Certificates"**
3. System generates certificates for all eligible learners
4. Certificates available for download

---

## Reports and Analytics

### Available Reports

| Report | Description |
|--------|-------------|
| **Enrollment Report** | Learner enrollment statistics |
| **Completion Report** | Course completion rates |
| **Assessment Report** | Assessment scores and outcomes |
| **Trainer Report** | Trainer assignments and load |
| **Financial Report** | Grant and claim summaries |

### Generating Reports

1. Go to the relevant section
2. Click **"Generate Report"**
3. Select date range and filters
4. Click **"Export"**
5. Download as Excel or PDF

---

## System Administration

### User Management

View and manage system users:

1. Access user list
2. Search by name, email, or role
3. View user details
4. Update user roles if needed

### Role Assignment

Assign or modify user roles:

1. Select user
2. Click **"Manage Roles"**
3. Add or remove roles:
   - Learner
   - Trainer
   - Developer
   - Admin
   - Training Provider
4. Save changes

---

## Troubleshooting

### Common Issues

**Can't create a new class?**
- Verify course template exists
- Check you have admin permissions
- Ensure all required fields are filled

**Trainer not appearing in list?**
- Verify trainer account is active
- Check trainer status isn't set to inactive
- Ensure trainer has proper role assigned

**Enrollment failing?**
- Check class hasn't reached capacity
- Verify registration deadline hasn't passed
- Ensure learner account exists

**SSG submission errors?**
- Verify SSG credentials are configured
- Check data format matches SSG requirements
- Review error messages for specific issues

---

## Best Practices

### Class Management

1. **Plan Ahead**: Create classes well in advance
2. **Monitor Capacity**: Track enrollment numbers
3. **Communicate**: Notify trainers of assignments promptly
4. **Document**: Keep records of all changes

### Enrollment Management

1. **Verify Information**: Double-check learner details
2. **Track Deadlines**: Monitor registration cutoffs
3. **Handle Waitlists**: Manage overflow appropriately
4. **Confirm Attendance**: Verify learner participation

### SSG Integration

1. **Submit Timely**: Meet SSG submission deadlines
2. **Verify Data**: Double-check all submissions
3. **Keep Records**: Maintain documentation
4. **Follow Up**: Track grant and claim status

---

## Quick Reference

### Status Definitions

| Status | Meaning |
|--------|---------|
| **Active** | Currently active and available |
| **Inactive** | Temporarily disabled |
| **Pending** | Awaiting action or approval |
| **Approved** | Successfully approved |
| **Rejected** | Application/request denied |
| **Completed** | Successfully finished |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Esc` | Close modal |
| `Enter` | Confirm action |

---

[Back to Home](./)
