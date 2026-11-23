import React, { useState } from 'react';

type Tab = 'query' | 'create';

const QB_APP_OPTIONS = [
  { value: 'app1', label: 'App 1' },
  { value: 'app2', label: 'App 2' },
];

export default function QBCustomerView() {
  const [selectedApp, setSelectedApp] = useState('app1');
  const [tab, setTab] = useState<Tab>('query');
  const [query, setQuery] = useState('SELECT * FROM Customer MAXRESULTS 20');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJson, setShowJson] = useState(false);

  // Create fields
  const [displayName, setDisplayName] = useState('');
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');

  const callApi = async (body: any) => {
    setError(''); setResult(null); setLoading(true);
    try {
      const resp = await fetch('/api/quickbooks/proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'customer', app: selectedApp, ...body }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) setError(json.error || `Error ${resp.status}`);
      else setResult(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error'); }
    finally { setLoading(false); }
  };

  const handleQuery = () => callApi({ action: 'query', query });
  const handleCreate = () => {
    if (!displayName) { setError('Display Name is required.'); return; }
    const body: any = { DisplayName: displayName };
    if (givenName) body.GivenName = givenName;
    if (familyName) body.FamilyName = familyName;
    if (companyName) body.CompanyName = companyName;
    if (email) body.PrimaryEmailAddr = { Address: email };
    if (phone) body.PrimaryPhone = { FreeFormNumber: phone };
    if (line1 || city || postalCode || country) {
      body.BillAddr = {};
      if (line1) body.BillAddr.Line1 = line1;
      if (city) body.BillAddr.City = city;
      if (postalCode) body.BillAddr.PostalCode = postalCode;
      if (country) body.BillAddr.Country = country;
    }
    callApi({ action: 'create', body });
  };

  const tabClass = (t: Tab) => `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === t ? 'bg-surface text-primary border-b-2 border-primary' : 'text-muted hover:text-on-surface'}`;
  const customers = result?.QueryResponse?.Customer || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Customers</h1>
        <p className="mt-1 text-sm text-muted">QuickBooks Online Customer API</p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase text-muted tracking-wider">QuickBooks App</label>
        <div className="flex gap-1">
          {QB_APP_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setSelectedApp(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedApp === opt.value ? 'bg-success-bg text-success border-2 border-green-500 dark:border-green-500' : 'bg-surface-elevated text-on-surface-secondary border-2 border-transparent'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b border-default">
        {(['query', 'create'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setResult(null); setError(''); }} className={tabClass(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'query' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Query</label>
            <input value={query} onChange={e => setQuery(e.target.value)} className="w-full max-w-2xl rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary" />
          </div>
          <button onClick={handleQuery} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Querying…' : 'Query Customers'}</button>
        </div>
      )}

      {tab === 'create' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
            <Input label="Display Name *" value={displayName} onChange={setDisplayName} placeholder="e.g. John Smith" />
            <Input label="Given Name" value={givenName} onChange={setGivenName} placeholder="e.g. John" />
            <Input label="Family Name" value={familyName} onChange={setFamilyName} placeholder="e.g. Smith" />
            <Input label="Company Name" value={companyName} onChange={setCompanyName} placeholder="e.g. Acme Corp" />
            <Input label="Email" value={email} onChange={setEmail} placeholder="e.g. john@example.com" />
            <Input label="Phone" value={phone} onChange={setPhone} placeholder="e.g. +65 9123 4567" />
            <Input label="Address Line 1" value={line1} onChange={setLine1} placeholder="e.g. 123 Main St" />
            <Input label="City" value={city} onChange={setCity} placeholder="e.g. Singapore" />
            <Input label="Postal Code" value={postalCode} onChange={setPostalCode} placeholder="e.g. 123456" />
            <Input label="Country" value={country} onChange={setCountry} placeholder="e.g. SG" />
          </div>
          <button onClick={handleCreate} disabled={loading} className="px-6 py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-50">{loading ? 'Creating…' : 'Create Customer'}</button>
        </div>
      )}

      {error && <div className="p-3 rounded-lg bg-danger-bg border border-red-200 dark:border-red-800 text-danger text-sm">{error}</div>}

      {result && (
        <div className="space-y-4">
          {customers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="bg-gray-800 dark:bg-slate-700 text-white">
                  <th className="text-left px-4 py-3 font-semibold">ID</th>
                  <th className="text-left px-4 py-3 font-semibold">Display Name</th>
                  <th className="text-left px-4 py-3 font-semibold">Company</th>
                  <th className="text-left px-4 py-3 font-semibold">Email</th>
                  <th className="text-left px-4 py-3 font-semibold">Phone</th>
                  <th className="text-right px-4 py-3 font-semibold">Balance</th>
                  <th className="text-left px-4 py-3 font-semibold">Active</th>
                </tr></thead>
                <tbody>{customers.map((c: any) => (
                  <tr key={c.Id} className="border-b border-default hover:bg-surface-hover">
                    <td className="px-4 py-2 font-mono">{c.Id}</td>
                    <td className="px-4 py-2 font-medium">{c.DisplayName || '—'}</td>
                    <td className="px-4 py-2">{c.CompanyName || '—'}</td>
                    <td className="px-4 py-2">{c.PrimaryEmailAddr?.Address || '—'}</td>
                    <td className="px-4 py-2">{c.PrimaryPhone?.FreeFormNumber || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{c.Balance != null ? `$${Number(c.Balance).toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-2">{c.Active ? 'Yes' : 'No'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {/* Single customer result (from create) */}
          {!customers.length && result?.Customer && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'ID', value: result.Customer.Id },
                { label: 'Display Name', value: result.Customer.DisplayName },
                { label: 'Company', value: result.Customer.CompanyName },
                { label: 'Email', value: result.Customer.PrimaryEmailAddr?.Address },
                { label: 'Phone', value: result.Customer.PrimaryPhone?.FreeFormNumber },
                { label: 'Balance', value: result.Customer.Balance != null ? `$${Number(result.Customer.Balance).toFixed(2)}` : null },
              ].map(({ label, value }) => value != null && value !== '' ? (
                <div key={label} className="bg-surface-elevated rounded-lg p-3">
                  <dt className="text-xs font-medium text-muted uppercase tracking-wider">{label}</dt>
                  <dd className="mt-1 text-sm font-medium text-on-surface">{String(value)}</dd>
                </div>
              ) : null)}
            </div>
          )}

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

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-on-surface-secondary mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-strong bg-surface text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
    </div>
  );
}
