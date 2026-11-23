import React, { useState } from 'react';

export default function BizfileKeyDatesView() {
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
      const resp = await fetch(`/api/bizfile/query?endpoint=entityRegistrationKeyDates&uen=${encodeURIComponent(uen.trim())}`);
      const json = await resp.json();
      if (!resp.ok || !json.success) setError(json.error || `Error ${resp.status}`);
      else setResult(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  const entity = result && (Array.isArray(result) ? result[0] : result);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Entity Registration Key Dates</h1>
        <p className="mt-1 text-sm text-muted">Retrieve registration and key dates for an entity. <span className="text-xs opacity-70">(1 API call)</span></p>
      </div>
      <div className="max-w-md">
        <label className="block text-sm font-medium text-on-surface-secondary mb-1">UEN</label>
        <input value={uen} onChange={(e) => setUen(e.target.value)} placeholder="e.g. 201200696W"
          className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
      </div>
      <button onClick={handleSubmit} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading ? 'Loading…' : 'Query Key Dates'}
      </button>
      {error && <div className="p-3 rounded-lg bg-danger-bg border border-red-200 dark:border-red-800 text-danger text-sm">{error}</div>}
      {entity && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-on-surface">Results</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { label: 'UEN', value: entity.uen || entity.entityNo },
              { label: 'Name', value: entity.name || entity.entityName },
              { label: 'Status', value: entity.status?.description || entity.entityStatusDescription },
              { label: 'Registration Date', value: entity.registrationDate },
              { label: 'Commencement Date', value: entity.commencementDate },
              { label: 'Renewal Date', value: entity.renewalDate },
              { label: 'Expiry Date', value: entity.expiryDate },
              { label: 'Status Effective Date', value: entity.statusEffectiveDate || entity.entityStatusDate },
              { label: 'Last AGM Date', value: entity.lastAgmDate || entity.agmDate },
              { label: 'Last AR Date', value: entity.lastArDate || entity.annualReturnDate },
              { label: 'Financial Year End', value: entity.financialYearEnd },
            ].map(({ label, value }) => value != null && value !== '' ? (
              <div key={label} className="bg-surface-elevated rounded-lg p-3">
                <dt className="text-xs font-medium text-muted uppercase tracking-wider">{label}</dt>
                <dd className="mt-1 text-sm font-medium text-on-surface">{String(value)}</dd>
              </div>
            ) : null)}
          </div>
          <div className="border border-default rounded-lg overflow-hidden">
            <button onClick={() => setShowJson(!showJson)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-on-surface-secondary hover:bg-surface-hover transition-colors">
              <span>▶ JSON Response</span><span className="text-xs text-muted">{showJson ? 'collapse' : 'expand'}</span>
            </button>
            {showJson && <pre className="px-4 py-3 bg-surface-elevated text-xs font-mono text-on-surface overflow-x-auto max-h-96 border-t border-default">{JSON.stringify(result, null, 2)}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}
