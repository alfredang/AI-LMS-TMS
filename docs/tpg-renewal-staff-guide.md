# TPG renewal updates: staff quick start

Release: 0.1.6 staff package. Website: https://lms-tms.tertiaryinfotech.com/

Availability: open Course Funding Validity on TIA. When the Refresh from TPG button
is visible, the website administrator has enabled the feature for your account.

## What you need

- Google Chrome on your computer, with permission to load an unpacked extension.
- Your own TIA Admin or Developer account with access to Course Funding Validity.
- Your own authorised TPG account, signed in to the correct training organisation.
- TIA and TPG open in the same Chrome profile.

No ChatGPT extension, paid AI subscription, Google developer registration, Docker,
Node.js, or database credentials are needed on staff computers after website activation.
If your organisation disables Developer mode, contact IT for an approved installation.

## Set up once

1. Download the TIA TPG Renewal Sync staff ZIP and extract it to a permanent folder,
   such as Documents/TIA-TPG-Renewal-Sync. Do not delete or move this folder afterward.
2. Type chrome://extensions in Chrome's address bar and enable Developer mode.
3. Click Load unpacked. Select the extracted extension folder containing manifest.json
   (not the ZIP and not the parent folder).
4. Check that TIA TPG Renewal Sync is enabled and shows version 0.1.6.
5. Refresh the TIA website. Open Course Funding Validity and the TPG update dialog;
   it should show that the extension is connected.

## Run an update

1. Sign in to TPG in the same Chrome profile. Open Courses and check the organisation.
2. In TIA, open Course Funding Validity and click Update from TPG
   (labelled Refresh from TPG in the current trial).
3. Keep both tabs open. Do not change TPG filters or pages while capture runs.
4. Review the preview: date scope, captured counts, application numbers, renewal dates,
   statuses, and NOT Found results. Capturing and previewing do not update the database.
5. Click Confirm & Apply only when the preview is correct. Wait for the verified
   completion message, then check the refreshed list. Coordinate with colleagues so
   only one person runs the update at a time.

The default scope is WSQ courses expiring from today through the same date three months
later, inclusive, using Singapore dates. It is not an update of every course in the list.
The process reads all Submissions and Rejected Applications pages. For each in-scope course,
it chooses the latest matching application by exact course reference or normalised title.
It updates Renewal Application No, Actual Renew Date, and Renew Status together.
NOT Found means neither tab supplied a matching application; its date and status are unset.

## Problems and updates

- Extension not detected: check it is enabled, use the same Chrome profile, and refresh TIA.
- TPG login expired: sign in again, return to Courses, then retry capture.
- Capture error: the capture has not updated the database. Retry after checking TPG.
- Preview expired: capture again; previews expire after 30 minutes.
- Update result unclear: check the current list and ask the TIA administrator to inspect
  the run audit before applying again.
- New extension version: close any running capture, extract the new package, replace the
  files inside your existing extension folder, click Reload at chrome://extensions,
  then refresh TIA and check the displayed version. Updates are manual.

The package contains only extension code and this guide. Passwords and cookies are not
sent to TIA; extracted course/application rows are sent to the TIA website for processing.

Chrome's official installation instructions:
https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked
