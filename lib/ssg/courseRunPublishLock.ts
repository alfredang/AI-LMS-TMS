import pool from '../db';

/**
 * One SSG course-run publish per course at a time, across every LMS path and
 * every app instance.
 *
 * The duplicate guard is check-then-publish. Two publishes for the same course
 * that overlap - the 2 AM cron and someone clicking Sync, or Kael and the Add
 * Course Run screen - can both check, both see no run, and both publish. Holding
 * a Postgres advisory lock (keyed on the course code) across check + publish +
 * local save closes that window.
 *
 * Safety:
 *  - Callers for the same course queue in memory first, so at most one DB
 *    connection per course per process is ever spent waiting on the lock.
 *  - Two-key advisory lock (namespace, hash): a separate key space from the
 *    scheduler's single-key task locks, so the two can never collide.
 *  - If the unlock fails, the connection is destroyed rather than returned to
 *    the pool still holding the lock (Postgres frees it when the session ends).
 */
const LOCK_NAMESPACE = 7231; // arbitrary, fixed: "course-run publish"

export class CourseRunPublishBusyError extends Error {
  status = 409;
  constructor(courseCode: string) {
    super(`Another course-run publish for ${courseCode} is in progress. Nothing was submitted - try again shortly.`);
    this.name = 'CourseRunPublishBusyError';
  }
}

const g = globalThis as unknown as { __courseRunPublishQueues?: Map<string, Promise<unknown>> };
const queues = (g.__courseRunPublishQueues ??= new Map());

async function withDbLock<T>(code: string, fn: () => Promise<T>, deadline: number): Promise<T> {
  const client = await pool.connect();
  let unlocked = true; // nothing to unlock until acquired
  try {
    for (;;) {
      const { rows } = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok',
        [LOCK_NAMESPACE, code],
      );
      if (rows[0]?.ok) { unlocked = false; break; }
      if (Date.now() > deadline) throw new CourseRunPublishBusyError(code);
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      return await fn();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_NAMESPACE, code]);
        unlocked = true;
      } catch { /* destroy the connection below instead of pooling a held lock */ }
    }
  } finally {
    client.release(unlocked ? undefined : new Error('advisory unlock failed - discarding connection'));
  }
}

export async function withCourseRunPublishLock<T>(
  courseCode: string,
  fn: () => Promise<T>,
  waitMs = 60_000,
): Promise<T> {
  const code = String(courseCode || '').trim().toUpperCase();
  const deadline = Date.now() + waitMs;

  // Same-process callers wait their turn here, without holding a DB connection.
  const previous = queues.get(code) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((r) => { done = r; });
  const tail = previous.then(() => mine);
  queues.set(code, tail);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const waited = await Promise.race([
      previous.then(() => true, () => true),
      new Promise<boolean>((r) => { timer = setTimeout(() => r(false), Math.max(0, deadline - Date.now())); }),
    ]);
    clearTimeout(timer);
    if (!waited) throw new CourseRunPublishBusyError(code);
    return await withDbLock(code, fn, deadline);
  } finally {
    clearTimeout(timer);
    done();
    if (queues.get(code) === tail) queues.delete(code);
  }
}
