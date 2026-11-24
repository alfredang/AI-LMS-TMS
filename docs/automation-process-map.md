# TMS automation inspection map

Use this map to start investigations, then establish actual account, country,
course scope, enabled state and freshness from source and live configuration.
Rows describe candidate implementations, not verified active ownership. Optional
operational-worker modules may be present in a development checkout before they
are deployed; check that each referenced module exists in the deployed revision. The map
includes native entry points; the Google registry/source tool supplies project
IDs and file/line references for the connected account. Other tools such as n8n
must be inspected when the process or dependencies point to them.

| Business action | Native code to inspect | Google registry/source search terms |
|---|---|---|
| Calendar creation and learner guests | `lib/calendar/ensureClassCalendarEvent.ts`, `lib/google-calendar/da-calendar-sync.ts`, `lib/google-calendar/ca-calendar-sync.ts`, `pages/api/external/auto-add-today-enrolments-to-calendar.ts` | Add Orders to Calendar; `createEvent`, `Calendar.Events`, `addGuest`, `detectNewOrders` |
| Calendar editing, reschedules and cancellations | `lib/rescheduleHelpers.ts`, `lib/directApplicationCancellation.ts`, `lib/calendar/operationalCalendarWriter.ts`, `lib/calendar/operationalCalendarProjection.ts` | `setTime`, `setDescription`, `setTitle`, `deleteEvent`, `Calendar.Events.patch`, `Calendar.Events.update` |
| Trainer assignment and Calendar invitations | `lib/calendar/addTrainerToCalendar.ts`, `lib/calendar/confirmTrainerOnCalendar.ts` | `addGuest`, `removeGuest`, trainer, invite |
| Course confirmations and reminders | `lib/scheduler/scheduler.ts`, relevant `/api/external/` task route and configured email template | Course Confirmation Email; First Reminder; `sendEmail`, `GmailApp`, `MailApp` |
| Courseware and Meet details | `pages/api/external/auto-send-courseware-attendance.ts`, `lib/learner/coursewareEmailTemplate.ts`, `lib/learner/coursewareMasterTemplate.ts` | Courseware Delivery Automation; Google Meet Details to Learners; `sendEmail` |
| Registration intake and enrolment | `lib/directApplicationAutomation.ts`, `lib/autoEnrolDirectApplications.ts`, `lib/autoEnrolCompanyApplications.ts`, `lib/mmsSync/`, `lib/registration/` | Auto Create Enrolment; Enrolment; Direct Applications Email Automation; `UrlFetchApp`, `SpreadsheetApp` |
| Grants and invoice instructions | relevant TPG/finance routes, scheduler configuration and business email templates | Actions Required for Grant Application; Grant Application; QuickBooks; `sendEmail`, `UrlFetchApp` |
| Enquiries and follow-up emails | relevant enquiry routes, email templates and scheduler configuration | AutoReplyEmailCourseLink; Google Forms Contact Us; Thank You Email |

For each investigated process, record:

- Google script ID/file/function and native file/route, with source hashes or Git revision.
- Connected account and documented owner; country, course category and input filters.
- What it reads and changes: Calendar events, recipients, spreadsheets, TMS/MMS records.
- Trigger/deployment configuration with its observation date, and execution evidence if available.
- Which implementation currently owns each action, any overlap and anything still unknown.

Update this map and project metadata when an authorized change establishes or
changes ownership. Do not infer active trigger coverage from source alone.
