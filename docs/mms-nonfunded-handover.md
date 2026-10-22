# Non-funded MMS handover

Project branch: `feat/mms-for-non-funded-courses`, based on the existing `chariot-production` checkout. The matching MMS branch has the same name.

TMS discovers course events in its configured Google Calendar (currently `sales@tertiarycourses.com.sg`), resolves the operational class/roster, and sends a complete revisioned snapshot to MMS. All entry points exclude trimmed, case-insensitive `TGS` prefixes. This feature does not change funded-course operations.

## Configuration and rollout

The new scheduler tasks default to disabled, and `MMS_SYNC_ENABLED` defaults to false. Configure secrets through the deployment environment; do not commit an API key or enable jobs against a live MMS instance before its matching migration/API is deployed.

| Environment variable | Value/purpose |
| --- | --- |
| `MMS_SYNC_ENABLED` | `true` to enable the pilot service and its manual controls. |
| `MMS_SYNC_URL` | Full MMS import URL ending in `/courses/api_tms_import`. HTTPS is required except for localhost tests. |
| `MMS_SYNC_API_KEY` | Dedicated credential matching MMS `mmd/tms_handover/api_key`. |
| `MMS_SYNC_COURSE_ALLOWLIST` | Comma-separated pilot course codes, e.g. `C916,C1382`. Empty means no imports. |
| `MMS_SYNC_PROVIDER_ID` | Defaults to `tertiary-sg`; must match MMS scope. |
| `MMS_SYNC_WEBSITE_ID` | Defaults to `1`; must match the MMS website. |
| `MMS_SYNC_HORIZON_DAYS` | Future discovery horizon; default 60 days. |
| `MMS_SYNC_FEEDBACK_URL_TEMPLATE` | Approved feedback URL template, normally `https://<TMS-host>/feedback/{run_uuid}`. A class without a TMS UUID gets no such link. An external mapped form may instead use `{source_run_key}` if that form actually supports this identity. |
| `MMS_PUBLIC_ORIGIN` | Canonical participant MMS origin, e.g. `https://<approved-MMS-host>`. Must match MMS `mmd/tms_handover/public_origin` and its dashboard origin. Do not infer it from the import API hostname. |
| `MMS_ACCESS_NOTIFICATIONS_ENABLED` | Defaults to false. Enable only after scoped previews, access tests and operations review. Pauses initial access mail, scoped course-day access mail, MMS reminder release and Calendar access-block updates while leaving previews available. |
| `MMS_ACCESS_SUPPORT` | Optional support contact override; otherwise the Company Settings support/company email or company telephone is used. A missing contact prevents access mail. |
| `MMS_PILOT_START_DATE` | Full-run first-session minimum in SGT; default `2026-10-23`. Match MMS `mmd/tms_handover/pilot_start_date`. |

The `create_mms_nonfunded_sync.sql` migration creates only integration metadata and transactional outbox triggers. The service applies it once per process when enabled. It can also be applied through the normal database migration workflow. Supported source changes enqueue work in the same transaction as the operational edit; a rollback therefore rolls back the queued change too.

Apply `database/migrations/create_mms_class_access.sql` **after** `create_mms_nonfunded_sync.sql`; `ensureSchema()` applies them in that order. It adds per-run approval/first-handover metadata and the participant notification outbox. Deploy MMS's matching class-access migration/API first, with synchronization and notification sending disabled. Existing funded templates and global TMS URL settings are not changed.

1. Deploy both feature branches with all new scheduler tasks disabled.
2. Configure matching source/target credentials, calendar/store/provider scope, and a small course allowlist.
3. Call the existing service-authenticated `/api/external/mms-sync?dry_run=true` to validate source snapshots and preview MMS create/adopt/update decisions. This records scan diagnostics but does not write MMS accounts/classes/rosters.
4. Save a pilot class in TMS and use **Sync MMS now** in Class by Date or Master List. Master List changes must finish saving before synchronization.
5. For a calendar-only class, explicitly check the trainer-confirmation checkbox only after the displayed saved trainer is assigned. A Calendar RSVP alone never confirms the assignment.
6. Verify both roles' actual login, class access, courseware permissions, sessions, attendance, and the mapped TMS feedback form. Only then mark MMS pilot access verification complete.
7. Enable `mms_nonfunded_discovery` (22:00 SGT), `mms_nonfunded_reconcile` (every two minutes), and `mms_nonfunded_worker` (every minute) in the existing Task Scheduler. Its timezone is explicitly Asia/Singapore.

Master List has a handover overview with recorded discovery exceptions and import/readiness failures. Per-class controls show job state, target class link, last successful sync, and unresolved warnings. Use the existing scheduler Run Now action for batch work.

## Source and ownership rules

- Prefer exact TMS run identity and its confirmed enrolments/direct/company applications. Otherwise use the persisted Master List connected to the exact Calendar occurrence.
- Direct/company applications without a TMS run are supported only when the Calendar supplies an explicit operational run reference and their course code matches exactly. Fuzzy course-title/date matching never determines a learner roster.
- A missing operational roster is incomplete; it cannot remove everybody from MMS.
- Imported source/run keys survive reschedules and later TMS mappings. Existing event IDs are adopted, and the MMS worker cannot create another Calendar event/invitation for a managed run.
- Roles and membership changes are scoped to participating non-funded classes. Transfers update the eligible side; funded destination/source classes remain in TMS.
- Profiles use stable TMS person IDs when available. Initial matching uses normalized email; persisted email aliases keep subsequent profile/email changes linked even when the saved Master List still shows the old address. Current TMS profile names/phones take precedence. Collisions and administratively blocked accounts require review.
- Multiple trainers or conflicting session overrides are explicitly reported for review; this pilot does not silently discard them. Non-`TGS` codes outside supported `C` routing are also reported for review.
- Memberships originating from native MMS orders/manual additions are retained on a TMS withdrawal and reported as conflicts. Attendance/certificates are preserved. An imported schedule with existing attendance cannot be silently remapped.

Jobs have expiring leases, bounded retries, per-class locks, a monotonic content revision, and dirty-state recovery for changes during delivery. MMS rejects stale revisions and verifies the snapshot content hash. A successful import can still be **incomplete** until trainer confirmation, materials, feedback, and access verification are ready.

## Verification

Local verification on 21 October 2026: 15 source/contract tests plus eight existing trainer/mobile-reminder regressions passed; API auth coverage passed for 598 routes. The type baseline comparison reported 168 existing unique diagnostics and no new diagnostics. Isolated PostgreSQL trigger tests and a TMS-generated Unicode snapshot's PHP contract/hash check also passed. These checks do not establish production latency or real Google/account permissions.

Run `node --import tsx --test tests/mms-sync.test.ts tests/mms-sync-source.test.ts`, `node scripts/check-api-auth.js`, and `node --expose-gc scripts/check-mms-sync-types.cjs` before committing. The last command compares diagnostics with HEAD without altering either worktree; unrelated baseline type errors remain visible.

Disposable PostgreSQL fixtures under `tests/fixtures/mms-sync-outbox-*` exercise atomic queueing, rollback, coalescing, shared identities, and funded reclassification. Use an isolated test database, never a live connection. Matching MMS contract/runtime tests are in its `scripts/tests/` directory.

Disable the new scheduler tasks and `MMS_SYNC_ENABLED` to stop delivery. Keep mappings and audit history; do not delete accounts/classes to retry. This implementation is Phase 1. Production activation and the delivered-class pilot are separate rollout steps.

## Participant access and exact-run pilot approval — 22 October 2026

1. Keep `MMS_ACCESS_NOTIFICATIONS_ENABLED=false`. Configure the canonical participant origin on both ends. MMS checks that its participant and dashboard origins match; a mismatched domain cannot report ready access.
2. Use **Preview MMS access** on the exact class in TMS. Review all sessions, the full run's first session, confirmed trainer and active learner list. A course-code allowlist alone grants no import approval. Calendar entries labelled Day/Session/Part 2 or later require the full run, including its first day, to be resolved first.
3. Verify that the entire course starts on/after 23 October and has not already begun. Check the full-run approval checkbox and use **Sync MMS now**. The server records the reviewer and first-session timestamp. Both TMS and MMS reject an initial handover after that timestamp; retries and ordinary changes remain allowed for a run handed over before it started.
4. If a future first session is rescheduled, preview and explicitly review its new start before either the previous or new start has passed. The same MMS run/class ID is retained. A course already underway cannot be reapproved with a later first session.
5. Verify learner/trainer account access, actual OTP receipt, exact-class landing after password/OTP/role selection, courseware permissions and feedback. Inspect both rendered access messages and the correct support contact. The importer itself sends no welcome/OTP/invitation.
6. After the deployment instruction and final pilot review, enable the notification switch and worker for those approved runs. **Send pending MMS access** queues/sends eligible unsent access; **Resend MMS access** records an explicit operator action for one current recipient. An initial announcement is unique per run/person/role; routine revisions do not resend it. Email corrections are audited separately. Late confirmed learners/replacement trainers are notified after their MMS synchronization succeeds.
7. Check per-participant pending/sent/failed/review/cancelled status, actual pilot inbox receipt, Calendar access-update errors and the full-run readiness checklist. “Sent” means mail-service acceptance, not proof of delivery/read receipt. Resolve uncertain sends by checking the sender's sent-mail records before an explicit resend. Definite transient failures have bounded retries; an interrupted/uncertain send is held for review.

The existing one-minute MMS worker also dispatches the notification outbox; the separate machine-authenticated `mode=notifications` operation supports recovery/dispatch. Notifications require a current successful ready result at the exact source revision/hash and a sync less than five minutes old. They recheck the live source before dispatch. Outbox leases recover interrupted workers into review, rather than automatically resending a message that might already have been accepted.

TMS continues sending invitations and processing Accept/Decline. For an approved MMS run, invitation/acceptance wording says MMS access follows confirmed assignment/readiness. Dedicated learner confirmation/course-day variants and trainer reminder feeds/WhatsApp use MMS access; pending access is held or described without an old TMS class-login link. Existing Calendar events receive a scoped access block through the guarded TMS writer, with the same event IDs, meeting links, RSVP history and `sendUpdates=none` description policy. TMS feedback and acceptance URLs keep their valid TMS destinations. Every `TGS` message takes the original path unchanged.

If a participant withdraws or a trainer is removed while mail is pending, cancel their unsent access. Re-enrolments, corrected links and previously failed/uncertain sends use the explicit resend control after eligibility is restored. Completed classes do not acquire new automatic initial announcements. For a deliberate operational fallback to TMS, pause notifications/updates, record the affected run and reason, and send a reviewed corrective instruction using the existing operations mail process before directing participants back; retain mappings, logs and MMS attendance. Do not change shared funded-course templates to manage a pilot exception.

## Reproducible isolated verification

The MMS repository provides `scripts/tests/docker-compose.handover.yml`. It uses sanitized fixtures, an internal-only Docker network and Mailpit. Its `tms-tests` profile mounts this repository read-only and masks Windows `node_modules`, using the existing pure-JS TypeScript compiler with the cached Node image. It needs no production credentials or dependency downloads.

From the MMS repository run `docker compose -p mms-access-verification -f scripts/tests/docker-compose.handover.yml up -d`, then its `api` service's `scripts/tests/run-tms-handover-suite.php` and `tms-tests --require /fixture/tests/register-mms-test-typescript.cjs --test /fixture/tests/mms-access-runtime.test.ts`. The latter tests real PostgreSQL outbox constraints, overlapping enqueue/dispatch, pending changes, withdrawals, email corrections, explicit resend, uncertain acceptance and funded reclassification with all outbound services mocked.

From this repository run `node --import tsx --test tests/mms-access.test.ts tests/mms-access-mail.test.ts tests/mms-sync.test.ts tests/mms-sync-source.test.ts tests/mobile-reminders.test.ts tests/trainer-acknowledgement-rules.test.ts`, the API auth check and the existing type-baseline comparison. Live sender delivery/permissions and pilot inbox receipt remain deployment checks.

Verified on 22 October: all 31 listed tests, the real PostgreSQL notification lifecycle/concurrency suite and API-auth coverage for 599 routes passed. TypeScript remains at the existing 168 diagnostics with no additions. The matching MMS suite passed 44 database, 12 contract, five API and 23 class-access/login checks with actual OTP capture in isolated Mailpit; migrations passed and a repeat had no pending files. Production remains disabled and no participant email was sent.
