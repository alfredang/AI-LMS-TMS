import type { NextApiRequest, NextApiResponse } from 'next';
import { listRunAttendees, patchRunAttendee } from '../../../lib/calendar/runAttendees';

/**
 * External API — Calendar attendees for a course run.
 *
 * GET  ?run_id=<uuid|ssg_run_id>
 *   Returns the run's Google Calendar event(s) and their attendee lists.
 *   Response: { success, status, writesEnabled, events: [...], people: [...] }
 *
 * POST { run_id, email, action: 'add' | 'remove' }
 *   Add or remove a single attendee on all of the run's Google Calendar events.
 *   Response: { success, status, changed, events }
 *
 * Headers: x-api-key: <EXTERNAL_API_KEY_FOR_CLAWDBOT>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  if (!validKey) return res.status(500).json({ success: false, error: 'API key not configured on server' });
  if (!apiKey || apiKey !== validKey) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

  if (req.method === 'GET') {
    const runId = String(req.query.run_id || '').trim();
    if (!runId) return res.status(400).json({ success: false, error: 'run_id is required' });
    try {
      const result = await listRunAttendees(runId);
      return res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to load attendees' });
    }
  }

  if (req.method === 'POST') {
    const { run_id, email, action } = (req.body || {}) as { run_id?: string; email?: string; action?: string };
    if (!run_id) return res.status(400).json({ success: false, error: 'run_id is required' });
    if (!email || !email.trim()) return res.status(400).json({ success: false, error: 'email is required' });
    if (action !== 'add' && action !== 'remove') return res.status(400).json({ success: false, error: "action must be 'add' or 'remove'" });
    try {
      const result = await patchRunAttendee(run_id.trim(), email.trim(), action);
      return res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to update attendee' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
