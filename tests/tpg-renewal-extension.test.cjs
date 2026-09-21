const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extensionDir = path.join(__dirname, '..', 'extensions', 'tia-renewal-sync');
const dashboardUrl = 'https://www.tpgateway.gov.sg/workspace/course-registry/Dashboard.aspx';

test('recovers a page-one counter with stale last-page rows before accepting a complete capture', async () => {
  let listener;
  let label;
  let page;
  let stale;
  let navigated;
  const transitions = [];
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const chrome = {
    runtime: { onMessage: { addListener(callback) { listener = callback; } } },
    tabs: {
      async query() { return [{ id: 20, url: dashboardUrl }]; },
      async get() { return { id: 20, url: dashboardUrl }; },
      async sendMessage(tabId, message) {
        if (tabId === 10) {
          if (['complete', 'error'].includes(message.payload.event)) finish(message.payload);
          return;
        }
        if (message.type === 'SELECT_TPG_TAB') {
          label = message.label; page = 1; stale = true; navigated = false;
        } else if (message.type === 'FIRST_TPG_PAGE') {
          page = 1;
          if (navigated) stale = false;
          transitions.push(`${label}:first`);
        } else if (message.type === 'NEXT_TPG_PAGE') {
          page = 2; navigated = true; stale = false;
          transitions.push(`${label}:next`);
        } else if (message.type === 'READ_TPG_GRID') {
          const lastRows = stale || page === 2;
          return { ok: true, state: {
            ready: true, activeTab: label, headers: ['Application Ref. No.'],
            summary: page === 1 ? '1 to 10 of 14 records' : '11 to 14 of 14 records',
            rows: Array.from({ length: lastRows ? 4 : 10 }, (_, index) => ({
              'Application Ref. No.': `TPG-${(lastRows ? 11 : 1) + index}`,
            })),
          } };
        } else assert.equal(message.type, 'CLEAR_TPG_FILTERS');
        return { ok: true, clicked: true };
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8'), {
    chrome, setTimeout: callback => setTimeout(callback, 0), Date, Error,
  });
  listener({ type: 'START_RENEWAL_CAPTURE', requestId: 'stale-rows' },
    { tab: { id: 10, url: 'http://localhost:3000/' } }, () => {});
  const outcome = await completed;
  assert.equal(outcome.event, 'complete', outcome.message);
  for (const capture of [outcome.captures.submissions, outcome.captures.rejectedApplications]) {
    assert.equal(capture.count, 14);
    assert.equal(new Set(capture.rows.map(row => row['Application Ref. No.'])).size, 14);
    assert.equal(capture.rows[0]['Application Ref. No.'], 'TPG-1');
    assert.equal(capture.pageAudit.length, 2);
  }
  assert.deepEqual(transitions, ['Submissions:first', 'Submissions:next', 'Submissions:first',
    'Submissions:next', 'Rejected Applications:first', 'Rejected Applications:next',
    'Rejected Applications:first', 'Rejected Applications:next']);
});

test('attaches to an already-open TPG tab and resets retained last pages before capturing both grids', async () => {
  const seen = [];
  let listener;
  let readerAttached = false;
  let injections = 0;
  let activeTab = 'Inactive Courses';
  let onFirstPage = false;
  const resets = [];
  const fields = ['Date Submitted', 'Application Ref. No.', 'Course Ref. No.', 'Course Title', 'Submission Type', 'Course Type', 'Status', 'Remarks'];
  const row = {
    'Date Submitted': '21-09-2026',
    'Application Ref. No.': 'TPG-2026122885',
    'Course Ref. No.': 'TGS-2026061312',
    'Course Title': 'Sample Course',
    'Submission Type': 'Renew',
    'Course Type': 'WSQ',
    Status: 'Processing',
    Remarks: '',
    sourcePageSummary: '1 to 1 of 1 records',
  };
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });

  const chrome = {
    runtime: { onMessage: { addListener(callback) { listener = callback; } } },
    scripting: {
      async executeScript({ target, files }) {
        assert.equal(target.tabId, 20);
        assert.equal(files.length, 1);
        assert.equal(files[0], 'tpg-reader.js');
        injections += 1;
        readerAttached = true;
      },
    },
    tabs: {
      async query() { return [{ id: 20, url: dashboardUrl }]; },
      async get() { return { id: 20, url: dashboardUrl }; },
      async sendMessage(tabId, message) {
        if (tabId === 10) {
          seen.push(message.payload);
          if (message.payload.event === 'complete' || message.payload.event === 'error') finish(message.payload);
          return;
        }
        assert.equal(tabId, 20);
        if (!readerAttached) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (message.type === 'SELECT_TPG_TAB') {
          activeTab = message.label;
          onFirstPage = false;
          return { ok: true, clicked: true };
        }
        if (message.type === 'CLEAR_TPG_FILTERS') return { ok: true, clicked: true };
        if (message.type === 'FIRST_TPG_PAGE') {
          resets.push(activeTab);
          onFirstPage = true;
          return { ok: true, clicked: true };
        }
        if (message.type === 'READ_TPG_GRID') return {
          ok: true,
          state: {
            ready: true,
            activeTab,
            summary: onFirstPage ? '1 to 1 of 1 records' : '181 to 186 of 186 records',
            headers: fields,
            rows: onFirstPage ? [row] : Array.from({ length: 6 }, () => row),
          },
        };
        throw new Error(`Unexpected command: ${message.type}`);
      },
    },
  };

  vm.runInNewContext(fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8'), {
    chrome,
    setTimeout,
    Date,
    Error,
  });
  listener({ type: 'START_RENEWAL_CAPTURE', requestId: 'test' },
    { tab: { id: 10, url: 'http://localhost:3000/' } }, () => {});

  let timeout;
  const outcome = await Promise.race([
    completed,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Capture did not finish')), 5000); }),
  ]).finally(() => clearTimeout(timeout));
  assert.equal(outcome.event, 'complete', outcome.message);
  assert.equal(injections, 1);
  assert.deepEqual(resets, ['Submissions', 'Rejected Applications']);
  assert.equal(outcome.captures.submissions.count, 1);
  assert.equal(outcome.captures.rejectedApplications.count, 1);
  assert.equal(outcome.captures.sourceUrl, dashboardUrl);
  assert.ok(seen.some((event) => event.message?.includes('Submissions')));
  assert.ok(seen.some((event) => event.message?.includes('Rejected Applications')));
});

test('finds TPG Clear Filter when it is a submit input', () => {
  let listener;
  let clicks = 0;
  const clearInput = {
    value: 'Clear Filter',
    innerText: '',
    textContent: '',
    getClientRects: () => [1],
    closest: () => null,
    click: () => { clicks += 1; },
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: '0.1.4' }),
      onMessage: { addListener(callback) { listener = callback; } },
    },
  };
  const document = {
    querySelectorAll(selector) {
      assert.match(selector, /input\[type="submit"\]/);
      return [clearInput];
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(extensionDir, 'tpg-reader.js'), 'utf8'), {
    chrome,
    document,
    getComputedStyle: () => ({ visibility: 'visible' }),
  });
  let response;
  listener({ type: 'CLEAR_TPG_FILTERS' }, null, (value) => { response = value; });
  assert.equal(response.ok, true);
  assert.equal(response.clicked, true);
  assert.equal(clicks, 1);
});

test('does not refresh TPG when the visible application filters are already clear', () => {
  let listener;
  let clicks = 0;
  const filterWrapper = {
    querySelectorAll(selector) {
      return selector === 'select' ? [{ selectedIndex: 0 }] : [{ value: '' }];
    },
  };
  const clearInput = {
    value: 'Clear Filter',
    getClientRects: () => [1],
    closest: () => filterWrapper,
    click: () => { clicks += 1; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(extensionDir, 'tpg-reader.js'), 'utf8'), {
    chrome: {
      runtime: {
        getManifest: () => ({ version: '0.1.4' }),
        onMessage: { addListener(callback) { listener = callback; } },
      },
    },
    document: { querySelectorAll: () => [clearInput] },
    getComputedStyle: () => ({ visibility: 'visible' }),
  });
  let response;
  listener({ type: 'CLEAR_TPG_FILTERS' }, null, (value) => { response = value; });
  assert.equal(response.ok, true);
  assert.equal(response.clicked, true);
  assert.equal(clicks, 0);
});
