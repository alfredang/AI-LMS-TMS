import React, { useCallback, useEffect, useState } from 'react';

interface TemplatePayload {
  section: string;
  label: string;
  default: string;
  custom: string | null;
  placeholders: string[];
  updatedAt: string | null;
}

interface Props {
  section: string;
}

// Collapsible prompt template editor. Mirrors the Streamlit `st.expander(
// "Prompt Template")` pattern: section-specific textarea, placeholder hint,
// explicit Save (persists to cp_prompt_template table) and Reset to default.
const CpPromptTemplateEditor: React.FC<Props> = ({ section }) => {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [payload, setPayload] = useState<TemplatePayload | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/developer/cp-templates');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load templates');
      const match = (data.sections as TemplatePayload[]).find(s => s.section === section);
      if (!match) throw new Error(`Section "${section}" not found in template list`);
      setPayload(match);
      setDraft(match.custom ?? match.default);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!payload) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const res = await fetch('/api/developer/cp-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, template: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save template');
      setStatus(data.reverted ? 'Reverted to default' : 'Saved');
      await load();
      setTimeout(() => setStatus(''), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!payload) return;
    if (!window.confirm('Reset this prompt to the built-in default? Your saved edits will be deleted.')) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const res = await fetch('/api/developer/cp-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, template: '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset template');
      setStatus('Reverted to default');
      await load();
      setTimeout(() => setStatus(''), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const dirty = payload ? draft !== (payload.custom ?? payload.default) : false;
  const isCustomised = payload ? payload.custom !== null && payload.custom !== payload.default : false;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
      >
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>Prompt Template</span>
        {isCustomised && (
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 uppercase tracking-wider font-semibold">
            Customised
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {loading ? (
            <p className="text-sm text-gray-500">Loading template…</p>
          ) : payload ? (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Edit the prompt template used for generation. Placeholders:{' '}
                {payload.placeholders.map((p, i) => (
                  <React.Fragment key={p}>
                    <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-emerald-700 dark:text-emerald-300 font-mono text-[11px]">{`{${p}}`}</code>
                    {i < payload.placeholders.length - 1 ? ', ' : ''}
                  </React.Fragment>
                ))}
              </p>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={Math.min(20, Math.max(10, draft.split('\n').length + 1))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs font-mono leading-relaxed focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Template'}
                </button>
                <button
                  onClick={handleReset}
                  disabled={saving || !isCustomised}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors"
                >
                  Reset to Default
                </button>
                {payload.updatedAt && (
                  <span className="text-[11px] text-gray-400">
                    Last saved {new Date(payload.updatedAt).toLocaleString()}
                  </span>
                )}
                {status && <span className="text-xs text-emerald-600 dark:text-emerald-400">{status}</span>}
              </div>
            </>
          ) : null}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
};

export default CpPromptTemplateEditor;
