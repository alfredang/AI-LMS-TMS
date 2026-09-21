(() => {
  const ORIGIN = 'http://localhost:3000';
  if (window.location.origin !== ORIGIN) return;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    if (event.data?.type === 'TIA_TPG_RENEWAL_PING') {
      window.postMessage({ type: 'TIA_TPG_RENEWAL_READY', version: chrome.runtime.getManifest().version }, ORIGIN);
      return;
    }
    if (event.data?.type !== 'TIA_TPG_RENEWAL_START') return;
    const requestId = String(event.data.requestId || '');
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return;
    chrome.runtime.sendMessage({ type: 'START_RENEWAL_CAPTURE', requestId }).catch((error) => {
      window.postMessage({ type: 'TIA_TPG_RENEWAL_EVENT', requestId, event: 'error', message: error.message }, ORIGIN);
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'RENEWAL_CAPTURE_EVENT') return;
    window.postMessage({ type: 'TIA_TPG_RENEWAL_EVENT', ...message.payload }, ORIGIN);
  });

  window.postMessage({ type: 'TIA_TPG_RENEWAL_READY', version: chrome.runtime.getManifest().version }, ORIGIN);
})();
