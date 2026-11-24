# Google Apps Script tools for AI and operators

The source tool extends the existing TMS Google Automations module. Google remains
the authority for live source; TMS stores encrypted last-known source and dated
revisions. Authorized requests decrypt and redact source on the TMS server.
Agents never need direct database access, Google OAuth credentials or the backup key.

## Setup and authentication

Run `node scripts/google-automations.cjs help` from the TMS repository.
Use `--config <private.json>` or `GOOGLE_AUTOMATIONS_CLIENT_CONFIG`. The default is
`config/google-automations-agent.private.json`, ignored by Git and Docker.
The client requires HTTPS, except on loopback development hosts, and refuses redirects.

A private client configuration contains `baseUrl` and either `agentToken` or an
Admin/Developer `sessionToken`. Existing private password-login configurations
containing `email`, `password` and `loginType` also work. Tokens/passwords must not
be passed as command-line arguments, committed or printed in logs.

Generate a dedicated expiring credential without printing its raw token:

```powershell
node scripts/google-automations.cjs keygen --id codex-inspection --account owner@example.com --base-url https://tms.example.com --projects '*' --expires 2027-02-01T00:00:00Z --out config/google-automations-agent.private.json
```

The command writes the private client file exclusively and prints a server entry
containing only the token's SHA-256 digest and grants. Install an array of such
entries as the server-only runtime variable `GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON`.
Do not prefix it with `NEXT_PUBLIC_`. Each entry specifies an ID, Google account,
project allowlist (`['*']` explicitly grants all registered projects), expiration
and operation scopes. Missing/invalid/expired credentials fail closed.
Use the dedicated `x-google-automation-key` header; query-string keys and generic
scheduler/service keys cannot inspect or edit source. Remove the entry to revoke.

Scopes are independent: `read`, `refresh`, `draft`, `publish`. Every credential
must have `read`; the generator defaults to `read,refresh,draft`. Add `publish`
only for an authorized publisher. Server `allowPublish` must also be enabled,
and publishing requires explicit acknowledgement. Agents cannot configure the
Google connection, modify metadata, manage triggers or deploy web apps.

## Inspect and edit

```powershell
node scripts/google-automations.cjs list --query Calendar
node scripts/google-automations.cjs coverage
node scripts/google-automations.cjs sync --missing-only
node scripts/google-automations.cjs search --query createEvent
node scripts/google-automations.cjs read --script SCRIPT_ID
node scripts/google-automations.cjs revisions --script SCRIPT_ID
node scripts/google-automations.cjs revision --script SCRIPT_ID --revision REVISION_UUID
node scripts/google-automations.cjs checkout --script SCRIPT_ID --refresh --dir scratch/calendar-script-review
# Edit the .gs/.html files in the checkout's files/ directory; preserve placeholders and the manifest.
node scripts/google-automations.cjs draft --dir scratch/calendar-script-review --reason 'Describe the intended behavior change'
node scripts/google-automations.cjs review --script SCRIPT_ID --draft DRAFT_UUID
# Run only within authorization for this live source change:
node scripts/google-automations.cjs publish --script SCRIPT_ID --draft DRAFT_UUID --acknowledge-live-code
node scripts/google-automations.cjs history --script SCRIPT_ID
node scripts/google-automations.cjs restore --script SCRIPT_ID --draft APPLIED_DRAFT_UUID --reason 'Explain the restoration'
```

Saved reads/search/history never contact Google. `refresh`, `sync` and checkout
`--refresh` retrieve live source and update encrypted snapshots without executing
scripts or writing Google source. `sync --missing-only` fills missing snapshots;
`sync` refreshes every registered project and reports individual failures without
blind retries. During rollout, `sync --legacy-source` uses the existing Source
GET route; it works with human login credentials before the new routes deploy.

Search returns up to 100 literal matches with project/file/line/hash and snapshot
time; it searches redacted source only. `truncated` means more results may exist.
Use narrower search terms when truncated. Coverage is separate and identifies
projects that have no saved source. Neither search nor source presence establishes
trigger activation or successful execution. A database snapshot is explicitly
last-known source; refresh it when current Google state matters.

Checkouts use numbered safe filenames and retain original Google filenames/types
in `checkout.json`. The server preserves the complete file set and credentials,
parses JavaScript without executing it, and blocks manifest changes in this phase.
Use synthetic business-behavior tests as well; a syntax check is not a runtime test.
The existing publish path saves an encrypted before/after draft before writing,
checks for concurrent Google edits, publishes the complete file set and reads it
back. An uncertain result is not retried automatically. A restore creates a new
draft for review and publication; it does not immediately write Google.

## Persistence and scheduled refresh

`create_google_automation_source_revisions.sql` is additive and also included in
the authenticated route's lazy schema setup for standalone deployments. It seeds
the existing saved snapshot once. Each changed source creates another encrypted
revision; unchanged refreshes update the last-successful timestamp without copying
identical content. Returning to older code creates a new observation. Refresh
failure retains source and history and records a fixed, credential-free error.
Keep database backups and both encryption keys securely; history cannot recover
versions that were never observed.

The scheduled sync also discovers accessible standalone projects before refreshing
the registry. Container-bound projects still require registration by script ID;
an empty Drive result does not prove that no other scripts exist.

The scheduler task `google_automation_source_sync` runs daily at **03:15 SGT**
when enabled, calling POST `/api/external/sync-google-automation-sources` through
the existing scheduler authentication. Set server runtime
`GOOGLE_AUTOMATIONS_SYNC_ENABLED=true`; a newly seeded task is enabled only when
this flag is true. If the task already exists disabled, enable it in Task Scheduler.
The endpoint also checks the flag. It returns counts/status, never source code.
Existing Google execution schedules and native business jobs are unaffected.

## API additions

Authenticated `/api/admin/google-automations` supports:

- GET `view=coverage` and `view=search&q=...`, filtered to the agent's project grants.
- GET `view=storedSource&scriptId=...` without a Google refresh.
- GET `view=sourceRevisions&scriptId=...` and `view=sourceRevision&scriptId=...&revisionId=...`.
- POST `action=refresh,scriptId=...` to observe Google source.
- Existing draft/review/history/restore/publish operations, with separate agent scopes.

Human Admin/Developer and Training Provider permissions remain in force. Agents
are separately account/project scoped. Source responses are private and no-store;
Google exceptions, source ciphertext and private configuration are not returned.

## Rollout and verification

Before deployment, run focused Google Automations tests, the isolated PostgreSQL
migration/revision tests, API authentication coverage, feature type checks and the
production build. Validate agent project/scope isolation with synthetic credentials
and source; never publish test edits to a production Google project.
After deployment, install runtime agent grants and the source-sync flag, confirm
coverage, read saved source through TMS, refresh a project, and verify unchanged
refreshes do not create duplicate revisions. Test actual Google writes only on a
disposable project; publish business changes only within their separate authorization.

24 November 2026 verification: the production registry's 18 missing source
snapshots were retrieved through its existing signed-in Source UI. A subsequent
read-only database check found 23/23 encrypted snapshots, no missing source, and
23 valid encrypted envelopes. No Google source, triggers or deployments changed.
This backfill used the existing production module; it does not establish that the
new source tools, revision migration or daily sync have been deployed or enabled.
