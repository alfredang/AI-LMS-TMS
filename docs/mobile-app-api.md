# Learner and trainer app API (`/api/mobile/*`)

Shared by the iOS and the Android app (TIA TMS). Every route except sign-in needs
`Authorization: Bearer lms_…` (the session token from sign-in). The caller is always the session
user; ids in a request are checked against that user's enrolment (learner) or trainer assignment
(trainer) before anything is returned or changed. Errors are `{ "error": "message for the user" }`
with a 4xx/5xx status; `401` means the session has ended.

The older routes stay as they are: `/api/mobile/auth`, `/me`, `/dashboard`, `/device`,
`/delete-account` (iOS) and `/api/android/*` (Android sign-in, dashboard, device). A token from
either sign-in works on every route below.

## Sign-in

`POST /api/mobile/login` (public) `{ email, password }` →
`{ data: { user: { id, email, fullName, role, roles }, token, forcePasswordChange } }`.
Existing active learner/trainer accounts only. 8 attempts per email per 15 minutes (`429`).

`POST /api/mobile/password` `{ currentPassword, newPassword }` → `{ success: true }`. At least
8 characters. Ends the user's other sessions.

## Profile

`GET /api/mobile/profile` → `{ data: { id, email, fullName, pictureURL, theme, phone, company,
employmentStatus, linkedinURL, brandColor, academy } }`.
`theme` is `system`, `light` or `dark`. `brandColor` is the academy's colour (`#RRGGBB`).

`PATCH /api/mobile/profile` with any of `fullName`, `phone`, `company`, `employmentStatus`
(`Employed`, `Unemployed`, `Looking for Job`), `linkedinURL` (trainer), `theme` → the updated
profile. Other fields are ignored. Email, password, NRIC and roles cannot be changed here.

## Classes

`GET /api/mobile/dashboard?role=learner|trainer` → `{ courses: [...], sessions: [...] }` (unchanged;
each course now also has `runCode` and `classStatus`).

`GET /api/mobile/class?id=<course id from the dashboard>&role=learner|trainer` → `{ data }`:

| Field | Notes |
|---|---|
| `id`, `runCode`, `title`, `code`, `startDate`, `endDate`, `format`, `classStatus`, `venue`, `meetingURL` | class header |
| `materials[]` | `{ id, title, url }`. Learner: slides, guide, activities, and the lesson plan when the academy allows it. Trainer: also trainer slides, lesson plan, facilitator guide, assessment plan. |
| `sessions[]` | `{ id, label, date, startTime, endTime }` plus `attendance` (`present`, `absent` or `null`) for a learner, `presentCount` for a trainer |
| `ssgAttendanceURL` | SSG e-attendance: the learner's take-attendance link, or the trainer's QR page. `null` when the class has no digital attendance id. |
| `assessments[]` | `{ type, label, questionURL, published, submissions[] }`. A learner only receives published assessments; `submissions[]` are their own files `{ id, fileName, fileURL, submittedAt, signed }`. |
| `traqomURL` | TRAQOM survey link |
| learner only | `assessmentStatus`, `traqomCompleted`, `feedback: { enabled, externalURL, submitted }` |
| trainer only | `roster[]` `{ enrolmentId, name, status, traqomCompleted, submissions }`, `feedbackCount` |

## Attendance

- `GET /api/mobile/attendance?sessionId=` (assigned trainer) →
  `{ data: { checkinURL, learners: [{ enrolmentId, name, isPresent, reason }] } }`.
  `checkinURL` is the session's Take Attendance link; show it as a QR code.
- `POST /api/mobile/attendance` `{ action: "mark", sessionId, records: [{ enrolmentId, isPresent, reason? }] }`
  (assigned trainer) → `{ success, saved, data: { learners } }`. Manual attendance.
- `POST /api/mobile/attendance` `{ action: "checkin", code }` (learner) →
  `{ success, message, already, course, session }`. `code` is the text of the scanned QR code.

SSG e-attendance itself is taken on MySkillsFuture with Singpass (`ssgAttendanceURL`).

## Assessments

A learner's file is first uploaded to the academy's Google Drive:
`POST /api/upload/google-drive?studentName=&courseRunId=<runCode>` (multipart field `file`,
100 MB) → `{ data: { fileUrl, studentFolderId } }`. Then (pass `studentFolderId` as `folderId`):

- `POST /api/mobile/assessments` `{ action: "submit", runId, type, fileName, fileURL, folderId? }` → `201 { success, id }`.
  Enrolled learner, published assessment, Google Drive link only.
- `DELETE /api/mobile/assessments` `{ submissionId }` → own file, not yet signed by the assessor.
- `POST /api/mobile/assessments` `{ action: "grade", enrolmentIds: [..], isCompetent }` (assigned trainer) →
  `{ success, status }` (`Competent` or `Not Yet Competent`).

## Course feedback

- `GET /api/mobile/feedback?runId=` (enrolled learner) →
  `{ data: { title, sections: [{ id, title, fields: [{ id, label, type, required, options, autofill, readonly }] }], submitted, autofill } }`.
  Field types: `text`, `email`, `date`, `textarea`, `select`, `rating1to5`. Fields with `autofill`
  are filled by the server from the class.
- `POST /api/mobile/feedback` `{ runId, answers: { <field id>: value } }` → `201`. One response per learner per class (`409` after that).

When the academy uses an external feedback form, `feedback.externalURL` on the class is set; open that link.

## Verification

Disposable PostgreSQL only (see `docs/mobile-ios.md`):

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:15439/postgres ENABLE_APP_SCHEDULER=false npx next dev --webpack -p 3004
DATABASE_URL=postgresql://postgres@127.0.0.1:15439/postgres node --import tsx tests/mobile-app-integration.ts
```
