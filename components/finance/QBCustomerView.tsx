import React, { useState } from 'react';

type Tab = 'query' | 'create';

export default function QBCustomerView() {
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
        body: JSON.stringify({ entity: 'customer', ...body }),
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

  const tabClass = (t: Tab) => `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === t ? 'bg-white dark:bg-slate-800 text-primary border-b-2 border-primary' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`;
  const customers = result?.QueryResponse?.Customer || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">QuickBooks Online Customer API</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(['query', 'create'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setResult(null); setError(''); }} className={tabClass(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'query' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Query</label>
            <input value={query} onChange={e => setQuery(e.target.value)} className="w-full max-w-2xl rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary" />
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

      {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{error}</div>}

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
                  <tr key={c.Id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
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
                <div key={label} className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</dt>
                  <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{String(value)}</dd>
                </div>
              ) : null)}
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

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary" />
    </div>
  );
}
