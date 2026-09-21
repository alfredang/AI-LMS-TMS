# TPG renewal production configuration

The application supports Admin and Developer sessions, matching the layouts exposing
Course Funding Validity. Service/API-key callers cannot run this interactive workflow.
The grouped Refresh from TPG and Setup & Download controls are shown only when the
server enables the feature and its configured origin matches the current website.

For the TIA Coolify Dockerfile application, configure runtime environment variables:

```
ENABLE_TPG_RENEWAL_SYNC=true
TPG_RENEWAL_ORIGIN=https://lms-tms.tertiaryinfotech.com
TPG_RENEWAL_JOB_DIR=/app/tpg-renewal-jobs
```

Add persistent storage mounted at `/app/tpg-renewal-jobs` before activation. Keep this
outside `public`: it contains private captures, previews and apply audits. The process
must be able to write this directory. Do not set `ENABLE_TPG_RENEWAL_TRIAL=true` in
production; that flag deliberately selects the localhost origin. Other tenants remain
disabled unless explicitly configured and supplied an extension for their own origin.

`npm run build` creates both ZIP packages and guides from the explicit file allowlist.
Staff use `/downloads/tpg-renewal/tia-tpg-renewal-sync-staff-v0.1.6.zip`; localhost
uses the corresponding local package under `/downloads/tpg-renewal/local/`.
No Docker installation is required on staff computers. Upgrades are manual.

After deployment, verify configuration with an authorised interactive session, the
grouped buttons, guide and archive download, a full preview, and a reviewed apply.
The synchronizer keeps plan hashes, optimistic locks, a transaction and post-write
verification. A deployment itself does not run a renewal update.
