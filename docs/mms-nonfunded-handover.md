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

The `create_mms_nonfunded_sync.sql` migration creates only integration metadata and transactional outbox triggers. The service applies it once per process when enabled. It can also be applied through the normal database migration workflow. Supported source changes enqueue work in the same transaction as the operational edit; a rollback therefore rolls back the queued change too.

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
