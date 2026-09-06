/**
 * In-app task scheduler using node-cron.
 *
 * Schedule configuration is stored in the `scheduler_config` database table
 * and can be adjusted by admins via the Scheduler admin page.
 *
 * Initialised once on server startup via Next.js instrumentation.ts.
 */

import cron, { ScheduledTask } from 'node-cron';
import pool from '../db';
import crypto from 'crypto';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deterministic 32-bit signed integer from a string, used as the key for
 * PostgreSQL advisory locks.  Two tasks with the same ID always produce the
 * same lock key, so even separate processes/containers contend on the same DB
 * lock row.
 */
function hashStringToInt(s: string): number {
    const hash = crypto.createHash('md5').update(s).digest();
    // Read first 4 bytes as signed 32-bit int (pg advisory lock uses int4/int8)
    return hash.readInt32BE(0);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchedulerTask {
    id: string;
    name: string;
    description: string;
    cron_expression: string;
    enabled: boolean;
    api_endpoint: string;
    email_template: string | null;
    days_in_advance: number | null;
    last_run_at: string | null;
    last_status: string | null;
    created_at: string;
    updated_at: string;
}

// ── Cross-module-instance singleton state ─────────────────────────────────────
// Turbopack bundles this module into multiple chunks (one per entry point that
// imports it — e.g. instrumentation.ts and pages/api/admin/scheduler.ts), each
// with its own JavaScript module instance and its own top-level state. We hoist
// shared state onto globalThis so all instances see the same Map and Set.
// Without this, scheduleTask()'s "stop existing job" logic can't see jobs
// registered by sibling module instances → cron jobs stack → tasks fire 2×.
// Root cause: .project/research/rca-scheduler-double-fire.md

type SchedulerGlobals = {
    activeJobs: Map<string, ScheduledTask>;
    inFlight: Set<string>;
    initialized: boolean;
};

const globalRef = globalThis as unknown as { __lmsScheduler?: SchedulerGlobals };

if (!globalRef.__lmsScheduler) {
    globalRef.__lmsScheduler = {
        activeJobs: new Map<string, ScheduledTask>(),
        inFlight: new Set<string>(),
        initialized: false,
    };
}

const schedulerState = globalRef.__lmsScheduler;

// Diagnostic: every module instance gets a unique ID logged at load time.
// After deploy, look for two different INSTANCE_ID values in container logs
// alongside identical activeJobs.size — that proves the singleton works.
// TODO: remove this diagnostic log in a follow-up commit once verified.
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);
console.log(`⏰ [Scheduler] module instance loaded — instance=${INSTANCE_ID} activeJobs.size=${schedulerState.activeJobs.size} initialized=${schedulerState.initialized}`);

// ── Ensure the scheduler_config table exists ──────────────────────────────────

async function ensureSchedulerTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS scheduler_config (
            id               TEXT PRIMARY KEY,
            name             TEXT NOT NULL,
            description      TEXT NOT NULL DEFAULT '',
            cron_expression  TEXT NOT NULL,
            enabled          BOOLEAN NOT NULL DEFAULT true,
            api_endpoint     TEXT NOT NULL,
            email_template   TEXT,
            days_in_advance  INTEGER DEFAULT 3,
            last_run_at      TIMESTAMPTZ,
            last_status      TEXT,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Add columns if they don't exist (for existing installations)
    await pool.query(`
        ALTER TABLE scheduler_config ADD COLUMN IF NOT EXISTS email_template TEXT
    `);
    await pool.query(`
        ALTER TABLE scheduler_config ADD COLUMN IF NOT EXISTS days_in_advance INTEGER DEFAULT 3
    `);
}

// ── Seed default tasks if they don't exist ────────────────────────────────────

async function seedDefaults() {
    const defaults: Array<{
        id: string;
        name: string;
        description: string;
        cron_expression: string;
        api_endpoint: string;
        email_template?: string;
        days_in_advance?: number;
        default_enabled?: boolean;
    }> = [
        {
            id: 'mobile_class_reminders',
            name: 'Mobile Class Reminders',
            description: 'APNs reminders for enrolled learners and assigned trainers, 3 days and 1 day before each active class session.',
            cron_expression: '*/5 * * * *',
            api_endpoint: '/api/mobile/send-reminders',
            default_enabled: process.env.MOBILE_APNS_ENABLED === 'true',
        },
        {
            id: 'auto_create_trainer_folders',
            name: 'Auto Create Assessment Records',
            description: 'Creates assessment folders in Google Drive for all course runs starting today. Trainer names are sourced from local DB (course_run_trainer / assigned_trainer_name / trainer_profile).',
            cron_expression: '0 14 * * *', // 2:00 PM daily
            api_endpoint: '/api/external/auto-create-assessment-records',
        },
        {
            id: 'auto_create_learners',
            name: 'Auto Create Learner Accounts',
            description: 'Automatically creates learner accounts and enrolment records for classes starting tomorrow.',
            cron_expression: '0 18 * * *', // 6:00 PM daily
            api_endpoint: '/api/external/auto-create-learners',
        },
        {
            id: 'sync_course_run_dates',
            name: 'Sync Course Run Dates',
            description: 'Syncs course run start/end dates from SSG to the local database for classes starting today.',
            cron_expression: '0 1 * * *', // 1:00 AM daily
            api_endpoint: '/api/external/sync-course-run-dates',
        },
        {
            id: 'auto_sync_attendance',
            name: 'Auto Sync SSG Attendance',
            description: 'Automatically pulls down SSG attendance records for classes ending recently, ensuring local DB is up to date before certificates are generated.',
            cron_expression: '0 18 * * *', // 6:00 PM daily
            api_endpoint: '/api/external/auto-sync-attendance',
        },
        {
            id: 'auto_create_certificates',
            name: 'Auto-Create Certificates and Send to Learner\'s Email',
            description: 'Automatically generates certificates and sends them via email to learners in courses ending today based on final session attendance.',
            cron_expression: '30 18 * * *',
            api_endpoint: '/api/external/auto-create-certificates',
        },
        {
            id: 'auto_send_course_confirmation',
            name: 'Auto Send Final Class Confirm Emails',
            description: 'Sends Final Class Confirm emails to all confirmed learners in course runs starting soon. Uses the email template configured in Company Settings.',
            cron_expression: '0 9 * * *', // 9:00 AM daily
            api_endpoint: '/api/external/auto-send-course-confirmation',
            email_template: 'final_course_confirmation',
            days_in_advance: 3,
        },
        {
            id: 'auto_send_class_confirmation',
            name: 'Auto Send Class Confirm Emails',
            description: 'Sends Class Confirm emails to all confirmed learners in course runs starting soon. Uses the email template configured in Company Settings.',
            cron_expression: '0 10 * * *', // 10:00 AM daily
            api_endpoint: '/api/external/auto-send-course-confirmation',
            email_template: 'course_confirmation',
            days_in_advance: 7,
        },
        {
            id: 'upcoming_course_runs',
            name: 'Fetch TGS Enrolments & Assign Trainers',
            description: 'For each upcoming TGS- course run within the configured threshold window, searches SSG for enrolments and assigns trainers accordingly. Runs daily at 2:00 AM SGT.',
            cron_expression: '0 2 * * *', // 2:00 AM SGT daily
            api_endpoint: '/api/external/upcoming-course-runs',
        },
        {
            id: 'sync_trainer_to_tpg',
            name: 'Sync Trainer (Local) to TPG/SSG',
            description: 'For each upcoming course run that has a locally assigned trainer but no TPG trainer, calls SSG Edit Course Run to push the trainer (with NRIC if available) to TPG. Runs daily at 3:00 AM SGT.',
            cron_expression: '0 3 * * *', // 3:00 AM SGT daily
            api_endpoint: '/api/external/sync-trainer-to-tpg',
        },
        {
            id: 'sync_course_run_sessions',
            name: 'Sync Course Run Sessions (gap-fill)',
            description: 'For each active/upcoming course run that has people (≥1 learner or a trainer) but NO local sessions, pulls its sessions from SSG into local course_session so it appears on the in-app calendar. Per-run viewing also syncs on demand; this catches runs nobody opened. Runs daily at 2:30 AM SGT.',
            cron_expression: '30 2 * * *', // 2:30 AM SGT daily
            api_endpoint: '/api/external/sync-course-run-sessions',
        },
        {
            id: 'auto_sync_wsq_schedule',
            name: 'Auto Sync WSQ Schedule to SSG (fresh)',
            description: 'Daily: pulls the WSQ course schedule from MMS (Tertiary Courses SG) and PUBLISHES FRESH missing course runs to SSG/TPGateway. Skips schedules that have failed before (eligibility failures are retried weekly; other errors need a developer), skips runs that already exist / have no local course or session-timing template, and skips past-dated schedules. Publishes REAL TPGateway runs with the default venue and no human review, so it ships DISABLED — enable here once the MMS feed is verified. Runs daily at 2:00 AM SGT.',
            cron_expression: '0 2 * * *', // 2:00 AM SGT daily
            api_endpoint: '/api/external/auto-sync-wsq-schedule',
            default_enabled: false,
        },
        {
            id: 'auto_retry_wsq_blocked',
            name: 'Retry Blocked WSQ Schedules (weekly)',
            description: 'Weekly (Sunday, off-peak): retries ONLY future WSQ schedules whose last SSG failure was an eligibility block (not eligible / outside course support period) — these are resolved by an external approval process, so a gentle once-a-week retry helps. Does NOT retry other error types (those are likely submission bugs needing developer investigation). Publishes REAL TPGateway runs, so it ships DISABLED — enable here once verified. Runs Sundays at 4:00 AM SGT.',
            cron_expression: '0 4 * * 0', // 4:00 AM SGT every Sunday (off-peak)
            api_endpoint: '/api/external/auto-retry-wsq-blocked',
            default_enabled: false,
        },
        {
            id: 'sync_run_trainers_from_tpg',
            name: 'Sync Course Run Trainers from TPG',
            description: 'For each active/upcoming course run that has people, does a live viewCourseRun and upserts the TPG-assigned trainer (handles direct add/remove on TPGateway, incl. removals). Per-run viewing already refreshes on demand; this is the grid-wide backstop for runs nobody opens. Runs daily at 2:00 AM SGT.',
            cron_expression: '0 2 * * *', // 2:00 AM SGT daily
            api_endpoint: '/api/external/sync-run-trainers-from-tpg',
        },
        {
            id: 'sync_enrolment_ids',
            name: 'Sync Learner Enrolment IDs from TPG',
            description: 'SSG → LMS backstop: for each current/upcoming run, reconciles local enrollment.enrolment_id against SSG (links the live TPGateway reference, clears stale ones). enrolment_id ONLY — never adds/removes learners or changes roster status. Per-action reconciliation already runs on enrol/move/cancel; this catches enrolments changed directly on TPGateway. Runs daily at 3:30 AM SGT.',
            cron_expression: '30 3 * * *', // 3:30 AM SGT daily
            api_endpoint: '/api/external/sync-enrolment-ids',
        },
        {
            id: 'sync_google_calendar',
            name: 'Sync Google Calendar (Virtual Classes)',
            description: 'Checks Google Calendar for events in the next 21 days. Events with [VIRTUAL] in the title are matched to course runs — sets class_type to Virtual and stores the Google Meet link. Runs daily at 1:00 AM SGT.',
            cron_expression: '0 1 * * *', // 1:00 AM SGT daily
            api_endpoint: '/api/external/sync-google-calendar',
        },
        {
            id: 'sync_trainers_to_calendar',
            name: 'Add Trainers to Google Calendar',
            description: 'Daily (LMS → Calendar): for every upcoming class in the window (today + days_in_advance, SGT) that has a trainer assigned IN THE LMS, adds that trainer as an attendee on the matching Google Calendar event (reuses addTrainerToCalendar). Only ADDS — it never reads trainers back from the calendar and never overwrites LMS data. This is the trainer counterpart to the learner calendar sync. Logged to lms_to_calendar_trainer_sync_log. DISABLED by default — enable from the Task Scheduler.',
            cron_expression: '0 2 * * *', // 2:00 AM SGT daily
            api_endpoint: '/api/external/sync-trainers-to-calendar',
            days_in_advance: 7,
            default_enabled: false,
        },
        {
            id: 'auto_send_courseware_attendance',
            name: 'Auto Send Courseware and Attendance Email',
            description: 'Sends courseware and attendance taking emails to learners in course runs starting today. Uses the email template configured in Company Settings.',
            cron_expression: '0 7 * * *', // 7:00 AM SGT daily
            api_endpoint: '/api/external/auto-send-courseware-attendance',
            email_template: 'courseware_attendance',
        },
        {
            id: 'auto_send_course_completion',
            name: 'Auto Send Course Completion Email',
            description: 'Sends course completion and thank you emails to confirmed learners in course runs ending today. Uses the Course Completion and Thank You template configured in Training Provider → Templates.',
            cron_expression: '35 17 * * *', // 5:35 PM SGT daily
            api_endpoint: '/api/external/auto-send-course-completion',
            email_template: 'course_completion',
        },
        {
            id: 'auto_send_class_evaluation',
            name: 'Auto Send Class Evaluation to Trainers',
            description: 'Compiles learner Course Feedback responses for confirmed course runs that have ended and emails the compiled class evaluation to the trainer(s), anonymised as Learner 1, Learner 2, etc. Each response is emailed once.',
            cron_expression: '30 18 * * *', // 6:30 PM SGT daily
            api_endpoint: '/api/external/auto-send-class-evaluation',
        },
        {
            id: 'auto_send_trainer_invitations',
            name: 'Auto Send Trainer Invitations',
            description: 'Weekly Monday sweep: first EXPIRES any invitation still pending after a week with no response (its links stop working), then, for every upcoming class with no locally-assigned trainer, invites the next approved trainer in the course\'s preference order. Together with the Thursday reminder task this forms the weekly cycle: invite Monday → remind Thursday → expire & move to the next trainer the following Monday. Default schedule is Monday at 10:00 AM SGT.',
            cron_expression: '0 10 * * 1', // 10:00 AM SGT every Monday
            api_endpoint: '/api/external/auto-send-trainer-invitations',
            days_in_advance: 30,
        },
        {
            id: 'auto_queue_class_reminder_whatsapp',
            name: 'Queue Class-Reminder WhatsApp (3 days ahead)',
            description: 'Daily at 12:30 PM SGT: for every CONFIRMED class starting days_in_advance days from today (default 3) with a trainer assigned in the LMS, composes the upcoming-class reminder from the LMS record (title, code, run ID, dates, duration, mode, venue/Meet link) and queues one WhatsApp message per trainer. Delivery is pulled by the OpenClaw WhatsApp agent via the rate-gated queue API (max 7/day, 15 min apart, 1:00–5:00 PM SGT only).',
            cron_expression: '30 12 * * *', // 12:30 PM SGT daily
            api_endpoint: '/api/external/auto-queue-class-reminders',
            days_in_advance: 3,
        },
        {
            id: 'auto_remind_trainer_invitations',
            name: 'Remind Pending Trainer Invitations',
            description: 'Thursday follow-up to the Monday invitation sweep: re-emails every trainer whose invitation is still PENDING (not accepted/declined) for an upcoming class, using the same accept/decline links as the original email. Sends nothing when there are no pending invitations. Default schedule is Thursday at 10:00 AM SGT.',
            cron_expression: '0 10 * * 4', // 10:00 AM SGT every Thursday
            api_endpoint: '/api/external/auto-remind-trainer-invitations',
        },
        {
            id: 'sync_ssg_enrolments',
            name: 'Sync SSG Enrolments',
            description: 'Pulls recent enrolments from SSG (last 7 days) and stores new ones in the local ssg_enrolment_record table. Runs every 3 hours. Only inserts new records — existing enrolment references are skipped.',
            cron_expression: '0 */3 * * *', // Every 3 hours
            api_endpoint: '/api/external/sync-ssg-enrolments',
        },
        {
            id: 'reconcile_enrolment_cancellations',
            name: 'Reconcile Enrolment Cancellations',
            description: 'For active local enrolments on recently-ended or near-future course runs, pulls the current status from TPGateway and writes cancellations/withdrawals back to the local enrolment record. Closes the gap where a learner cancels on TPG but the local status stays Confirmed (which previously let cancelled learners through assessment/certificate guards). Read-mostly: only propagates cancellations, never reactivates. Default 05:00 SGT daily.',
            cron_expression: '0 5 * * *', // 5:00 AM SGT daily
            api_endpoint: '/api/external/reconcile-enrolment-cancellations',
        },
        {
            id: 'auto_add_today_enrolments_to_calendar',
            name: 'Auto Add Today\'s Enrolments to Calendar',
            description: 'Pulls today\'s (SGT) enrolments from SSG, and for each Confirmed enrolment whose class has a matching Google Calendar event but whose learner email is not yet an attendee, adds the email to the event. Runs every 3 hours.',
            cron_expression: '0 */3 * * *', // Every 3 hours
            api_endpoint: '/api/external/auto-add-today-enrolments-to-calendar',
        },
        {
            id: 'auto_sanitise_data',
            name: 'Auto Sanitise Old PII',
            description: 'Weekly sweep that redacts NRIC and phone digits on rows older than the retention window configured in Company Settings → Security Setting → Auto Sanitise Data. Honours the master toggle (off → skipped). Default Sunday 02:00 SGT.',
            cron_expression: '0 2 * * 0', // 2:00 AM SGT every Sunday
            api_endpoint: '/api/external/auto-sanitise-data',
        },
        {
            id: 'auto_generate_proforma_invoices',
            name: 'Auto Generate Proforma Invoices',
            description: 'Nightly sweep that generates a proforma invoice PDF for every active enrollment still missing pro_forma_url. Saves to the Google Drive proforma folder and writes the URL back to the enrollment row so it appears in Finance → Proforma Invoice and the learner\'s Billing History. Idempotent - enrollments that already have a proforma are skipped. Default 04:00 SGT daily.',
            cron_expression: '0 4 * * *', // 4:00 AM SGT daily
            api_endpoint: '/api/external/auto-generate-proforma-invoices',
            default_enabled: false,
        },
        {
            id: 'sync_learners_to_mailerlite',
            name: 'Sync Learner Emails to MailerLite',
            description: 'Daily: submits NEW learner emails (active accounts, gov.sg addresses always excluded) to the MailerLite subscriber group configured under Company Settings → Integrations → MailerLite (env vars MAILERLITE_API_KEY / MAILERLITE_GROUP_ID as fallback). Already-synced emails are tracked in mailerlite_synced_email and skipped, so each run only pushes learners added since the last one. Tenants without MailerLite configured log a skipped run. Runs daily at 3:00 AM SGT.',
            cron_expression: '0 3 * * *', // 3:00 AM SGT daily
            api_endpoint: '/api/external/sync-learners-to-mailerlite',
        },
        {
            id: 'funding_renewal_reminder',
            name: 'Funding Renewal Reminder Email',
            description: 'Daily email listing funded courses whose funding validity has expired or expires within 1 month and are not yet marked as renewed on the Course Funding Validity page. Recipients come from the FUNDING_REMINDER_RECIPIENTS env var (comma-separated); tenants without it log a skipped run. No email is sent when nothing is pending. Runs daily at 8:00 AM SGT.',
            cron_expression: '0 8 * * *', // 8:00 AM SGT daily
            api_endpoint: '/api/external/funding-renewal-reminder',
        },
    ];

    const ids = defaults.map(t => t.id);
    await pool.query(
        `DELETE FROM scheduler_config WHERE id NOT IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`,
        ids
    );

    for (const task of defaults) {
        await pool.query(
            `INSERT INTO scheduler_config (id, name, description, cron_expression, api_endpoint, email_template, days_in_advance, enabled)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                cron_expression = EXCLUDED.cron_expression`,
            [task.id, task.name, task.description, task.cron_expression, task.api_endpoint, task.email_template || null, task.days_in_advance ?? null, task.default_enabled ?? true]
        );
    }
}

// ── Direct handler registry ───────────────────────────────────────────────────
// Tasks registered here are called directly without HTTP round-trips.
// All data comes from the local DB — no external API calls needed.

type TaskHandler = () => Promise<any>;
const directHandlers = new Map<string, TaskHandler>();

/**
 * Register a direct handler so the scheduler can call it without going through
 * the HTTP API layer. Lazy-loaded to avoid circular imports at startup.
 */
function getDirectHandler(taskId: string): TaskHandler | undefined {
    // Lazy-register handlers on first call
    if (directHandlers.size === 0) {
        directHandlers.set('auto_create_trainer_folders', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-create-assessment-records');
            return runAutomation();
        });
        directHandlers.set('auto_create_learners', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-create-learners');
            return runAutomation();
        });
        directHandlers.set('auto_sync_attendance', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-sync-attendance');
            return runAutomation();
        });
        directHandlers.set('auto_create_certificates', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-create-certificates');
            return runAutomation();
        });
        directHandlers.set('auto_send_course_confirmation', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-send-course-confirmation');
            return runAutomation('auto_send_course_confirmation');
        });
        directHandlers.set('auto_send_class_confirmation', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-send-course-confirmation');
            return runAutomation('auto_send_class_confirmation');
        });
        directHandlers.set('sync_course_run_dates', async () => {
            const { runDateSync } = await import('../../pages/api/external/sync-course-run-dates');
            return runDateSync();
        });
        directHandlers.set('auto_sync_wsq_schedule', async () => {
            const { runAutoSyncWsqSchedule } = await import('../../pages/api/external/auto-sync-wsq-schedule');
            return runAutoSyncWsqSchedule();
        });
        directHandlers.set('auto_retry_wsq_blocked', async () => {
            const { runAutoRetryWsqBlocked } = await import('../../pages/api/external/auto-retry-wsq-blocked');
            return runAutoRetryWsqBlocked();
        });
        directHandlers.set('upcoming_course_runs', async () => {
            const { runUpcomingCourseRuns } = await import('../../pages/api/external/upcoming-course-runs');
            return runUpcomingCourseRuns();
        });
        directHandlers.set('sync_trainer_to_tpg', async () => {
            const { runSyncTrainerToTpg } = await import('../../pages/api/external/sync-trainer-to-tpg');
            return runSyncTrainerToTpg();
        });
        directHandlers.set('sync_google_calendar', async () => {
            const { runSyncGoogleCalendar } = await import('../../pages/api/external/sync-google-calendar');
            return runSyncGoogleCalendar();
        });
        directHandlers.set('auto_send_courseware_attendance', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-send-courseware-attendance');
            return runAutomation();
        });
        directHandlers.set('auto_send_course_completion', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-send-course-completion');
            return runAutomation();
        });
        directHandlers.set('auto_send_class_evaluation', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-send-class-evaluation');
            return runAutomation();
        });
        directHandlers.set('auto_send_trainer_invitations', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-send-trainer-invitations');
            return runAutomation();
        });
        directHandlers.set('auto_remind_trainer_invitations', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-remind-trainer-invitations');
            return runAutomation();
        });
        directHandlers.set('auto_queue_class_reminder_whatsapp', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-queue-class-reminders');
            return runAutomation();
        });
        directHandlers.set('sync_ssg_enrolments', async () => {
            const { runAutomation } = await import('../../pages/api/external/sync-ssg-enrolments');
            return runAutomation();
        });
        directHandlers.set('reconcile_enrolment_cancellations', async () => {
            const { runAutomation } = await import('../../pages/api/external/reconcile-enrolment-cancellations');
            return runAutomation();
        });
        directHandlers.set('auto_add_today_enrolments_to_calendar', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-add-today-enrolments-to-calendar');
            return runAutomation();
        });
        directHandlers.set('auto_sanitise_data', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-sanitise-data');
            return runAutomation();
        });
        directHandlers.set('auto_generate_proforma_invoices', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-generate-proforma-invoices');
            return runAutomation();
        });
        directHandlers.set('sync_learners_to_mailerlite', async () => {
            const { runAutomation } = await import('../../pages/api/external/sync-learners-to-mailerlite');
            return runAutomation();
        });
        directHandlers.set('funding_renewal_reminder', async () => {
            const { runAutomation } = await import('../../pages/api/external/funding-renewal-reminder');
            return runAutomation();
        });
        directHandlers.set('sync_trainers_to_calendar', async () => {
            const { runAutomation } = await import('../../pages/api/external/sync-trainers-to-calendar');
            return runAutomation();
        });
    }
    return directHandlers.get(taskId);
}

// ── Execute a scheduled task ──────────────────────────────────────────────────

async function executeTask(task: SchedulerTask) {
    // ── Layer 1: In-process lock (globalThis) ─────────────────────────────
    // Catches duplicate invocations within the same Node.js process (e.g.
    // two Turbopack module instances, admin Run Now while cron is mid-run).
    if (schedulerState.inFlight.has(task.id)) {
        console.log(`⏰ [Scheduler] "${task.name}" already running (in-process) — skipping [instance=${INSTANCE_ID}]`);
        return { success: false, error: 'already in-flight' };
    }
    schedulerState.inFlight.add(task.id);

    // ── Layer 2: Cross-process lock (PostgreSQL advisory lock) ────────────
    // This is the REAL guard.  In-memory flags are invisible to other
    // containers / processes (e.g. during rolling deployments or if the
    // hosting platform runs >1 replica).  Advisory locks are held in the
    // shared database so only ONE process globally can execute a given task.
    const lockKey = hashStringToInt(task.id);
    let dbLockAcquired = false;
    try {
        const lockResult = await pool.query(
            'SELECT pg_try_advisory_lock($1) AS acquired',
            [lockKey]
        );
        dbLockAcquired = lockResult.rows[0]?.acquired === true;
        if (!dbLockAcquired) {
            console.log(`⏰ [Scheduler] "${task.name}" — DB advisory lock not acquired, another process is already running it — skipping`);
            return { success: false, error: 'another process holds the lock' };
        }
    } catch (lockErr) {
        // If the advisory lock query itself fails (e.g. DB hiccup), fall
        // through and rely on the in-process lock alone rather than
        // blocking the task entirely.
        console.warn(`⏰ [Scheduler] "${task.name}" — advisory lock query failed, proceeding with in-process lock only:`, lockErr);
    }

    const startTime = new Date();
    console.log(`⏰ [Scheduler] Running "${task.name}" at ${startTime.toISOString()} [instance=${INSTANCE_ID}]`);

    try {
        let data: any;

        // Try direct handler first (no HTTP round-trip, no API key needed)
        const directHandler = getDirectHandler(task.id);
        if (directHandler) {
            console.log(`⏰ [Scheduler] "${task.name}" — calling directly (no HTTP)`);
            data = await directHandler();
        } else {
            // Fallback: call via HTTP for tasks that still need it
            const apiKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
            if (!apiKey) {
                throw new Error('EXTERNAL_API_KEY_FOR_CLAWDBOT not configured');
            }

            const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
            const url = `${baseUrl}${task.api_endpoint}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                },
            });

            data = await response.json();

            if (!response.ok) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
        }

        const elapsed = Date.now() - startTime.getTime();
        console.log(`⏰ [Scheduler] "${task.name}" completed in ${elapsed}ms — status: success`);

        await pool.query(
            `UPDATE scheduler_config
             SET last_run_at = NOW(), last_status = $1, updated_at = NOW()
             WHERE id = $2`,
            ['success', task.id]
        );

        return { success: true, data };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`⏰ [Scheduler] "${task.name}" failed:`, errorMsg);

        await pool.query(
            `UPDATE scheduler_config
             SET last_run_at = NOW(), last_status = $1, updated_at = NOW()
             WHERE id = $2`,
            [`error: ${errorMsg.slice(0, 200)}`, task.id]
        ).catch(() => {});

        return { success: false, error: errorMsg };
    } finally {
        // Release the in-process lock
        schedulerState.inFlight.delete(task.id);

        // Release the DB advisory lock (if we acquired it)
        if (dbLockAcquired) {
            await pool.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => {});
        }
    }
}

// ── Schedule a single task ────────────────────────────────────────────────────

function scheduleTask(task: SchedulerTask) {
    // Stop existing job if any (cross-instance via globalThis singleton)
    const existing = schedulerState.activeJobs.get(task.id);
    if (existing) {
        existing.stop();
        schedulerState.activeJobs.delete(task.id);
    }

    // Also clean up node-cron's own internal global.scheduledTasks registry.
    // node-cron stores every job created via cron.schedule() in a separate
    // global Map keyed by a UUID. Calling .stop() clears the timer but does
    // NOT remove the entry, so orphaned jobs accumulate. We purge stopped
    // tasks to prevent any edge-case reactivation.
    try {
        const internalTasks = cron.getTasks();
        if (internalTasks && typeof internalTasks.forEach === 'function') {
            internalTasks.forEach((cronTask: any, key: string) => {
                // A stopped task has timeout === null in its internal scheduler
                if (cronTask?._scheduler?.timeout === null) {
                    internalTasks.delete(key);
                }
            });
        }
    } catch { /* non-critical cleanup */ }

    if (!task.enabled) {
        console.log(`⏰ [Scheduler] "${task.name}" is disabled — skipping`);
        return;
    }

    if (!cron.validate(task.cron_expression)) {
        console.error(`⏰ [Scheduler] Invalid cron expression for "${task.name}": ${task.cron_expression}`);
        return;
    }

    const job = cron.schedule(task.cron_expression, () => {
        executeTask(task).catch(console.error);
    }, {
        timezone: 'Asia/Singapore',
    });

    schedulerState.activeJobs.set(task.id, job);
    console.log(`⏰ [Scheduler] Scheduled "${task.name}" — cron: ${task.cron_expression} (SGT) [instance=${INSTANCE_ID}]`);
}

// ── Initialise all scheduled tasks ────────────────────────────────────────────

export async function initScheduler() {
    // Idempotency guard — safe to call from multiple module instances.
    // initialized is on the globalThis singleton so any instance can see it.
    if (schedulerState.initialized) {
        console.log(`⏰ [Scheduler] initScheduler called again — already initialised, skipping [instance=${INSTANCE_ID}]`);
        return;
    }

    // Set the flag EAGERLY — before any await — so that a concurrent call
    // from a sibling Turbopack module instance cannot slip through the
    // guard while we are awaiting DB queries.  If init fails we reset the
    // flag so a future call can retry.
    schedulerState.initialized = true;

    try {
        console.log(`⏰ [Scheduler] Initialising... [instance=${INSTANCE_ID}]`);
        await ensureSchedulerTable();
        await seedDefaults();

        const result = await pool.query<SchedulerTask>(
            `SELECT * FROM scheduler_config ORDER BY name ASC`
        );

        for (const task of result.rows) {
            scheduleTask(task);
        }

        console.log(`⏰ [Scheduler] Initialised ${result.rows.length} task(s) [instance=${INSTANCE_ID}]`);
    } catch (err) {
        // Reset flag so a subsequent call can retry initialisation.
        schedulerState.initialized = false;
        console.error('⏰ [Scheduler] Failed to initialise:', err);
    }
}

// ── Reload a single task (called after admin updates) ─────────────────────────

export async function reloadTask(taskId: string) {
    const result = await pool.query<SchedulerTask>(
        `SELECT * FROM scheduler_config WHERE id = $1`,
        [taskId]
    );

    if (result.rows.length === 0) {
        // Task was deleted — stop it (cross-instance via globalThis singleton)
        const existing = schedulerState.activeJobs.get(taskId);
        if (existing) {
            existing.stop();
            schedulerState.activeJobs.delete(taskId);
        }
        return;
    }

    scheduleTask(result.rows[0]);
}

// ── Get all task statuses ─────────────────────────────────────────────────────

export async function getSchedulerTasks(): Promise<SchedulerTask[]> {
    await ensureSchedulerTable();
    await seedDefaults();
    const result = await pool.query<SchedulerTask>(
        `SELECT * FROM scheduler_config ORDER BY name ASC`
    );
    return result.rows;
}

// ── Update a task's schedule ──────────────────────────────────────────────────

export async function updateTaskSchedule(
    taskId: string,
    updates: { cron_expression?: string; enabled?: boolean; email_template?: string | null; days_in_advance?: number | null }
): Promise<SchedulerTask | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let paramIdx = 1;

    if (updates.cron_expression !== undefined) {
        if (!cron.validate(updates.cron_expression)) {
            throw new Error(`Invalid cron expression: ${updates.cron_expression}`);
        }
        setClauses.push(`cron_expression = $${paramIdx++}`);
        values.push(updates.cron_expression);
    }

    if (updates.enabled !== undefined) {
        setClauses.push(`enabled = $${paramIdx++}`);
        values.push(updates.enabled);
    }

    if (updates.email_template !== undefined) {
        setClauses.push(`email_template = $${paramIdx++}`);
        values.push(updates.email_template);
    }

    if (updates.days_in_advance !== undefined) {
        setClauses.push(`days_in_advance = $${paramIdx++}`);
        values.push(updates.days_in_advance);
    }

    values.push(taskId);

    const result = await pool.query<SchedulerTask>(
        `UPDATE scheduler_config SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
        values
    );

    if (result.rows.length === 0) return null;

    // Reload the cron job with the new config
    await reloadTask(taskId);

    return result.rows[0];
}

// ── Run a task immediately ────────────────────────────────────────────────────

export async function runTaskNow(taskId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    const result = await pool.query<SchedulerTask>(
        `SELECT * FROM scheduler_config WHERE id = $1`,
        [taskId]
    );

    if (result.rows.length === 0) {
        return { success: false, error: 'Task not found' };
    }

    return executeTask(result.rows[0]);
}
