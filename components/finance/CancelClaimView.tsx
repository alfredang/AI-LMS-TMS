import React, { useState } from 'react';

const APP_OPTIONS = [
  { value: 'app1', label: 'App 1 (Skilleto)' },
  { value: 'app2', label: 'App 2' },
  { value: 'app3', label: 'App 3' },
  { value: 'app4', label: 'App 4 (OAuth)' },
];

export default function CancelClaimView() {
  const [selectedApp, setSelectedApp] = useState('app1');
  const [claimId, setClaimId] = useState('');
  const [nric, setNric] = useState('');
  const [claimCancelCode, setClaimCancelCode] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setResult(null);

    if (!claimId || !nric || !claimCancelCode) {
      setError('Claim ID, NRIC, and Cancel Code are required.');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/sf-credits/claims/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, nric, claimCancelCode, app: selectedApp }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        setError(json.error || `Error ${resp.status}`);
      } else {
        setResult(json.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cancel Claim</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          POST /skillsFutureCredits/claims/&#123;claimId&#125; (v2)
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider mb-2">
          Certificate / OAuth
        </label>
        <select
          value={selectedApp}
          onChange={(e) => setSelectedApp(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-primary focus:border-primary"
        >
          {APP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Claim ID</label>
          <input
            value={claimId}
            onChange={(e) => setClaimId(e.target.value)}
            placeholder="e.g. 200123456789"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">NRIC</label>
          <input
            value={nric}
            onChange={(e) => setNric(e.target.value)}
            placeholder="e.g. S1234567A"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cancel Code</label>
          <input
            value={claimCancelCode}
            onChange={(e) => setClaimCancelCode(e.target.value)}
            placeholder="e.g. 01"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
      </div>

      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">
        This action will cancel the claim and cannot be undone.
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="px-6 py-2.5 rounded-lg bg-red-600 text-white font-medium text-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Cancelling…' : 'Cancel Claim'}
      </button>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm font-medium">
            Claim cancelled successfully.
          </div>

          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowJson(!showJson)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
            >
              <span>▶ JSON Response</span>
              <span className="text-xs text-gray-400">{showJson ? 'collapse' : 'expand'}</span>
            </button>
            {showJson && (
              <pre className="px-4 py-3 bg-gray-50 dark:bg-slate-900 text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 border-t border-gray-200 dark:border-gray-700">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
