# Google Automation triggers: local review and connection

The localhost review adds a Triggers tab alongside the existing source editor.
The observed 16 triggers across 14 sales-owned projects are stored in the private
review configuration as dated Google UI evidence. Six container-bound projects
were added to the previous 17-project registry, so the review now lists 23 projects.
Unknown inventory is displayed as unknown; an empty list is not proof of no triggers.

## Local inspection

Open `http://localhost:3004/?view=admin&adminPage=googleAutomations`, choose a project,
and select Triggers. Admin and Developer can edit the enabled state and existing
minute/hour/daily schedules, save an immutable draft with a reason, review before
and proposed settings, and explicitly Apply to local review. Spreadsheet On change
triggers retain their event type and support an enabled-state draft.

Local changes persist in `google_automation_trigger_change` in the isolated review
database. They never call Google. The dated Google schedule is retained separately
for comparison. Source publishing remains disabled. The review-only mode refuses
any database other than `127.0.0.1:15447/google_automation_review` and refuses source
publishing enabled. The review runner also disables the native scheduler and MMS sync.

Source editing now uses a numbered gutter with synchronized vertical scrolling,
30 lines at 24px line height (752px including padding), and 16px monospace text
(previously 12px). Before/proposed review uses the same text size, green added /
changed lines and red removed / replaced lines, with plus/minus markers. Both panes
open near the first difference; Jump to first change returns to it. The bounded
line comparison avoids shifting every following line after a simple insertion.
For very large changed regions, the comparison highlights the entire changed region
rather than spending unbounded time on line matching.

## Live Google connection: prepared, not deployed

The implementation contains the server-side signed bridge client and the Apps
Script V8 template `integrations/google-apps-script/TmsTriggerBridge.js`. These have
been tested using synthetic remote responses / a VM harness; they have not yet
been deployed or authorized in a Google project. Do not claim live trigger editing
has been verified. A disposable Google project must validate actual runtime and
deployment behavior before any production rollout.

Each managed project needs its own owner-authorized helper. Preserve the complete
source set and existing scopes, check existing `doPost` handlers and deployments,
and route deliberately rather than replacing existing web-app behavior. The template
uses `script.scriptapp` for trigger operations and `userinfo.email` to verify the
effective Google owner. Coordinate owner reauthorization when adding these scopes;
an unattended production script can stop until the owner grants new permissions.
No new OAuth client or additional Google API service is required for this design.

Set per-project Script Properties through a secure provisioning step:

- `TMS_TRIGGER_BRIDGE_SECRET`: a separate random 32-byte key, base64 encoded.
- `TMS_TRIGGER_BRIDGE_OWNER`: the verified owner's Google email.
- `TMS_TRIGGER_BRIDGE_HANDLERS`: a JSON array of explicitly permitted handler names.

Configure the TMS private connection with `triggerManagement.reviewOnly:false`,
`allowApply:true`, an owner-scoped `inventory`, and `bridges[scriptId]` containing
`url`, the matching `secret`, and the `handlers` allowlist. Do not put these secrets
in public configuration, browser responses, tracked source or deployment images.
Missing connection or disabled live application allows draft preparation but blocks
live Apply on the server. Human Admin/Developer authorization is required independently
of source publishing. Training Provider can inspect only; machine API keys are denied.

An execute-as-owner web app preserves sales ownership while Danny uses TMS under
his own Admin/Developer session. If the server-to-server deployment requires Anyone
access, the endpoint is publicly reachable and its application-level HMAC authentication
is critical. Review this exposure and domain policy before applying it. The inspected
Google UI offered this access option; the task did not select it or deploy anything.

The protocol signs requests and responses, binds the account/project/request ID,
uses a short timestamp window and persistent replay protection, and exposes only
inventory and allowed trigger changes. It does not execute arbitrary functions.
The client accepts Google Apps Script deployment URLs only and never retries a
mutation automatically. Durable TMS intent and a script lock protect changes;
timeouts, partial changes or readback mismatch block further application until
an operator reconciles Google state. There is no automatic reconciliation endpoint
in this phase; inspect both systems and record a deliberate operator resolution.

Changing a schedule deletes/recreates a trigger; enabling after disable creates a
new one. This is not atomic and Google failure notification preferences may need
review afterward. Original clock frequency is not exposed by Trigger reflection.
TMS records newly managed settings and preserves dated initial UI evidence.
The current helper does not manage Google's failure-notification email settings.

## Data and API

Migration: `database/migrations/create_google_automation_trigger_changes.sql`, also
applied lazily by the authenticated route under a schema advisory lock. It is additive
and idempotent. Changes record account/project, actor, reason, immutable before /
after, expected inventory context, status, creation/application time and applier.
Per-project advisory locks and readback detect stale or uncertain changes.

Existing authenticated `/api/admin/google-automations` adds:

- GET `?view=triggers&scriptId=...` for inventory, mode/capabilities and change history.
- POST `action:triggerDraft`, `scriptId`, `triggerKey`, `settings`, `reason`.
- POST `action:triggerApply`, `scriptId`, `draftId`, `acknowledged:true`.

## Verification (5 November 2026)

All 18 focused tests passed, including real isolated PostgreSQL persistence and
idempotent schema setup, local review with no Google calls, stale drafts, synthetic
live replacement/disable, applier audit and uncertain-result blocking. The helper
VM tests cover forged signatures, stale requests, replay, project/handler boundaries,
and preventing repeated mutations. The client tests reject forged responses and
non-Google endpoint URLs. No real business function or trigger was invoked.

The Playwright review check uses the normal password login, reads real Google source,
tests numbered editor geometry/scrolling, saves a local source draft, checks highlighted
lines, edits/applies/restores a local trigger schedule, verifies database persistence,
checks a 390px mobile layout and confirms source publication is blocked. It does not
intercept API responses or inject authentication. Screenshots are under
`outputs/google-automations/`. Current source/helper live deployment remains pending.

The final TypeScript comparison reports 127 baseline / 127 current diagnostics,
with no new diagnostics. API authentication coverage passed for all 628 routes;
JavaScript syntax and whitespace checks passed. The visible Chrome review is left
open on Add Orders to Calendar with Edit trigger expanded for user inspection.

## Official references

- [ScriptApp ownership and required scope](https://developers.google.com/apps-script/reference/script/script-app)
- [Trigger getters and available metadata](https://developers.google.com/apps-script/reference/script/trigger)
- [Execution API limitations](https://developers.google.com/apps-script/api/how-tos/execute)
- [Web apps and execution identity](https://developers.google.com/apps-script/guides/web)
- [HMAC signatures](https://developers.google.com/apps-script/reference/utilities/utilities)
