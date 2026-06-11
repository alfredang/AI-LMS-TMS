/**
 * Whether THIS process may WRITE to Google Calendar.
 *
 * Local/dev runs against a copy of the prod DB, so `training_provider.google_calendar_url`
 * and the stored OAuth credentials point at the **production** calendar. Without a guard,
 * sanity testing (or any manual trigger / API call) on a dev machine would mutate real
 * production events — invisibly to other devs.
 *
 * So calendar writes are OFF unless explicitly enabled, mirroring the cron scheduler guard
 * (`ENABLE_APP_SCHEDULER`) in instrumentation.ts:
 *   - ENABLE_CALENDAR_WRITES=true   -> allowed (explicit opt-in; e.g. a dev pointing at a TEST calendar)
 *   - ENABLE_CALENDAR_WRITES=false  -> blocked (hard off, even in prod)
 *   - else NODE_ENV=production       -> allowed
 *   - else (local dev)               -> BLOCKED
 *
 * Production deploy: set ENABLE_CALENDAR_WRITES=true (or rely on NODE_ENV=production).
 */
export function calendarWritesAllowed(): boolean {
  if (process.env.ENABLE_CALENDAR_WRITES === 'true') return true;
  if (process.env.ENABLE_CALENDAR_WRITES === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/** One-line reason for logs when writes are skipped. */
export const CALENDAR_WRITES_BLOCKED_MSG =
  'Calendar writes disabled for this environment (set ENABLE_CALENDAR_WRITES=true to allow)';
