/**
 * In-memory progress store for "Fetch from TPGateway" (Bulk Grant Payment Sync) jobs.
 *
 * A job is a single run of the Playwright driver (lib/tpg/fetchGrantDisbursements.ts).
 * The driver mutates the job as it progresses; the status API route reads it so
 * the LMS UI can poll and render live progress (login -> navigate -> filter ->
 * scrape -> match/persist).
 *
 * Deliberately a SEPARATE store from lib/tpg/jobStore.ts (used by the Direct
 * Application "Confirm & fetch from TPGateway" feature), even though the shape
 * is similar — that feature is already live in production and this one is not
 * meant to share code/risk with it. See lib/tpg/fetchGrantDisbursements.ts for
 * why: local-dev only for v1, no screenshot/operator-input relay needed (the
 * operator sees the real browser window on their own machine).
 *
 * Held in a globalThis singleton — same pattern as jobStore.ts / the scheduler
 * (globalThis.__lmsScheduler) — so it survives Next.js dev hot-reloads and is
 * shared across API route module instances within the one server process.
 * LOCAL-ONLY dev tool (Singpass needs a headed browser + a human), so a
 * process-memory store is deliberate; nothing is persisted.
 */

import type { GrantImportBatchPreview } from '@/lib/services/grantImport/tpGatewayDisbursementTypes';

export type GrantFetchPhase =
  /**
   * Waiting for an office machine to pick this up (production only — see
   * scripts/tpg-grant-fetch-agent.mjs). TPGateway sits behind CloudFront, which
   * blocks datacentre IP ranges, so the server queues the run and an agent on
   * the office network drives it from an address the portal accepts.
   */
  | 'queued'
  | 'starting'
  | 'awaiting_login'
  | 'navigating'
  | 'filtering'
  | 'downloading'
  | 'processing'
  | 'done'
  | 'cancelled'
  | 'error';

/** One line of human-readable progress, oldest first. */
export interface GrantFetchLogEntry {
  at: number;
  text: string;
}

/**
 * A live picture of the browser, so the Singpass step is driveable from inside
 * the LMS page instead of a separate popup window. The driver runs headless
 * and posts frames here; the panel renders them and forwards clicks/keys back
 * — same mechanism as lib/tpg/jobStore.ts's TpgScreen, kept as its own type
 * since this is a deliberately separate job store.
 */
export interface GrantFetchScreen {
  /** JPEG data URL of the current page. */
  dataUrl: string;
  width: number;
  height: number;
  at: number;
}

/** An operator gesture waiting to be applied to the page. */
export type GrantFetchInput =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string };

export interface GrantFetchJob {
  id: string;
  startDate: string; // DD-MM-YYYY, Payment From, as entered
  /**
   * The Finance/Admin user who clicked Fetch & Upload. When a queued job is
   * relayed through the office agent, this is forwarded so the LOCAL run
   * re-authenticates as the same real person (requireFinanceOrAdmin needs an
   * actorUserId — the agent's service key alone satisfies withAuth's role
   * check but not that separate, per-user authorization/audit check).
   */
  actorUserId: string | null;
  phase: GrantFetchPhase;
  message: string;
  /** Total rows in the downloaded export, once parsed. */
  rowsFound: number;
  /** Set by the cancel route; the driver checks it between safe points and stops. */
  cancelRequested: boolean;
  log: GrantFetchLogEntry[];
  /** Latest browser frame, or null when the run needs no supervision. */
  screen: GrantFetchScreen | null;
  /** Gestures the operator has sent that the driver has not applied yet. */
  pendingInput: GrantFetchInput[];
  /** True while the driver wants a human looking at `screen` (the Singpass step). */
  needsOperator: boolean;
  /** Set once the scraped rows have gone through validate/match/persist. */
  result: GrantImportBatchPreview | null;
  error: string | null;
  /** Path to a debug screenshot written to scratch/ when a step fails. */
  screenshot: string | null;
  startedAt: number;
  updatedAt: number;
}

const g = globalThis as unknown as { __grantFetchJobs?: Map<string, GrantFetchJob> };
if (!g.__grantFetchJobs) g.__grantFetchJobs = new Map<string, GrantFetchJob>();
const jobs = g.__grantFetchJobs;

/** Cap retained jobs so a long-lived dev server doesn't leak memory. */
const MAX_RETAINED = 20;

export function createGrantFetchJob(id: string, startDate: string, actorUserId: string | null = null): GrantFetchJob {
  const now = Date.now();
  const job: GrantFetchJob = {
    id,
    startDate,
    actorUserId,
    phase: 'starting',
    message: 'Starting…',
    rowsFound: 0,
    cancelRequested: false,
    log: [],
    screen: null,
    pendingInput: [],
    needsOperator: false,
    result: null,
    error: null,
    screenshot: null,
    startedAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);

  if (jobs.size > MAX_RETAINED) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
    if (oldest) jobs.delete(oldest.id);
  }
  return job;
}

export function getGrantFetchJob(id: string): GrantFetchJob | undefined {
  const job = jobs.get(id);
  if (job) reapIfStale(job);
  return job;
}

/**
 * Finish a job whose driver has gone silent — same reasoning as jobStore.ts's
 * reapIfStale: without this, a crashed driver leaves cancel looking broken and
 * getActiveGrantFetchJob() refusing every later run forever.
 */
function reapIfStale(job: GrantFetchJob): void {
  if (!isStale(job)) return;
  job.phase = 'cancelled';
  job.message = job.cancelRequested
    ? 'Stopped.'
    : 'Lost contact with the machine running this.';
  job.needsOperator = false;
  job.screen = null;
  job.updatedAt = Date.now();
}

function isFinished(job: GrantFetchJob): boolean {
  return job.phase === 'done' || job.phase === 'error' || job.phase === 'cancelled';
}

/**
 * The job still driving a browser, if any. Two concurrent runs would fight over
 * the one persistent Chromium profile and Playwright would fail on the profile
 * lock mid-run, so a second start is refused rather than left to crash.
 */
export function getActiveGrantFetchJob(): GrantFetchJob | undefined {
  return [...jobs.values()].find((j) => !isFinished(j) && !isStale(j));
}

const STALE_AFTER_MS = 90_000;
const CANCEL_ACK_MS = 12_000;

function isStale(job: GrantFetchJob): boolean {
  if (isFinished(job)) return false;
  // Waiting on a person to finish Singpass, or on an agent to pick up a queued
  // job, is not staleness.
  if (!job.cancelRequested && (job.phase === 'queued' || job.phase === 'awaiting_login' || job.needsOperator)) {
    return false;
  }
  const limit = job.cancelRequested ? CANCEL_ACK_MS : STALE_AFTER_MS;
  return Date.now() - job.updatedAt > limit;
}

const MAX_LOG_LINES = 80;

/** Append a line to the job's activity feed. No-op if the job is gone. */
export function pushGrantFetchLog(id: string, text: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.log.push({ at: Date.now(), text });
  if (job.log.length > MAX_LOG_LINES) {
    job.log.splice(0, job.log.length - MAX_LOG_LINES);
  }
  job.updatedAt = Date.now();
}

/** Shallow-merge a patch into the job and bump updatedAt. No-op if the job is gone. */
export function patchGrantFetchJob(id: string, patch: Partial<GrantFetchJob>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
}

/**
 * Ask a running job to stop. Cancellation is cooperative: the driver only acts
 * on it between safe boundaries (between pages / before persisting), so nothing
 * is left half-scraped.
 */
export function requestGrantFetchCancel(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (isFinished(job)) return false;

  // A queued job has no driver listening yet — an agent may never claim it, so end
  // it here rather than leaving the operator stuck at "Stopping…" indefinitely.
  if (job.phase === 'queued' || isStale(job)) {
    const neverStarted = job.phase === 'queued';
    job.cancelRequested = true;
    job.phase = 'cancelled';
    job.message = neverStarted
      ? 'Cancelled before it started. Nothing was fetched.'
      : 'Stopped — the machine running it stopped reporting.';
    job.updatedAt = Date.now();
    return true;
  }

  job.cancelRequested = true;
  job.message = 'Stopping…';
  job.updatedAt = Date.now();
  return true;
}

export function isGrantFetchCancelled(id: string): boolean {
  return jobs.get(id)?.cancelRequested === true;
}

/** Queue an operator gesture for the driver to apply on its next poll. */
export function pushGrantFetchInput(id: string, input: GrantFetchInput): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  // Bound the queue: a click-happy operator (or a stuck UI) must not grow this without limit.
  if (job.pendingInput.length >= 50) return false;
  job.pendingInput.push(input);
  job.updatedAt = Date.now();
  return true;
}

/** Take everything queued, leaving the queue empty. */
export function drainGrantFetchInput(id: string): GrantFetchInput[] {
  const job = jobs.get(id);
  if (!job || job.pendingInput.length === 0) return [];
  const taken = job.pendingInput;
  job.pendingInput = [];
  return taken;
}

/**
 * Hand the oldest waiting job to an agent, or null if there is nothing to do.
 *
 * Claiming flips it out of 'queued' in the same call, so two agents polling at
 * once cannot both pick up the same run — Node is single-threaded, so this
 * check-and-set cannot be interleaved.
 */
export function claimQueuedGrantFetchJob(): GrantFetchJob | null {
  const queued = [...jobs.values()]
    .filter((j) => j.phase === 'queued')
    .sort((a, b) => a.startedAt - b.startedAt)[0];
  if (!queued) return null;
  queued.phase = 'starting';
  queued.message = 'Picked up — starting the browser…';
  queued.updatedAt = Date.now();
  return queued;
}

/**
 * When the office-agent (scripts/tpg-grant-fetch-agent.mjs) last asked for work.
 *
 * Whether anything can actually run is invisible from the live site otherwise —
 * a queued run just sits at "waiting" with no way to tell whether it will be
 * picked up in five seconds or never. The agent polls every few seconds, so
 * recent contact is a good proxy for "the agent is on".
 */
let lastAgentSeenAt = 0;

/** Generous next to the agent's 5s idle poll, so a slow tick is not "offline". */
const AGENT_ONLINE_WINDOW_MS = 25_000;

export function markGrantFetchAgentSeen(): void {
  lastAgentSeenAt = Date.now();
}

export function grantFetchAgentStatus(): { online: boolean; lastSeenAt: number | null } {
  return {
    online: lastAgentSeenAt > 0 && Date.now() - lastAgentSeenAt < AGENT_ONLINE_WINDOW_MS,
    lastSeenAt: lastAgentSeenAt || null,
  };
}
