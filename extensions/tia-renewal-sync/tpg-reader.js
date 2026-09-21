(() => {
  // A tab opened before an extension reload needs a fresh reader injection.
  // Avoid registering duplicate listeners if it was already attached.
  const readerVersion = chrome.runtime.getManifest().version;
  if (globalThis.__tiaTpgReaderVersion === readerVersion) return;
  globalThis.__tiaTpgReaderVersion = readerVersion;

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normal = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  // TPG puts hidden sort links/scripts inside each <th>. innerText therefore
  // includes "Sort column by ..." and cannot be used as the field name.
  const heading = (cell) => clean([...cell.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent).join('')) || clean((cell.innerText || '').split('\n')[0]);

  function tabElement(label) {
    return [...document.querySelectorAll('a, button, [role="tab"], li')]
      .filter(visible)
      .find((element) => clean(element.textContent) === label &&
        ![...element.children].some((child) => clean(child.textContent) === label)) || null;
  }

  function activeTab() {
    for (const label of ['Submissions', 'Rejected Applications']) {
      const element = tabElement(label);
      if (!element) continue;
      const clickable = element.closest('a,button,[role="tab"]') || element;
      const parent = clickable.closest('li');
      if (clickable.getAttribute('aria-selected') === 'true' || clickable.getAttribute('aria-current') === 'page'
        || /\b(active|selected|current)\b/i.test(clickable.className || '')
        || (parent && /\b(active|selected|current)\b/i.test(parent.className || ''))) return label;
    }
    return null;
  }

  function readGrid() {
    const tables = [...document.querySelectorAll('table')].filter(visible);
    const found = tables.map((table) => {
      const headers = [...table.querySelectorAll('thead th')].map(heading);
      return { table, headers };
    }).find(({ headers }) => headers.some((header) => normal(header) === 'applicationrefno')
      && headers.some((header) => normal(header) === 'coursetitle'));
    if (!found) return { ready: false, url: location.href, activeTab: activeTab(), reason: 'TPG application table not detected. Open the Courses dashboard in your signed-in TPG tab, then retry.' };
    const { table, headers } = found;
    const required = ['datesubmitted', 'applicationrefno', 'courserefno', 'coursetitle', 'submissiontype', 'coursetype', 'status'];
    const missing = required.filter((name) => !headers.some((header) => normal(header) === name));
    if (missing.length) return { ready: false, url: location.href, activeTab: activeTab(), reason: `TPG table headers changed: ${missing.join(', ')}` };

    // Use the pagination next to this grid, not another tab's transient text
    // while TPG swaps panels during its AJAX refresh.
    let scope = table.parentElement;
    let summaryMatch = null;
    let emptyMatch = false;
    for (let depth = 0; scope && depth < 5; depth += 1, scope = scope.parentElement) {
      const scopeText = scope.innerText || '';
      summaryMatch = scopeText.match(/\b(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+records?\b/i);
      emptyMatch = /\b(no records found|0 records|no data available)\b/i.test(scopeText);
      if (summaryMatch || emptyMatch) break;
    }
    const summary = summaryMatch ? summaryMatch[0] : (emptyMatch ? '0 records' : null);
    if (!summary) return { ready: false, url: location.href, activeTab: activeTab(), reason: 'TPG pagination total was not found.' };
    const rows = (summary === '0 records' ? [] : [...table.querySelectorAll('tbody tr')].filter(visible)).map((tr) => {
      const cells = [...tr.querySelectorAll(':scope > td')];
      if (cells.length !== headers.length) throw new Error(`TPG row has ${cells.length} cells, expected ${headers.length}.`);
      // The final, unlabeled TPG column contains row actions. Keep its cell
      // position for alignment, but never emit an empty-name field.
      const row = Object.fromEntries(headers.flatMap((header, index) => header
        ? [[header, clean(cells[index].innerText || cells[index].textContent)]] : []));
      row.sourcePageSummary = summary;
      return row;
    });
    return { ready: true, url: location.href, activeTab: activeTab(), headers, summary, rows };
  }

  function clickTab(label) {
    const element = tabElement(label);
    if (!element) throw new Error(`TPG tab "${label}" was not found.`);
    (element.closest('a,button,[role="tab"]') || element).click();
    return true;
  }

  function clearFilters(force = false) {
    const button = [...document.querySelectorAll('a,button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"]')]
      .filter(visible).find((element) => /^clear filters?$/i.test(clean(element.value || element.innerText || element.textContent)));
    if (!button) return false;
    const filters = button.closest('[id*="FiltersInputWrapper"]');
    if (filters) {
      const hasTextFilter = [...filters.querySelectorAll('input[type="text"],input[type="search"],input[type="date"]')]
        .some((input) => clean(input.value));
      const hasSelectFilter = [...filters.querySelectorAll('select')]
        .some((select) => select.selectedIndex > 0);
      if (!force && !hasTextFilter && !hasSelectFilter) return true;
    }
    button.click();
    return true;
  }

  function nextPage() {
    const candidates = [...document.querySelectorAll('a,button,[role="button"]')].filter(visible);
    const button = candidates.find((element) => {
      const label = clean(element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent);
      return /^(next(?: page)?|›|»|>)$/i.test(label) || /\bnext\b/i.test(element.getAttribute('aria-label') || '');
    });
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true'
      || /\bdisabled\b/i.test(button.className || '') || /\bdisabled\b/i.test(button.closest('li')?.className || '')) {
      throw new Error('TPG Next page control is unavailable before the reported final page.');
    }
    button.click();
    return true;
  }

  function firstPage() {
    const state = readGrid();
    if (!state.ready) throw new Error(state.reason);
    if (/^(?:1\s+to\s+|0 records)/i.test(state.summary)) return false;
    const table = [...document.querySelectorAll('table')].filter(visible)
      .find((element) => [...element.querySelectorAll('thead th')]
        .some((cell) => normal(heading(cell)) === 'applicationrefno'));
    let scope = table?.parentElement;
    for (let depth = 0; scope && depth < 5; depth += 1, scope = scope.parentElement) {
      const button = [...scope.querySelectorAll('a,button,[role="button"],input[type="button"],input[type="submit"]')]
        .filter(visible).find((element) => {
          const label = clean(element.getAttribute('aria-label') || element.getAttribute('title')
            || element.value || element.innerText || element.textContent);
          return /^(?:1|first(?: page)?|page 1|go to (?:first page|page 1)|«|<<)$/i.test(label)
            && !element.disabled && element.getAttribute('aria-disabled') !== 'true'
            && !/\bdisabled\b/i.test(element.className || '')
            && !/\bdisabled\b/i.test(element.closest('li')?.className || '');
        });
      if (button) {
        button.click();
        return true;
      }
      if ((scope.innerText || '').includes(state.summary)) break;
    }
    // Some TPG pagers hide page 1 on later pages. Clear Filter performs a
    // fresh search; force it here even when the filter values are empty.
    if (clearFilters(true)) return true;
    throw new Error('TPG first page control was not found. Return the application grid to page 1 and retry.');
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    try {
      if (message?.type === 'READ_TPG_GRID') respond({ ok: true, state: readGrid() });
      else if (message?.type === 'SELECT_TPG_TAB') respond({ ok: true, clicked: clickTab(message.label) });
      else if (message?.type === 'CLEAR_TPG_FILTERS') respond({ ok: true, clicked: clearFilters() });
      else if (message?.type === 'NEXT_TPG_PAGE') respond({ ok: true, clicked: nextPage() });
      else if (message?.type === 'FIRST_TPG_PAGE') respond({ ok: true, clicked: firstPage() });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });
})();
