import React, { useState } from 'react';

const ENTITY_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'BIZ', label: 'Business (BIZ)' },
  { value: 'COM', label: 'Company (COM)' },
  { value: 'LLP', label: 'LLP' },
  { value: 'LP', label: 'LP' },
  { value: 'PAF', label: 'PAF' },
  { value: 'UF', label: 'Unregistered Foreign (UF)' },
  { value: 'UL', label: 'Unregistered Local (UL)' },
];

export default function BizfileNameSearchView() {
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('');
  const [searchFormer, setSearchFormer] = useState(false);
  const [page, setPage] = useState('1');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  const handleSubmit = async (pageNum?: string) => {
    setError('');
    setResult(null);

    if (!name.trim() || name.trim().length < 5) {
      setError('Entity name must be at least 5 characters.');
      return;
    }

    const currentPage = pageNum || page;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        endpoint: 'entityNameSearch',
        name: name.trim(),
        page: currentPage,
        resultsPerPage: '50',
      });
      if (entityType) params.set('type', entityType);
      if (searchFormer) params.set('searchInFormerNames', 'TRUE');

      const resp = await fetch(`/api/bizfile/query?${params}`);
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        setError(json.error || `Error ${resp.status}`);
      } else {
        setResult(json.data);
        setPage(currentPage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const names = result?.entityNames || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Entity Name Search</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Search entities by partial name (min 5 characters).{' '}
          <span className="text-xs opacity-70">(1 API call)</span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Entity Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tertiary Infotech"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Entity Type</label>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary">
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer pb-2">
            <input type="checkbox" checked={searchFormer} onChange={(e) => setSearchFormer(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Include former names</span>
          </label>
        </div>
      </div>

      <button onClick={() => handleSubmit('1')} disabled={loading}
        className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading ? 'Searching…' : 'Search'}
      </button>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Results
              {result.resultCategory && <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">({result.resultCategory})</span>}
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Page {result.currentPage || page} · {names.length} results
            </span>
          </div>

          {names.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 dark:bg-slate-700 text-white">
                    <th className="text-left px-4 py-3 font-semibold w-16">#</th>
                    <th className="text-left px-4 py-3 font-semibold">Entity Name</th>
                  </tr>
                </thead>
                <tbody>
                  {names.map((n: string, i: number) => (
                    <tr key={i} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{(parseInt(result.currentPage || '1') - 1) * 50 + i + 1}</td>
                      <td className="px-4 py-2 text-gray-900 dark:text-white font-medium">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No matching entities found.</p>
          )}

          {/* Pagination */}
          {names.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => handleSubmit(String(Math.max(1, parseInt(page) - 1)))}
                disabled={loading || parseInt(page) <= 1}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-40 transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => handleSubmit(String(parseInt(page) + 1))}
                disabled={loading || names.length < 50}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600 disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          )}

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
