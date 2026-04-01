/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used to initialise the in-app task scheduler (cron jobs).
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
    // Only run on the server side, not during build
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { initScheduler } = await import('./lib/scheduler/scheduler');
        await initScheduler();
    }
}
