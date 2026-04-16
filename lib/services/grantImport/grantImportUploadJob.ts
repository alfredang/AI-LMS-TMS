import fs from 'fs';
import crypto from 'crypto';
import type { GrantImportBatchPreview } from './tpGatewayDisbursementTypes';
import { stage1UploadParseValidateMatchAndPersist } from './grantImportStage1';
import os from 'os';
import path from 'path';

export type GrantImportUploadJobStatus = 'queued' | 'running' | 'done' | 'failed';

export type GrantImportUploadJobSnapshot = {
  id: string;
  status: GrantImportUploadJobStatus;
  pct: number; // 0-100
  message: string;
  createdAt: string;
  updatedAt: string;
  result?: GrantImportBatchPreview;
  error?: string;
};

type Job = GrantImportUploadJobSnapshot & {
  tempFilePath: string;
  filename: string | null;
  actorUserId: string | null;
  cleanupTimer?: NodeJS.Timeout;
  lastPersistedAtMs?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __grantImportUploadJobs: Map<string, Job> | undefined;
  // eslint-disable-next-line no-var
  var __grantImportUploadJobsInit: boolean | undefined;
}

// Keep jobs stable across Next.js dev hot-reloads by storing in globalThis.
const JOBS: Map<string, Job> = globalThis.__grantImportUploadJobs ?? new Map<string, Job>();
globalThis.__grantImportUploadJobs = JOBS;
const JOB_TTL_MS = 30 * 60 * 1000;
const JOB_PERSIST_DIR = path.join(os.tmpdir(), 'ai-lms-tms-grant-import-jobs');
const PERSIST_THROTTLE_MS = 250;

function jobFilePath(jobId: string) {
  return path.join(JOB_PERSIST_DIR, `${jobId}.json`);
}

async function ensurePersistDir(): Promise<void> {
  await fs.promises.mkdir(JOB_PERSIST_DIR, { recursive: true });
}

function safeParseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function clampPct(p: number) {
  return Math.max(0, Math.min(100, Math.round(p)));
}

async function persistJob(job: Job, force = false): Promise<void> {
  const now = Date.now();
  if (!force && job.lastPersistedAtMs && now - job.lastPersistedAtMs < PERSIST_THROTTLE_MS) return;
  job.lastPersistedAtMs = now;

  try {
    await ensurePersistDir();
    const { cleanupTimer, ...serializable } = job;
    await fs.promises.writeFile(jobFilePath(job.id), JSON.stringify(serializable), 'utf8');
  } catch {
    // ignore persistence failures (should not break job processing)
  }
}

async function deletePersistedJob(jobId: string): Promise<void> {
  try {
    await fs.promises.unlink(jobFilePath(jobId));
  } catch {
    // ignore
  }
}

async function loadPersistedJobsOnce(): Promise<void> {
  if (globalThis.__grantImportUploadJobsInit) return;
  globalThis.__grantImportUploadJobsInit = true;

  try {
    await ensurePersistDir();
    const files = await fs.promises.readdir(JOB_PERSIST_DIR);
    const jobFiles = files.filter((f) => f.endsWith('.json'));

    for (const f of jobFiles) {
      const full = path.join(JOB_PERSIST_DIR, f);
      const raw = await fs.promises.readFile(full, 'utf8').catch(() => null);
      if (!raw) continue;
      const parsed = safeParseJson<Job>(raw);
      if (!parsed?.id) continue;

      // hydrate into memory
      const job: Job = { ...parsed };
      JOBS.set(job.id, job);
      scheduleCleanup(job);

      // If dev server restarted mid-run, resume automatically.
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'queued';
        job.message = 'Resuming after restart';
        job.updatedAt = nowIso();
        void persistJob(job, true);
        void runJob(job).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

function scheduleCleanup(job: Job) {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    const j = JOBS.get(job.id);
    if (!j) return;
    try {
      if (j.tempFilePath) fs.unlink(j.tempFilePath, () => {});
    } catch {
      // ignore
    }
    JOBS.delete(job.id);
    void deletePersistedJob(job.id);
  }, JOB_TTL_MS);
}

export function createGrantImportUploadJob(input: {
  tempFilePath: string;
  filename: string | null;
  actorUserId: string | null;
}): { jobId: string } {
  void loadPersistedJobsOnce();
  const id = crypto.randomUUID();
  const job: Job = {
    id,
    status: 'queued',
    pct: 0,
    message: 'Queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    tempFilePath: input.tempFilePath,
    filename: input.filename,
    actorUserId: input.actorUserId,
  };
  JOBS.set(id, job);
  scheduleCleanup(job);
  void persistJob(job, true);

  // fire-and-forget processing
  void runJob(job).catch(() => {});
  return { jobId: id };
}

export function getGrantImportUploadJob(jobId: string): GrantImportUploadJobSnapshot | null {
  void loadPersistedJobsOnce();
  const job = JOBS.get(jobId);
  if (!job) {
    // Try disk (in case request hits during/after dev reload).
    try {
      const raw = fs.existsSync(jobFilePath(jobId)) ? fs.readFileSync(jobFilePath(jobId), 'utf8') : null;
      if (raw) {
        const parsed = safeParseJson<Job>(raw);
        if (parsed?.id) {
          const hydrated: Job = { ...parsed };
          JOBS.set(jobId, hydrated);
          scheduleCleanup(hydrated);
          // Resume if it was mid-run.
          if (hydrated.status === 'queued' || hydrated.status === 'running') {
            hydrated.status = 'queued';
            hydrated.message = 'Resuming after restart';
            hydrated.updatedAt = nowIso();
            void persistJob(hydrated, true);
            void runJob(hydrated).catch(() => {});
          }
          const { tempFilePath, filename, actorUserId, cleanupTimer, lastPersistedAtMs, ...snap } = hydrated;
          return snap;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }
  const { tempFilePath, filename, actorUserId, cleanupTimer, ...snap } = job;
  return snap;
}

async function runJob(job: Job): Promise<void> {
  job.status = 'running';
  job.pct = 1;
  job.message = 'Reading file';
  job.updatedAt = nowIso();
  void persistJob(job, true);

  try {
    const result = await stage1UploadParseValidateMatchAndPersist({
      filepath: job.tempFilePath,
      filename: job.filename,
      actorUserId: job.actorUserId,
      onProgress: (p) => {
        job.pct = clampPct(p.pct);
        job.message = p.message || job.message;
        job.updatedAt = nowIso();
        void persistJob(job, false);
      },
    });
    job.status = 'done';
    job.pct = 100;
    job.message = 'Completed';
    job.result = result;
    job.updatedAt = nowIso();
    void persistJob(job, true);
  } catch (e: unknown) {
    job.status = 'failed';
    job.pct = Math.max(1, job.pct);
    job.message = 'Failed';
    job.error = e instanceof Error ? e.message : 'Upload processing failed';
    job.updatedAt = nowIso();
    void persistJob(job, true);
  } finally {
    scheduleCleanup(job);
    void persistJob(job, true);
  }
}

// Best-effort init on module load
void loadPersistedJobsOnce();

