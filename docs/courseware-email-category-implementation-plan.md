# Courseware Email Category Implementation Plan

Updated: 20 November 2026, Asia/Singapore.

Status: Live in production. [PR #159](https://github.com/alfredang/AI-LMS-TMS/pull/159) merged on 20 November 2026 at 15:34:23 Singapore time as `1b598be2792c041512808c2a50751c9884de121b`. The new app build was verified at 15:51:56, and the reviewed master template was activated directly in the database at 15:52:11 Singapore time. All three scenarios, saved content, CC preservation and the existing schedule were verified.

## Objective and scope

Replace the mixed courseware email with **one editable master template that renders three scenarios** for the existing TMS course-day email. Each learner receives one rendered email containing the information relevant to their registered class, with the approved Academy letterhead, storefront logo link, typography and support details.

Maintain the shared greeting, course details, login instructions, support details and layout once. Category-specific portal guidance, attendance and assessment sections are conditional parts of that same template. The three scenario previews are examples of its rendered output, not three independently maintained templates.

This work applies only to the courseware email currently sent by `pages/api/external/auto-send-courseware-attendance.ts`. Other confirmation, welcome, registration, assessment-result and MMS access-notification templates are outside scope. Existing Google Apps Script source, triggers and process ownership remain unchanged.

The existing native courseware job runs daily at 07:00 Singapore time. Preserve that schedule, confirmed-enrolment eligibility, class-start-date filter, cancelled-class exclusions, per-class disable setting and configured CC recipients.

## Category selection

Classify by the registered class's **Course Code**, not its course title. Trim whitespace and compare case-insensitively without changing the stored/displayed code.

| Course Code | Rendering scenario | Portal and applicable content |
| --- | --- | --- |
| Begins with `TGS-` | WSQ-SWDA funded | TMS portal, SWDA e-attendance and WSQ assessment |
| Begins with `C-`, or C followed by digits such as `C197` and `C251` | Non-funded | Learner portal and non-funded class attendance |
| Missing, blank or unrecognised | Combined guidance | Both portals, category explanations and trainer/TIA Support guidance |

Use deterministic rules: an unrecognised code selects the combined-guidance scenario; it must not silently be treated as funded or non-funded. Existing recipient, class-access and MMS readiness restrictions still apply.

Keep these rules tenant-scoped; do not assume another tenant or country uses the same code conventions or portal URLs.

## One template with three scenarios

Use one stored subject pattern, `{EMAIL_PURPOSE} - {COURSE_NAME}`, and one stored HTML body. The renderer supplies the purpose text and decides which conditional sections to show.

| Scenario | EMAIL_PURPOSE | Attendance sections | Assessment section |
| --- | --- | --- | --- |
| WSQ-SWDA funded | `Course Materials, Attendance and WSQ Assessment` | `E-Attendance - SWDA-Funded Course` only | WSQ assessment submission |
| Non-funded | `Course Materials and Class Access` | `Class Attendance - Non-Funded Courses Only` only | None |
| Combined guidance | `Course Materials and Login Guidance` | Both sections, separately labelled and conditional | Explicitly labelled for WSQ courses only |

### Shared content and conditional sections

| Content | Stored and maintained | Display rule |
| --- | --- | --- |
| Letterhead, greeting, course details, OTP/self-registration/spam reminder, support and sign-off | Once in the master body | Every scenario |
| Funded portal link and its category label | One conditional block; URL supplied from tenant configuration | Funded and combined scenarios |
| Non-funded portal link and its category label | One conditional block; URL supplied from tenant configuration | Non-funded and combined scenarios |
| Check-course-code introduction and unsure/trainer/support guidance | One conditional block | Combined scenario only |
| Class Attendance | One conditional block | Non-funded and combined scenarios; labelled non-funded only |
| E-Attendance | One conditional block | Funded and combined scenarios; labelled SWDA-funded only |
| WSQ Assessment Information | One conditional block | Funded and combined scenarios; explicitly conditional in combined output |

Use a small, documented set of allowlisted conditional markers and variables. Do not evaluate arbitrary JavaScript or template expressions. Validate balanced blocks and known names when saving. Resolve block visibility before substituting escaped course values, so inserted course data cannot be interpreted as template syntax. No conditional markers may remain in a sent email.

Keep each reusable section's wording in one place. Where a scenario needs different introductory wording or a verified attendance link, use a small conditional phrase or resolved variable rather than copying the full section. The exact supported marker syntax must be documented beside the editor during implementation.

Use SWDA in the revised learner-facing wording. Retain the existing MySkillsFuture attendance endpoint; a change of agency name alone does not justify changing a working URL.

### Shared greeting and course details

Every rendered scenario starts with the shared greeting:

> Dear Learners,
>
> Welcome to Tertiary Infotech Academy.

Display the actual course title, Course Code, Course Run Code and class dates once under **Your Course Details**. Never hardcode the sample course, run number or dates. Collapse identical start/end dates to one date; show both dates for multi-day classes.

### Course Material and Login

Use one shared **Course Material and Login** heading.

For the two recognised categories, use the same wording with only the portal URL changed:

> Please visit **[category-specific portal]** and sign in using your registered email address by requesting a one-time password (OTP). Once signed in, open your course to download the course materials.
>
> If you are unable to sign in or cannot see the course you are attending, complete **learner self-registration** on the login page using the **Course Run Code shown above**.
>
> **Reminder:** If your OTP does not arrive, please check your **spam or junk folder**.

Portal URLs for the Tertiary Singapore template:

- WSQ-SWDA funded: `https://lms-tms.tertiaryinfotech.com/`
- Non-funded: `https://www.tertiarycourses.com.sg/learnerlogin`

The combined scenario first lists both portals with their category/code explanations and adds:

> Please check the Course Code shown above or on your registration and use the appropriate portal below.
>
> **If you are unsure which portal to use, please check with your trainer or contact TIA Support using the details below.**

It then provides the common OTP, self-registration and spam/junk instructions once. Confirm that self-registration is available from both portal flows before activation. If a required Course Run Code is genuinely unavailable, direct the learner to their trainer or support for the code rather than displaying an invented value or saying it appears above.

### Attendance wording

**Class Attendance - Non-Funded Courses Only**

> If you are attending a non-funded course, please follow your trainer's instructions for recording your attendance during each class session.

**E-Attendance - SWDA-Funded Course**

> If you are attending a SWDA-funded course, please complete your digital e-attendance for each session using the attendance link provided by your trainer.

For a recognised funded class with a verified attendance identifier, include the existing **Take e-attendance** link populated from that class. Do not derive an SWDA attendance URL from an MMS class ID or an unverified identifier. In the combined fallback, use the trainer-provided-link wording unless the correct SWDA attendance link has been independently verified.

The non-funded output contains no SWDA e-attendance instructions. The funded output contains no non-funded Class Attendance section. The combined output contains both separately labelled sections, without implying both apply to the learner. All sections belong to the same master template.

### WSQ assessment wording

Both applicable scenarios use the heading **Assessment Information - WSQ Courses Only** and the portal name **Course Material Portal**.

Funded scenario:

> Assessment documents and submission are available in the **Course Material Portal**. Your trainer will explain the steps and guide you through the process during the assessment session.

Combined scenario:

> If you are attending a WSQ course, assessment documents and submission are available in the **Course Material Portal**. Your trainer will explain the steps and guide you through the process during the assessment session.

Do not render a WSQ assessment section in the non-funded scenario. Present this as information about available documents and trainer guidance; do not introduce exam/pass requirements or fixed submission times.

### Support and sign-off

> **TIA Support**
>
> If you need assistance, please contact us:
>
> Tel: 6929 2168  
> Email: enquiry@tertiaryinfotech.com
>
> Best regards,  
> Tertiary Courses SG Team

Store this branding/contact content once in the tenant's master template or configuration, not as a new hardcoded rule in shared sending logic.

## Current implementation constraints

- The database currently stores one `courseware_attendance_email_subject` and one `courseware_attendance_email_body` on `training_provider`, plus a shared CC field.
- Reuse the existing subject/body pair and `courseware_attendance_email_cc`. Do not add three subject/body pairs, a template table or a new activation flag for this change. A database schema migration is not required for the proposed design.
- The Company Settings editor, API and test-email preview currently expose that single template. Extend them for conditional content and scenario previews while keeping one editable source.
- The course-day sender obtains course details from the class and recipients from confirmed enrolments in that class.
- `lib/mmsSync/legacyRouting.ts::learnerMail()` can replace the entire subject/body with an MMS course-day access message. Updating the master body alone will not ensure the chosen scenario reaches MMS-routed learners; the courseware caller must preserve readiness checks and use the shared renderer.
- The Google registry contains a separate Courseware Delivery Automation project. Registry/source existence is not proof of its trigger schedule. This plan does not change it or consolidate sending ownership.

## Implementation steps

1. **Back up and capture the baseline.** Save the current tenant template, subject, CC and scheduler settings securely. Recheck the Google registry and TMS/MMS routing before changing the sender.
2. **Reuse the existing tenant storage.** Keep one `courseware_attendance_email_subject`, one `courseware_attendance_email_body` and the current CC field on `training_provider`. Save the pre-change values securely for rollback; no category-specific database fields are needed.
3. **Build a shared classifier and renderer.** Resolve one scenario from the registered class's code, determine conditional-block visibility, resolve the subject purpose and class identifiers, and substitute escaped values. Use the same rendering path for production and previews. Keep the external SWDA attendance identifier separate from the MMS class identifier. Support the existing ordinary HTML template without markers so deploying renderer support alone preserves current TMS template output.
4. **Integrate only the courseware sending path.** Render the scenario in `auto-send-courseware-attendance.ts`. For MMS-routed courseware mail, preserve readiness and recipient checks and use the same master template. Scope any routing change explicitly to this caller; confirmation emails and independent MMS access notifications must retain their existing behaviour. An unrecognised code must not bypass a readiness hold. Stage any MMS presentation change until the reviewed master template is saved, so deployment alone does not unexpectedly replace an existing MMS message.
5. **Update Company Settings and preview support.** Keep one subject editor and one body editor. Add a three-scenario preview selector, documented conditional markers/variables and example course data. Preview selection must not create a second saved template or change production category selection. Validate conditional syntax and supported variables in the authenticated GET/PUT/test-email paths; scope writes to the authenticated tenant/provider.
6. **Prepare the reviewed master content.** Consolidate the approved examples into shared blocks and conditional sections. Retain the approved linked letterhead, 650px white wrapper, 22px greeting, 16px headings, 12px body text, 16px body line height and 10px content padding. Update shared wording once and verify it appears consistently in all three scenario previews.
7. **Validate and deploy support.** Complete the checks below with the existing saved template untouched. Deploy backward-compatible rendering/editor support only after repository checks pass. No new scheduler or additional sending job is required.
8. **Activate by saving the approved master template.** After final content approval, update the existing tenant subject/body pair together and read it back. Verify all three outputs before the next normal scheduled run. Do not rerun the scheduled job to test a template or resend courseware to learners.

## Files expected to change during implementation

| Area | Existing or proposed file |
| --- | --- |
| Classifier and renderer | `lib/learner/coursewareEmailTemplate.ts` (proposed) |
| Course-day sender | `pages/api/external/auto-send-courseware-attendance.ts` |
| Scoped MMS course-day integration | `lib/mmsSync/legacyRouting.ts` or a courseware-specific adapter; preserve shared callers |
| Template settings API | `pages/api/training-provider/courseware-attendance-email-template.ts` |
| Company Settings editor | `components/training-provider/CoursewareAttendanceEmailTemplateView.tsx` |
| Test-email rendering | `pages/api/training-provider/send-test-email.ts` |
| Focused verification | Classifier/renderer and sender-routing tests using synthetic recipients and sources |

These implementation locations are now present, together with `lib/learner/coursewareMasterTemplate.ts` and `tests/courseware-email-template.test.ts`. No schema migration or three-pair template storage was introduced.

## Validation and acceptance criteria

- Test TGS codes, C-hyphen codes, existing C-number codes, mixed case, whitespace, null/blank and unrecognised codes.
- Verify the rendering scenario is based on the enrolled class's Course Code, not its title, and exactly one courseware send is attempted per eligible recipient in that job run.
- Verify there is one saved subject/body pair and one editor source. Changing shared wording once must update all three rendered scenarios without editing three copies.
- Verify allowlisted conditional markers resolve correctly, malformed/unknown blocks are rejected, and course values containing marker-like text cannot affect block visibility.
- Verify funded mail includes only the TMS portal, SWDA e-attendance and WSQ assessment; non-funded mail includes only the learner portal and Class Attendance.
- Verify fallback mail includes both portal choices, the trainer/TIA Support guidance, two separately conditional attendance sections and the conditional WSQ assessment section.
- Test TMS and ready/pending/review MMS cases. Preserve class readiness holds and avoid changing confirmation or independent access-notification content.
- Test that Course Run Code, MMS class ID and SWDA attendance links use their correct sources. Missing codes must not become fabricated links.
- Validate HTML escaping, supported variables, complete placeholder replacement, one visible course-details block and one copy of the shared login instructions.
- Confirm OTP and learner self-registration are reachable on each category's portal.
- Render desktop and mobile previews, checking the linked logo, typography, wrapping and links.
- Exercise the local editor/API, all three preview choices and appropriate repository checks before deployment. Confirm no schema change is introduced. Test backwards compatibility with the current ordinary HTML template and verify preview selection does not alter the saved template or live classification.
- Use synthetic sources for Google-related validation; never modify production Google Script code merely to test editing.
- Send preview emails only when explicitly requested, to the specified reviewer only. Do not invoke learner bulk-send or run-now actions as a test.
- Read back the activated master subject/body and confirm the existing schedule and CC values are unchanged. After the next scheduled run, inspect logs and a sent example to verify the correct scenario actually rendered.

## Rollout and rollback

Deploy the backward-compatible classifier, renderer and single-template editor while retaining the currently saved subject/body. Review the three rendered scenario previews from one staged master template. After approval and routing verification, activate by saving that one master subject/body pair in the existing tenant settings. No new flag, schema migration or scheduler is required.

If content rendering fails, restore the backed-up subject/body pair. The renderer must continue to accept the previous ordinary HTML. If courseware routing itself regresses, revert that scoped code change as well. Restore template content before removing renderer support so conditional markers cannot be sent literally. Keep all backups. Do not change schedules, Google triggers, enrolments or MMS process ownership as part of rollback.

## Review artifacts

The following local review artifacts are gitignored under `scratch/`; this implementation plan is the durable repository document. They illustrate the three expected outputs. Their separate HTML files are review snapshots, not three production templates. The single conditional master source is implemented and staged under `scratch/courseware-email-20261120/implementation/master.json`, with the final rendered mock bodies in `mock-emails.json` in that directory.

- [Funded HTML draft](../scratch/courseware-email-20261120/three-category-drafts/wsq-swda.html)
- [Non-funded HTML draft](../scratch/courseware-email-20261120/three-category-drafts/non-funded.html)
- [Combined fallback HTML draft](../scratch/courseware-email-20261120/three-category-drafts/unrecognised-code.html)
- [Combined fallback desktop preview with corrected attendance sections](../scratch/courseware-email-20261120/three-category-drafts/unrecognised-code-attendance-split-desktop.png)
- [Combined fallback mobile preview](../scratch/courseware-email-20261120/three-category-drafts/unrecognised-code-attendance-split-mobile.png)
- [Draft metadata](../scratch/courseware-email-20261120/three-category-drafts/review-plan.json)

The HTML drafts use illustrative course data/placeholders for review. Implementation must populate actual registered-class details at send time from one saved master template.

## Implementation and final verification record

- [x] Implement one classifier, one renderer and a tenant-content master-template builder using the existing subject/body storage.
- [x] Add scoped course-day MMS rendering while retaining readiness, membership and notification holds and the existing confirmation behaviour.
- [x] Add the single-source editor's three-scenario preview/test selector, validation and sandboxed HTML preview.
- [x] Pass focused classifier/renderer, API and MMS-routing tests, localhost editor checks and all three desktop/mobile email renders.
- [x] Pass API authentication coverage and the production webpack build. The repository-wide type check reports existing errors outside the changed files. The design-token guard passes with Windows path separators normalised in memory; its tracked source is unchanged.
- [x] Release the isolated change and verify the new renderer is live before saving conditional content.
- [x] Activate the backed-up tenant master subject/body; read back the saved content and confirm CC and schedule preservation.
- [x] Send exactly one clearly labelled mock email for each scenario to the review address explicitly specified in the latest request, without CC/BCC. All use sample class data and no actionable SWDA attendance link.
- [x] Verify all three messages in Gmail Sent, including recipient, subject and rendered body. Record their scenario, timestamp and message ID in the private daily log and local audit record. This verifies sending, not recipient delivery.

The initial three mock messages were sent on 20 November 2026 at 14:05:05, 14:05:25 and 14:06:11 Singapore time for funded, non-funded and unrecognised scenarios respectively. The recipient clarification arrived afterward. One mock per scenario was then sent to the clarified review address at 15:05:32, 15:05:47 and 15:06:09 Singapore time, and all three were verified in Gmail Sent with the expected headers and rendered bodies. No CC/BCC was used.

Both send histories are retained: `scratch/courseware-email-20261120/implementation/mock-send-receipts.json` records the initial set; `mock-send-receipts-corrected.json` in the same directory records the corrected final set. The private daily log also records the address correction and message IDs.

The feature was published on `codex/courseware-scenarios` in PR #159 after automatic approval review initially rejected a direct production push without explicit release approval. The user subsequently approved production implementation, and PR #159 is now merged and deployed. Direct database access was used to activate only the existing tenant subject/body fields after confirming renderer availability. A fresh rollback backup was captured, saved content was read back, and CC and schedules were verified unchanged. Google code and triggers remain unchanged.

### Assessment wording revision and refreshed samples

The assessment section now reads **Assessment Information - WSQ Courses Only**, calls the portal **Course Material Portal**, and explains document availability and trainer guidance during the assessment session. The combined scenario retains its WSQ-only qualification; the non-funded scenario still omits assessment information.

Nine focused tests and six desktop/mobile renders passed for this revision. One updated mock per scenario was sent to the clarified review address on 20 November 2026 at 15:31:20, 15:31:25 and 15:31:31 Singapore time (funded, non-funded and unrecognised respectively). Gmail Sent headers and exact rendered bodies were verified; no CC/BCC was used.

The latest review master, rendered bodies, screenshots and send receipts are under `scratch/courseware-email-20261120/implementation/assessment-information-review/`. These samples supersede the earlier review sets. This reviewed master is now active in production; the previous wording is preserved in `master-before-assessment-wording.json` and the fresh production rollback snapshot.

### Production activation verification

- Live app build: `dYv_KNGSVnOX-7EPvQ0FX`; page bundle `index-51e3f4830519430a.js` exposes the three-scenario editor and conditional validation.
- Activated on 20 November 2026 at 15:52:11 Singapore time; a separate post-activation read confirmed the conditional master is saved.
- All three rendered scenarios passed against the saved subject/body. The assessment information wording appears only in funded and combined guidance.
- Existing CC preserved; courseware scheduler remains enabled with `0 7 * * *` in Asia/Singapore. The next normal eligible course-day send is 21 November 2026 at 07:00 Singapore time. No bulk-send/run-now action was invoked.
- Homepage and DB-backed health passed after activation. Google registry metadata remains unchanged; Google trigger coverage is still not inferred.
- Private rollback snapshot: `scratch/courseware-email-20261120/implementation/production-before-2026-11-20T07-39-32-644Z.json`.
- Private activation receipt: `scratch/courseware-email-20261120/implementation/production-activation-receipt.json`, containing exact readback, body hash and scenario verification evidence. Rollout observations are retained in `production-rollout-observations.jsonl`.

### Conditional markers

Wrap a block with `<!-- cw:if SHOW_FUNDED -->` and `<!-- cw:end -->`. Nested blocks are supported to a bounded depth; arbitrary expressions are not supported. Conditions are `FUNDED`, `NON_FUNDED`, `UNRECOGNISED`, `SHOW_FUNDED`, `SHOW_NON_FUNDED`, `HAS_RUN_CODE`, `NO_RUN_CODE`, `HAS_ATTENDANCE_LINK` and `NO_ATTENDANCE_LINK`.

`SHOW_FUNDED` renders for funded and combined guidance. `SHOW_NON_FUNDED` renders for non-funded and combined guidance. Scenario selection in the preview changes synthetic data only; production resolves it from the registered class's code.
