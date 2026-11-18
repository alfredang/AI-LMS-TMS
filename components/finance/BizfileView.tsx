import React, { useState } from 'react';

type BizfileEndpoint = 'entityVerification' | 'entityNameSearch' | 'entityBasicInformation' | 'businessProfile';

const ENDPOINTS: { value: BizfileEndpoint; label: string; cost: string }[] = [
  { value: 'entityVerification', label: 'Entity Verification', cost: '1 call' },
  { value: 'entityNameSearch', label: 'Entity Name Search', cost: '1 call' },
  { value: 'entityBasicInformation', label: 'Entity Basic Information', cost: '6 calls' },
  { value: 'businessProfile', label: 'Business Profile', cost: '17 calls' },
];

const ENTITY_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'BIZ', label: 'Business (BIZ)' },
  { value: 'COM', label: 'Company (COM)' },
  { value: 'LLP', label: 'Limited Liability Partnership (LLP)' },
  { value: 'LP', label: 'Limited Partnership (LP)' },
  { value: 'PAF', label: 'Public Accounting Firm (PAF)' },
];

export default function BizfileView() {
  const [endpoint, setEndpoint] = useState<BizfileEndpoint>('entityVerification');
  const [uen, setUen] = useState('');
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setResult(null);

    if (!uen && !name) {
      setError('Please enter a UEN or entity name.');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('endpoint', endpoint);
      if (uen) params.set('uen', uen);
      if (name) params.set('name', name);
      if (entityType) params.set('type', entityType);

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

  const renderVerificationResult = (data: any) => {
    if (!data) return null;
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ResultCard label="Valid" value={data.isValid ? 'Yes' : 'No'} highlight={data.isValid} />
        <ResultCard label="UEN" value={data.uen} />
        <ResultCard label="Name" value={data.name} />
        <ResultCard label="Entity Type" value={data.entityType} />
      </div>
    );
  };

  const renderNameSearchResult = (data: any) => {
    if (!data) return null;
    const names = data.entityNames || [];
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ResultCard label="Results Per Page" value={data.resultsPerPage} />
          <ResultCard label="Current Page" value={data.currentPage} />
          <ResultCard label="Category" value={data.resultCategory} />
        </div>
        {names.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-800 dark:bg-slate-700 text-white">
                  <th className="text-left px-4 py-3 font-semibold">#</th>
                  <th className="text-left px-4 py-3 font-semibold">Entity Name</th>
                </tr>
              </thead>
              <tbody>
                {names.map((n: string, i: number) => (
                  <tr key={i} className="border-b border-default hover:bg-surface-hover">
                    <td className="px-4 py-2 text-muted">{i + 1}</td>
                    <td className="px-4 py-2 text-on-surface font-medium">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {names.length === 0 && (
          <p className="text-sm text-muted">No matching entities found.</p>
        )}
      </div>
    );
  };

  const renderBasicInfoResult = (data: any) => {
    if (!data) return null;
    const entity = Array.isArray(data) ? data[0] : data;
    if (!entity) return <p className="text-sm text-muted">No data returned.</p>;

    const fields: { label: string; value: any }[] = [
      { label: 'UEN', value: entity.uen },
      { label: 'Name', value: entity.name },
      { label: 'Entity Type', value: entity.entityType },
      { label: 'Status', value: entity.status },
      { label: 'Registration Date', value: entity.registrationDate },
      { label: 'Commencement Date', value: entity.commencementDate },
      { label: 'Status Effective Date', value: entity.statusEffectiveDate },
    ];

    // Address
    const addr = entity.registeredAddress;
    if (addr) {
      const parts = [addr.block, addr.streetName, addr.levelNo ? `#${addr.levelNo}-${addr.unitNo || ''}` : '', addr.buildingName, addr.postalCode ? `S(${addr.postalCode})` : ''].filter(Boolean);
      fields.push({ label: 'Registered Address', value: parts.join(' ') });
    }

    // SSIC
    if (entity.primarySsicCode) {
      fields.push({ label: 'Primary SSIC', value: `${entity.primarySsicCode} — ${entity.primarySsicDescription || ''}` });
    }
    if (entity.secondarySsicCode) {
      fields.push({ label: 'Secondary SSIC', value: `${entity.secondarySsicCode} — ${entity.secondarySsicDescription || ''}` });
    }

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {fields.map(({ label, value }) => (
            <ResultCard key={label} label={label} value={value} />
          ))}
        </div>

        {/* Officers */}
        {entity.officers && entity.officers.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-on-surface-secondary mb-2">Officers</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 dark:bg-slate-700 text-white">
                    <th className="text-left px-4 py-2 font-semibold">Name</th>
                    <th className="text-left px-4 py-2 font-semibold">Position</th>
                    <th className="text-left px-4 py-2 font-semibold">Appointed</th>
                    <th className="text-left px-4 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entity.officers.map((o: any, i: number) => (
                    <tr key={i} className="border-b border-default">
                      <td className="px-4 py-2">{o.name || '—'}</td>
                      <td className="px-4 py-2">{o.position || '—'}</td>
                      <td className="px-4 py-2">{o.appointedDate || '—'}</td>
                      <td className="px-4 py-2">{o.status || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStructuredResult = () => {
    if (!result) return null;
    switch (endpoint) {
      case 'entityVerification': return renderVerificationResult(result);
      case 'entityNameSearch': return renderNameSearchResult(result);
      case 'entityBasicInformation': return renderBasicInfoResult(result);
      case 'businessProfile': return renderBasicInfoResult(result);
      default: return null;
    }
  };

  const needsUen = endpoint === 'entityVerification' || endpoint === 'entityBasicInformation' || endpoint === 'businessProfile';
  const needsName = endpoint === 'entityVerification' || endpoint === 'entityNameSearch' || endpoint === 'entityBasicInformation';
  const showTypeFilter = endpoint === 'entityNameSearch';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Bizfile — Entity Information Query</h1>
        <p className="mt-1 text-sm text-muted">
          Query ACRA entity information via Bizfile API.
        </p>
      </div>

      {/* Endpoint Selector */}
      <div>
        <label className="block text-xs font-semibold uppercase text-muted tracking-wider mb-2">
          API Endpoint
        </label>
        <div className="flex flex-wrap gap-2">
          {ENDPOINTS.map((ep) => (
            <button
              key={ep.value}
              onClick={() => { setEndpoint(ep.value); setResult(null); setError(''); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                endpoint === ep.value
                  ? 'bg-primary text-white'
                  : 'bg-surface-elevated text-on-surface-secondary hover:bg-gray-200 dark:hover:bg-slate-600'
              }`}
            >
              {ep.label}
              <span className="ml-1.5 text-xs opacity-70">({ep.cost})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
        {needsUen && (
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">UEN</label>
            <input
              value={uen}
              onChange={(e) => setUen(e.target.value)}
              placeholder="e.g. 201200696W"
              className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
        )}
        {needsName && (
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Entity Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tertiary Infotech"
              className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
        )}
        {showTypeFilter && (
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Entity Type</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Querying…' : 'Query Bizfile'}
      </button>

      {error && (
        <div className="p-3 rounded-lg bg-danger-bg border border-red-200 dark:border-red-800 text-danger text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-on-surface">Results</h2>
          {renderStructuredResult()}

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

function ResultCard({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return (
    <div className="bg-surface-elevated rounded-lg p-3">
      <dt className="text-xs font-medium text-muted uppercase tracking-wider">{label}</dt>
      <dd className={`mt-1 text-sm font-medium ${highlight ? 'text-success' : 'text-on-surface'}`}>
        {value != null && value !== '' ? String(value) : '—'}
      </dd>
    </div>
  );
}
