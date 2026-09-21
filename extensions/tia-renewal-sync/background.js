const TPG_URL = 'https://www.tpgateway.gov.sg/workspace/course-registry/Dashboard.aspx';
let activeJob = null;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendEvent(job, event, extra = {}) {
  await chrome.tabs.sendMessage(job.tiaTabId, {
    type: 'RENEWAL_CAPTURE_EVENT',
    payload: { requestId: job.requestId, event, ...extra },
  });
}

async function command(tabId, message, allowNavigation = false) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response && !response.ok) throw new Error(response.error || 'TPG reader rejected the command.');
      if (!response) throw new Error('TPG reader did not respond.');
      return response;
    } catch (error) {
      lastError = error;
      if (allowNavigation && attempt === 0 && /message port closed|context invalidated/i.test(error?.message || '')) {
        return { ok: true, navigationStarted: true };
      }
      if (/TPG reader rejected/i.test(error?.message || '') || /TPG (tab|Next)/i.test(error?.message || '')) throw error;
      if (/receiving end does not exist|could not establish connection/i.test(error?.message || '')) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!tab.url?.startsWith('https://www.tpgateway.gov.sg/')) {
            throw new Error('TPG left the Courses dashboard. Finish any sign-in in Chrome, return to TPG Courses, and retry.');
          }
          // An unpacked extension reload does not attach content scripts to
          // TPG tabs that were already open. Inject into this permitted tab.
          await chrome.scripting.executeScript({ target: { tabId }, files: ['tpg-reader.js'] });
        } catch (injectionError) {
          lastError = injectionError;
          if (/TPG left the Courses dashboard/.test(injectionError?.message || '')) throw injectionError;
          if (/cannot access|missing host permission|not permitted/i.test(injectionError?.message || '')) {
            throw new Error('Cannot attach the TPG reader to this tab. Check the extension site access for tpgateway.gov.sg.');
          }
        }
      }
      await pause(500);
    }
  }
  throw lastError || new Error('Could not reach the TPG tab.');
}

async function read(tabId) {
  return (await command(tabId, { type: 'READ_TPG_GRID' })).state;
}

function range(summary) {
  const match = String(summary).match(/(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+records?/i);
  if (!match) {
    if (/^0 records?$/i.test(summary)) return { start: 0, end: 0, total: 0 };
    throw new Error(`Unrecognized TPG page summary: ${summary}`);
  }
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

async function waitForPage(tabId, label, expectedStart, previousSignature = null) {
  let lastState;
  let stableSignature = null;
  const previousFirstApplication = previousSignature?.split('|').at(-1) || null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const state = await read(tabId);
      lastState = state;
      if (state.ready && state.activeTab === label) {
        const page = range(state.summary);
        const firstApplication = state.rows[0]?.['Application Ref. No.'] || '';
        const signature = `${state.activeTab}|${state.summary}|${firstApplication}`;
        const rowCountMatches = page.total === 0 ? state.rows.length === 0
          : state.rows.length === page.end - page.start + 1;
        const isExpectedPage = page.start === expectedStart || (page.total === 0 && expectedStart === 1);
        const advanced = !previousFirstApplication || page.total === 0 || firstApplication !== previousFirstApplication;
        if (isExpectedPage && rowCountMatches && advanced && signature !== previousSignature) {
          if (signature === stableSignature) return { state, page, signature };
          stableSignature = signature;
        } else {
          stableSignature = null;
        }
      }
    } catch {
      // ASP.NET postbacks can briefly replace the document; retry after load.
    }
    await pause(500);
  }
  throw new Error(lastState?.reason || `TPG did not settle on ${label} page starting at record ${expectedStart}. Last observed: ${lastState?.summary || 'no page range'}, ${lastState?.rows?.length ?? 0} visible rows. No database update was made.`);
}

async function waitForSelectedGrid(tabId, label) {
  let lastState;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const state = await read(tabId);
      lastState = state;
      if (state.ready && state.activeTab === label) return;
    } catch {
      // The tab may still be loading after an ASP.NET postback.
    }
    await pause(500);
  }
  throw new Error(lastState?.reason || `TPG did not load the ${label} table. Check the TPG login.`);
}

async function captureTab(job, label) {
  await sendEvent(job, 'progress', { message: `Opening ${label}…` });
  await command(job.tpgTabId, { type: 'SELECT_TPG_TAB', label }, true);
  await waitForSelectedGrid(job.tpgTabId, label);
  const cleared = await command(job.tpgTabId, { type: 'CLEAR_TPG_FILTERS' }, true);
  if (cleared.clicked === false) throw new Error(`TPG ${label} Clear Filter control was not found.`);
  await waitForSelectedGrid(job.tpgTabId, label);
  await command(job.tpgTabId, { type: 'FIRST_TPG_PAGE' }, true);
  // TPG can reset only the pager to 1 while retaining the final page's rows.
  // A real page transition reloads the table; do not accept the stale rows.
  const initial = await read(job.tpgTabId);
  if (initial.ready && initial.activeTab === label) {
    const initialPage = range(initial.summary);
    if (initialPage.start === 1 && initialPage.end < initialPage.total
      && initial.rows.length !== initialPage.end) {
      await sendEvent(job, 'progress', { message: `Refreshing ${label} after TPG retained stale page rows…` });
      await command(job.tpgTabId, { type: 'NEXT_TPG_PAGE' }, true);
      await waitForPage(job.tpgTabId, label, initialPage.end + 1);
      await command(job.tpgTabId, { type: 'FIRST_TPG_PAGE' }, true);
    }
  }
  let { state, page, signature } = await waitForPage(job.tpgTabId, label, 1);
  const rows = [];
  const pageAudit = [];
  const headers = state.headers;
  const total = page.total;
  let pageNumber = 1;
  while (true) {
    if (page.total !== total || (total > 0 && (page.start !== rows.length + 1 || state.rows.length !== page.end - page.start + 1))) {
      throw new Error(`${label} page ${pageNumber} is inconsistent: ${state.summary}, ${state.rows.length} visible rows, ${rows.length} previously captured, initial total ${total}. No database update was made.`);
    }
    rows.push(...state.rows);
    pageAudit.push({
      page: pageNumber,
      summary: state.summary,
      rows: state.rows.length,
      firstApplicationRef: state.rows[0]?.['Application Ref. No.'] || null,
      lastApplicationRef: state.rows.at(-1)?.['Application Ref. No.'] || null,
    });
    await sendEvent(job, 'progress', { message: `${label}: ${rows.length} of ${total} records captured` });
    if (page.end === total) break;
    if (pageNumber > 500) throw new Error(`${label} exceeded 500 pages.`);
    await command(job.tpgTabId, { type: 'NEXT_TPG_PAGE' }, true);
    const next = await waitForPage(job.tpgTabId, label, page.end + 1, signature);
    ({ state, page, signature } = next);
    pageNumber += 1;
  }
  if (rows.length !== total) throw new Error(`${label} captured ${rows.length} of ${total} records.`);
  return {
    scrapedAt: new Date().toISOString(),
    count: rows.length,
    coverage: { complete: true, total },
    headers,
    rows,
    pageAudit,
  };
}

async function openTpgTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.tpgateway.gov.sg/*' });
  const existing = tabs.find((tab) => tab.url?.includes('/workspace/course-registry/')) || tabs[0];
  if (existing?.id) {
    if (existing.url !== TPG_URL) await chrome.tabs.update(existing.id, { url: TPG_URL });
    return existing.id;
  }
  const opened = await chrome.tabs.create({ url: TPG_URL, active: false });
  if (!opened.id) throw new Error('Could not open a TPG tab.');
  return opened.id;
}

async function run(job) {
  try {
    await sendEvent(job, 'progress', { message: 'Connecting to your logged-in TPG session…' });
    job.tpgTabId = await openTpgTab();
    const submissions = await captureTab(job, 'Submissions');
    const sourceUrl = (await chrome.tabs.get(job.tpgTabId)).url || TPG_URL;
    const rejectedApplications = await captureTab(job, 'Rejected Applications');
    await sendEvent(job, 'complete', { captures: { sourceUrl, submissions, rejectedApplications } });
  } catch (error) {
    await sendEvent(job, 'error', { message: error?.message || String(error) }).catch(() => undefined);
  } finally {
    activeJob = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'START_RENEWAL_CAPTURE') return;
  if (!sender.tab?.id || !sender.tab.url?.startsWith('http://localhost:3000/')) {
    respond({ ok: false, error: 'Only the TIA localhost page can start a capture.' });
    return;
  }
  if (activeJob) {
    respond({ ok: false, error: 'A TPG capture is already running.' });
    chrome.tabs.sendMessage(sender.tab.id, { type: 'RENEWAL_CAPTURE_EVENT',
      payload: { requestId: message.requestId, event: 'error', message: 'A TPG capture is already running.' } }).catch(() => undefined);
    return;
  }
  activeJob = { requestId: message.requestId, tiaTabId: sender.tab.id, tpgTabId: null };
  respond({ ok: true });
  run(activeJob);
});
