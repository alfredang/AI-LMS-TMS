# TIA TPG Renewal Sync — localhost trial

This is a manual, review-before-apply trial for the Docker app at `http://localhost:3000`.
It uses a deterministic Chrome extension and the existing renewal matching rules. No LLM,
ChatGPT subscription, or Chrome Web Store registration is needed.

## Install the extension

1. Build/start the localhost Docker app with `docker compose -f docker-compose.tertiary-local.yml up -d --build app`.
2. In the same Chrome profile used to sign in to TPG, open `chrome://extensions`.
3. Enable **Developer mode**, select **Load unpacked**, and choose the
   `extensions/tia-renewal-sync` directory in this repository.
4. Open `http://localhost:3000/?adminPage=fundingValidity&view=admin` and sign in as an admin.
5. Log in to TPG in that Chrome profile. Complete Singpass/MFA yourself if requested.
6. Click **Refresh from TPG (Trial)** on the Course Validity List.

The extension reads every page of **Submissions** and **Rejected Applications** with filters
cleared. It requires the TPG record totals and page ranges to match every captured row. If
the page layout, login, filters, or pagination cannot be verified, the run stops without a
database update. The extension sends extracted course rows to TIA, not credentials or cookies.

## Review and apply

The preview is a read-only database plan. It covers WSQ courses with validity end dates from
the current Singapore date through three calendar months later, inclusive. Check the TPG
capture counts, `NOT Found` cases, application numbers, dates, statuses, and changed rows.
Only **Confirm & Apply** writes renewal fields. The update uses the same row identity and
optimistic-lock checks as the CLI, plus a single database transaction and post-write verification.
The captured data, plan, and apply audit are saved in the `tertiary_renewal_jobs_data` Docker volume.

**Important:** `docker-compose.tertiary-local.yml` points at the configured live TIA database.
The trial is limited to `localhost:3000`, is off by default outside that compose file, and
requires an interactive admin session. Do not click **Confirm & Apply** unless the preview is correct.

For extension changes, reload it at `chrome://extensions` and refresh the TIA page. The unpacked
extension does not update itself automatically.
The TIA dialog should then report extension v0.1.6 or newer. If it still reports an older version,
check that Chrome's **TIA TPG Renewal Sync (Local Trial)** is loaded from this repository's
`extensions/tia-renewal-sync` folder (not a copied or older folder), click its **Reload** button,
and refresh the TIA tab again.
Version 0.1.5 explicitly returns each application grid to page 1 before capture, even when
TPG remembers the last page and all filters are already clear. It also attaches its reader
to a TPG tab that was already open before the extension
was reloaded; you do not need to refresh TPG manually.

Version 0.1.6 recovers when TPG resets the pager to page 1 but keeps the last page's
rows: it visits page 2, verifies that page, then returns to page 1 before capture.
This behavior was reproduced live on Rejected Applications (four old rows with a
`1 to 10 of 184 records` counter); the page round trip restored all ten rows.
