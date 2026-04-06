import React, { useState } from 'react';

type Tab = 'query' | 'create' | 'pdf' | 'send' | 'void' | 'delete';

const QB_APP_OPTIONS = [
  { value: 'app1', label: 'App 1' },
  { value: 'app2', label: 'App 2' },
];

export default function QBPaymentView() {
  const [selectedApp, setSelectedApp] = useState('app1');
  const [tab, setTab] = useState<Tab>('query');
  const [query, setQuery] = useState('SELECT * FROM Payment MAXRESULTS 20');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [totalAmt, setTotalAmt] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [paymentAmt, setPaymentAmt] = useState('');

  const [pdfId, setPdfId] = useState('');
  const [sendId, setSendId] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [voidId, setVoidId] = useState('');
  const [voidSyncToken, setVoidSyncToken] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [syncToken, setSyncToken] = useState('');

  const callApi = async (body: any) => {
    setError(''); setResult(null); setLoading(true);
    try {
      const resp = await fetch('/api/quickbooks/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'payment', app: selectedApp, ...body }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) setError(json.error || `Error ${resp.status}`);
      else setResult(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  const handleQuery = () => callApi({ action: 'query', query });
  const handleCreate = () => {
    if (!customerId || !totalAmt) { setError('Customer ID and Total Amount are required.'); return; }
    const body: any = { CustomerRef: { value: customerId }, TotalAmt: parseFloat(totalAmt) };
    if (invoiceId) {
      body.Line = [{ Amount: parseFloat(paymentAmt || totalAmt), LinkedTxn: [{ TxnId: invoiceId, TxnType: 'Invoice' }] }];
    }
    callApi({ action: 'create', body });
  };
  const handlePdf = async () => {
    if (!pdfId) { setError('Payment ID is required.'); return; }
    setError(''); setLoading(true);
    try {
      const resp = await fetch('/api/quickbooks/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pdf', entity: 'payment', id: pdfId, app: selectedApp }),
      });
      if (!resp.ok) { const json = await resp.json().catch(() => null); setError(json?.error || `Error ${resp.status}`); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `payment-${pdfId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };
  const handleSend = () => { if (!sendId) { setError('Payment ID is required.'); return; } callApi({ action: 'send', id: sendId, sendTo: sendTo || undefined }); };
  const handleVoid = () => { if (!voidId || !voidSyncToken) { setError('ID and SyncToken are required.'); return; } callApi({ action: 'void', body: { Id: voidId, SyncToken: voidSyncToken } }); };
  const handleDelete = () => { if (!deleteId || !syncToken) { setError('ID and SyncToken are required.'); return; } callApi({ action: 'delete', body: { Id: deleteId, SyncToken: syncToken } }); };

  const tabClass = (t: Tab) => `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === t ? 'bg-white dark:bg-slate-800 text-primary border-b-2 border-primary' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;
  const payments = result?.QueryResponse?.Payment || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payments</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">QuickBooks Online Payment API</p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">QuickBooks App</label>
        <div className="flex gap-1">
          {QB_APP_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setSelectedApp(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedApp === opt.value ? 'bg-green-100 text-green-800 border-2 border-green-500 dark:bg-green-900/30 dark:text-green-400 dark:border-green-500' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 border-2 border-transparent'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700">
        {(['query', 'create', 'pdf', 'send', 'void', 'delete'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setResult(null); setError(''); }} className={tabClass(t)}>
            {t === 'pdf' ? 'Get PDF' : t === 'void' ? 'Void' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'query' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Query</label>
            <input value={query} onChange={e => setQuery(e.target.value)} className="w-full max-w-2xl rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary" />
          </div>
          <button onClick={handleQuery} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Querying…' : 'Query Payments'}</button>
        </div>
      )}

      {tab === 'create' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Customer ID *" value={customerId} onChange={setCustomerId} placeholder="e.g. 1" />
            <Input label="Total Amount *" value={totalAmt} onChange={setTotalAmt} placeholder="e.g. 150.00" />
            <Input label="Invoice ID (optional)" value={invoiceId} onChange={setInvoiceId} placeholder="Link to invoice" />
            <Input label="Payment Amount" value={paymentAmt} onChange={setPaymentAmt} placeholder="Amount against invoice" />
          </div>
          <button onClick={handleCreate} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Creating…' : 'Create Payment'}</button>
        </div>
      )}

      {tab === 'pdf' && (
        <div className="space-y-4">
          <Input label="Payment ID *" value={pdfId} onChange={setPdfId} placeholder="e.g. 789" />
          <button onClick={handlePdf} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Downloading…' : 'Download PDF'}</button>
        </div>
      )}

      {tab === 'send' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Payment ID *" value={sendId} onChange={setSendId} placeholder="e.g. 789" />
            <Input label="Send To (email)" value={sendTo} onChange={setSendTo} placeholder="Optional override" />
          </div>
          <button onClick={handleSend} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Sending…' : 'Send Payment'}</button>
        </div>
      )}

      {tab === 'void' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Payment ID *" value={voidId} onChange={setVoidId} placeholder="e.g. 789" />
            <Input label="SyncToken *" value={voidSyncToken} onChange={setVoidSyncToken} placeholder="e.g. 0" />
          </div>
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">Voiding a payment reverses it but keeps the record.</div>
          <button onClick={handleVoid} disabled={loading} className="px-6 py-2.5 rounded-lg bg-amber-600 text-white font-medium text-sm hover:bg-amber-700 disabled:opacity-50">{loading ? 'Voiding…' : 'Void Payment'}</button>
        </div>
      )}

      {tab === 'delete' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Payment ID *" value={deleteId} onChange={setDeleteId} placeholder="e.g. 789" />
            <Input label="SyncToken *" value={syncToken} onChange={setSyncToken} placeholder="e.g. 0" />
          </div>
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">This action cannot be undone.</div>
          <button onClick={handleDelete} disabled={loading} className="px-6 py-2.5 rounded-lg bg-red-600 text-white font-medium text-sm hover:bg-red-700 disabled:opacity-50">{loading ? 'Deleting…' : 'Delete Payment'}</button>
        </div>
      )}

      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{error}</div>}

      {result && (
        <div className="space-y-4">
          {payments.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-gray-800 dark:bg-slate-700 text-white">
                  <th className="text-left px-4 py-3 font-semibold">ID</th>
                  <th className="text-left px-4 py-3 font-semibold">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-right px-4 py-3 font-semibold">Total</th>
                  <th className="text-right px-4 py-3 font-semibold">Unapplied</th>
                </tr></thead>
                <tbody>{payments.map((p: any) => (
                  <tr key={p.Id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-2 font-mono">{p.Id}</td>
                    <td className="px-4 py-2">{p.CustomerRef?.name || '—'}</td>
                    <td className="px-4 py-2">{p.TxnDate || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">${Number(p.TotalAmt || 0).toFixed(2)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">${Number(p.UnappliedAmt || 0).toFixed(2)}</td>
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
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
    </div>
  );
}

function JsonToggle({ data, show, setShow }: { data: any; show: boolean; setShow: (v: boolean) => void }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button onClick={() => setShow(!show)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
        <span>▶ JSON Response</span><span className="text-xs text-gray-400">{show ? 'collapse' : 'expand'}</span>
      </button>
      {show && <pre className="px-4 py-3 bg-gray-50 dark:bg-slate-900 text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 border-t border-gray-200 dark:border-gray-700">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
