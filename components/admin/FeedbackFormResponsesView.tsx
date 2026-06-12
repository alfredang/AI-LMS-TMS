import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';

interface ResponseRow {
  id: string;
  course_run_code?: string;
  course_title?: string;
  course_code?: string;
  trainer_name?: string;
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
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

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
        r.course_title, r.course_code, r.course_run_code, r.trainer_name,
        r.learner_name, r.learner_email,
        r.answers?.learner_name, r.answers?.message,
      ].map(v => String(v ?? '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }, [rows, search]);

  useEffect(() => { setPage(1); }, [search, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  const allChecked = paginated.length > 0 && paginated.every(r => selected.has(r.id));
  const toggleAll = () => {
    setSelected(prev => {
      if (allChecked) {
        const next = new Set(prev);
        paginated.forEach(r => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      paginated.forEach(r => next.add(r.id));
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

  const COLUMNS: Array<{ key: string; label: string; get: (r: ResponseRow) => any; cellClass?: string }> = [
    { key: 'course_title', label: 'Course Title', get: r => r.course_title },
    { key: 'course_code', label: 'Course Code', get: r => r.course_code },
    { key: 'course_run_code', label: 'Run ID', get: r => r.course_run_code },
    { key: 'trainer_name', label: 'Trainer Name', get: r => r.trainer_name },
    { key: 'learner_name', label: 'Learner Name', get: r => r.learner_name || r.answers?.learner_name },
    { key: 'training_outcome', label: 'Training Outcome', get: r => r.answers?.rate_learning_objectives },
    { key: 'trainer_quality', label: 'Trainer Quality', get: r => r.answers?.rate_trainer_knowledge },
    { key: 'environment', label: 'Environment', get: r => r.answers?.rate_training_environment },
    { key: 'message', label: 'Message', get: r => r.answers?.message, cellClass: 'max-w-[200px] truncate' },
    { key: 'submitted_at', label: 'Submitted On', get: r => new Date(r.submitted_at).toLocaleString() },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="text-2xl font-bold mb-2 dark:text-white">Feedback Responses</h2>
        {(() => {
          // Build the absolute URL from the current origin so external scripts
          // can copy it directly. Works for any tenant deployment (Tertiary,
          // Chariot, Intellisoft, previews, etc.) without hardcoding a domain.
          const apiUrl = typeof window !== 'undefined'
            ? `${window.location.origin.replace(/\/$/, '')}/api/feedback-form/responses`
            : '/api/feedback-form/responses';
          return (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 flex flex-wrap items-center gap-2">
              <span>Public read-only API:</span>
              <code className="font-mono text-gray-700 dark:text-gray-200 break-all">{apiUrl}</code>
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(apiUrl);
                  }
                }}
                className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Copy
              </button>
            </p>
          );
        })()}
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
                {paginated.map(r => {
                  const checked = selected.has(r.id);
                  return (
                    <tr key={r.id} className={`border-t border-gray-200 dark:border-gray-700 align-top ${checked ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={checked} onChange={() => toggleOne(r.id)} aria-label="Select row" />
                      </td>
                      {COLUMNS.map(c => {
                        const val = String(c.get(r) ?? '');
                        return (
                          <td
                            key={c.key}
                            className={`px-3 py-2 ${c.cellClass ?? 'whitespace-nowrap'}`}
                            title={c.cellClass ? val : undefined}
                          >
                            {val}
                          </td>
                        );
                      })}
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
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-sm">
            <span className="text-gray-600 dark:text-gray-300">
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={safePage === 1}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-40"
              >« First</button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-40"
              >‹ Prev</button>
              <span className="text-gray-600 dark:text-gray-300">
                Page {safePage} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-40"
              >Next ›</button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={safePage === totalPages}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-40"
              >Last »</button>
            </div>
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
                  {(() => {
                    const PREFERRED_ORDER = [
                      'course_title', 'course_code', 'learner_name', 'start_date', 'end_date',
                      'rate_learning_objectives', 'rate_trainer_knowledge', 'rate_training_environment',
                    ];
                    const keys = Object.keys(editDraft.answers);
                    const ordered = [
                      ...PREFERRED_ORDER.filter(k => keys.includes(k)),
                      ...keys.filter(k => !PREFERRED_ORDER.includes(k) && k !== 'message'),
                      ...(keys.includes('message') ? ['message'] : []),
                    ];
                    return ordered.map(k => {
                      const v = editDraft.answers[k];
                      const isMessage = k === 'message';
                      const onChange = (next: string) =>
                        setEditDraft(d => ({
                          ...d,
                          answers: {
                            ...d.answers,
                            [k]: typeof v === 'number' && next !== '' && !isNaN(Number(next)) ? Number(next) : next,
                          },
                        }));
                      return (
                        <div key={k} className={`grid grid-cols-3 gap-2 ${isMessage ? 'items-start' : 'items-center'}`}>
                          <label className="text-xs text-gray-500 col-span-1 truncate pt-2" title={k}>{k}</label>
                          {isMessage ? (
                            <textarea
                              rows={4}
                              className="col-span-2 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm"
                              value={String(v ?? '')}
                              onChange={e => onChange(e.target.value)}
                            />
                          ) : (
                            <input
                              className="col-span-2 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm"
                              value={String(v ?? '')}
                              onChange={e => onChange(e.target.value)}
                            />
                          )}
                        </div>
                      );
                    });
                  })()}
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
