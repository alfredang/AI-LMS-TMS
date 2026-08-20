/**
 * TPGateway grant-fetch office agent.
 *
 * WHY THIS EXISTS
 *   TPGateway sits behind CloudFront, which blocks datacentre IP ranges. The
 *   LMS server drives Chromium perfectly well, but its requests get a 403
 *   before the portal ever sees them — while the identical run from the office
 *   network works. So the live site QUEUES a "Fetch from TPGateway" run, and
 *   this agent, on a machine at the office, hands it to the LMS running there.
 *   Progress is copied back, so whoever clicked watches it on the live site as
 *   if it had run on the server.
 *
 * IT IS ONLY GLUE
 *   Both ends already speak the same API. This script starts nothing itself —
 *   it forwards a queued run to the local LMS, copies status up, and passes the
 *   operator's clicks down. No second copy of the automation to keep in step.
 *
 * A SEPARATE PROCESS FROM scripts/tpg-agent.mjs
 *   That script relays the Direct Application "Confirm & fetch" feature, which
 *   is already live in production. This one is a deliberately separate agent
 *   for Bulk Grant Payment Sync's "Fetch from TPGateway", so a bug here can
 *   never affect that already-proven flow. Run both at once on the office
 *   machine if both features are in use.
 *
 * WHAT YOU NEED ON THIS MACHINE
 *   - the LMS running locally (npm run dev), which is where the browser opens
 *   - LIVE_URL        e.g. https://ai-lms-tms.tertiaryinfo.tech
 *   - LOCAL_URL       defaults to http://localhost:3000
 *   - AGENT_KEY       service key both ends accept for machine callers
 *                     (same value as SCHEDULER_SECRET / EXTERNAL_API_KEY_FOR_CLAWDBOT
 *                     — the same three settings scripts/tpg-agent.mjs already uses)
 *
 * RUN IT
 *   LIVE_URL=https://... AGENT_KEY=... node scripts/tpg-grant-fetch-agent.mjs
 *
 *   Leave it running. It idles until someone clicks Fetch & Upload on the live
 *   site. The operator scans the Singpass QR from the picture shown to them in
 *   the LMS, so nobody has to be sitting at this machine.
 */
import { readFileSync } from 'node:fs';

/**
 * Read settings from .env.local when they are not already in the environment.
 *
 * Windows has no `VAR=value command` prefix, so requiring the operator to
 * export variables first is a trap on the machine this actually runs on. The
 * key is in .env.local anyway — that file is gitignored, which is where a
 * secret belongs.
 */
function fromEnvFile(name) {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at < 0 || line.trimStart().startsWith('#')) continue;
      if (line.slice(0, at).trim() === name) return line.slice(at + 1).trim();
    }
  } catch {
    /* no .env.local — fall through to the missing-settings message */
  }
  return '';
}

const LIVE_URL = (process.env.LIVE_URL || fromEnvFile('LIVE_URL') || '').replace(/\/$/, '');
const LOCAL_URL = (process.env.LOCAL_URL || fromEnvFile('LOCAL_URL') || 'http://localhost:3000').replace(/\/$/, '');
const AGENT_KEY = process.env.AGENT_KEY || fromEnvFile('AGENT_KEY') || '';

const POLL_IDLE_MS = 5000;
const POLL_ACTIVE_MS = 1000;

if (!LIVE_URL || !AGENT_KEY) {
  console.error('Set LIVE_URL and AGENT_KEY — see the comment at the top of this file.');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': AGENT_KEY,
  Authorization: `Bearer ${AGENT_KEY}`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(base, path, init, extraHeaders) {
  const res = await fetch(`${base}${path}`, { ...init, headers: extraHeaders ? { ...headers, ...extraHeaders } : headers });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

const report = (body) =>
  api(LIVE_URL, '/api/finance/grant-fetch/report', { method: 'POST', body: JSON.stringify(body) });

/** Copy one local job's state up to the live job the operator is watching. */
async function mirror(localId, liveId, sent) {
  const { data: job } = await api(LOCAL_URL, `/api/finance/grant-fetch/status?jobId=${localId}`);
  if (!job) return { done: true };

  await report({
    jobId: liveId,
    patch: {
      phase: job.phase,
      message: job.message,
      rowsFound: job.rowsFound,
      error: job.error,
      needsOperator: job.needsOperator,
      screen: job.screen,
      // Only meaningful once the run has finished; harmless before that.
      result: job.phase === 'done' ? job.result : undefined,
    },
  });

  // Activity lines only what has not gone up yet.
  for (const line of job.log.slice(sent.logCount)) {
    await report({ jobId: liveId, log: line.text });
  }
  sent.logCount = job.log.length;

  return { done: ['done', 'cancelled', 'error'].includes(job.phase) };
}

async function runOne(live) {
  console.log(`[grant-fetch-agent] picked up ${live.id} (Payment From ${live.startDate})`);

  if (!live.actorUserId) {
    throw new Error('queued job has no actorUserId — the local run would fail requireFinanceOrAdmin');
  }

  // The local run's requireFinanceOrAdmin check needs a real, DB-verified actorUserId
  // — the agent's own service key (in the base `headers`) satisfies withAuth's role
  // check but not that separate per-user authorization/audit check, so the original
  // clicking user's id is forwarded here instead of bypassing that check.
  const started = await api(
    LOCAL_URL,
    '/api/finance/grant-fetch/run',
    { method: 'POST', body: JSON.stringify({ startDate: live.startDate }) },
    { 'x-actor-user-id': live.actorUserId }
  );
  const localId = started.jobId;
  if (!localId) throw new Error('the local LMS did not return a jobId');

  const sent = { logCount: 0 };

  for (;;) {
    const state = await mirror(localId, live.id, sent).catch((err) => {
      console.warn('[grant-fetch-agent] mirror failed (will retry):', err.message);
      return {};
    });

    // Bring the operator's clicks — and any stop request — down to the browser.
    try {
      const poll = await api(LIVE_URL, `/api/finance/grant-fetch/next?jobId=${encodeURIComponent(live.id)}`);
      for (const input of poll.input || []) {
        await api(LOCAL_URL, '/api/finance/grant-fetch/input', {
          method: 'POST',
          body: JSON.stringify({ jobId: localId, ...input }),
        }).catch(() => {});
      }
      if (poll.job?.cancelRequested) {
        await api(LOCAL_URL, '/api/finance/grant-fetch/cancel', {
          method: 'POST',
          body: JSON.stringify({ jobId: localId }),
        }).catch(() => {});
      }
    } catch {
      /* transient — next tick picks it up */
    }

    if (state.done) break;
    await sleep(POLL_ACTIVE_MS);
  }

  console.log(`[grant-fetch-agent] finished ${live.id}`);
}

// Ctrl+C during an in-flight fetch does not always unwind the loop on Windows,
// which leaves the operator with a window they cannot close. Exit on the signal
// itself rather than relying on the loop noticing.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    console.log('\n[grant-fetch-agent] stopping.');
    process.exit(0);
  });
}

console.log(`[grant-fetch-agent] watching ${LIVE_URL} — browser will open via ${LOCAL_URL}`);
console.log('[grant-fetch-agent] press Ctrl+C to stop.');
for (;;) {
  try {
    const { job } = await api(LIVE_URL, '/api/finance/grant-fetch/next');
    if (job) await runOne(job);
    else await sleep(POLL_IDLE_MS);
  } catch (err) {
    console.warn('[grant-fetch-agent] poll failed:', err.message);
    await sleep(POLL_IDLE_MS);
  }
}
