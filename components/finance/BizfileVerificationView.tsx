import React, { useState } from 'react';

export default function BizfileVerificationView() {
  const [uen, setUen] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  const handleSubmit = async () => {
    setError(''); setResult(null);
    if (!uen && !name) { setError('Please enter a UEN or entity name.'); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ endpoint: 'entityVerification' });
      if (uen) params.set('uen', uen);
      if (name) params.set('name', name);
      const resp = await fetch(`/api/bizfile/query?${params}`);
      const json = await resp.json();
      if (!resp.ok || !json.success) setError(json.error || `Error ${resp.status}`);
      else setResult(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Entity Verification</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Verify entity existence and type. <span className="text-xs opacity-70">(1 API call)</span></p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UEN</label>
          <input value={uen} onChange={(e) => setUen(e.target.value)} placeholder="e.g. 201200696W"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Entity Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tertiary Infotech"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
        </div>
      </div>
      <button onClick={handleSubmit} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading ? 'Verifying…' : 'Verify Entity'}
      </button>
      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{error}</div>}
      {result && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Results</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card label="Valid" value={result.isValid ? 'Yes' : 'No'} highlight={result.isValid} />
            <Card label="UEN" value={result.uen} />
            <Card label="Name" value={result.name} />
            <Card label="Entity Type" value={result.entityType} />
          </div>
          <JsonToggle data={result} showJson={showJson} setShowJson={setShowJson} />
        </div>
      )}
    </div>
  );
}

function Card({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return (
    <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</dt>
      <dd className={`mt-1 text-sm font-medium ${highlight ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>{value != null && value !== '' ? String(value) : '—'}</dd>
    </div>
  );
}

function JsonToggle({ data, showJson, setShowJson }: { data: any; showJson: boolean; setShowJson: (v: boolean) => void }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button onClick={() => setShowJson(!showJson)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
        <span>▶ JSON Response</span><span className="text-xs text-gray-400">{showJson ? 'collapse' : 'expand'}</span>
      </button>
      {showJson && <pre className="px-4 py-3 bg-gray-50 dark:bg-slate-900 text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 border-t border-gray-200 dark:border-gray-700">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
