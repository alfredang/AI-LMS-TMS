# TPG renewal synchronization

The deterministic synchronizer refreshes TIA course-application dates, numbers, statuses, and submit types from complete TPG captures. An optional Course-Related Report also refreshes TRAQOM response rates and quality ratings. Its legacy funding-window mode can reconcile the current course reference code.

## Scope

The default scope is courses with a matching TPG application submitted during the inclusive three-calendar-month period ending on `--as-of`. Use the current Singapore date for `--as-of`, including when working from an older stored capture; the audit records the capture dates separately. The match may come from Submissions or Rejected Applications. For each database course, the synchronizer chooses the latest matching application by submission date; same-date ties prefer Submissions and then the higher application number. It includes all database course types and does not require an existing application number or a near-term funding expiry.

For example, `--as-of 2026-09-29` includes applications submitted from `2026-06-29` through `2026-09-29`. If the latest stored capture is from 25 September, it contains observations only through that scrape date. Courses without a matching application in the period retain their application fields. A stored renewal date later than the selected captured application is also left unchanged to prevent regression from an older capture. This scope updates `actual_renew_date`, `renewal_application_no`, `renewed_status`, and `submission_type`; it preserves course codes. The submit type comes from the same latest selected application, not an older submission for that course.

Pass `--traqom-report "Course-Related Report - 27 Sep 2026.xlsx"` to also set `traqom_response_rate` and `traqom_quality_rating`. The workbook must have the exact `Course Ref Number`, `Course Renewal (TRAQOM Response Rate (%))`, and `Course Renewal (TRAQOM Quality Rating)` headers. Each report reference must resolve to exactly one database course through its current, old, or historical reference; ambiguous matches fail planning. Report-only courses get only TRAQOM updates. Zero is a valid reported value, not a blank. The plan records report path and SHA-256, and apply rechecks them. Use the latest intended report for future runs; do not automatically reuse the example file.

For every future run, choose the latest complete, coherent Submissions, Rejected Applications, and Course Listing capture set in `scratch/`, or create a new set only when a live scrape is requested. The example paths below document the 29 September run; do not reuse them automatically. Report any days between the newest capture and the as-of date as unobserved, not as proof that no further applications were submitted.

The former funding-validity window remains available with `--scope funding-window --as-of YYYY-MM-DD --through YYYY-MM-DD`. In that mode the scope is the union of WSQ courses expiring in that inclusive window and courses of any database type that already have a real `TPG-...` application number. `--window-only` applies only to this legacy mode.

Candidate selection combines Submissions and Rejected Applications, matches exact known course refs (including code history), exact normalized titles, and the stored application number, then selects the latest submitted row. `Approved` remains `Approved`; `Rejected` maps to `Rejected/Expired`.

In the legacy funding-window mode, `Course Ref Code (New)` comes only from the complete active Course Listing. The listing row must match by an exact known course ref, exact database title, or exact selected-application title, and the target code must not belong to another database course. Code changes also update `course_code_history` and `course_change_log` atomically.

Current-code reconciliation runs only in the legacy funding-window mode.

## Plan

```powershell
npm run tpg:renewal-sync -- plan `
  --as-of 2026-09-29 `
  --submissions scratch/tpg-submissions-all-types-2026-09-25.json `
  --rejected scratch/tpg-rejected-applications-2026-09-25.json `
  --course-listing scratch/tpg-course-listing-all-types-2026-09-25-live.json `
  --outdir outputs/tpg-recent-applications-2026-09-29
```

Review `plan.json`, especially the chosen latest application for courses with multiple matches, status changes, and `unmatchedRecentApplications`. The unmatched list means no safe exact database-course match was found; it does not prove the course is absent. A blank-ref `New` application with a former or similar title needs manual identity review, not an inferred TGS number or automatic database write.

## Apply

```powershell
npm run tpg:renewal-sync -- apply `
  --as-of 2026-09-29 `
  --submissions scratch/tpg-submissions-all-types-2026-09-25.json `
  --rejected scratch/tpg-rejected-applications-2026-09-25.json `
  --course-listing scratch/tpg-course-listing-all-types-2026-09-25-live.json `
  --outdir outputs/tpg-recent-applications-2026-09-29 `
  --plan outputs/tpg-recent-applications-2026-09-29/plan.json `
  --confirm-plan-hash sha256:PLAN_HASH
```

Apply requires the exact plan hash, optimistic-locks all planned course fields, uses one transaction, verifies every requested field, and writes `apply-audit.json` only after commit.
