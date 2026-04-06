import React, { useState } from 'react';

export default function BizfileCapitalView() {
  const [uen, setUen] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  const handleSubmit = async () => {
    setError(''); setResult(null);
    if (!uen.trim()) { setError('UEN is required.'); return; }
    setLoading(true);
    try {
      const resp = await fetch(`/api/bizfile/query?endpoint=companyCapitalDetails&uen=${encodeURIComponent(uen.trim())}`);
      const json = await resp.json();
      if (!resp.ok || !json.success) setError(json.error || `Error ${resp.status}`);
      else setResult(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  const entity = result && (Array.isArray(result) ? result[0] : result);
  const shares = entity?.shareCapital || entity?.capitals || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Company Capital Details</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Retrieve share capital information (companies only). <span className="text-xs opacity-70">(2 API calls)</span></p>
      </div>
      <div className="max-w-md">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UEN</label>
        <input value={uen} onChange={(e) => setUen(e.target.value)} placeholder="e.g. 201200696W"
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
      </div>
      <button onClick={handleSubmit} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading ? 'Loading…' : 'Query Capital'}
      </button>
      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{error}</div>}
      {entity && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Results</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">UEN</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{entity.uen || entity.entityNo || '—'}</dd>
            </div>
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{entity.name || entity.entityName || '—'}</dd>
            </div>
          </div>

          {shares.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 dark:bg-slate-700 text-white">
                    <th className="text-left px-4 py-3 font-semibold">Share Type</th>
                    <th className="text-left px-4 py-3 font-semibold">Currency</th>
                    <th className="text-right px-4 py-3 font-semibold">No. of Shares</th>
                    <th className="text-right px-4 py-3 font-semibold">Issued Capital</th>
                    <th className="text-right px-4 py-3 font-semibold">Paid-Up Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {shares.map((s: any, i: number) => (
                    <tr key={i} className="border-b border-gray-200 dark:border-gray-700">
                      <td className="px-4 py-2">{s.shareType || s.capitalType || '—'}</td>
                      <td className="px-4 py-2">{s.currency || '—'}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{s.noOfShares?.toLocaleString() ?? s.numberOfShares?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{s.issuedCapital?.toLocaleString() ?? s.issuedShareCapital?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{s.paidUpCapital?.toLocaleString() ?? s.paidUpShareCapital?.toLocaleString() ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button onClick={() => setShowJson(!showJson)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
              <span>▶ JSON Response</span><span className="text-xs text-gray-400">{showJson ? 'collapse' : 'expand'}</span>
            </button>
            {showJson && <pre className="px-4 py-3 bg-gray-50 dark:bg-slate-900 text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 border-t border-gray-200 dark:border-gray-700">{JSON.stringify(result, null, 2)}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}
