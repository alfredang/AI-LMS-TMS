/**
 * myEventsCache — client-side cache for "My Calendar" (/api/calendar/my-events).
 *
 * MyCalendarView is rendered from a switch in TrainerLayout/LearnerLayout, so it
 * UNMOUNTS whenever the user visits another page and remounts with empty state —
 * every return to My Calendar re-fetched the whole visible range and showed an
 * empty grid while it waited. This module keeps the fetched events in a
 * module-level Map that survives unmounts (and view/month changes), so a range
 * already seen this session paints instantly and only revalidates in the
 * background.
 *
 * Cached per (user, role, range) — never shared between accounts. sessionStorage
 * is used as a second tier so a full page reload still paints instantly; it is
 * per-tab and cleared on logout via clearMyEventsCache().
 */

export interface MyClassEvent {
  courseRunUuid: string;
  courseRunId: string;
  courseCode: string;
  courseTitle: string;
  classStatus: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  dayNumber: number;
  totalDays: number;
  sessionCount: number;
}

interface CacheEntry {
  events: MyClassEvent[];
  fetchedAt: number;
}

/** Entries older than this are refetched in the background (still shown instantly). */
export const STALE_AFTER_MS = 5 * 60 * 1000;
/** Entries older than this are treated as absent (too old to show at all). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const SESSION_PREFIX = 'lms.myCalendar.v1:';

const memory = new Map<string, CacheEntry>();
/** In-flight requests, so two mounts racing the same range share one fetch. */
const inflight = new Map<string, Promise<MyClassEvent[]>>();

export const cacheKey = (userId: string, role: string, start: string, end: string): string =>
  `${userId}|${role}|${start}|${end}`;

const sessionKey = (key: string) => `${SESSION_PREFIX}${key}`;

function readSession(key: string): CacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(sessionKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.events) || typeof parsed.fetchedAt !== 'number') return null;
    return parsed as CacheEntry;
  } catch {
    return null;
  }
}

function writeSession(key: string, entry: CacheEntry): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(sessionKey(key), JSON.stringify(entry));
  } catch {
    // Quota or disabled storage — the in-memory tier still works.
  }
}

/** Cached events for a range, or null when absent/too old. */
export function getCached(key: string): CacheEntry | null {
  let entry = memory.get(key) || null;
  if (!entry) {
    entry = readSession(key);
    if (entry) memory.set(key, entry);
  }
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > MAX_AGE_MS) {
    memory.delete(key);
    if (typeof window !== 'undefined') {
      try { window.sessionStorage.removeItem(sessionKey(key)); } catch { /* ignore */ }
    }
    return null;
  }
  return entry;
}

export const isStale = (entry: CacheEntry): boolean => Date.now() - entry.fetchedAt > STALE_AFTER_MS;

export function setCached(key: string, events: MyClassEvent[]): CacheEntry {
  const entry: CacheEntry = { events, fetchedAt: Date.now() };
  memory.set(key, entry);
  writeSession(key, entry);
  return entry;
}

/**
 * Fetch a range, de-duplicating concurrent callers for the same key. The result
 * is cached; a failed request is NOT cached (so the next mount retries).
 */
export function fetchRange(key: string, url: string): Promise<MyClassEvent[]> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const request = (async () => {
    const res = await fetch(url);
    const data = await res.json();
    if (!data?.success) throw new Error(data?.error || 'Failed to load calendar');
    const events: MyClassEvent[] = data.data?.events || [];
    setCached(key, events);
    return events;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, request);
  return request;
}

/** Drop everything — call on logout / user switch so no data crosses accounts. */
export function clearMyEventsCache(): void {
  memory.clear();
  inflight.clear();
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(SESSION_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // ignore storage errors
  }
}
