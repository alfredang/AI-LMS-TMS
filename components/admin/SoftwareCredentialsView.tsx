import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

interface Credential {
  id: number;
  license: string;
  software: string;
  login: string;
  password: string;
  licence_type: string;
  url: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

type FormState = Omit<Credential, 'id' | 'created_at' | 'updated_at'> & { id?: number };

const EMPTY_FORM: FormState = {
  license: '',
  software: '',
  login: '',
  password: '',
  licence_type: '',
  url: '',
  notes: '',
};

const SoftwareCredentialsView: React.FC = () => {
  const [rows, setRows] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/software-credentials');
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Failed to load');
      setRows(json.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.license.toLowerCase().includes(q) ||
      r.software.toLowerCase().includes(q) ||
      r.login.toLowerCase().includes(q) ||
      r.licence_type.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.license.trim()) {
      setError('License is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const method = editing.id ? 'PUT' : 'POST';
      const res = await fetch('/api/admin/software-credentials', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Save failed');
      setEditing(null);
      await fetchRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this credential?')) return;
    try {
      const res = await fetch(`/api/admin/software-credentials?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Delete failed');
      await fetchRows();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Software Credentials</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Shared third-party logins for training operations. Admin-only.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search license, software, login…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-md w-64"
            />
            <Button onClick={() => setEditing({ ...EMPTY_FORM })}>
              <Icon name={IconName.Add} className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </div>
        {error && (
          <div className="mt-3 px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">
            {error}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-slate-700">
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-2 py-1.5">License</th>
                <th className="px-2 py-1.5">Software</th>
                <th className="px-2 py-1.5">Login</th>
                <th className="px-2 py-1.5">Password</th>
                <th className="px-2 py-1.5">Type</th>
                <th className="px-2 py-1.5">URL</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {loading ? (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-gray-500">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-gray-500">No credentials</td></tr>
              ) : filtered.map(row => {
                const shown = !!revealed[row.id];
                return (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <td className="px-2 py-1 font-medium text-gray-900 dark:text-white whitespace-nowrap">{row.license}</td>
                    <td className="px-2 py-1 text-gray-600 dark:text-gray-300 max-w-[12rem] truncate" title={row.software}>{row.software}</td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <span className="truncate max-w-[14rem]" title={row.login}>{row.login}</span>
                        {row.login && (
                          <button onClick={() => copy(row.login)} title="Copy login" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0">
                            <CopyIcon className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-200 whitespace-nowrap font-mono">
                      <div className="flex items-center gap-1">
                        <span>{shown ? row.password : '••••••'}</span>
                        <button onClick={() => setRevealed(r => ({ ...r, [row.id]: !r[row.id] }))} title={shown ? 'Hide' : 'Show'} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0">
                          <Icon name={shown ? IconName.EyeOff : IconName.Eye} className="w-3 h-3" />
                        </button>
                        {row.password && (
                          <button onClick={() => copy(row.password)} title="Copy password" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0">
                            <CopyIcon className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row.licence_type}</td>
                    <td className="px-2 py-1 text-blue-600 dark:text-blue-400 max-w-[14rem] truncate">
                      {row.url && row.url.toLowerCase() !== 'na' ? (
                        <a href={row.url.startsWith('http') ? row.url : `https://${row.url}`} target="_blank" rel="noopener noreferrer" className="hover:underline" title={row.url}>
                          {row.url}
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <button onClick={() => setEditing({
                        id: row.id,
                        license: row.license,
                        software: row.software,
                        login: row.login,
                        password: row.password,
                        licence_type: row.licence_type,
                        url: row.url,
                        notes: row.notes,
                      })} className="text-gray-500 hover:text-blue-600 mr-2" title="Edit">
                        <Icon name={IconName.Create} className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(row.id)} className="text-gray-500 hover:text-red-600" title="Delete">
                        <Icon name={IconName.Delete} className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100 dark:border-slate-700">
          {filtered.length} of {rows.length} credential{rows.length === 1 ? '' : 's'}
        </div>
      </Card>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !saving && setEditing(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              {editing.id ? 'Edit Credential' : 'Add Credential'}
            </h3>
            <div className="space-y-3">
              {([
                ['license', 'License *'],
                ['software', 'Software Supported'],
                ['login', 'Login'],
                ['password', 'Password'],
                ['licence_type', 'Licence Type (Paid/Free/NA)'],
                ['url', 'URL'],
                ['notes', 'Notes'],
              ] as Array<[keyof FormState, string]>).map(([key, label]) => (
                <div key={key as string}>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{label}</label>
                  <input
                    type="text"
                    value={(editing[key] as string) || ''}
                    onChange={(e) => setEditing(prev => prev ? { ...prev, [key]: e.target.value } : prev)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-md"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SoftwareCredentialsView;
