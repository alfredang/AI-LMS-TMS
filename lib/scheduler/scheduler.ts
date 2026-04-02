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
    last_run_at: string | null;
    last_status: string | null;
    created_at: string;
    updated_at: string;
}

// ── In-memory map of active cron jobs ─────────────────────────────────────────

const activeJobs = new Map<string, ScheduledTask>();

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
            last_run_at      TIMESTAMPTZ,
            last_status      TEXT,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW()
        )
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
            name: 'Auto-Create Certificates',
            description: 'Automatically generates certificates at 6:30 PM for learners in courses ending today based on final session attendance.',
            cron_expression: '30 18 * * *',
            api_endpoint: '/api/external/auto-create-certificates',
        },
    ];

    const ids = defaults.map(t => t.id);
    await pool.query(
        `DELETE FROM scheduler_config WHERE id NOT IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`,
        ids
    );

    for (const task of defaults) {
        await pool.query(
            `INSERT INTO scheduler_config (id, name, description, cron_expression, api_endpoint)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET 
                name = EXCLUDED.name,
                description = EXCLUDED.description`,
            [task.id, task.name, task.description, task.cron_expression, task.api_endpoint]
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
    }
    return directHandlers.get(taskId);
}

// ── Execute a scheduled task ──────────────────────────────────────────────────

async function executeTask(task: SchedulerTask) {
    const startTime = new Date();
    console.log(`⏰ [Scheduler] Running "${task.name}" at ${startTime.toISOString()}`);

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
    }
}

// ── Schedule a single task ────────────────────────────────────────────────────

function scheduleTask(task: SchedulerTask) {
    // Stop existing job if any
    const existing = activeJobs.get(task.id);
    if (existing) {
        existing.stop();
        activeJobs.delete(task.id);
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

    activeJobs.set(task.id, job);
    console.log(`⏰ [Scheduler] Scheduled "${task.name}" — cron: ${task.cron_expression} (SGT)`);
}

// ── Initialise all scheduled tasks ────────────────────────────────────────────

export async function initScheduler() {
    try {
        console.log('⏰ [Scheduler] Initialising...');
        await ensureSchedulerTable();
        await seedDefaults();

        const result = await pool.query<SchedulerTask>(
            `SELECT * FROM scheduler_config ORDER BY name ASC`
        );

        for (const task of result.rows) {
            scheduleTask(task);
        }

        console.log(`⏰ [Scheduler] Initialised ${result.rows.length} task(s)`);
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
        // Task was deleted — stop it
        const existing = activeJobs.get(taskId);
        if (existing) {
            existing.stop();
            activeJobs.delete(taskId);
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
    updates: { cron_expression?: string; enabled?: boolean }
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
