# Existing automation tools

Google Apps Script is a registered external tool in this TMS. Before adding or
changing order intake, Calendar creation, learner/trainer communications,
courseware delivery, grant instructions or enquiry automation:

- Read `docs/google-automations.md` and inspect the Google Automations registry.
- Compare the existing Google project's purpose and course/country scope with
  native `lib/scheduler/scheduler.ts` jobs and TMS/MMS access routing.
- Do not infer trigger enablement or coverage from source or a project name.
- Phase 1 provides registry/source management only. Keep existing schedules and
  business-process ownership unless the user explicitly requests a change.
- Google source publishing affects live trigger code. Validate with synthetic
  projects; never modify a production script merely to test editing.
- Keep OAuth tokens and `config/google-automations.private.json` out of Git,
  Docker build contexts, browser responses and logs. Retain the backup encryption
  key securely alongside database backups.

Repository architecture and existing operational conventions are in `CLAUDE.md`.
