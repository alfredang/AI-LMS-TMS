import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import type { FeedbackFormField, FeedbackFormSection } from '../../types';

interface RunContext {
  course_run_id: string;
  course_run_code: string;
  course_title: string;
  course_code: string;
  start_date: string | null;
  end_date: string | null;
}

interface TemplatePayload {
  id: string;
  title: string;
  sections: FeedbackFormSection[];
  run_context: RunContext | null;
}

const fmtDate = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

const StarIcon: React.FC<{ className?: string; filled?: boolean }> = ({ className, filled }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const resolveAutofill = (field: FeedbackFormField, ctx: RunContext | null): string => {
  if (!ctx || !field.autofill) return '';
  switch (field.autofill) {
    case 'course_title': return ctx.course_title || '';
    case 'course_code': return ctx.course_code || '';
    case 'start_date': return fmtDate(ctx.start_date);
    case 'end_date': return fmtDate(ctx.end_date);
    default: return '';
  }
};

export default function FeedbackFormPage() {
  const router = useRouter();
  const runId = typeof router.query.runId === 'string' ? router.query.runId : '';
  const [tmpl, setTmpl] = useState<TemplatePayload | null>(null);
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    fetch(`/api/feedback-form/template?course_run_id=${encodeURIComponent(runId)}`)
      .then(r => r.json())
      .then(j => {
        if (!j.success) { setError(j.error || 'Failed to load form'); return; }
        const data: TemplatePayload = j.data;
        setTmpl(data);
        const initial: Record<string, string | number> = {};
        data.sections.forEach(s => s.fields.forEach(f => {
          initial[f.id] = resolveAutofill(f, data.run_context);
        }));
        setValues(initial);
      })
      .catch(e => setError(String(e)));
  }, [runId]);

  const learnerName = useMemo(() => {
    const f = tmpl?.sections.flatMap(s => s.fields).find(f => f.id === 'learner_name' || f.label.toLowerCase().includes('name'));
    return f ? String(values[f.id] || '') : '';
  }, [tmpl, values]);

  const learnerEmail = useMemo(() => {
    const f = tmpl?.sections.flatMap(s => s.fields).find(f => f.id === 'learner_email' || f.type === 'email');
    return f ? String(values[f.id] || '') : '';
  }, [tmpl, values]);

  const onChange = (fid: string, v: string | number) => setValues(prev => ({ ...prev, [fid]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tmpl) return;
    for (const s of tmpl.sections) {
      for (const f of s.fields) {
        if (f.required && (values[f.id] === '' || values[f.id] === undefined || values[f.id] === null)) {
          setError(`Please fill: ${f.label}`);
          return;
        }
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/feedback-form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: tmpl.id,
          course_run_id: runId,
          learner_email: learnerEmail,
          learner_name: learnerName,
          answers: values,
        }),
      });
      const j = await r.json();
      if (j.success) setDone(true);
      else setError(j.error || 'Submit failed');
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !tmpl) return <div className="max-w-2xl mx-auto p-6 text-red-600">{error}</div>;
  if (!tmpl) return <div className="max-w-2xl mx-auto p-6">Loading…</div>;

  if (done) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">Thank you!</h1>
        <p className="text-gray-600">Your feedback has been recorded.</p>
      </div>
    );
  }

  return (
    <>
      <Head><title>{tmpl.title}</title></Head>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
        <form onSubmit={submit} className="max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tmpl.title}</h1>
            {tmpl.run_context && (
              <p className="text-sm text-gray-500 mt-1">
                {tmpl.run_context.course_code} — {tmpl.run_context.course_title}
              </p>
            )}
          </div>

          {tmpl.sections.map(section => (
            <div key={section.id} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 border-b pb-1">{section.title}</h2>
              {section.fields.map(field => (
                <FieldInput
                  key={field.id}
                  field={field}
                  value={values[field.id] ?? ''}
                  onChange={v => onChange(field.id, v)}
                />
              ))}
            </div>
          ))}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </form>
      </div>
    </>
  );
}

const FieldInput: React.FC<{
  field: FeedbackFormField;
  value: string | number;
  onChange: (v: string | number) => void;
}> = ({ field, value, onChange }) => {
  const base = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white';
  const labelEl = (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      {field.label}{field.required && <span className="text-red-500"> *</span>}
    </label>
  );

  if (field.type === 'rating1to5') {
    return (
      <div>
        {labelEl}
        <div className="mt-3">
          <div className="flex flex-nowrap items-center justify-between sm:justify-start sm:gap-12">
            {[1, 2, 3, 4, 5].map(n => {
              const current = Number(value);
              const filled = current >= n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChange(n)}
                  className="flex flex-col items-center gap-1 group focus:outline-none flex-shrink-0"
                  aria-label={`Rate ${n} out of 5`}
                >
                  <StarIcon className={`w-9 h-9 sm:w-11 sm:h-11 transition-colors ${filled ? 'text-yellow-400' : 'text-gray-300 group-hover:text-yellow-300'}`} filled={filled} />
                  <span className={`text-xs font-medium ${current === n ? 'text-yellow-500' : 'text-gray-500'}`}>{n}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2">1 = Poor, 5 = Best</p>
        </div>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div>
        {labelEl}
        <textarea
          className={base}
          rows={4}
          value={String(value)}
          required={field.required}
          readOnly={field.readonly}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        {labelEl}
        <select
          className={base}
          value={String(value)}
          required={field.required}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">— Select —</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  const htmlType = field.type === 'email' ? 'email' : field.type === 'date' ? 'date' : 'text';
  return (
    <div>
      {labelEl}
      <input
        type={htmlType}
        className={`${base} ${field.readonly ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
        value={String(value)}
        required={field.required}
        readOnly={field.readonly}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
};
