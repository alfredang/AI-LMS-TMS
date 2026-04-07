import React, { useState } from 'react';

export default function BizfileDirectorySearchView() {
  const [searchBy, setSearchBy] = useState<'uen' | 'name' | 'fbrn'>('uen');
  const [uen, setUen] = useState('');
  const [name, setName] = useState('');
  const [fbrn, setFbrn] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setResult(null);

    const value = searchBy === 'uen' ? uen : searchBy === 'name' ? name : fbrn;
    if (!value.trim()) {
      setError(`Please enter a ${searchBy === 'uen' ? 'UEN' : searchBy === 'name' ? 'name' : 'FBRN'}.`);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ endpoint: 'entitySearch', [searchBy]: value.trim() });
      const resp = await fetch(`/api/bizfile/query?${params}`);
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

  const renderResult = () => {
    if (!result) return null;
    const entity = Array.isArray(result) ? result[0] : result;
    if (!entity) return <p className="text-sm text-gray-500">No data returned.</p>;

    const addr = entity.registeredAddress;
    const addressParts = addr
      ? [addr.blkhseNo, addr.streetName, addr.levelNo ? `#${addr.levelNo}-${addr.unitNo || ''}` : '', addr.bldgName, addr.postalCode ? `S(${addr.postalCode})` : ''].filter(Boolean)
      : [];

    const fields: { label: string; value: any }[] = [
      { label: 'UEN', value: entity.uen },
      { label: 'Name', value: entity.name },
      { label: 'Status', value: entity.status?.description },
      { label: 'FBRN', value: entity.fbrn },
      { label: 'Registered Address', value: addressParts.join(' ') || null },
      { label: 'Primary SSIC', value: entity.ssic?.code ? `${entity.ssic.code} — ${entity.ssic.description || ''}` : null },
    ];

    // Former names
    if (entity.formerNames?.length > 0) {
      fields.push({ label: 'Former Names', value: entity.formerNames.join(', ') });
    }

    // AGM/AR info
    if (entity.coAgmDue) {
      if (entity.coAgmDue.lastAgmDate) fields.push({ label: 'Last AGM Date', value: entity.coAgmDue.lastAgmDate });
      if (entity.coAgmDue.lastArDate) fields.push({ label: 'Last AR Date', value: entity.coAgmDue.lastArDate });
      if (entity.coAgmDue.lastFinancialYearEndDate) fields.push({ label: 'Last FYE', value: entity.coAgmDue.lastFinancialYearEndDate });
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fields.map(({ label, value }) =>
          value != null && value !== '' ? (
            <div key={label} className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{String(value)}</dd>
            </div>
          ) : null
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Entity Directory Search</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Search entity details by UEN, name, or FBRN.{' '}
          <span className="text-xs opacity-70">(1 API call)</span>
        </p>
      </div>

      {/* Search By Toggle */}
      <div>
        <label className="block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider mb-2">Search By</label>
        <div className="flex gap-2">
          {([['uen', 'UEN'], ['name', 'Name'], ['fbrn', 'FBRN']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSearchBy(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchBy === key
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-md">
        {searchBy === 'uen' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UEN</label>
            <input value={uen} onChange={(e) => setUen(e.target.value)} placeholder="e.g. 201200696W"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
          </div>
        )}
        {searchBy === 'name' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Entity Name (exact)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tertiary Infotech Academy Pte. Ltd."
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
          </div>
        )}
        {searchBy === 'fbrn' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">FBRN</label>
            <input value={fbrn} onChange={(e) => setFbrn(e.target.value)} placeholder="e.g. CN-18901239123"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
          </div>
        )}
      </div>

      <button onClick={handleSubmit} disabled={loading}
        className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading ? 'Searching…' : 'Search'}
      </button>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Results</h2>
          {renderResult()}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button onClick={() => setShowJson(!showJson)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
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
