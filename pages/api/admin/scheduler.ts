import type { NextApiRequest, NextApiResponse } from 'next';
import {
    getSchedulerTasks,
    updateTaskSchedule,
    runTaskNow,
} from '../../../lib/scheduler/scheduler';

/**
 * Admin API — Scheduler Management
 *
 * GET  /api/admin/scheduler          — List all scheduled tasks
 * PUT  /api/admin/scheduler          — Update a task's schedule
 * POST /api/admin/scheduler          — Run a task immediately
 *
 * PUT body:   { taskId, cron_expression?, enabled? }
 * POST body:  { taskId }
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // GET — List all tasks
    if (req.method === 'GET') {
        try {
            const tasks = await getSchedulerTasks();
            return res.status(200).json({ success: true, tasks });
        } catch (err) {
            console.error('❌ Scheduler GET error:', err);
            return res.status(500).json({
                success: false,
                error: err instanceof Error ? err.message : 'Failed to fetch scheduler tasks',
            });
        }
    }

    // PUT — Update schedule
    if (req.method === 'PUT') {
        const { taskId, cron_expression, enabled, email_template, days_in_advance } = req.body ?? {};

        if (!taskId) {
            return res.status(400).json({ success: false, error: 'taskId is required' });
        }

        try {
            const updated = await updateTaskSchedule(taskId, {
                cron_expression,
                enabled,
                email_template,
                days_in_advance,
            });

            if (!updated) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }

            return res.status(200).json({ success: true, task: updated });
        } catch (err) {
            console.error('❌ Scheduler PUT error:', err);
            return res.status(400).json({
                success: false,
                error: err instanceof Error ? err.message : 'Failed to update task',
            });
        }
    }

    // POST — Run now
    if (req.method === 'POST') {
        const { taskId } = req.body ?? {};

        if (!taskId) {
            return res.status(400).json({ success: false, error: 'taskId is required' });
        }

        try {
            const result = await runTaskNow(taskId);
            return res.status(200).json(result);
        } catch (err) {
            console.error('❌ Scheduler POST error:', err);
            return res.status(500).json({
                success: false,
                error: err instanceof Error ? err.message : 'Failed to run task',
            });
        }
    }

    res.setHeader('Allow', ['GET', 'PUT', 'POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
}
