import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';

interface ResponseRow {
  id: string;
  course_run_code?: string;
  course_title?: string;
  course_code?: string;
  learner_name?: string;
  learner_email?: string;
  answers: Record<string, string | number>;
  submitted_at: string;
}

export const FeedbackFormResponsesView: React.FC = () => {
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<ResponseRow | null>(null);
  const [editing, setEditing] = useState<ResponseRow | null>(null);
  const [editDraft, setEditDraft] = useState<{ learner_name: string; learner_email: string; answers: Record<string, any> }>({ learner_name: '', learner_email: '', answers: {} });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', new Date(to + 'T23:59:59').toISOString());
      const r = await fetch(`/api/feedback-form/responses${qs.toString() ? `?${qs}` : ''}`);
      const j = await r.json();
      if (j.success) {
        setRows(j.data);
        setSelected(new Set());
      } else {
        setError(j.error || 'Failed to load');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Reload when date filters change.
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      const hay = [
        r.course_title, r.course_code, r.course_run_code,
        r.learner_name, r.learner_email,
        r.answers?.learner_name, r.answers?.message,
      ].map(v => String(v ?? '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }, [rows, search]);

  const allChecked = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAll = () => {
    setSelected(prev => {
      if (allChecked) {
        const next = new Set(prev);
        filtered.forEach(r => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach(r => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openEdit = (r: ResponseRow) => {
    setEditing(r);
    setEditDraft({
      learner_name: r.learner_name || String(r.answers?.learner_name || ''),
      learner_email: r.learner_email || '',
      answers: { ...(r.answers || {}) },
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/feedback-form-responses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          learner_name: editDraft.learner_name,
          learner_email: editDraft.learner_email,
          answers: editDraft.answers,
        }),
      });
      const j = await r.json();
      if (!j.success) {
        setError(j.error || 'Save failed');
      } else {
        setEditing(null);
        await load();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteIds = async (ids: string[]) => {
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} response${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/feedback-form-responses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const j = await r.json();
      if (!j.success) {
        setError(j.error || 'Delete failed');
      } else {
        await load();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const COLUMNS: Array<{ key: string; label: string; get: (r: ResponseRow) => any }> = [
    { key: 'course_title', label: 'Course Title', get: r => r.course_title },
    { key: 'course_code', label: 'Course Code', get: r => r.course_code },
    { key: 'course_run_code', label: 'Run ID', get: r => r.course_run_code },
    { key: 'learner_name', label: 'Learner Name', get: r => r.learner_name || r.answers?.learner_name },
    { key: 'training_outcome', label: 'Training Outcome', get: r => r.answers?.rate_learning_objectives },
    { key: 'trainer_quality', label: 'Trainer Quality', get: r => r.answers?.rate_trainer_knowledge },
    { key: 'environment', label: 'Environment', get: r => r.answers?.rate_training_environment },
    { key: 'message', label: 'Message', get: r => r.answers?.message },
    { key: 'submitted_at', label: 'Submitted On', get: r => new Date(r.submitted_at).toLocaleString() },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-2 dark:text-white">Feedback Responses</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Public read-only API: <code>/api/feedback-form/responses</code>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-6">
            <label className="block text-xs text-gray-500 mb-1">Search</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="course, code, learner, message…"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </div>
        </div>
        {selected.size > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-300">{selected.size} selected</span>
            <button
              onClick={() => deleteIds(Array.from(selected))}
              disabled={busy}
              className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >Delete Selected</button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-lg"
            >Clear</button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No responses.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  {COLUMNS.map(c => (
                    <th key={c.key} className="text-left px-3 py-2 whitespace-nowrap">{c.label}</th>
                  ))}
                  <th className="text-left px-3 py-2 whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const checked = selected.has(r.id);
                  return (
                    <tr key={r.id} className={`border-t border-gray-200 dark:border-gray-700 align-top ${checked ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={checked} onChange={() => toggleOne(r.id)} aria-label="Select row" />
                      </td>
                      {COLUMNS.map(c => (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap">{String(c.get(r) ?? '')}</td>
                      ))}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setViewing(r)}
                            title="View JSON"
                            aria-label="View JSON"
                            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-blue-600"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                          <button
                            onClick={() => openEdit(r)}
                            title="Edit"
                            aria-label="Edit"
                            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-amber-600"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => deleteIds([r.id])}
                            disabled={busy}
                            title="Delete"
                            aria-label="Delete"
                            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-red-600 disabled:opacity-50"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold dark:text-white">Response JSON</h3>
                <p className="text-xs text-gray-500">{viewing.course_code} — {viewing.course_title} ({viewing.course_run_code})</p>
                <p className="text-xs text-gray-500">{new Date(viewing.submitted_at).toLocaleString()}</p>
              </div>
              <button onClick={() => setViewing(null)} className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white">✕</button>
            </div>
            <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded overflow-auto">{JSON.stringify(viewing, null, 2)}</pre>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !busy && setEditing(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[85vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold dark:text-white">Edit Response</h3>
                <p className="text-xs text-gray-500">{editing.course_code} — {editing.course_title} ({editing.course_run_code})</p>
              </div>
              <button onClick={() => !busy && setEditing(null)} className="p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Learner Name</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  value={editDraft.learner_name}
                  onChange={e => setEditDraft(d => ({ ...d, learner_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Learner Email</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  value={editDraft.learner_email}
                  onChange={e => setEditDraft(d => ({ ...d, learner_email: e.target.value }))}
                />
              </div>
              <div className="border-t pt-3 border-gray-200 dark:border-gray-700">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Answers</p>
                <div className="space-y-2">
                  {Object.entries(editDraft.answers).map(([k, v]) => (
                    <div key={k} className="grid grid-cols-3 gap-2 items-center">
                      <label className="text-xs text-gray-500 col-span-1 truncate" title={k}>{k}</label>
                      <input
                        className="col-span-2 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm"
                        value={String(v ?? '')}
                        onChange={e => {
                          const next = e.target.value;
                          setEditDraft(d => ({
                            ...d,
                            answers: {
                              ...d.answers,
                              [k]: typeof v === 'number' && next !== '' && !isNaN(Number(next)) ? Number(next) : next,
                            },
                          }));
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => !busy && setEditing(null)} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg">Cancel</button>
              <button onClick={saveEdit} disabled={busy} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeedbackFormResponsesView;
