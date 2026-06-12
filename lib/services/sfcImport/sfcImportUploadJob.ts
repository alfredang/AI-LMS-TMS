import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { sfcStage1ParseMatchAndPersist } from './sfcImportStage1';
import { insertSfcImportBatch, updateSfcImportBatchCounts } from './sfcImportDb';

export type SfcImportUploadJobStatus = 'queued' | 'running' | 'done' | 'failed';

export type SfcImportUploadJobSnapshot = {
  id: string;
  status: SfcImportUploadJobStatus;
  pct: number;
  message: string;
  batchId: number | null;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

type Job = SfcImportUploadJobSnapshot & {
  tempFilePath: string;
  filename: string | null;
  actorUserId: string | null;
  cleanupTimer?: NodeJS.Timeout;
  lastPersistedAtMs?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __sfcImportUploadJobs: Map<string, Job> | undefined;
  // eslint-disable-next-line no-var
  var __sfcImportUploadJobsInit: boolean | undefined;
}

const JOBS: Map<string, Job> = globalThis.__sfcImportUploadJobs ?? new Map<string, Job>();
globalThis.__sfcImportUploadJobs = JOBS;
const JOB_TTL_MS = 30 * 60 * 1000;
const JOB_PERSIST_DIR = path.join(os.tmpdir(), 'ai-lms-tms-sfc-import-jobs');
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
    // ignore persistence failures
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
  if (globalThis.__sfcImportUploadJobsInit) return;
  globalThis.__sfcImportUploadJobsInit = true;
  try {
    await ensurePersistDir();
    const files = await fs.promises.readdir(JOB_PERSIST_DIR);
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const raw = await fs.promises.readFile(path.join(JOB_PERSIST_DIR, f), 'utf8').catch(() => null);
      if (!raw) continue;
      const parsed = safeParseJson<Job>(raw);
      if (!parsed?.id) continue;
      const job: Job = { ...parsed };
      JOBS.set(job.id, job);
      scheduleCleanup(job);
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

export function createSfcImportUploadJob(input: {
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
    batchId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    tempFilePath: input.tempFilePath,
    filename: input.filename,
    actorUserId: input.actorUserId,
  };
  JOBS.set(id, job);
  scheduleCleanup(job);
  void persistJob(job, true);
  void runJob(job).catch(() => {});
  return { jobId: id };
}

export function getSfcImportUploadJob(jobId: string): SfcImportUploadJobSnapshot | null {
  void loadPersistedJobsOnce();
  const job = JOBS.get(jobId);
  if (!job) {
    try {
      const raw = fs.existsSync(jobFilePath(jobId)) ? fs.readFileSync(jobFilePath(jobId), 'utf8') : null;
      if (raw) {
        const parsed = safeParseJson<Job>(raw);
        if (parsed?.id) {
          const hydrated: Job = { ...parsed };
          JOBS.set(jobId, hydrated);
          scheduleCleanup(hydrated);
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
    const batch = await insertSfcImportBatch({
      filename: job.filename || 'unknown.xlsx',
      uploadedBy: job.actorUserId,
    });
    job.batchId = batch.id;
    job.updatedAt = nowIso();
    void persistJob(job, true);

    await sfcStage1ParseMatchAndPersist({
      filepath: job.tempFilePath,
      filename: job.filename,
      batchId: batch.id,
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
    job.updatedAt = nowIso();
    void persistJob(job, true);
  } catch (e: unknown) {
    job.status = 'failed';
    job.pct = Math.max(1, job.pct);
    job.message = 'Failed';
    job.error = e instanceof Error ? e.message : 'Upload processing failed';
    job.updatedAt = nowIso();
    if (job.batchId) {
      try {
        await updateSfcImportBatchCounts(
          job.batchId,
          { total_rows: 0, ready_count: 0, already_applied_count: 0, unmatched_count: 0, skipped_da_count: 0, invalid_count: 0 },
          'failed'
        );
      } catch {
        // ignore
      }
    }
    void persistJob(job, true);
  } finally {
    scheduleCleanup(job);
    void persistJob(job, true);
  }
}

void loadPersistedJobsOnce();
