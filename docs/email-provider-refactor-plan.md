# Email Provider Refactor — PR 1 Plan

**Status:** Draft for review
**Author:** Claude Code (with Alfred)
**Date:** 2026-05-01
**Goal of this doc:** Get sign-off on the refactor scope and safety strategy *before* any code is written.

---

## 1. Goal

Replace the ~16 places that currently call the Gmail API (or SMTP) directly with a single `sendEmail()` entry point backed by a swappable **provider** interface. After this PR, adding SMTP, Resend, or SES becomes a one-file change instead of a 16-file change.

**This PR ships zero behavioural change.** Every existing email path continues to send via Gmail OAuth using the exact same credentials read from `training_provider`. The point of the PR is to make the *next* PR (SMTP plugin) safe.

## 2. Non-goals (explicitly out of scope for PR 1)

- Adding SMTP, Resend, SES, or any new transport. That is **PR 2**.
- New `email_provider` column on `training_provider`. Added in PR 2.
- UI changes in Company Settings. Added in PR 2.
- Refactoring the Google Calendar / Drive / Slides paths. They share `googleapis` but are not email and stay untouched.
- Changing email templates, content, or DB schema for templates.
- Encrypting credentials at rest. Worthwhile but separate.

If someone reading PR 1 sees any of the above, the PR is wrong.

## 3. Inventory of current email sends

(Full table in agent output; summary here.)

| Transport | Sites | Notes |
|---|---|---|
| **Gmail API (OAuth)** | 15 | OTP login, password reset, certificates (3 paths), course confirmation, completion, courseware, proforma invoice, trainer invitation (3 entry points), feedback, two test endpoints |
| **SMTP (nodemailer)** | 1 | Support ticket notifications only — `lib/services/emailService.ts` consumed by `pages/api/tickets/create.ts` |
| **Total** | 16 | |

Key observations:

- **No shared Gmail-send helper exists today** — each endpoint manually builds MIME headers and calls `gmail.users.messages.send()`. The only shared wrapper is the private `sendGmail()` inside `lib/trainerInvitationSender.ts`. This means PR 1 must refactor every call site, not just one helper.
- Credentials are loaded inconsistently: most endpoints inline `SELECT ... FROM training_provider`, only trainer-invitation flows use a helper (`loadTrainingProviderEmailConfig`). PR 1 standardises on the helper.
- Two existing **admin test endpoints** (`send-test-email.ts`, `send-test-certificate-email.ts`) are perfect verification harnesses — they already exist in production, are accessible via Company Settings UI, and let us validate the new abstraction without touching real-user flows.

## 4. Target architecture

```
lib/email/
  index.ts                 ← export sendEmail(message): Promise<EmailResult>
  types.ts                 ← EmailMessage, EmailResult, EmailProvider, EmailAttachment
  resolver.ts              ← getProvider(): always returns gmail-oauth in PR 1
  loadConfig.ts            ← single source for reading training_provider email columns
  providers/
    gmail-oauth.ts         ← extracted from existing inline code
  templates/
    (no change — templates stay in DB or existing locations)
```

**Provider interface (final form, PR 1 implements only Gmail):**

```typescript
export interface EmailMessage {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface EmailResult {
  messageId: string;
  provider: 'gmail_oauth';   // union grows in PR 2: 'gmail_oauth' | 'smtp' | 'resend'
  acceptedAt: Date;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}
```

**`sendEmail()` entry point:**

```typescript
// lib/email/index.ts
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const provider = await getProvider();   // PR 1: always GmailOAuthProvider
  return provider.send(message);
}
```

**What every existing call site looks like after the refactor:**

```typescript
// before
const oauth2Client = new google.auth.OAuth2(...);
oauth2Client.setCredentials({ refresh_token });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
const raw = Buffer.from(`Subject: ${subject}\n...${html}`).toString('base64url');
await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

// after
await sendEmail({ to, subject, html });
```

The `gmail-oauth.ts` provider absorbs all the OAuth/MIME plumbing once. **No call site does its own MIME construction after PR 1.**

## 5. Migration strategy — how we keep `main` safe

This is the critical part. The codebase is in active production use; an OTP-send regression locks every user out. We mitigate with **strangler-style incremental migration** within a single PR:

### Phase 1 — Land the abstraction unused (low risk)
- Add `lib/email/*` files.
- Add `gmail-oauth.ts` provider implementing the existing logic.
- Add unit tests for `gmail-oauth.ts` (mock `googleapis`, verify MIME construction matches existing format byte-for-byte for OTP, certificate w/ attachment, and trainer invitation cases).
- **No call site changes yet.** PR can be merged here without affecting any user flow.

If we wanted to be ultra-cautious, Phase 1 could even be its own PR. I'd argue it's safe to combine with Phase 2 since the new code is unreachable.

### Phase 2 — Migrate the two test endpoints first
- `pages/api/training-provider/send-test-email.ts` → `sendEmail()`
- `pages/api/training-provider/send-test-certificate-email.ts` → `sendEmail()`
- These are **admin-triggered, manual, low-volume**. Any regression is caught immediately by the operator clicking "Send Test Email" and not receiving it.
- **Verification gate:** before proceeding, manually send a test from Tertiary's production via the Company Settings UI and confirm the email arrives, looks identical, has correct sender/reply-to, and (for the certificate test) attaches a PDF.

### Phase 3 — Migrate user-facing flows in low-risk order
Order chosen by blast radius if regressed:

1. **Feedback form** (`send-feedback.ts`) — low volume, only TP staff see it.
2. **Trainer invitation follow-up** (`respond.ts` `sendFollowUpEmail`) — low volume, off the critical path.
3. **Trainer invitation main send** (refactor `trainerInvitationSender.ts::sendGmail()` to delegate to `sendEmail()`) — automated but already wrapped, so the change is one file.
4. **Course confirmation, completion, courseware emails** (3 cron jobs) — automated, run nightly. Worst case: one batch goes silent. Acceptable rollback window.
5. **Proforma invoice email** (`send-proforma-email.ts`) — finance-triggered, batch.
6. **Certificate emails** (3 paths) — admin-triggered + cron. Critical for compliance, so done after the cron-based ones above prove the pattern.
7. **Forgot password** (`forgot-password.ts`) — user-triggered, but users have alternative paths (ask admin).
8. **OTP login** (`send-otp.ts`) — **last**. Highest blast radius (broken OTP = total login outage). By the time we touch this, the abstraction has been shaken out by 14 other call sites.

### Phase 4 — Migrate the SMTP-only path
`pages/api/tickets/create.ts` currently uses `lib/services/emailService.ts` (SMTP). Two options:

- **4a (preferred):** route ticket emails through `sendEmail()` too. Today they'd go via Gmail OAuth (changing the support-ticket transport from SMTP to Gmail OAuth). Verify deliverability matches before merging.
- **4b (alternative):** leave `emailService.ts` alone in PR 1 — it'll naturally migrate when PR 2 introduces SMTP as a real provider. Lower risk for PR 1, slight tech debt deferred.

**Recommendation:** Phase 4b. PR 1 stays focused on Gmail OAuth consolidation. The single SMTP path becomes the first opt-in user of the SMTP provider in PR 2.

## 6. Verification strategy

| Layer | Approach |
|---|---|
| **Unit tests (new)** | `lib/email/providers/gmail-oauth.test.ts` — mock `googleapis`, assert MIME byte-equality with snapshots captured from current production code for OTP, certificate (with PDF attachment), trainer-invitation (with cc list), feedback (with reply-to). |
| **Integration test (new)** | Single test that hits `sendEmail()` against a Gmail sandbox account with `MAIL_TEST_MODE=true`, verifies a real message lands. Run manually before merge, not in CI (needs network + creds). |
| **Manual smoke test** | Walkthrough script: send OTP, send forgot-password, send certificate via UI test button, trigger one cron job manually. Capture sender, reply-to, attachment, and rendered HTML for each. Compare against pre-refactor screenshots. |
| **Production canary** | Deploy to Tertiary first (it's our own client; we eat the dogfood). Monitor `auto_create_certificates_log` and the OTP table for 48h before declaring stable. |
| **Rollback plan** | The PR is one git revert away from restoring the inline calls. We tag the pre-PR commit so revert is mechanical. |

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MIME format drift breaks Gmail's parsing of attachments (PDF certificates) | Low | High (no certs sent) | Snapshot tests on MIME bytes; manual cert send via test endpoint before user-facing certs migrated |
| Subtle change in From / Reply-To header behaviour | Medium | Medium (replies go to wrong place) | Phase 3.1 on feedback form catches this early; explicit assertion in unit tests |
| OAuth token refresh logic regresses | Low | Critical (everything dies after 1h) | Existing `loadTrainingProviderEmailConfig` already handles refresh; we keep its behaviour, just call from one place |
| Cron job silently fails | Medium | Medium (delayed by 1 day) | All cron jobs have logging tables (`auto_create_certificates_log` etc.); add monitoring step in Phase 3 |
| Unicode / emoji in subjects double-encodes | Low | Low (cosmetic) | Snapshot tests include emoji case |
| Deployment partial-rollout (one container new, one old) | Low | Low | Coolify deploys atomically; not multi-replica |

## 8. Effort & timeline

| Phase | Work | Calendar |
|---|---|---|
| Phase 1 (abstraction + tests) | ~4 hours | Day 1 |
| Phase 2 (test endpoints + manual verify) | ~1 hour | Day 1 |
| Phase 3 (8 user-facing migrations + verify each) | ~4 hours | Day 2 |
| Phase 4b decision (skip in PR 1) | 0 | — |
| Manual smoke + canary on Tertiary | 48h soak | Days 3–4 |
| **Total wall-clock** | | **~4 days** |

Pure coding time is ~1 dev-day; the rest is verification time we should not skip.

## 9. Acceptance criteria for PR 1 to merge

- [ ] All 15 Gmail OAuth send sites call `sendEmail()` and contain zero references to `googleapis` / `gmail.users.messages.send` directly.
- [ ] `lib/services/emailService.ts` (SMTP) and its single consumer `pages/api/tickets/create.ts` are unchanged (Phase 4b).
- [ ] No new env vars, no new DB columns, no schema migrations.
- [ ] Unit tests pass; manual smoke test signed off.
- [ ] 48h Tertiary canary shows no increase in failed sends, no user-reported OTP issues.
- [ ] Code-review approval focusing specifically on the OTP and certificate-attachment paths.

## 10. Open questions for review

1. **Phase 4 choice — 4a or 4b?** I'm proposing 4b. Are we comfortable leaving the SMTP path alone for PR 1?
2. **Test infrastructure.** Do we have Jest/Vitest set up already? If not, do we add it as part of PR 1, or skip unit tests in favour of the manual smoke test?
3. **Canary on Tertiary.** Comfortable using Tertiary as the canary, or want to wait for Chariot to be the test client?
4. **Who owns the manual smoke test?** Roughly 30 min of clicking through the admin UI and triggering each send.

## 11. What PR 2 looks like (preview, not part of this PR)

For context only — confirms the PR 1 abstraction is the right shape:

- Migration adds `email_provider` (default `'gmail_oauth'`) and `smtp_*` columns to `training_provider`.
- New `lib/email/providers/smtp.ts` using existing `nodemailer` dep.
- `resolver.ts` switches on `email_provider`.
- Company Settings UI gets an "Email Provider" dropdown; SMTP fields appear when SMTP is selected.
- `pages/api/tickets/create.ts` migrated to `sendEmail()` (closing Phase 4b).
- Existing clients keep `gmail_oauth` default → zero migration burden.

If PR 1's abstraction is right, PR 2 is a one-day change. If PR 2 turns out to need design changes to the provider interface, we revise PR 1 *before* merging it — which is why we're getting alignment on this doc first.
