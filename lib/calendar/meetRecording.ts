import { google } from 'googleapis';
import pool from '../db';
import { getGoogleCredentials } from '../google-auth/googleAuth';
import { calendarWritesAllowed } from './calendarGuard';
import { meetCode } from './meetLinkRule';
import { classifyMeetApiError, isAutoRecordingOn, type AutoRecordingResult } from './meetRecordingRule';

/**
 * Turns auto-recording ON for a class's Google Meet room (rule in
 * ./meetRecordingRule). The room is the one on the class's calendar event, so it is
 * owned by the app's Google account, the only account allowed to change it.
 *
 * Uses the Meet REST API v2: `spaces.get` (by meeting code) then `spaces.patch` of
 * `config.artifactConfig.recordingConfig.autoRecordingGeneration`. Never throws:
 * a failure is returned as a status so a calendar sync keeps going.
 */

const MEET_API = 'https://meet.googleapis.com/v2';
const RECORDING_FIELD = 'config.artifactConfig.recordingConfig.autoRecordingGeneration';

async function accessToken(): Promise<string> {
  const c = await getGoogleCredentials(pool);
  const oauth = new google.auth.OAuth2(c.clientId, c.clientSecret);
  oauth.setCredentials({ refresh_token: c.refreshToken });
  const t = (await oauth.getAccessToken()).token;
  if (!t) throw new Error('Google returned no access token');
  return t;
}

async function meetFetch(token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const r = await fetch(`${MEET_API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}

export interface EnsureAutoRecordingOptions {
  /** Report the room's state without changing it. */
  dryRun?: boolean;
  /** Reuse one access token across many rooms (a sync checks every upcoming class). */
  token?: string;
}

export async function ensureMeetAutoRecording(meetLink: string, opts?: EnsureAutoRecordingOptions): Promise<AutoRecordingResult> {
  const code = meetCode(meetLink);
  if (!code) return { status: 'error', meetLink, message: 'Not a Google Meet link' };
  const link = `https://meet.google.com/${code}`;
  try {
    const token = opts?.token || await accessToken();
    const got = await meetFetch(token, `spaces/${code}`);
    if (!got.ok) return { meetLink: link, ...classifyMeetApiError(got.status, got.body) };
    if (isAutoRecordingOn(got.body)) return { status: 'on', meetLink: link };

    // Same guard as calendar writes: a dev machine holds the production Google token.
    if (opts?.dryRun || !calendarWritesAllowed()) return { status: 'would_turn_on', meetLink: link };

    const name = (got.body as { name?: string } | null)?.name; // "spaces/<id>": patch does not accept the meeting code
    if (!name) return { status: 'error', meetLink: link, message: 'Google Meet returned no space name' };
    const patched = await meetFetch(token, `${name}?updateMask=${encodeURIComponent(RECORDING_FIELD)}`, {
      method: 'PATCH',
      body: JSON.stringify({ config: { artifactConfig: { recordingConfig: { autoRecordingGeneration: 'ON' } } } }),
    });
    if (!patched.ok) return { meetLink: link, ...classifyMeetApiError(patched.status, patched.body) };
    if (!isAutoRecordingOn(patched.body)) {
      return { status: 'error', meetLink: link, message: 'Google Meet accepted the change but auto-recording is still off (the Workspace edition or admin policy may not allow recording).' };
    }
    return { status: 'turned_on', meetLink: link };
  } catch (e) {
    return { status: 'error', meetLink: link, message: e instanceof Error ? e.message : String(e) };
  }
}

/** One access token for a batch of rooms; null when Google credentials are not usable. */
export async function meetAccessToken(): Promise<string | null> {
  try { return await accessToken(); } catch (e) {
    console.warn('[meetRecording] no Google access token:', e instanceof Error ? e.message : e);
    return null;
  }
}
