# Google Automations: registry and source editor

**Local review update (5 November 2026):** the localhost module now includes a
Triggers tab with dated Google inventory, editable schedule drafts and persisted
local review application. Live trigger application requires a separately authorized
per-project helper and remains unconnected. The source editor now has numbered
lines, a 30-line viewport, 16px text and highlighted before/proposed differences.
See [trigger setup and verification](google-automation-triggers.md). The original
Phase 1 scope below describes the production integration awaiting deployment.

Phase 1 registers external Google Apps Script projects in TMS. Google continues
to execute its existing triggers. No scheduler, enrolment, Calendar, Gmail,
courseware, finance, MMS or notification business process is changed by enabling
this module. There is no run-now, trigger-management or deployment-management API.

## Operator access

- Admin: Calendar & Crons → Google Automations (also searchable).
- Developer: Google Automations in the sidebar.
- Training Provider: Google Automations in the top navigation, read-only.
- Admin and Developer sessions may document projects, create drafts and publish.
  Publishing also requires `allowPublish: true` in the dedicated configuration.
  Machine API keys and other user roles cannot access this module.

The connection check validates the account and `script.projects` scope. Discover
registers standalone Apps Script files exposed by Drive. Container-bound scripts
must be registered using their script ID. A registry is not a complete account-wide
trigger inventory. Schedules, owners and dependencies are manually documented and
start as **Not verified**. No execution-history claims are inferred from source.

## Dedicated connection

### Install through TMS without Coolify

When no file/runtime connection exists, sign in as Admin or Developer and open
Google Automations. Select the dedicated connection JSON, review the account and
publishing setting, acknowledge installation and select Install Google connection.
TMS verifies Google identity and `script.projects` access before saving. The entire
connection (including the source-backup key) is encrypted in
`google_automation_connection`; credentials are never returned to the browser.

This uses a separate key derivation from the existing server
`AI_OAUTH_ENCRYPTION_KEY` or `JWT_SECRET` (at least 32 characters), following the
application's existing encrypted AI credential storage. If neither exists, setup
fails closed and a server administrator must configure encryption. No new Google
client or Coolify access is needed when that server secret is already configured.
Back up the established server secret as well as the original source-backup key.
Setup is bootstrap-only: it cannot overwrite an installed connection or change
its backup key. Runtime configuration takes precedence over database configuration.
Imported review logins/database passwords and helper credentials are stripped, and
live trigger application remains disabled. Existing Calendar/Gmail settings are
not updated. The additive migration is `create_google_automation_connection.sql`.

### File or runtime-secret installation

No new scope is required for source inspection and editing. Required APIs are
Apps Script API and Drive API; OAuth scopes are `script.projects` and
`drive.metadata.readonly`. This connection is independent of the existing TMS
Calendar/Gmail connection. Do not overwrite that connection.

Provision an already-authorized user OAuth token and an audit inventory:

```powershell
node scripts/setup-google-automations.mjs <authorized-user-token-file> <inventory.json> <expected-google-email>
```

The script verifies Google identity/scopes and creates
`config/google-automations.private.json` with exclusive creation, a random 32-byte
encryption key and registered project metadata. It never overwrites an existing
file or modifies Google source. The file is ignored by Git and Docker builds,
and explicitly excluded from Next.js standalone output tracing.

For deployment, supply this private file through a restricted, persistent server
secret mount. Set `GOOGLE_AUTOMATIONS_CONFIG_FILE` to its absolute server path, or
mount it at `/app/config/google-automations.private.json`. Do not put it in public
assets, source control, an image build context or a browser environment variable.
Alternatively, provide the complete JSON as base64 in the server-only runtime
secret `GOOGLE_AUTOMATIONS_CONFIG_B64`. It takes precedence over the file setting.
In Coolify mark it runtime-only, not a build argument, and keep its value secret.
Base64 is transport encoding, not encryption. Never use a `NEXT_PUBLIC_` variable.
Back up the encryption key with the database; losing it makes drafts/backups
unreadable. A missing configuration leaves the module disconnected. Set
`GOOGLE_AUTOMATIONS_ENABLED=false` to disable access without affecting Google
execution. Set `allowPublish:false` to allow inspection/drafts but block publishing.

Configuration format (values below are placeholders):

```json
{
  "enabled": true,
  "allowPublish": false,
  "accountEmail": "automation@example.com",
  "encryptionKey": "BASE64_32_BYTE_RANDOM_KEY",
  "credentials": {
    "client_id": "OAUTH_CLIENT_ID",
    "client_secret": "OAUTH_CLIENT_SECRET",
    "refresh_token": "OAUTH_REFRESH_TOKEN"
  },
  "projects": []
}
```

The registry and drafts use the TMS PostgreSQL database. The module lazily applies
the additive `create_google_automation_registry.sql` schema on its authenticated
routes. No global scheduler or startup job is added. Registrations are scoped by
connected Google account; this single-tenant-deployment configuration is not a
cross-provider shared credential store.

## Editing and recovery

1. Select a project and open Source. Current Google files are read and an encrypted
   snapshot is saved. Known inline credentials are masked in browser responses.
   Redaction is defense in depth, not a guarantee of finding every possible secret;
   source access remains privileged.
2. Edit existing JavaScript or HTML files, enter a reason and Save draft and review.
   The manifest, file names and file types are preserved. JavaScript is parsed but
   never executed. Runtime permissions and business correctness still need review.
3. Review the before/proposed source for each changed file. Drafts are immutable,
   encrypted and persistent. They do not write Google source.
4. An authorized publisher explicitly acknowledges the live-trigger effect and
   selects Apply to Google. TMS rechecks the current source hash, persists the
   encrypted previous source and intent, submits the COMPLETE file set and reads
   it back before marking the update applied. No Google write is retried
   automatically. Per-project database locks serialize TMS publications, but cannot
   lock Google Editor; its external concurrent edits remain a residual race.
5. History → Prepare restoration draft loads the encrypted previous source into
   a new reviewable draft. Review and explicitly apply it. Historical changes that
   would alter the current manifest/file set are blocked in this phase.

Google installable triggers use HEAD source, so an applied source edit can change
their next execution without a schedule change. Versioned web apps are not
redeployed. This UI's history covers TMS changes, not every Google editor change.
If an update times out, readback differs, or the app crashes after recording its
intent, inspect current Google source and the saved draft before preparing another
change. Do not blindly replay an uncertain update.

API: authenticated `/api/admin/google-automations`, GET registry/connection/source/
history/draft; POST discover/register/metadata/draft/restore/publish. There is no
generic Google proxy and no execution or deployment action. Source/error responses
use no-store caching and SDK request errors are never exposed or logged.

## Future development contract

### Trigger access inspection (5 November 2026)

Playwright inspection of the signed-in sales account found 16 installable triggers
across 14 projects (15 scheduled, one spreadsheet change). Add Orders to Calendar
runs `detectNewOrders` every 30 minutes, has no active/archived deployment, and
currently requests Gmail/Sheets/Calendar scopes without `script.scriptapp`.
All inspected edit/deployment dialogs were cancelled; no Google changes were saved.

Trigger management remains unimplemented. It needs a per-project helper executing
as the trigger owner with `https://www.googleapis.com/auth/script.scriptapp`, plus
a tested authenticated backend connection. Adding a scope to the TMS source OAuth
client alone does not supply this capability. Google's Execution API cannot create
triggers. Trigger reflection has no clock schedule getter; preserve dated UI
evidence and store schedules for TMS-managed triggers, with unknown/stale states
for external changes. Prepare/test the helper before requesting owner consent or
deploying any externally reachable endpoint. Coordinate reauthorization because
adding inferred scopes can interrupt unattended production executions.

The full dated inventory and implementation/owner-consent sequence are recorded in
the workspace handover `GOOGLE_TRIGGER_INTEGRATION_2026-11-05.md`.

Google Apps Script is an existing TMS integration tool. Before implementing a new
order, Calendar, communication, grant or enquiry process, inspect the registry and
compare its scope with native scheduler jobs. Source inspection does not establish
active trigger coverage. Consolidation, ownership switching, trigger changes,
execution monitoring (`script.processes`) and deployment management are later phases.

## Verification

### Local UI review (5 November 2026)

The requested pre-deployment UI review runs at
`http://localhost:3004/?view=admin&adminPage=googleAutomations`. Existing apps on
3000/3003 are preserved. The review uses a separate empty-schema PostgreSQL
database, `google_automation_review`, in the isolated local container on port
15447. It contains a normal password-authenticated local Admin account; credentials
are in ignored `config/google-automations-review-login.private.json` (no Google
credentials in that login-only file).

The review connection uses the real Google project inventory/source reads with
`allowPublish:false`. Local metadata/drafts can be saved; applying source to Google
is blocked by the backend. Existing Google execution is unchanged.

To restart after a reboot, start `tms-google-automations-test-20261104` and run
`node scripts/start-google-automations-review.mjs` from the TMS repository. This
runner binds only to 127.0.0.1:3004, points to the separate review database, disables
the TMS scheduler/MMS sync and uses the dedicated review connection. Do not replace
it with the normal dev command pointed at an operational database. Background
logs are in `.codex-tmp/google-automations-review/`.

`node scripts/check-google-automations-review.mjs` checks normal API/UI password
login, real project/source reads, rendered UI and the backend publication block.
It does not mock API responses or publish a source edit. The prior production
deployment plan remains pending user UI review.

`node --import tsx --test tests/google-automations.test.ts` covers read/draft isolation,
redaction and preservation, full-file publication, concurrency conflicts, uncertain
outcomes, verification, permissions and recovery using synthetic Google source.
Set `GOOGLE_AUTOMATIONS_TEST_DB=1` with an isolated PostgreSQL container bound to
127.0.0.1:15447, database `google_automation_test`, user `postgres`, password
`isolated-only` to also exercise real migrations, persistence and advisory locks.
Never point this test at an operational database. Live Google validation uses
identity, discovery and getContent only; no production script is edited as a test.

Local verification on 4 November 2026: all 11 focused tests passed, including the
isolated PostgreSQL migration/persistence/lock/recovery test. The production build
and API authentication coverage check passed. The UI check loaded the 17-project
registry, verified the real account and inspected Add Orders to Calendar; editing,
apply and restoration used synthetic source with production mutations blocked.
Desktop/mobile rendering and Training Provider read-only access were verified.
The standalone artifact and route trace exclude the private OAuth file. This
record does not claim that the module has been deployed to the production TMS.
