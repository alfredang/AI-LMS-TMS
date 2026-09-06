# Native Android learner and trainer client

The Kotlin / Jetpack Compose app uses `/api/android/send-otp`, `/api/android/login`,
`/api/android/dashboard?role=learner|trainer` and `/api/android/device`.
Only existing active learner/trainer accounts can sign in. These endpoints do not
create accounts, accept passwords, expose administrative functions, or trust a
caller-supplied user ID. Course access is derived from current enrollment and
trainer assignment. Trainer slides are omitted for learner requests.

OTP sending reuses the provider's email configuration and templates. Sending is
limited to three requests per email per 15 minutes; verification is limited to
eight attempts. Codes are consumed atomically, and sessions use the existing
hashed-at-rest, revocable 30-day session implementation.

## Android push configuration

Set the server-only `ANDROID_FCM_CREDENTIALS_JSON` to a Firebase service-account
JSON with the Firebase Cloud Messaging API Admin role in the Android Firebase
project. Never put this credential in the Android app or public repository.
The worker starts only when this variable and the existing app scheduler are enabled.
It checks every five minutes, beginning at 09:00 Asia/Singapore, for sessions one
and three calendar days ahead. It checks current enrollment, assignments,
account status, device opt-in, and the device's unexpired authenticated session.

Delivery is tracked per device/session/start-time/offset and serialized with a
PostgreSQL advisory lock. Successful sends are not repeated; failed sends retry.
FCM delivery is at least once: the client uses a stable notification ID to replace
a retry rather than showing multiple notifications. Invalid device tokens are removed.
No notifications are sent before 09:00 SGT. A restart later that day catches up.

The database tables are created idempotently on demand. No existing tables are
replaced. An absent credential leaves the Android push worker disabled.

## Tests

Load `database/01-schema.sql` into an isolated PostgreSQL instance, set
`DATABASE_URL` for a local database named `ailms_android` on port 15449, and run:

```
node --import tsx --test tests/android-mobile.test.ts
node scripts/check-api-auth.js
```

The integration test refuses a production database. It verifies role isolation,
trainer resource privacy, OTP replay, Singapore dates, withdrawal, push-device
lifecycle and duplicate-send prevention with a fake sender.
