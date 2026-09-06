# Native iOS companion

The Tertiary Learning app uses `/api/mobile/*`. It exposes only learner and trainer capabilities. The server uses session identity and current database role/assignment records for every protected request.

## APNs configuration

Set these server-only variables in the intended tenant's deployment:

- `MOBILE_APNS_ENABLED=true`
- `MOBILE_APNS_KEY_ID`: Apple Push Notification service key ID (not an App Store Connect API key).
- `MOBILE_APNS_TEAM_ID`: Apple developer team ID.
- `MOBILE_APNS_PRIVATE_KEY`: APNs .p8 contents; keep secret.
- `MOBILE_APNS_TOPIC=com.tertiaryinfotech.ailmstms`

The existing scheduler seeds `mobile_class_reminders` every five minutes. It is disabled by default unless APNs is enabled at first creation. If the row was created while disabled, enable it explicitly in Scheduler after configuring credentials. The app registers sandbox tokens in Debug and production tokens in Release. Tokens are removed on sign-out/deletion; Apple 410 responses remove invalid registrations.

Reminders use actual course-session start dates/times in Asia/Singapore, with a one-hour retry window. No push is generated for an unpublished start time. Runs with no published sessions appear in the calendar with time TBC. Cancellations, withdrawn enrolments, inactive accounts and session-level trainer overrides are checked at send time. Successful deliveries are recorded per token/session/start time/day offset. Database advisory locking prevents concurrent runs; APNs collapse identifiers reduce duplicate delivery after an ambiguous send outcome. Expiration is zero so stale reminders are not queued by Apple.

## Account deletion

The endpoint removes portal login credentials, identifying app profile fields, role memberships, active sessions, OTPs and registered devices. It retains a pseudonymous account ID for linked statutory training/financial records. The app explicitly explains retained training records before confirmation. It does not cascade-delete enrolments or assessment records.

## Verification

Use a disposable PostgreSQL database. Never run fixture tests on a live tenant.

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:15439/postgres ENABLE_APP_SCHEDULER=false npx next dev --webpack -p 3003
DATABASE_URL=postgresql://postgres@127.0.0.1:15439/postgres node --import tsx tests/mobile-integration.ts
node --import tsx --test tests/mobile-reminders.test.ts
node scripts/check-api-auth.js
npx tsc --noEmit --ignoreDeprecations 5.0
```

`mobile-integration.ts` verifies user ownership, roles, trainer overrides, canceled classes, OTP replay, device registration, machine-only scheduler access and account deletion. Seed the base schema and session migration before running. Backend schema has some unrelated historical restore-order defects; local fixture verification does not establish production schema parity.

## Review and support

Static mobile support/privacy and synthetic sample materials are under `public/mobile/`. Sample materials contain no real enrolments, learners, trainers or answer keys.
