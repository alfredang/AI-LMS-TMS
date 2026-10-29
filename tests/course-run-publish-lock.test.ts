import assert from 'node:assert/strict';
import test from 'node:test';

// Needs a real Postgres for advisory locks. Runs only against an explicitly given
// throwaway database - never the DATABASE_URL in .env.local:
//   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine
//   LOCK_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres npm test
const url = process.env.LOCK_TEST_DATABASE_URL;
const skip = !url || !/localhost|127\.0\.0\.1/.test(url) ? 'set LOCK_TEST_DATABASE_URL to a local throwaway Postgres' : false;

const load = async () => {
  process.env.DATABASE_URL = url; // lib/db reads it at import; dotenv does not override it
  return import('../lib/ssg/courseRunPublishLock');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('two publishes for the same course never overlap', { skip }, async () => {
  const { withCourseRunPublishLock } = await load();
  const events: string[] = [];
  const job = (name: string) => withCourseRunPublishLock('TGS-LOCKTEST', async () => {
    events.push(`${name} start`);
    await sleep(300);
    events.push(`${name} end`);
  });
  await Promise.all([job('a'), job('b')]);
  assert.deepEqual(events.map((e) => e.split(' ')[1]), ['start', 'end', 'start', 'end']);
});

test('different courses publish in parallel', { skip }, async () => {
  const { withCourseRunPublishLock } = await load();
  const t0 = Date.now();
  await Promise.all(['TGS-LOCK-A', 'TGS-LOCK-B'].map((c) => withCourseRunPublishLock(c, () => sleep(400))));
  assert.ok(Date.now() - t0 < 750, 'second course waited for the first');
});

test('gives up with a busy error instead of waiting forever', { skip }, async () => {
  const { withCourseRunPublishLock, CourseRunPublishBusyError } = await load();
  const holder = withCourseRunPublishLock('TGS-LOCK-BUSY', () => sleep(1500));
  await sleep(100);
  await assert.rejects(withCourseRunPublishLock('TGS-LOCK-BUSY', async () => {}, 300), CourseRunPublishBusyError);
  await holder;
});

test('ten waiters for one course hold at most two DB connections', { skip }, async () => {
  const { withCourseRunPublishLock } = await load();
  const pool = (await import('../lib/db')).default;
  let peak = 0;
  const watch = setInterval(() => { peak = Math.max(peak, pool.totalCount - pool.idleCount); }, 10);
  await Promise.all(Array.from({ length: 10 }, () =>
    withCourseRunPublishLock('TGS-LOCK-POOL', () => sleep(50))));
  clearInterval(watch);
  assert.ok(peak <= 2, `peak checked-out connections ${peak}`);
});

test('releases the lock when the publish throws', { skip }, async () => {
  const { withCourseRunPublishLock } = await load();
  await assert.rejects(withCourseRunPublishLock('TGS-LOCK-THROW', async () => { throw new Error('ssg down'); }), /ssg down/);
  await withCourseRunPublishLock('TGS-LOCK-THROW', async () => {}, 500); // would be busy if still held
  const pool = (await import('../lib/db')).default;
  await pool.end();
});
