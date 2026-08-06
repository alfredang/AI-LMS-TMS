/**
 * In-memory progress store for TPGateway "confirm & fetch" jobs.
 *
 * A job is a single run of the Playwright driver (lib/tpg/confirmApplications.ts).
 * The driver mutates the job as it progresses; the status API route reads it so
 * the LMS UI can poll and render live progress (login -> confirm -> download).
 *
 * Held in a globalThis singleton — same pattern as the scheduler
 * (globalThis.__lmsScheduler) — so it survives Next.js dev hot-reloads and is
 * shared across API route module instances within the one server process. This
 * is a LOCAL-ONLY dev tool (Singpass needs a headed browser + a human), so a
 * process-memory store is deliberate; nothing is persisted.
 */

export type TpgPhase =
  /**
   * Waiting for an office machine to pick this up.
   *
   * TPGateway sits behind CloudFront, which blocks datacentre IP ranges — the
   * server can drive the browser perfectly well, but its requests never reach
   * the portal. So the live site queues the run and an agent on the office
   * network runs it from an address the portal accepts, reporting progress back
   * into this same job.
   */
  | 'queued'
  | 'starting'
  | 'awaiting_login'
  | 'collecting'
  | 'awaiting_approval'
  | 'confirming'
  | 'downloading'
  | 'parsing'
  | 'done'
  | 'cancelled'
  | 'error';

export type TpgAppStatus =
  | 'pending'
  | 'confirming'
  | 'confirmed'
  | 'would-confirm' // dry-run: reached the final step but stopped before clicking Confirm
  | 'skipped'
  | 'failed';

export interface TpgAppProgress {
  id: string; // CA-xxxx-xxxxxx
  name?: string;
  status: TpgAppStatus;
  reason?: string;
}

/** One line of human-readable progress, oldest first. */
export interface TpgLogEntry {
  at: number;
  text: string;
}

/**
 * A live picture of the browser, so a run on the server is still driveable.
 *
 * Singpass cannot be automated — someone has to scan a QR with their phone. On
 * an operator's own machine they just look at the browser window; on the server
 * there is no window to look at, so the driver posts frames here and the panel
 * renders them. A picture plus forwarded clicks is enough for this flow and
 * avoids putting a remote-desktop service on the box that hosts the database.
 */
export interface TpgScreen {
  /** PNG data URL of the current page. */
  dataUrl: string;
  /** Rendered size, so the UI can map a click back to page coordinates. */
  width: number;
  height: number;
  at: number;
}

/** An operator gesture waiting to be applied to the page. */
export type TpgInput =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string };

export interface TpgJob {
  id: string;
  dryRun: boolean;
  max: number | null;
  phase: TpgPhase;
  message: string;
  /** How many applications this run will actually process (targets after Limit). */
  total: number;
  /** How many were found awaiting confirmation, before Limit was applied. */
  found: number;
  /** Set by the cancel route; the driver checks it between steps and stops. */
  cancelRequested: boolean;
  /** True once the operator has approved an unlimited live run (see approveJob). */
  approved: boolean;
  apps: TpgAppProgress[];
  /**
   * Running commentary for the panel. The phase label and bar say roughly where
   * a run is; they cannot say what it is doing right now, so a slow step and a
   * hung one look identical. These lines are what tells them apart.
   */
  log: TpgLogEntry[];
  /** Latest browser frame, or null when the run needs no supervision. */
  screen: TpgScreen | null;
  /** Gestures the operator has sent that the driver has not applied yet. */
  pendingInput: TpgInput[];
  /** True while the driver wants a human looking at `screen`. */
  needsOperator: boolean;
  /** Parsed Excel rows (header-keyed objects), ready for the UI to ingest. Live mode only. */
  rows: Record<string, unknown>[] | null;
  error: string | null;
  /** Path to a debug screenshot written to scratch/ when a step fails. */
  screenshot: string | null;
  startedAt: number;
  updatedAt: number;
}

const g = globalThis as unknown as { __tpgJobs?: Map<string, TpgJob> };
if (!g.__tpgJobs) g.__tpgJobs = new Map<string, TpgJob>();
const jobs = g.__tpgJobs;

/** Cap retained jobs so a long-lived dev server doesn't leak memory. */
const MAX_RETAINED = 20;

export function createJob(id: string, dryRun: boolean, max: number | null): TpgJob {
  const now = Date.now();
  const job: TpgJob = {
    id,
    dryRun,
    max,
    phase: 'starting',
    message: 'Starting…',
    total: 0,
    found: 0,
    cancelRequested: false,
    approved: false,
    apps: [],
    log: [],
    screen: null,
    pendingInput: [],
    needsOperator: false,
    rows: null,
    error: null,
    screenshot: null,
    startedAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);

  // Evict oldest once over the cap.
  if (jobs.size > MAX_RETAINED) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
    if (oldest) jobs.delete(oldest.id);
  }
  return job;
}

export function getJob(id: string): TpgJob | undefined {
  const job = jobs.get(id);
  if (job) reapIfStale(job);
  return job;
}

/**
 * Finish a job whose driver has gone silent.
 *
 * Cancel raises a flag for the driver to act on at a safe point. If the driver
 * has died, nobody ever acts on it and the panel sits at "Stopping…"
 * indefinitely — pressing Cancel appeared to do nothing at all. There is no
 * background timer over this in-memory store, so the check runs whenever a job
 * is read, which is every poll from the panel.
 *
 * Only ever applied to a job nothing is driving (see isStale), so a run that is
 * simply waiting for someone to finish Singpass is never cut short.
 */
function reapIfStale(job: TpgJob): void {
  if (!isStale(job)) return;
  job.phase = 'cancelled';
  job.message = job.cancelRequested
    ? 'Stopped. Anything already confirmed on TPGateway was still enrolled.'
    : 'Lost contact with the machine running this. Anything already confirmed on TPGateway was still enrolled.';
  job.needsOperator = false;
  job.screen = null;
  job.updatedAt = Date.now();
}

/** True once a job can no longer change — nothing is driving a browser for it. */
function isFinished(job: TpgJob): boolean {
  return job.phase === 'done' || job.phase === 'error' || job.phase === 'cancelled';
}

/**
 * The job still driving a browser, if any. Two concurrent runs would fight over
 * the one persistent Chromium profile (scratch/.tpg-profile) and Playwright
 * would fail on the profile lock — mid-run, after applications had been
 * confirmed. So a second start is refused rather than left to crash.
 */
export function getActiveJob(): TpgJob | undefined {
  return [...jobs.values()].find((j) => !isFinished(j) && !isStale(j));
}

/**
 * How long a run may go unreported before we treat its driver as gone.
 *
 * Generous, because a healthy run can be quiet: it may be parked waiting for
 * someone to finish Singpass or approve a batch. Those states are excluded
 * below, so this only catches a driver that actually vanished — an agent whose
 * machine slept, a dev server restarted mid-run.
 */
const STALE_AFTER_MS = 90_000;

/**
 * How long a driver has to acknowledge a cancel before we stop waiting.
 *
 * Comfortably longer than the agent's one-second poll, short enough that the
 * button does not feel broken.
 */
const CANCEL_ACK_MS = 12_000;

/**
 * A job nobody is driving any more.
 *
 * Without this, an agent that dies mid-run leaves its job active forever:
 * cancel is cooperative and has nobody to hear it, and getActiveJob() then
 * refuses every later run. One crashed agent would jam the feature until the
 * container restarted.
 */
function isStale(job: TpgJob): boolean {
  if (isFinished(job)) return false;
  // Waiting on a person is not staleness — they may be finding their phone.
  // A cancel is different: it is a live driver's job to acknowledge that
  // promptly whatever it was doing, so silence after one means it is gone.
  if (!job.cancelRequested) {
    if (job.phase === 'queued' || job.phase === 'awaiting_login' || job.phase === 'awaiting_approval') {
      return false;
    }
    if (job.needsOperator) return false;
  }
  // A driver that has been asked to stop gets seconds, not a minute and a half
  // — otherwise Cancel looks broken to the person who pressed it.
  const limit = job.cancelRequested ? CANCEL_ACK_MS : STALE_AFTER_MS;
  return Date.now() - job.updatedAt > limit;
}

/** Keep only the tail — the panel shows a handful of lines and this is memory. */
const MAX_LOG_LINES = 80;

/** Append a line to the job's activity feed. No-op if the job is gone. */
export function pushLog(id: string, text: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.log.push({ at: Date.now(), text });
  if (job.log.length > MAX_LOG_LINES) {
    job.log.splice(0, job.log.length - MAX_LOG_LINES);
  }
  job.updatedAt = Date.now();
}

/**
 * Hand the oldest waiting job to an agent, or null if there is nothing to do.
 *
 * Claiming flips it out of 'queued' in the same call, so two agents polling at
 * once cannot both pick up the same run — Node is single-threaded, so this
 * check-and-set cannot be interleaved.
 */
export function claimQueuedJob(): TpgJob | null {
  const queued = [...jobs.values()]
    .filter((j) => j.phase === 'queued')
    .sort((a, b) => a.startedAt - b.startedAt)[0];
  if (!queued) return null;
  queued.phase = 'starting';
  queued.message = 'Picked up — starting the browser…';
  queued.updatedAt = Date.now();
  return queued;
}

/** Queue an operator gesture for the driver to apply on its next poll. */
export function pushInput(id: string, input: TpgInput): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  // Bound the queue: a click-happy operator (or a stuck UI) must not grow this
  // without limit while the driver is busy between polls.
  if (job.pendingInput.length >= 50) return false;
  job.pendingInput.push(input);
  job.updatedAt = Date.now();
  return true;
}

/** Take everything queued, leaving the queue empty. */
export function drainInput(id: string): TpgInput[] {
  const job = jobs.get(id);
  if (!job || job.pendingInput.length === 0) return [];
  const taken = job.pendingInput;
  job.pendingInput = [];
  return taken;
}

/** Shallow-merge a patch into the job and bump updatedAt. No-op if the job is gone. */
export function patchJob(id: string, patch: Partial<TpgJob>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
}

/**
 * Ask a running job to stop. The driver polls isCancelled() between steps, so
 * the stop happens at the next safe boundary — never mid-confirmation, which
 * would leave an application half-actioned on TPGateway.
 * Returns false if the job is unknown or already finished.
 */
export function requestCancel(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (isFinished(job)) return false;

  // Cancel is normally cooperative: the driver notices the flag at a safe
  // point, so a confirmation in flight is never abandoned half-done on
  // TPGateway. That only works if a driver is still listening. A queued run has
  // not been picked up, and a stale one has lost whoever was driving it — in
  // both cases nobody will ever read the flag, so end the job here instead of
  // leaving the operator stuck at "Stopping…".
  if (job.phase === 'queued' || isStale(job)) {
    const neverStarted = job.phase === 'queued';
    job.cancelRequested = true;
    job.phase = 'cancelled';
    job.message = neverStarted
      ? 'Cancelled before it started. Nothing was confirmed.'
      : 'Stopped — the machine running it stopped reporting. Anything already confirmed on TPGateway was still enrolled.';
    job.updatedAt = Date.now();
    return true;
  }

  job.cancelRequested = true;
  job.message = 'Stopping…';
  job.updatedAt = Date.now();
  return true;
}

export function isCancelled(id: string): boolean {
  return jobs.get(id)?.cancelRequested === true;
}

/**
 * Release a run that is parked at 'awaiting_approval'.
 *
 * An unlimited live run would otherwise confirm everything it found without the
 * operator ever seeing the number, and confirmation on TPGateway is
 * irreversible. So the driver parks, shows what it found, and waits for this.
 * Returns false unless the job is genuinely parked, so approval can't be given
 * ahead of time or twice.
 */
export function approveJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.phase !== 'awaiting_approval' || job.cancelRequested) return false;
  job.approved = true;
  job.message = 'Approved — confirming…';
  job.updatedAt = Date.now();
  return true;
}

export function isApproved(id: string): boolean {
  return jobs.get(id)?.approved === true;
}

/** Upsert one application's progress row by CA id. */
export function upsertApp(id: string, app: TpgAppProgress): void {
  const job = jobs.get(id);
  if (!job) return;
  const idx = job.apps.findIndex((a) => a.id === app.id);
  if (idx >= 0) job.apps[idx] = { ...job.apps[idx], ...app };
  else job.apps.push(app);
  job.updatedAt = Date.now();
}
