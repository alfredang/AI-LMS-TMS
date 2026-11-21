/**
 * Rule (2026-11-21): every Virtual or Hybrid class session held on Google Meet is
 * recorded automatically. The Meet room on the class's calendar event must have
 * auto-recording ON, so the recording starts without anyone pressing Record.
 *
 * Pure module (no DB, no Google import) so the decisions can be unit-tested; the
 * Meet API calls live in ./meetRecording (`ensureMeetAutoRecording`).
 */
import { meetCode } from './meetLinkRule';

/** Scope the stored Google token needs to read and change a Meet room's settings. */
export const MEET_SETTINGS_SCOPE = 'https://www.googleapis.com/auth/meetings.space.settings';

export type AutoRecordingStatus =
  /** Auto-recording was already ON. */
  | 'on'
  /** Auto-recording was OFF and has been turned ON. */
  | 'turned_on'
  /** Auto-recording is OFF; a dry run or a non-production process did not change it. */
  | 'would_turn_on'
  /** The Google token lacks the Meet scope: renew the Google sign-in in Company Settings. */
  | 'scope_missing'
  /** The Google Meet REST API is not enabled on the Google Cloud project. */
  | 'api_disabled'
  /** The app's Google account does not own the room (the Meet was made by someone else). */
  | 'not_owner'
  /** Meet does not know the room (expired or mistyped code). */
  | 'not_found'
  | 'error';

export interface AutoRecordingResult {
  status: AutoRecordingStatus;
  meetLink: string;
  message?: string;
}

/** True when the outcome leaves the room recording automatically. */
export const autoRecordingOk = (s: AutoRecordingStatus): boolean => s === 'on' || s === 'turned_on';

/**
 * The Meet rooms of a run that must record automatically: only a Virtual or Hybrid
 * class, only Google Meet links (Zoom and Teams are outside this rule), one entry
 * per room.
 */
export function roomsNeedingAutoRecording(classType: string | null | undefined, links: Array<string | null | undefined>): string[] {
  if (!/^(virtual|hybrid)$/i.test((classType || '').trim())) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of links) {
    const code = meetCode(l);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(`https://meet.google.com/${code}`);
  }
  return out;
}

/** Reads `config.artifactConfig.recordingConfig.autoRecordingGeneration` off a Meet space. */
export function isAutoRecordingOn(space: unknown): boolean {
  const v = (space as { config?: { artifactConfig?: { recordingConfig?: { autoRecordingGeneration?: string } } } } | null)
    ?.config?.artifactConfig?.recordingConfig?.autoRecordingGeneration;
  return v === 'ON';
}

/** Maps a failed Meet API response to the reason staff can act on. */
export function classifyMeetApiError(httpStatus: number, body: unknown): { status: AutoRecordingStatus; message: string } {
  const err = (body as { error?: { message?: string; details?: Array<{ reason?: string }> } } | null)?.error;
  const reasons = (err?.details || []).map(d => d?.reason || '');
  const text = err?.message || `Google Meet API returned HTTP ${httpStatus}`;
  if (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || /insufficient authentication scopes/i.test(text)) {
    return {
      status: 'scope_missing',
      message: 'The Google sign-in has no Google Meet permission. Renew it in Company Settings → Integration → Google (Renew via Google Sign-In) and accept the Google Meet permission.',
    };
  }
  if (reasons.includes('SERVICE_DISABLED') || /has not been used in project|is disabled/i.test(text)) {
    return {
      status: 'api_disabled',
      message: 'The Google Meet REST API is not enabled on the Google Cloud project of the Google Client ID. Enable it in Google Cloud Console → APIs & Services.',
    };
  }
  if (httpStatus === 404) return { status: 'not_found', message: 'Google Meet does not know this room.' };
  if (httpStatus === 403) {
    return {
      status: 'not_owner',
      message: `Only the room's owner can turn on auto-recording, and the app's Google account does not own this room (${text}).`,
    };
  }
  return { status: 'error', message: text };
}
