# SSG API Library

TypeScript client library for the SkillsFuture Singapore (SSG) API.
Handles certificate-based authentication, AES-256-CBC encryption/decryption, and request building.

---

## Structure

```
lib/ssg/
├── api/
│   ├── course-api.ts         # Course run CRUD + sessions
│   ├── enrolment-api.ts      # Enrolment lifecycle
│   ├── assessment-api.ts     # Assessment CRUD
│   └── attendance-api.ts     # Session attendance
├── models/
│   ├── course-runs.ts
│   ├── add-course-run.ts
│   ├── edit-delete-course-run.ts
│   ├── enrolment.ts
│   ├── assessment.ts
│   └── attendance.ts
├── services/
│   ├── credentials-service.ts   # Loads SSG cert + keys from DB
│   └── enrolment-service.ts
├── utils/
│   ├── cryptography.ts          # AES-256-CBC encrypt/decrypt
│   ├── http-utils.ts            # HTTP client + request builder
│   ├── validators.ts
│   └── sync-enrolment-to-db.ts
├── constants.ts
└── index.ts
```

---

## Available API Routes

### Course API — `api/course-api.ts`

| Method | SSG Endpoint | Library Function |
|--------|-------------|-----------------|
| GET | `/courses/courseRuns/id/{runId}` | `viewCourseRun(runId)` |
| POST | `/courses/courseRuns/publish` | `addCourseRun(runInfo)` |
| POST | `/courses/courseRuns/edit/{runId}` | `editCourseRun(runId, runInfo)` |
| POST | `/courses/courseRuns/edit/{runId}` | `addSessionsToCourseRun(runId, runInfo)` |
| POST | `/courses/courseRuns/edit/{runId}` | `deleteSessionsFromCourseRun(runId, ...)` |
| POST | `/courses/courseRuns/edit/{runId}` | `updateSessionsFromCourseRun(runId, ...)` |
| POST | `/courses/courseRuns/edit/{runId}` | `deleteCourseRun(runId, runInfo)` |
| GET | `/courses/runs/{runId}/sessions` | `viewCourseSessions(courseRef, runId)` |

> **Note:** There is no course search endpoint in this library. SSG course search requires a course reference number or keyword and is not currently implemented. The admin `CourseRunView` page uses an n8n webhook as a workaround for this.

---

### Enrolment API — `api/enrolment-api.ts`

| Method | SSG Endpoint | Library Function |
|--------|-------------|-----------------|
| POST | `/tpg/enrolments` | `createEnrolment(payload)` |
| GET | `/tpg/enrolments/details/{refNo}` | `viewEnrolment(refNo)` |
| POST | `/tpg/enrolments/search` | `searchEnrolment(payload)` |
| POST | `/tpg/enrolments/{refNo}` | `updateEnrolment(refNo, payload)` |
| POST | `/tpg/enrolments/feeCollections/{refNo}` | `updateFeeCollection(refNo, payload)` |
| POST | `/tpg/enrolments/{refNo}/cancel` | `cancelEnrolment(refNo, payload)` |

---

### Assessment API — `api/assessment-api.ts`

| Method | SSG Endpoint | Library Function |
|--------|-------------|-----------------|
| POST | `/tpg/assessments` | `createAssessment(payload)` |
| GET | `/tpg/assessments/{refNo}` | `viewAssessment(refNo)` |
| POST | `/tpg/assessments/search` | `searchAssessment(payload)` |
| POST | `/tpg/assessments/{refNo}` | `updateOrVoidAssessment(refNo, payload)` |

---

### Attendance API — `api/attendance-api.ts`

| Method | SSG Endpoint | Library Function |
|--------|-------------|-----------------|
| POST | `/courses/runs/{runId}/sessions/attendance` | `uploadAttendance(runId, payload)` |
| GET | `/courses/runs/{runId}/sessions/attendance` | `viewAttendance(runId, courseRef, sessionId?)` |

---

## Usage

```ts
import { getSSGCredentialsService } from './services/credentials-service';
import { createSSGCourseAPI } from './api/course-api';
import { createSSGEnrolmentAPI } from './api/enrolment-api';

const credentials = await getSSGCredentialsService().getSSGCredentials();
const baseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

const courseAPI = createSSGCourseAPI(baseUrl, credentials);
const enrolmentAPI = createSSGEnrolmentAPI(baseUrl, credentials);

// View a course run
const result = await courseAPI.viewCourseRun('1067920');

// Search enrolments for a course run
const enrolments = await enrolmentAPI.searchEnrolment({
  course: { run: { id: '1067920' } },
  parameters: { page: 0, pageSize: 20 }
});
```

---

## Authentication

All requests use **certificate-based mutual TLS**. The cert and private key are stored encrypted in the database per training provider and loaded via `credentials-service.ts`.

Payloads for write operations (POST) are **AES-256-CBC encrypted** before sending. Some GET responses are also encrypted and must be decrypted using the same key.
