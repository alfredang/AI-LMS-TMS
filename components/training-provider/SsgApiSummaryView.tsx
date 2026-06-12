import React, { useEffect, useState, useCallback } from 'react';

interface ApiRow {
  id: number;
  api_name: string;
  version: string;
  app1_status: string;
  app2_status: string;
  app3_status: string;
  app4_status: string;
}

interface CertExpiry {
  app1_cert_expiry:       string | null;
  app2_cert_expiry:       string | null;
  app3_cert_expiry:       string | null;
  app4_secret_last_generated_at: string | null;
}

type AppKey = 'app1_status' | 'app2_status' | 'app3_status' | 'app4_status';

const VALID_STATUSES = ['Active', 'Pending', 'Not Subscribed', 'Suspended', 'Rejected', 'Inactive'];

const CERT_CARDS = [
  { key: 'app1_cert_expiry'              as keyof CertExpiry, app: 'App 1 – SKILLETO TERTIARY',          label: 'Cert Expiry'           },
  { key: 'app2_cert_expiry'              as keyof CertExpiry, app: 'App 2 – Training Management System', label: 'Cert Expiry'           },
  { key: 'app3_cert_expiry'              as keyof CertExpiry, app: 'App 3 – Tertiary Infotech Academy',  label: 'Cert Expiry'           },
  { key: 'app4_secret_last_generated_at' as keyof CertExpiry, app: 'App 4 – TMS API (OAuth)',                   label: 'Secret Last Generated' },
];

const STATUS_CLASSES: Record<string, string> = {
  'Active':         'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  'Pending':        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  'Suspended':      'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  'Rejected':       'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  'Not Subscribed': 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  'Inactive':       'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const formatSgt = (isoStr: string | null): string => {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' SGT';
};

// Convert UTC ISO string → local datetime-local input value (YYYY-MM-DDTHH:mm)
const toDatetimeLocal = (isoStr: string | null): string => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  // Shift to SGT for display in the input
  const sgt = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sgt.getFullYear()}-${pad(sgt.getMonth() + 1)}-${pad(sgt.getDate())}T${pad(sgt.getHours())}:${pad(sgt.getMinutes())}`;
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASSES[status] ?? 'bg-gray-100 text-gray-500'}`}>
    {status || '—'}
  </span>
);

const StatusSelect: React.FC<{ value: string; onChange: (v: string) => void; saving: boolean }> = ({ value, onChange, saving }) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    disabled={saving}
    className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
  >
    {VALID_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
  </select>
);

const SsgApiSummaryView: React.FC = () => {
  const [rows, setRows] = useState<ApiRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [certExpiry, setCertExpiry] = useState<CertExpiry>({
    app1_cert_expiry: null,
    app2_cert_expiry: null,
    app3_cert_expiry: null,
    app4_secret_last_generated_at: null,
  });
  const [certDraft, setCertDraft] = useState<CertExpiry | null>(null);
  const [certEditing, setCertEditing] = useState(false);
  const [certSaving, setCertSaving] = useState(false);

  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<ApiRow>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/training-provider/api-subscription');
      const json = await res.json();
      if (json.success) {
        setRows(json.data);
        setLastUpdated(json.lastUpdated ?? null);
        setCertExpiry(json.certExpiry ?? {
          app1_cert_expiry: null,
          app2_cert_expiry: null,
          app3_cert_expiry: null,
          app4_secret_last_generated_at: null,
        });
      }
    } catch {
      showToast('error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Cert expiry editing ──
  const startCertEdit = () => {
    setCertDraft({ ...certExpiry });
    setCertEditing(true);
  };

  const cancelCertEdit = () => {
    setCertDraft(null);
    setCertEditing(false);
  };

  const saveCertEdit = async () => {
    if (!certDraft) return;
    setCertSaving(true);
    try {
      const res = await fetch('/api/training-provider/api-subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(certDraft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setCertExpiry(json.certExpiry);
      setCertEditing(false);
      setCertDraft(null);
      showToast('success', 'Dates saved successfully');
    } catch (e: any) {
      showToast('error', e.message || 'Save failed');
    } finally {
      setCertSaving(false);
    }
  };

  // ── Row editing ──
  const startEdit = (row: ApiRow) => {
    setEditingId(row.id);
    setEditDraft({ app1_status: row.app1_status, app2_status: row.app2_status, app3_status: row.app3_status, app4_status: row.app4_status });
  };

  const cancelEdit = () => { setEditingId(null); setEditDraft({}); };

  const saveEdit = async (id: number) => {
    setSaving(true);
    try {
      const res = await fetch('/api/training-provider/api-subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editDraft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setRows(prev => prev.map(r => r.id === id ? { ...r, ...json.data } : r));
      if (json.data?.updated_at) setLastUpdated(json.data.updated_at);
      setEditingId(null);
      showToast('success', 'Saved successfully');
    } catch (e: any) {
      showToast('error', e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const filtered = rows.filter(r =>
    !search || (r.api_name ?? '').toLowerCase().includes(search.toLowerCase()) || (r.version ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">SSG API Summary</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          API subscription status across all apps.{' '}
          <span className="font-medium text-gray-600 dark:text-gray-300">
            Last updated: {formatSgt(lastUpdated)}
          </span>
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'success'
            ? 'bg-green-100 text-green-800 border border-green-300'
            : 'bg-red-100 text-red-800 border border-red-300'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Cert expiry / secret rotation cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Certificate & Secret Dates</h2>
          {!certEditing ? (
            <button
              onClick={startCertEdit}
              className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 text-xs font-medium"
            >
              Edit Dates
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={saveCertEdit}
                disabled={certSaving}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
              >
                {certSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={cancelCertEdit}
                disabled={certSaving}
                className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CERT_CARDS.map(({ key, app, label }) => (
            <div key={key} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 px-4 py-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{app}</p>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">{label}</p>
              {certEditing && certDraft ? (
                <input
                  type="datetime-local"
                  value={toDatetimeLocal(certDraft[key])}
                  onChange={e => setCertDraft(d => d ? { ...d, [key]: e.target.value ? new Date(e.target.value).toISOString() : null } : d)}
                  className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">{formatSgt(certExpiry[key])}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Status:</span>
        {VALID_STATUSES.map(s => <StatusBadge key={s} status={s} />)}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search API name…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-64 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-xs text-gray-400">{filtered.length} / {rows.length} APIs</span>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">API Name</th>
                <th className="px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">Version</th>
                <th className="px-3 py-3 text-center font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  App 1<br/><span className="font-normal text-gray-400">SKILLETO TERTIARY</span>
                </th>
                <th className="px-3 py-3 text-center font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  App 2<br/><span className="font-normal text-gray-400">Training Management System</span>
                </th>
                <th className="px-3 py-3 text-center font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  App 3<br/><span className="font-normal text-gray-400">Tertiary Infotech Academy</span>
                </th>
                <th className="px-3 py-3 text-center font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  App 4<br/><span className="font-normal text-gray-400">TMS API (OAuth)</span>
                </th>
                <th className="px-3 py-3 text-center font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {paginated.map(row => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className={`transition-colors ${isEditing ? 'bg-blue-50 dark:bg-blue-900/10' : 'hover:bg-gray-50 dark:hover:bg-slate-700/30'}`}>
                    <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100 font-medium">{row.api_name}</td>
                    <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{row.version}</td>

                    {(['app1_status', 'app2_status', 'app3_status', 'app4_status'] as AppKey[]).map(key => (
                      <td key={key} className="px-3 py-2.5 text-center">
                        {isEditing ? (
                          <StatusSelect
                            value={editDraft[key] ?? row[key]}
                            onChange={v => setEditDraft(d => ({ ...d, [key]: v }))}
                            saving={saving}
                          />
                        ) : (
                          <StatusBadge status={row[key]} />
                        )}
                      </td>
                    ))}

                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => saveEdit(row.id)}
                            disabled={saving}
                            className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 text-xs font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(row)}
                          className="px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 text-xs font-medium"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    {rows.length === 0 ? 'No data — run the migration SQL to seed the table.' : 'No results match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} APIs
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-slate-600"
            >
              «
            </button>
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1}
              className="px-2.5 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-slate-600"
            >
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 py-1 text-xs text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${
                      page === p
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page === totalPages}
              className="px-2.5 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-slate-600"
            >
              ›
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-slate-600"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SsgApiSummaryView;
