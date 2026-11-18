import React, { useState } from 'react';

type Tab = 'query' | 'read' | 'create' | 'pdf' | 'send' | 'delete';

const QB_APP_OPTIONS = [
  { value: 'app1', label: 'App 1' },
  { value: 'app2', label: 'App 2' },
];

export default function QBEstimateView() {
  const [selectedApp, setSelectedApp] = useState('app1');
  const [tab, setTab] = useState<Tab>('query');
  const [query, setQuery] = useState('SELECT * FROM Estimate MAXRESULTS 20');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  // Create fields
  const [customerId, setCustomerId] = useState('');
  const [itemId, setItemId] = useState('');
  const [itemName, setItemName] = useState('');
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [description, setDescription] = useState('');

  // Read / PDF fields
  const [readId, setReadId] = useState('');
  const [pdfId, setPdfId] = useState('');

  // Send fields
  const [sendId, setSendId] = useState('');
  const [sendTo, setSendTo] = useState('');

  // Delete fields
  const [deleteId, setDeleteId] = useState('');
  const [syncToken, setSyncToken] = useState('');

  const callApi = async (body: any) => {
    setError(''); setResult(null); setLoading(true);
    try {
      const resp = await fetch('/api/quickbooks/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'estimate', app: selectedApp, ...body }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) setError(json.error || `Error ${resp.status}`);
      else setResult(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  const handleQuery = () => callApi({ action: 'query', query });
  const handleRead = () => { if (!readId) { setError('Estimate ID is required.'); return; } callApi({ action: 'read', id: readId }); };
  const handlePdf = async () => {
    if (!pdfId) { setError('Estimate ID is required.'); return; }
    setError(''); setLoading(true);
    try {
      const resp = await fetch('/api/quickbooks/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pdf', entity: 'estimate', id: pdfId, app: selectedApp }),
      });
      if (!resp.ok) { const json = await resp.json().catch(() => null); setError(json?.error || `Error ${resp.status}`); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `estimate-${pdfId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };
  const handleCreate = () => {
    if (!customerId) { setError('Customer ID is required.'); return; }
    const amt = parseFloat(unitPrice) * parseInt(qty);
    callApi({
      action: 'create',
      body: {
        CustomerRef: { value: customerId },
        Line: [{
          DetailType: 'SalesItemLineDetail', Amount: amt,
          Description: description || undefined,
          SalesItemLineDetail: { ItemRef: { value: itemId || '1', name: itemName || 'Services' }, UnitPrice: parseFloat(unitPrice), Qty: parseInt(qty) },
        }],
      },
    });
  };
  const handleSend = () => { if (!sendId) { setError('Estimate ID is required.'); return; } callApi({ action: 'send', id: sendId, sendTo: sendTo || undefined }); };
  const handleDelete = () => { if (!deleteId || !syncToken) { setError('ID and SyncToken are required.'); return; } callApi({ action: 'delete', body: { Id: deleteId, SyncToken: syncToken } }); };

  const tabClass = (t: Tab) => `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === t ? 'bg-surface text-primary border-b-2 border-primary' : 'text-muted hover:text-on-surface'}`;

  const estimates = result?.QueryResponse?.Estimate || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Quotes (Estimates)</h1>
        <p className="mt-1 text-sm text-muted">QuickBooks Online Estimate API</p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase text-muted tracking-wider">QuickBooks App</label>
        <div className="flex gap-1">
          {QB_APP_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setSelectedApp(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedApp === opt.value ? 'bg-success-bg text-success border-2 border-green-500 dark:border-green-500' : 'bg-surface-elevated text-on-surface-secondary border-2 border-transparent'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b border-default">
        {(['query', 'read', 'create', 'pdf', 'send', 'delete'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setResult(null); setError(''); }} className={tabClass(t)}>
            {t === 'pdf' ? 'Get PDF' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'query' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Query</label>
            <input value={query} onChange={e => setQuery(e.target.value)} className="w-full max-w-2xl rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary" />
          </div>
          <button onClick={handleQuery} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Querying…' : 'Query Estimates'}</button>
        </div>
      )}

      {tab === 'read' && (
        <div className="space-y-4">
          <Input label="Estimate ID *" value={readId} onChange={setReadId} placeholder="e.g. 123" />
          <button onClick={handleRead} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Loading…' : 'Read Estimate'}</button>
        </div>
      )}

      {tab === 'create' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
            <Input label="Customer ID *" value={customerId} onChange={setCustomerId} placeholder="e.g. 1" />
            <Input label="Item ID" value={itemId} onChange={setItemId} placeholder="e.g. 1" />
            <Input label="Item Name" value={itemName} onChange={setItemName} placeholder="e.g. Services" />
            <Input label="Qty" value={qty} onChange={setQty} placeholder="1" />
            <Input label="Unit Price *" value={unitPrice} onChange={setUnitPrice} placeholder="e.g. 150.00" />
            <Input label="Description" value={description} onChange={setDescription} placeholder="Optional" />
          </div>
          <button onClick={handleCreate} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Creating…' : 'Create Estimate'}</button>
        </div>
      )}

      {tab === 'pdf' && (
        <div className="space-y-4">
          <Input label="Estimate ID *" value={pdfId} onChange={setPdfId} placeholder="e.g. 123" />
          <button onClick={handlePdf} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Downloading…' : 'Download PDF'}</button>
        </div>
      )}

      {tab === 'send' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Estimate ID *" value={sendId} onChange={setSendId} placeholder="e.g. 123" />
            <Input label="Send To (email)" value={sendTo} onChange={setSendTo} placeholder="Optional override" />
          </div>
          <button onClick={handleSend} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Sending…' : 'Send Estimate'}</button>
        </div>
      )}

      {tab === 'delete' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Estimate ID *" value={deleteId} onChange={setDeleteId} placeholder="e.g. 123" />
            <Input label="SyncToken *" value={syncToken} onChange={setSyncToken} placeholder="e.g. 0" />
          </div>
          <div className="p-3 rounded-lg bg-warning-bg border border-amber-200 dark:border-amber-800 text-warning text-sm">This action cannot be undone.</div>
          <button onClick={handleDelete} disabled={loading} className="px-6 py-2.5 rounded-lg bg-red-600 text-white font-medium text-sm hover:bg-red-700 disabled:opacity-50">{loading ? 'Deleting…' : 'Delete Estimate'}</button>
        </div>
      )}

      {error && <div className="p-3 rounded-lg bg-danger-bg border border-red-200 dark:border-red-800 text-danger text-sm">{error}</div>}

      {result && (
        <div className="space-y-4">
          {estimates.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-gray-800 dark:bg-slate-700 text-white">
                  <th className="text-left px-4 py-3 font-semibold">ID</th>
                  <th className="text-left px-4 py-3 font-semibold">Doc #</th>
                  <th className="text-left px-4 py-3 font-semibold">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Total</th>
                </tr></thead>
                <tbody>{estimates.map((e: any) => (
                  <tr key={e.Id} className="border-b border-default hover:bg-surface-hover">
                    <td className="px-4 py-2 font-mono">{e.Id}</td>
                    <td className="px-4 py-2">{e.DocNumber || '—'}</td>
                    <td className="px-4 py-2">{e.CustomerRef?.name || e.CustomerRef?.value || '—'}</td>
                    <td className="px-4 py-2">{e.TxnDate || '—'}</td>
                    <td className="px-4 py-2">{e.TxnStatus || e.EmailStatus || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{e.TotalAmt != null ? `$${Number(e.TotalAmt).toFixed(2)}` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <JsonToggle data={result} show={showJson} setShow={setShowJson} />
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-on-surface-secondary mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
    </div>
  );
}

function JsonToggle({ data, show, setShow }: { data: any; show: boolean; setShow: (v: boolean) => void }) {
  return (
    <div className="border border-default rounded-lg overflow-hidden">
      <button onClick={() => setShow(!show)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-on-surface-secondary hover:bg-surface-hover transition-colors">
        <span>▶ JSON Response</span><span className="text-xs text-muted">{show ? 'collapse' : 'expand'}</span>
      </button>
      {show && <pre className="px-4 py-3 bg-surface-elevated text-xs font-mono text-on-surface overflow-x-auto max-h-96 border-t border-default">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
