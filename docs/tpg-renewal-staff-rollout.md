# Staff distribution and page proposal

## Recommended page placement

Place a secondary **Setup & Download** button immediately after the primary **Update
from TPG** button in the Course Validity List toolbar. Keep Excel downloads separate.
The secondary button opens a small dialog with:

- **Download Chrome extension (v0.1.6, ZIP)**.
- **Read setup & usage guide**, opening the printable HTML guide in another tab.
- Installed extension version or **Not detected**, with a short reminder to sign in to TPG.

Use the same dialog from the update dialog's missing/outdated-extension message.
Staff should be able to download before the extension is installed. Keep these controls
available to the same users authorised for Course Funding Validity, with the same check
enforced by the server for capture planning and applying updates.

## Prepared artifacts

Run `node scripts/package-tpg-renewal-extension.cjs` to build:

- `/downloads/tpg-renewal/tia-tpg-renewal-sync-staff-v0.1.6.zip`
- `/downloads/tpg-renewal/setup-guide.html`
- `/downloads/tpg-renewal/release.json` (version, target origin, SHA-256 checksum).

The ZIP includes an `extension` folder, `START-HERE.html`, and `README.txt`.
Only four explicitly selected extension files enter the ZIP. It contains no database
credentials, environment files, source captures, audits, or Docker configuration.
The build adapts the localhost extension to the exact TIA production origin; the local
trial source remains unchanged. Staff need neither a local application nor Docker.

Generated ZIPs are ignored by Git. Build the package during the deployment build before
Next.js/Docker copies `public`, or upload the verified archive to the chosen download
location. The URLs above will work only after those artifacts are deployed. Files under
`public` are public downloads; they contain code and instructions only. If downloads must
also require login, serve these same artifacts through an authenticated download endpoint.

## Required before staff activation

The production implementation is now included. See [production configuration](tpg-renewal-production.md)
for the environment variables and persistent storage required to activate it. The
original rollout checklist below records the requirements implemented or to verify:

1. Implemented: replace localhost-only checks in `TpgRenewalTrial.tsx`, the backend origin guard, and
   trial UI wording with the exact production origin and environment configuration.
   Retain the enabled-feature flag, same-origin checks, and interactive session requirement.
2. Implemented: both plan/apply APIs allow Admin and Developer, the two layouts exposing
   Course Funding Validity. Interactive sessions are required.
3. Configure persistent job/audit storage on the website server and enable the feature there.
4. Implemented: add the proposed dialog and links, use the packaged version as the minimum supported
   extension version, and build the download artifacts during deployment.
5. Verify on a second computer: extension handshake, full capture, preview, authorised apply,
   unchanged rerun, rejection of unauthorised users, and expiry/error recovery.
6. The guide now explains that a visible Refresh from TPG button indicates server activation.
   Announce the release to staff after live verification.

Each staff member signs in to their own TIA and authorised TPG session in the same Chrome
profile. Installation uses Chrome's documented Load unpacked process and manual updates:
https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked
