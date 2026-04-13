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
    }> = [
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
            id: 'sync_google_calendar',
            name: 'Sync Google Calendar (Virtual Classes)',
            description: 'Checks Google Calendar for events in the next 21 days. Events with [VIRTUAL] in the title are matched to course runs — sets class_type to Virtual and stores the Google Meet link. Runs daily at 1:00 AM SGT.',
            cron_expression: '0 1 * * *', // 1:00 AM SGT daily
            api_endpoint: '/api/external/sync-google-calendar',
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
            id: 'auto_send_trainer_invitations',
            name: 'Auto Send Trainer Invitations',
            description: 'Scans all upcoming course runs within the lookahead window and, for any class that has no locally-assigned trainer, sends an invitation email to the next approved trainer who has not already been invited, declined, or assigned. Default schedule is Monday and Thursday at 10:00 AM SGT — adjust days and time from the Task Scheduler UI.',
            cron_expression: '0 10 * * 1,4', // 10:00 AM SGT every Mon & Thu
            api_endpoint: '/api/external/auto-send-trainer-invitations',
            days_in_advance: 30,
        },
        {
            id: 'sync_ssg_enrolments',
            name: 'Sync SSG Enrolments',
            description: 'Pulls recent enrolments from SSG (last 7 days) and stores new ones in the local ssg_enrolment_record table. Runs every 2 hours. Only inserts new records — existing enrolment references are skipped.',
            cron_expression: '0 */2 * * *', // Every 2 hours
            api_endpoint: '/api/external/sync-ssg-enrolments',
        },
        {
            id: 'auto_sanitise_data',
            name: 'Auto Sanitise Old PII',
            description: 'Weekly sweep that redacts NRIC and phone digits on rows older than the retention window configured in Company Settings → Security Setting → Auto Sanitise Data. Honours the master toggle (off → skipped). Default Sunday 02:00 SGT.',
            cron_expression: '0 2 * * 0', // 2:00 AM SGT every Sunday
            api_endpoint: '/api/external/auto-sanitise-data',
        },
    ];

    const ids = defaults.map(t => t.id);
    await pool.query(
        `DELETE FROM scheduler_config WHERE id NOT IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`,
        ids
    );

    for (const task of defaults) {
        await pool.query(
            `INSERT INTO scheduler_config (id, name, description, cron_expression, api_endpoint, email_template, days_in_advance)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description`,
            [task.id, task.name, task.description, task.cron_expression, task.api_endpoint, task.email_template || null, task.days_in_advance ?? null]
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
        directHandlers.set('auto_send_trainer_invitations', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-send-trainer-invitations');
            return runAutomation();
        });
        directHandlers.set('sync_ssg_enrolments', async () => {
            const { runAutomation } = await import('../../pages/api/external/sync-ssg-enrolments');
            return runAutomation();
        });
        directHandlers.set('auto_sanitise_data', async () => {
            const { runAutomation } = await import('../../pages/api/external/auto-sanitise-data');
            return runAutomation();
        });
    }
    return directHandlers.get(taskId);
}

// ── Execute a scheduled task ──────────────────────────────────────────────────

async function executeTask(task: SchedulerTask) {
    // In-flight lock — defense-in-depth against duplicate invocations from any
    // source (sibling module instance's cron, admin Run Now while cron is mid-run,
    // or any future code path). Lives on globalThis singleton so all module
    // instances share the same lock set. JavaScript's single-threaded event loop
    // makes the has-then-add sequence atomic.
    if (schedulerState.inFlight.has(task.id)) {
        console.log(`⏰ [Scheduler] "${task.name}" already running — skipping duplicate invocation [instance=${INSTANCE_ID}]`);
        return { success: false, error: 'already in-flight' };
    }
    schedulerState.inFlight.add(task.id);

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
        // Always release the lock, even on error/throw, so future invocations work.
        schedulerState.inFlight.delete(task.id);
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

        // Only mark initialised on the success path so a failed init can be retried.
        schedulerState.initialized = true;
        console.log(`⏰ [Scheduler] Initialised ${result.rows.length} task(s) [instance=${INSTANCE_ID}]`);
    } catch (err) {
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
