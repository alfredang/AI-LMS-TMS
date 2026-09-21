# TPG renewal updates: localhost trial

Release: 0.1.6. Website: http://localhost:3000

This package is for the local Docker trial. The application must already be running
on this computer. Installing this extension alone on another computer will not give
that computer access to this trial. The trial updates the connected live TIA database.

## Set up once

1. Download and extract the ZIP to a permanent folder in Documents.
2. Open chrome://extensions in Chrome and enable Developer mode.
3. Click Load unpacked and select the extracted extension folder containing manifest.json.
4. Check that TIA TPG Renewal Sync (Local Trial) is enabled and shows version 0.1.6.
5. Refresh TIA at http://localhost:3000 and open Course Funding Validity.

Already using this extension? Keep only one copy enabled. To update, replace the files
in its existing folder with the new extension files, click Reload in chrome://extensions,
and refresh TIA. Do not delete or move the installed folder.

## Run an update

1. Sign in to TIA as an administrator and sign in to your authorised TPG account in
   the same Chrome profile. In TPG, open Courses and check the training organisation.
2. Click Refresh from TPG (Trial). Keep both tabs open and do not change TPG pages
   or filters while the capture runs.
3. Review the preview: course scope, application numbers, dates, statuses and NOT Found
   results. Capture and preview do not change the database.
4. Click Confirm & Apply when the preview is correct. Wait for the committed and verified
   message, then check the refreshed list. Apply writes to the connected live database.

The scope is WSQ courses expiring from today through the same date three months later,
inclusive, using Singapore dates. Both Submissions and Rejected Applications are read.
The latest application matching the course reference or exact normalised title supplies
the Renewal Application No, Actual Renew Date and Renew Status. NOT Found means no
matching application was found; its date and status remain unset.

## Help

- Extension not detected: enable it in the same Chrome profile and refresh TIA.
- Login expired: sign in to TPG, return to Courses, and retry.
- Capture failed: no database update has been made by capture. Check TPG and retry.
- Preview expired: capture again; previews last 30 minutes.
- Unclear apply result: check the list and ask the administrator to inspect the audit.
- Coordinate with colleagues so only one person runs a renewal update at a time.

No ChatGPT extension or paid AI subscription is required. This package contains only
extension code and instructions, not passwords, database credentials, or course data.
If Developer mode is blocked by your organisation, contact IT.
