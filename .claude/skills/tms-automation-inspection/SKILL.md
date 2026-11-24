---
name: tms-automation-inspection
description: Investigate TMS automation across native code and registered Google Apps Scripts, including Calendar changes, email delivery and enrolment; prepare validated Google source drafts and publish authorized changes through TMS.
---

Use the TMS HTTPS source tool from the repository root:
`node scripts/google-automations.cjs help`.
Read `docs/google-automation-tools.md` for authentication and command examples,
and `docs/automation-process-map.md` for native entry points and Google search terms.

For automation questions, inspect the Google registry and source coverage as well
as relevant native TMS code and scheduler configuration. Search source using
function/API names (`createEvent`, `setDescription`, `sendEmail`) and business
terms; project names alone do not establish coverage. Check dependencies,
country/course scope, owner and overlapping implementations. Treat unknown scope
as unknown rather than guessing from names or inline examples.

`read`, `search`, `revisions` and `revision` use database snapshots. Cite the
project, file, line, source hash and observation date. Refresh relevant projects
when current Google code is necessary. Report missing snapshots, refresh failures
and stale evidence explicitly. Code proves possible behavior; active triggers,
web deployments and successful executions require their own dated evidence.
The registry may omit unregistered/container-bound projects and other automation
systems; describe the scope of an investigation accordingly.

For a Google source change, refresh and checkout the complete project to an
ignored `scratch/` directory. Inspect overlapping native behavior, edit the actual
files, preserve masked credentials, and validate the changed business behavior
with synthetic data. Never invoke production functions to test an edit. Save a
draft with a reason, inspect its before/after source, and reference its draft ID.

Publish only within the user's authorization, using the tool's publish operation.
The server checks permissions, current Google source, immutable draft, backup and
readback. Reconcile an uncertain result before another publish. `restore` prepares
a new reviewable draft; it does not directly roll back Google.
Trigger and deployment changes are separate workflows and are not implied by
permission to edit source. Keep Google OAuth credentials and encryption keys on
the TMS server; source access does not require removing database encryption.
