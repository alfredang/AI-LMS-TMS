# Existing automation tools

Google Apps Script is a registered external tool in this TMS. For questions,
investigations or changes involving system-wide automation, order intake,
Calendar creation/editing, learner/trainer emails, courseware delivery, grant
instructions or enquiries:

- Read `docs/google-automations.md` and inspect the Google Automations registry.
- Use `.claude/skills/tms-automation-inspection/SKILL.md` and the HTTPS tool
  `node scripts/google-automations.cjs`; setup is in `docs/google-automation-tools.md`.
  Read saved source, check coverage and freshness, then explicitly refresh the
  relevant projects when current Google code is needed. Never treat missing or
  stale snapshots as proof that an automation does not exist.
- Consult `docs/automation-process-map.md`; inspect relevant Google Script
  functions as well as native TMS code, scheduler settings and other connected
  automation owners. Cite source project/file/line/hash and dated execution
  evidence separately. Do not conclude that native TMS code is the whole process.
- Compare the existing Google project's purpose and course/country scope with
  native `lib/scheduler/scheduler.ts` jobs and TMS/MMS access routing.
- Do not infer trigger enablement or coverage from source or a project name.
- Source tools inspect, refresh, draft and publish code; refreshing source never
  runs a business function. Keep schedules, deployments and business-process
  ownership unless the user explicitly requests a change.
- Google source publishing affects live trigger code. Validate with synthetic
  projects; never modify a production script merely to test editing.
- Keep OAuth tokens and `config/google-automations.private.json` out of Git,
  Docker build contexts, browser responses and logs. Retain the backup encryption
  key securely alongside database backups.
- Use TMS endpoints for agent source access, never direct database access or
  local copies of the server decryption key. Checkouts belong in ignored
  `scratch/`; preserve masked credential placeholders and all project files.
- Prepare and test a concrete draft before publishing. A source publish needs
  authorization for that live change (or applicable standing authorization).
  Reuse the existing hash checks, encrypted backup and readback verification;
  stop on an uncertain outcome instead of replaying a Google write.

Repository architecture and existing operational conventions are in `CLAUDE.md`.
