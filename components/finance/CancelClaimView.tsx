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
        <h1 className="text-2xl font-bold text-on-surface">Cancel Claim</h1>
        <p className="mt-1 text-sm text-muted">
          POST /skillsFutureCredits/claims/&#123;claimId&#125; (v2)
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-muted tracking-wider mb-2">
          Certificate / OAuth
        </label>
        <select
          value={selectedApp}
          onChange={(e) => setSelectedApp(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-primary focus:border-primary"
        >
          {APP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">Claim ID</label>
          <input
            value={claimId}
            onChange={(e) => setClaimId(e.target.value)}
            placeholder="e.g. 200123456789"
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">NRIC</label>
          <input
            value={nric}
            onChange={(e) => setNric(e.target.value)}
            placeholder="e.g. S1234567A"
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-on-surface-secondary mb-1">Cancel Code</label>
          <input
            value={claimCancelCode}
            onChange={(e) => setClaimCancelCode(e.target.value)}
            placeholder="e.g. 01"
            className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
          />
        </div>
      </div>

      <div className="p-3 rounded-lg bg-warning-bg border border-amber-200 dark:border-amber-800 text-warning text-sm">
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
        <div className="p-3 rounded-lg bg-danger-bg border border-red-200 dark:border-red-800 text-danger text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-success-bg border border-green-200 dark:border-green-800 text-success text-sm font-medium">
            Claim cancelled successfully.
          </div>

          <div className="border border-default rounded-lg overflow-hidden">
            <button
              onClick={() => setShowJson(!showJson)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-on-surface-secondary hover:bg-surface-hover transition-colors"
            >
              <span>▶ JSON Response</span>
              <span className="text-xs text-muted">{showJson ? 'collapse' : 'expand'}</span>
            </button>
            {showJson && (
              <pre className="px-4 py-3 bg-surface-elevated text-xs font-mono text-on-surface overflow-x-auto max-h-96 border-t border-default">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
