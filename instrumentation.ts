/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used to initialise the in-app task scheduler (cron jobs).
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
    // Only run on the server side, not during build
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const schedulerEnabled = process.env.ENABLE_APP_SCHEDULER === 'true'
            || (process.env.NODE_ENV === 'production' && process.env.ENABLE_APP_SCHEDULER !== 'false');

        if (schedulerEnabled) {
            try {
                const { initScheduler } = await import('./lib/scheduler/scheduler');
                await initScheduler();
            } catch (err) {
                console.error('[Scheduler] Failed to initialize:', err);
            }
        } else {
            console.log('[Scheduler] Startup scheduler disabled for this process');
        }

        // Ensure the CP Generator prompt-template table exists. Idempotent —
        // safe to run every boot; first-time deploys get the table without
        // requiring a manual `npm run db:migrate` step.
        try {
            const { ensureCpPromptTemplateTable } = await import('./lib/cp-prompts-ensure-table');
            await ensureCpPromptTemplateTable();
        } catch (err) {
            console.error('[CP] Failed to ensure cp_prompt_template table:', err);
        }

        try {
            const { ensureCourseAnnouncementTable } = await import('./lib/course-announcement-ensure-table');
            await ensureCourseAnnouncementTable();
        } catch (err) {
            console.error('[Announcements] Failed to ensure course_announcement table:', err);
        }

        // Warm up Gmail OAuth so the first user OTP request after a deploy hits
        // an already-refreshed access token. Without this, the cold OAuth
        // refresh adds 1–3s to the first send and occasionally fails outright,
        // forcing the user to click "Resend" to get a working OTP.
        (async () => {
            try {
                const pool = (await import('./lib/db')).default;
                const { google } = await import('googleapis');
                const r = await pool.query(
                    `SELECT email_user, google_client_id, google_client_secret, google_refresh_token
                       FROM training_provider
                   ORDER BY id LIMIT 1`
                );
                if (r.rows.length === 0) {
                    console.warn('[Gmail] Warm-up skipped: no training_provider row');
                    return;
                }
                const { email_user, google_client_id, google_client_secret, google_refresh_token } = r.rows[0];
                if (!email_user || !google_client_id || !google_client_secret || !google_refresh_token) {
                    console.warn('[Gmail] Warm-up skipped: OAuth credentials not fully configured');
                    return;
                }
                const oauth2 = new google.auth.OAuth2(
                    google_client_id,
                    google_client_secret,
                    'https://developers.google.com/oauthplayground'
                );
                oauth2.setCredentials({ refresh_token: google_refresh_token });
                await oauth2.getAccessToken();
                console.log('[Gmail] OAuth warm-up complete — access token cached');
            } catch (err: any) {
                console.error('[Gmail] OAuth warm-up failed:', err?.message || err);
            }
        })();
    }
}
