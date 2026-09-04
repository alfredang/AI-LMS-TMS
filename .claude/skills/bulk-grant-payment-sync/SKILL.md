---
name: bulk-grant-payment-sync
description: Reference and safety contract for the Finance "Bulk Grant Payment Sync" feature (TPGateway disbursement → QuickBooks payments). Load this BEFORE touching lib/services/grantImport/**, pages/api/grant-import/**, or components/finance/GrantImportView.tsx — it documents the full data flow and a set of invariants that must never be weakened, because this code writes real money movements into QuickBooks.
---

# Bulk Grant Payment Sync

Finance-role feature: Finance uploads a TPGateway Disbursement Excel export (actual SSG grant
payments received), the system matches each row to a QuickBooks invoice by GRN, and creates a
QuickBooks `Payment` against that invoice. This is a **financial write path** — a wrong match or
a malformed payment body can misstate revenue on the wrong customer's invoice. Treat any change
here with the same care as a schema migration on a live table.

## Where the code lives

- UI: `components/finance/GrantImportView.tsx` (3-step wizard: Upload → Review/Select → Apply)
- API: `pages/api/grant-import/**` (`upload`, `jobs/[jobId]`, `batches/[batchId]/{preview,rows,apply,apply-progress,export,results}`)
- Core logic: `lib/services/grantImport/`
  - `grantImportStage1.ts` — parse/validate/match/persist (read-only QB checks only)
  - `grantImportApply.ts` — **the only file that writes to QuickBooks** (creates/voids `Payment`)
  - `grantImportDb.ts` — all Postgres reads/writes for `grant_import_batches`/`grant_import_rows`/`grant_import_audit_logs`
  - `grantImportRollup.ts` — recomputes `ssg_enrolments.total_grant_received/pending/grant_payment_status`
  - `tpGatewayDisbursementParser.ts` / `tpGatewayDisbursementValidator.ts` — xlsx parsing + row validation
- Schema: `database/migrations/add_bulk_grant_payment_sync.sql` (also runtime-ensured by `ensureGrantImportSchema()` in `grantImportDb.ts`)

## The flow, in one paragraph

Step 1 (**upload**) parses the xlsx, validates row format (GRN/ENR/FTX regexes), flags duplicate
`financial_transaction_id`s against prior batches, and matches each row against `ssg_grants` /
`ssg_enrolments` — plus a **read-only** QuickBooks lookup (only for files ≤120 rows, or when
`GRANT_IMPORT_STAGE1_QB_CHECK=true`) to show whether a payment already exists. Every row lands in
`grant_import_rows` with `selected_for_apply = false` by default — nothing is pre-selected. Step 2
(**review**) is Finance manually selecting which `ready` rows to submit; only `ready` rows are
selectable in the UI and server-side. Step 3 (**apply**, `POST .../apply`) is the only step that
writes to QuickBooks: it resolves the invoice for each selected row's GRN, checks for an existing
payment (idempotent — never double-pays), guards the amount against the invoice's live balance,
builds a `Payment` body, asserts a set of hard invariants (below), creates it, then re-reads it to
verify QuickBooks actually saved what was sent and actually linked it to the invoice — voiding and
failing the row if not. Background rollups then update `ssg_enrolments` grant-payment status.

## Non-negotiable invariants (do not remove or weaken without the user explicitly asking)

These exist because of a real incident: a loosely-matched invoice + QuickBooks' `AutoApplyPayments`
company setting caused a payment to be created correctly (right date, right amount) but linked to
the wrong invoice, and QB silently spilled money onto *other* open invoices for that customer to
absorb the difference. All of the following are currently implemented in `grantImportApply.ts`
specifically to make that class of bug structurally impossible, not just unlikely:

1. **Only exact, structured-field invoice matches from an externally-verified source may drive a
   write.** Each enrolment has **two** QuickBooks invoices — a Customer Invoice (`DocNumber`
   always starts `TC...`) and a Grant Invoice (`DocNumber` is the Baseline GRN, with SME/MCES
   components billed as extra lines on that same invoice under their own GRNs). Invoice resolution
   (`qbResolveInvoiceForGrantRowAcrossApps`) has four possible outcomes, ranked by trust:
   (a) `resolvedBy: 'docNumber'` — `Invoice.DocNumber === thisGRN`, exact.
   (b) `resolvedBy: 'enrolment_grant_docNumber_ssg'` — `Invoice.DocNumber === a sibling GRN`,
       where the sibling relationship is confirmed by `ssg_grants` (synced directly from
       SSG/TPGateway — the same data the Consolidated Finance view reads from).
   (c) `resolvedBy: 'enrolment_grant_docNumber_history'` — sibling GRN known only from this app's
       own `grant_import_rows` upload history. Self-referential, never externally re-verified: if a
       wrong pairing were ever uploaded once, this tier would keep trusting it indefinitely. Tried
       only when `ssg_grants` has nothing (it lags/is missing for newer enrolments).
   (d) `resolvedBy: 'date_window_scan'` — fuzzy scan of nearby invoices' Line.Description text.
   **Only (a) and (b) may drive a write.** `applyGrantImportBatch` explicitly rejects
   `resolvedBy === 'date_window_scan'` **and** `resolvedBy === 'enrolment_grant_docNumber_history'`
   before doing anything else — those rows fail with an actionable message instead of writing.
   The `TC...` vs `GRN-...` DocNumber prefixes never overlap, so exact-DocNumber matching (a/b)
   can structurally never land on the wrong invoice *type* (Customer vs Grant) — the remaining
   risk tiers (c) and (d) guard against is picking the wrong *sibling GRN* or wrong *invoice
   instance*, not the wrong invoice type. If you ever see logic that lets `date_window_scan` or
   `enrolment_grant_docNumber_history` reach `qbCreatePayment`, that is a regression — revert it.
2. **Payment amount can never exceed the resolved invoice's live remaining balance.** Checked via
   a fresh `qbGetInvoiceBalance` call immediately before building the payment body. This is what
   stops `AutoApplyPayments` from having any excess to redistribute even if a wrong-but-underfull
   invoice were somehow resolved.
3. **`TotalAmt` must exactly equal the single `Line.Amount`, and that line must link to exactly
   one invoice — the resolved one.** Asserted as a hard runtime invariant immediately before
   `qbCreatePayment` (throws and fails the row otherwise). This is the direct mechanism: a payment
   whose `TotalAmt` exceeds what's explicitly applied to invoices is exactly what QuickBooks
   auto-distributes elsewhere. Never build a `paymentBody` with more than one `Line`, and never let
   `TotalAmt` diverge from that line's `Amount` for this feature.
4. **Idempotency checks run before the balance guard**, matching by (a) customer+date+amount
   linked to the invoice, then (b) `PaymentRefNum`. Re-running the same file, or re-clicking Apply,
   must never create a duplicate `Payment`. Don't reorder these checks after the balance guard —
   a correctly-already-paid invoice (balance already 0) would then be wrongly rejected as
   "exceeds balance" instead of recognized as done.
5. **Deposit account must never be left to resolve to QuickBooks' default ("Undeposited Funds").**
   If the configured account name/id can't be resolved, the row fails loudly rather than guessing.
6. **Post-write verification is mandatory, not optional.** After creating a `Payment`, the code
   re-reads it and checks date/ref/deposit-account/payment-method were actually saved as sent, and
   re-reads the invoice balance to confirm it actually dropped by the paid amount. Either check
   failing **voids the just-created payment** and fails the row — never report a row as "applied"
   without this confirmation.
7. **One failing row must never abort the batch or corrupt other rows' state.** Every row is its
   own try/catch with its own audit log entry (`grant_import_audit_logs`, event types `apply_start`
   / `apply_success` / `apply_fail` / `skip`). Keep it that way — no `Promise.all` fan-out that
   could let one QB error mask what happened to sibling rows.
8. **Overwrite (`allowOverwriteAlreadyApplied`) is opt-in, off by default**, and always voids the
   prior payment before creating a replacement — never leave two live payments for the same row.
9. **This feature never creates, edits, or deletes a QuickBooks Invoice, Customer, or Account.**
   All invoice/customer/account lookups are `qboQuery` (read-only `SELECT`). The only writes are
   `Payment` create and `Payment` void. If a change introduces an Invoice/Customer/Account write
   here, stop and confirm with the user first — that's outside this feature's authorized scope.
10. **Content verification, independent of resolution tier (added 2026-08-25).** Even a
    `'docNumber'` or `'enrolment_grant_docNumber_ssg'` match is only as trustworthy as the
    DocNumber/`ssg_grants` data feeding it — a stale `ssg_grants` row or a reused/duplicate
    DocNumber can still resolve to the wrong invoice *object* while passing the tier check in
    invariant 1. Every real grant invoice line in this company's QuickBooks carries
    `"Grant Ref #: <that line's own GRN>"` in its `Description` (verified against live data
    across dozens of sampled invoices, multiple description-punctuation variants). Before any
    write, `invoiceHasGrantInDescription(inv.raw, grantId)` must find the row's own `grant_id`
    literally present in the resolved invoice's line text — if not, the row fails instead of
    writing. This mirrors `verifySfcInvoiceMatch` (`sfcInvoiceVerify.ts`), added after an
    identical "trusted a resolved id without checking its content" incident in the SFC claims
    feature. Do not remove this check to "fix" a row that fails it — a failure here means the
    resolved invoice is unverified, not that the check is wrong; investigate the underlying
    `ssg_grants`/DocNumber data instead.

## Known UI/config gotcha (not a code bug, but affects how "safe" a given deployment is)

`apply.ts` defaults `dryRun` to `true` when the field is omitted from the request — but
`GrantImportView.tsx` always sends the field explicitly and its default React state is
`dryRun = false`, and the dry-run checkbox is hidden unless env `NEXT_PUBLIC_GRANT_IMPORT_SHOW_DRY_RUN=true`
is set. In a deployment without that env var, clicking "Apply Selected" writes to QuickBooks
immediately — there is no dry-run safety net visible to Finance. If asked to make this feature
safer for a given tenant, consider surfacing that toggle rather than relying on its hidden default.

## Before changing anything in this feature

1. Re-read this file's invariant list and confirm your change doesn't touch any of them.
2. Test on localhost per CLAUDE.md — but note QuickBooks itself can't be safely exercised against
   the real company file from local dev; treat any change to `grantImportApply.ts` as needing a
   careful code read + `dryRun` (or the smallest possible real test batch) rather than a full
   local run, and say so explicitly if you couldn't verify against live QuickBooks.
3. If a change would relax any of the 9 invariants above (e.g. allowing `date_window_scan` to
   auto-apply, allowing multi-line payments, raising the balance tolerance), do not make it
   silently — flag it to the user and get explicit confirmation first.
