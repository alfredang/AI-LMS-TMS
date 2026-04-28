/**
 * In-memory job store for long-running slide generation.
 * Jobs survive Next.js hot reloads via globalThis.
 *
 * Pattern: POST starts a job, client polls GET status, client downloads result.
 * This decouples the 15-25 minute pipeline from the HTTP request lifecycle,
 * surviving browser fetch timeouts, proxy kills, and dev-server hot reloads.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface SlideJob {
  id: string;
  status: JobStatus;
  progress: { message: string; percent: number };
  result?: {
    fileName: string;
    filePath: string;   // absolute path on server
    slideCount: number;
    stats: any;
    message: string;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface JobStoreGlobal {
  __cwSlidesJobs?: Map<string, SlideJob>;
}
const g = globalThis as unknown as JobStoreGlobal;
if (!g.__cwSlidesJobs) g.__cwSlidesJobs = new Map<string, SlideJob>();
const JOBS: Map<string, SlideJob> = g.__cwSlidesJobs;

// Cleanup old jobs (> 1 hour) every 5 min to prevent unbounded growth.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const JOB_MAX_AGE_MS = 60 * 60 * 1000;
let cleanupStarted = false;
function startCleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of JOBS.entries()) {
      if (now - job.updatedAt > JOB_MAX_AGE_MS) {
        if (job.result?.filePath) {
          try { fs.unlinkSync(job.result.filePath); } catch {}
        }
        JOBS.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS).unref?.();
}
startCleanup();

export function createJob(): SlideJob {
  const id = randomUUID();
  const now = Date.now();
  const job: SlideJob = {
    id,
    status: 'pending',
    progress: { message: 'Queued', percent: 0 },
    createdAt: now,
    updatedAt: now,
  };
  JOBS.set(id, job);
  return job;
}

export function getJob(id: string): SlideJob | undefined {
  return JOBS.get(id);
}

export function updateJob(id: string, patch: Partial<SlideJob>): void {
  const job = JOBS.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
  JOBS.set(id, job);
}

export function updateProgress(id: string, message: string, percent: number): void {
  const job = JOBS.get(id);
  if (!job) return;
  job.progress = { message, percent };
  job.updatedAt = Date.now();
}

export function slidesOutputDir(): string {
  const dir = path.join(os.tmpdir(), 'cw_slides_jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
