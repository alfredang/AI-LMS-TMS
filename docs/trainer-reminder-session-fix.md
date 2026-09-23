# Calendar session reconciliation and reminder eligibility

Implementation baseline: deployed revision `a50d5d335d4829794643538382ace15de3e9eb50`.

Google Calendar is the schedule master. A report row represents one actual Calendar event occurrence, with its date in Asia/Singapore. Operational LMS runs provide independently matched run metadata and assignments; they do not create extra master schedule rows.

## Corrected behaviour

1. **Accepted trainer:** match the individual guest's accepted response to one active Trainer-role account using primary, secondary or additional email. Use an exact unique name only if the guest exposes no email. Exclude organizer, calendar self, resources and declined guests. Hold duplicate identities, inactive matches and multiple accepted trainers. LMS and TPG assignments never stand in for acceptance.
2. **Session date:** report `session_date` and use it for acknowledgement, queueing and dispatch. Keep `run_start_date` and `run_end_date` separately. A run beginning 20 September with a Calendar session on 26 September is reported and queued for 26 September.
3. **Operational class match:** use one non-conflicting durable event mapping or explicit run ID. Without those, require a unique exact code, operational session date and explicit matching delivery mode. Do not fuzzy-match titles, select the first duplicate run, filter away competing run statuses, or write inferred mappings during reads. Distinct events claiming the same run/date are held. Unresolved Calendar rows remain visible with a reason.
4. **Acknowledgement:** key by operational run UUID, Calendar event ID, session date and trainer account. Acceptance never suppresses a different run sharing the same course code or another day's session.
5. **Shared eligibility:** report, queue and dispatch use `buildReminderSnapshot` and `evaluateReminderEligibility`. A reminder needs a verified future Calendar session, Confirmed class, one active pending/tentative trainer guest matching the effective local assignment (including session overrides), usable phone and no previous attempt for that run/session/person. Accepted or declined trainers are not reminder recipients. Uncertain sources hold the decision.

Calendar reads paginate fully and expand omitted attendee lists. Failed pages, incomplete guest lists or conflicting event detail reads fail closed. The implementation never sends a WhatsApp message itself and no live queue/release endpoint should be used as a test.

## API contract and consumer handoff

`GET /api/external/trainer-reminders?start_date=2026-09-26&end_date=2026-09-26`

- `trainer` is the verified **accepted** trainer or null. `trainer_resolution.source` is `gcal_accepted`, `no_accepted_trainer`, `ambiguous` or `calendar_unavailable`.
- **Consumers building reminder messages must read `reminder_recipient`, not `trainer`.** It is set only for an eligible reminder. The report's accepted-trainer column continues to use `trainer`.
- `start_date` now aliases `session_date` for existing date-display consumers. Use the new `run_start_date` for the overall run start. `end_date` remains the run end.
- `send_reminder` and `reminder_eligibility` always reflect the same decision, whether or not `send_reminder=true` filtering was requested. Already queued rows are not eligible to enqueue again.
- All statuses and unresolved Calendar entries appear by default. Optional `status=Confirmed` filters display after matching. `mapping_status`, `mapping_reason`, source timestamp and event ID support review.
- Requests by `course_run_id` require an explicit `session_date` for multi-day runs. Ambiguous multi-session responses are rejected.
- `last_reminder_sent_at` and `reminder_sent_count` are null (not a claim of zero historical messages).

`POST /api/external/auto-queue-class-reminders?dry_run=true` computes decisions without enqueueing. The normal scheduler entry point preserves its no-argument signature. Its deprecated `skippedAcknowledgedTgs` counter now aliases the exact-session acknowledgement count; new consumers should use `skippedAcknowledgedSessions`.

`GET /api/external/trainer-lookup` also uses exact code/date matching and accepted guests. The optional title parameter is retained but no longer used to guess an event.

These are intentional semantic changes. Update and verify external report consumers against the new fields before enabling this revision in production. The separately hosted WhatsApp bot is outside this backend change and was not edited or backed up by this patch.

## Queue migration and dispatch

The migration adds nullable session date, event ID and trainer account columns plus a partial unique index on run/session/person. It does not rewrite historical records. Concurrent scheduler inserts use `ON CONFLICT DO NOTHING`. All previous attempts, including failed, cancelled or expired messages, require review before requeueing.

Legacy rows without complete provenance are held at dispatch, never guessed or automatically replayed. Their old run-start date is used only for conservative deduplication. New pending records are rechecked against fresh Calendar, directory, class assignments and queue state immediately before release. Dispatch excludes its own queue ID from duplicate detection and only releases IDs that passed verification; changed event, trainer, phone or date holds release.

Existing channel time windows, daily caps and minimum spacing remain dispatch controls. `send_reminder=true` describes enqueue eligibility, not a promised delivery time. Snapshot reads across Calendar and PostgreSQL are not an atomic transaction; the fresh dispatch check reduces stale-source risk but cannot prevent a Calendar change after release.

## Validation

Run the isolated regression tests (no application scheduler, database or WhatsApp connection):

```text
node --import tsx --test tests/trainer-acknowledgement-rules.test.ts tests/trainer-calendar-pagination.test.ts tests/trainer-reminder-api.test.ts
npm run check:api-auth
npm run type-check
```

Tests cover accepted identity/aliases, organizers and resources, inactive and ambiguous identities, SGT boundaries, multi-day session dates, strict class links, duplicate events, independent acknowledgements, queue/dispatch parity, legacy holds, fresh acceptance, pagination and API source failures. API tests bundle real handlers with in-memory dependency mocks; they do not test against production credentials.

Repository-wide TypeScript and production-build results are recorded separately in the delivery evidence. Do not describe a failed repository check as passing merely because focused tests pass.

## Recovery

The immutable 14 September **Restore Point 1** remains the default named restoration target, with its documented partial coverage. This patch does not replace it. The separate 23 September pre-change capture preserves the exact deployed revision above, application/runtime configuration and uploads, plus a tested PostgreSQL restore. It is later state, not reconstructed 14 September data.

Before any deployment, refresh the affected-service capture if state has changed and verify the selected checksums. For rollback of this patch, first preserve then-current data and prevent outbound queue replay; use the selected exact source/image and recorded recovery instructions. The new nullable columns can remain during an application rollback; do not drop columns or restore an old database unnecessarily. Old application code will not honour the new legacy holds, so do not resume dispatch until queue records have been reviewed. Never roll back unrelated trainer assignments or Calendar edits as part of a code-only rollback.

Workspace recovery records:

- `backup/Ang backup/23. Revamp of trainer/Restore Point 1/RESTORE-POINT-1.md`
- `backup/Ang backup/23. Revamp of trainer/Pre-change Captures/2026-09-23 143504 SGT/RECOVERY.md`

The large runtime/database archives remain on the host; off-host runtime backup and the separate bot backup are outstanding. Check the recovery record for exact coverage rather than assuming full-system restoration.
