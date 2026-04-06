import React, { useState } from 'react';

type Tab = 'query' | 'read' | 'create' | 'pdf' | 'send' | 'void' | 'delete';

export default function QBInvoiceView() {
  const [tab, setTab] = useState<Tab>('query');
  const [query, setQuery] = useState('SELECT * FROM Invoice MAXRESULTS 20');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [itemId, setItemId] = useState('');
  const [itemName, setItemName] = useState('');
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  const [readId, setReadId] = useState('');
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
        body: JSON.stringify({ entity: 'invoice', ...body }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) setError(json.error || `Error ${resp.status}`);
      else setResult(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  const handlePdf = async () => {
    if (!pdfId) { setError('Invoice ID is required.'); return; }
    setError(''); setLoading(true);
    try {
      const resp = await fetch('/api/quickbooks/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pdf', entity: 'invoice', id: pdfId }),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => null);
        setError(json?.error || `Error ${resp.status}`);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `invoice-${pdfId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  const handleQuery = () => callApi({ action: 'query', query });
  const handleRead = () => { if (!readId) { setError('Invoice ID is required.'); return; } callApi({ action: 'read', id: readId }); };
  const handleVoid = () => { if (!voidId || !voidSyncToken) { setError('ID and SyncToken are required.'); return; } callApi({ action: 'void', body: { Id: voidId, SyncToken: voidSyncToken } }); };
  const handleCreate = () => {
    if (!customerId) { setError('Customer ID is required.'); return; }
    const amt = parseFloat(unitPrice) * parseInt(qty);
    callApi({
      action: 'create',
      body: {
        CustomerRef: { value: customerId },
        DueDate: dueDate || undefined,
        Line: [{
          DetailType: 'SalesItemLineDetail', Amount: amt,
          Description: description || undefined,
          SalesItemLineDetail: { ItemRef: { value: itemId || '1', name: itemName || 'Services' }, UnitPrice: parseFloat(unitPrice), Qty: parseInt(qty) },
        }],
      },
    });
  };
  const handleSend = () => { if (!sendId) { setError('Invoice ID is required.'); return; } callApi({ action: 'send', id: sendId, sendTo: sendTo || undefined }); };
  const handleDelete = () => { if (!deleteId || !syncToken) { setError('ID and SyncToken are required.'); return; } callApi({ action: 'delete', body: { Id: deleteId, SyncToken: syncToken } }); };

  const tabClass = (t: Tab) => `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === t ? 'bg-white dark:bg-slate-800 text-primary border-b-2 border-primary' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;
  const invoices = result?.QueryResponse?.Invoice || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Invoices</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">QuickBooks Online Invoice API</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(['query', 'read', 'create', 'pdf', 'send', 'void', 'delete'] as Tab[]).map(t => (
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
          <button onClick={handleQuery} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Querying…' : 'Query Invoices'}</button>
        </div>
      )}

      {tab === 'read' && (
        <div className="space-y-4">
          <Input label="Invoice ID *" value={readId} onChange={setReadId} placeholder="e.g. 456" />
          <button onClick={handleRead} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Loading…' : 'Read Invoice'}</button>
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
            <Input label="Due Date" value={dueDate} onChange={setDueDate} placeholder="YYYY-MM-DD" />
            <div className="sm:col-span-2 lg:col-span-3">
              <Input label="Description" value={description} onChange={setDescription} placeholder="Optional line item description" />
            </div>
          </div>
          <button onClick={handleCreate} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Creating…' : 'Create Invoice'}</button>
        </div>
      )}

      {tab === 'pdf' && (
        <div className="space-y-4">
          <Input label="Invoice ID *" value={pdfId} onChange={setPdfId} placeholder="e.g. 456" />
          <button onClick={handlePdf} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Downloading…' : 'Download PDF'}</button>
        </div>
      )}

      {tab === 'send' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Invoice ID *" value={sendId} onChange={setSendId} placeholder="e.g. 456" />
            <Input label="Send To (email)" value={sendTo} onChange={setSendTo} placeholder="Optional override" />
          </div>
          <button onClick={handleSend} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Sending…' : 'Send Invoice'}</button>
        </div>
      )}

      {tab === 'void' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Invoice ID *" value={voidId} onChange={setVoidId} placeholder="e.g. 456" />
            <Input label="SyncToken *" value={voidSyncToken} onChange={setVoidSyncToken} placeholder="e.g. 0" />
          </div>
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">Voiding an invoice zeros it out but keeps the record.</div>
          <button onClick={handleVoid} disabled={loading} className="px-6 py-2.5 rounded-lg bg-amber-600 text-white font-medium text-sm hover:bg-amber-700 disabled:opacity-50">{loading ? 'Voiding…' : 'Void Invoice'}</button>
        </div>
      )}

      {tab === 'delete' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Input label="Invoice ID *" value={deleteId} onChange={setDeleteId} placeholder="e.g. 456" />
            <Input label="SyncToken *" value={syncToken} onChange={setSyncToken} placeholder="e.g. 0" />
          </div>
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">This action cannot be undone.</div>
          <button onClick={handleDelete} disabled={loading} className="px-6 py-2.5 rounded-lg bg-red-600 text-white font-medium text-sm hover:bg-red-700 disabled:opacity-50">{loading ? 'Deleting…' : 'Delete Invoice'}</button>
        </div>
      )}

      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{error}</div>}

      {result && (
        <div className="space-y-4">
          {invoices.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-gray-800 dark:bg-slate-700 text-white">
                  <th className="text-left px-4 py-3 font-semibold">ID</th>
                  <th className="text-left px-4 py-3 font-semibold">Doc #</th>
                  <th className="text-left px-4 py-3 font-semibold">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold">Due</th>
                  <th className="text-right px-4 py-3 font-semibold">Total</th>
                  <th className="text-right px-4 py-3 font-semibold">Balance</th>
                </tr></thead>
                <tbody>{invoices.map((inv: any) => (
                  <tr key={inv.Id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-2 font-mono">{inv.Id}</td>
                    <td className="px-4 py-2">{inv.DocNumber || '—'}</td>
                    <td className="px-4 py-2">{inv.CustomerRef?.name || '—'}</td>
                    <td className="px-4 py-2">{inv.TxnDate || '—'}</td>
                    <td className="px-4 py-2">{inv.DueDate || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">${Number(inv.TotalAmt || 0).toFixed(2)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">${Number(inv.Balance || 0).toFixed(2)}</td>
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
