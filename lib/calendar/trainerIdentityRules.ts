import type { calendar_v3 } from 'googleapis';

export interface TrainerIdentity {
  user_id: string;
  name: string | null;
  email: string;
  emails: string[];
  phone: string | null;
  active: boolean;
}

export interface TrainerResolutionResult {
  source: 'gcal_accepted' | 'no_accepted_trainer' | 'ambiguous' | 'calendar_unavailable';
  trainer: TrainerIdentity | null;
  pending: TrainerIdentity[];
  candidates: TrainerIdentity[];
  adminWarning?: string;
}

export const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();
const normalizeName = (value: unknown): string => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Email is authoritative when supplied. Names are usable only without an email and when unique. */
export function matchGuestIdentity(
  guest: { email?: string | null; displayName?: string | null },
  directory: TrainerIdentity[],
): TrainerIdentity[] {
  const email = normalizeEmail(guest.email);
  const name = normalizeName(guest.displayName);
  return directory.filter(t => email
    ? t.emails.some(e => normalizeEmail(e) === email)
    : !!name && normalizeName(t.name) === name);
}

/** Never substitute an LMS assignment or TPG fallback for a guest's acceptance. */
export function resolveEventTrainers(event: calendar_v3.Schema$Event, directory: TrainerIdentity[]): TrainerResolutionResult {
  if (event.status === 'cancelled' || event.attendeesOmitted) {
    return { source: 'calendar_unavailable', trainer: null, pending: [], candidates: [], adminWarning: 'Calendar event is cancelled or its guest list is incomplete.' };
  }
  const accepted = new Map<string, TrainerIdentity>();
  const pending = new Map<string, TrainerIdentity>();
  let identityConflict = false;
  for (const guest of event.attendees || []) {
    if (guest.resource || guest.organizer || guest.self ||
        (guest.email && normalizeEmail(guest.email) === normalizeEmail(event.organizer?.email))) continue;
    if (!['accepted', 'needsAction', 'tentative'].includes(guest.responseStatus || '')) continue;
    const matches = matchGuestIdentity(guest, directory);
    if (matches.length > 1 || (matches.length === 1 && !matches[0].active)) {
      identityConflict = true;
      continue;
    }
    if (matches.length !== 1) continue; // An accepted learner is not a trainer.
    const trainer = matches[0];
    (guest.responseStatus === 'accepted' ? accepted : pending).set(trainer.user_id, trainer);
  }
  for (const id of accepted.keys()) pending.delete(id);
  if (identityConflict || accepted.size > 1) {
    return { source: 'ambiguous', trainer: null, pending: [...pending.values()], candidates: [...accepted.values()], adminWarning: 'Multiple accepted trainers, duplicate identity or inactive trainer requires review.' };
  }
  return {
    source: accepted.size === 1 ? 'gcal_accepted' : 'no_accepted_trainer',
    trainer: [...accepted.values()][0] || null,
    pending: [...pending.values()],
    candidates: [...accepted.values()],
  };
}
