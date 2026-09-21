# Deterministic TPG Renewal Database Sync

This CLI converts complete TPG Submissions and Rejected Applications captures into a reviewable database plan, then applies that exact plan in one verified transaction.

## One-line agent command

For the complete workflow—including live scraping through the logged-in Chrome session, database synchronization, audit generation, and TIA portal verification—use:

```text
Run $tpg-renewal-refresh
```

Add `dry run` to produce and review the plan without changing the database:

```text
Run $tpg-renewal-refresh as a dry run
```

The npm commands below remain the deterministic database stage used by that orchestration skill.

## Safety model

- `plan` uses a read-only database transaction.
- Both captures must prove complete coverage through `coverage.complete: true` or pagination metadata whose row count equals the reported total.
- Both captures must include valid `scrapedAt` timestamps and, by default, be no more than 180 minutes apart. Override with `--max-capture-skew-minutes` only when the reviewed scrape genuinely required longer.
- Matching is limited to exact course reference, normalized exact title, or the stored exact application number.
- The latest submitted candidate wins. Same-date ties prefer Submissions, then the higher application number.
- A missing prior number becomes `NOT Found` only when complete captures prove it is absent and neither exact course identity finds a replacement.
- `apply` requires the plan's SHA-256 hash, locks every course, and aborts the whole transaction if identity or renewal fields changed after planning.
- Only `actual_renew_date`, `renewal_application_no`, `renewed_status`, and `updated_at` are written.
- Applying an already-applied plan is a no-op; generating another plan from the same captures is also a no-op.

## Commands

Create a plan:

```powershell
npm run tpg:renewal-sync -- plan `
  --submissions scratch/tpg-submissions-all-types-YYYY-MM-DD.json `
  --rejected scratch/tpg-rejected-applications-YYYY-MM-DD.json `
  --as-of YYYY-MM-DD `
  --out outputs/tpg-renewal-sync-YYYY-MM-DD/plan.json
```

Review the JSON plan, especially `summary`, `operation`, `before`, `desired`, and `matchEvidence`. Then apply the exact hash printed by the plan command:

```powershell
npm run tpg:renewal-sync -- apply `
  --plan outputs/tpg-renewal-sync-YYYY-MM-DD/plan.json `
  --confirm-plan-hash sha256:REVIEWED_HASH
```

The default scope is WSQ courses with funding validity from the Singapore as-of date through the same calendar date three months later, inclusive. Use `--through YYYY-MM-DD` to override the end date.

## Capture contract

The tool accepts the existing full-capture shape:

```json
{
  "scrapedAt": "2026-09-21T00:00:00.000Z",
  "sourceUrl": "https://www.tpgateway.gov.sg/...",
  "submissions": {
    "count": 181,
    "rows": [],
    "pageAudit": []
  }
}
```

For a standardized capture without pagination details, include:

```json
{
  "coverage": { "complete": true, "total": 181 },
  "rows": []
}
```

Use the corresponding `rejectedApplications` key for that tab. Filtered search results must not claim complete coverage.
