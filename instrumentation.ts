/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used to initialise the in-app task scheduler (cron jobs).
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
    // Only run on the server side, not during build
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        // Always initialize the scheduler if it's the Node.js runtime
        try {
            const { initScheduler } = await import('./lib/scheduler/scheduler');
            await initScheduler();
        } catch (err) {
            console.error('[Scheduler] Failed to initialize:', err);
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

        // Warm up OpenClaw session to avoid ~15s cold start on first user message
        const { sendToOpenClaw } = await import('./lib/openclaw-client');
        sendToOpenClaw({ messages: [{ role: 'user', content: 'ping' }], userId: 'warmup', timeoutMs: 30000 }).catch(() => {});
        console.log('[Nemo] Warm-up ping sent to OpenClaw');
    }
}
