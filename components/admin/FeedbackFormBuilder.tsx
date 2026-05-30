import React, { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import type { FeedbackFormField, FeedbackFormSection, FeedbackFormTemplate } from '@app-types';

const FIELD_TYPES: FeedbackFormField['type'][] = ['text', 'email', 'date', 'textarea', 'select', 'rating1to5'];
const AUTOFILL_OPTIONS: Array<{ value: '' | NonNullable<FeedbackFormField['autofill']>; label: string }> = [
  { value: '', label: 'None' },
  { value: 'course_title', label: 'Course Title' },
  { value: 'course_code', label: 'Course Code' },
  { value: 'start_date', label: 'Start Date' },
  { value: 'end_date', label: 'End Date' },
];

const newId = () => Math.random().toString(36).slice(2, 10);

const StarIcon: React.FC<{ className?: string; filled?: boolean }> = ({ className, filled }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const PreviewField: React.FC<{ field: FeedbackFormField }> = ({ field }) => {
  const base = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm';
  const sample: Record<NonNullable<FeedbackFormField['autofill']>, string> = {
    course_title: 'Sample Course Title',
    course_code: 'TGS-XXXXXXX',
    start_date: '2026-01-15',
    end_date: '2026-01-16',
  };
  const placeholder = field.autofill ? sample[field.autofill] : '';
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}{field.required && <span className="text-red-500"> *</span>}
      </label>
      {field.type === 'rating1to5' ? (
        <div className="flex flex-wrap items-center gap-10 sm:gap-14 mt-3">
          {[1, 2, 3, 4, 5].map(n => (
            <div key={n} className="flex flex-col items-center gap-1.5">
              <StarIcon className="w-11 h-11 text-gray-300" />
              <span className="text-xs font-medium text-gray-500">{n}</span>
            </div>
          ))}
          <span className="text-xs text-gray-500 ml-2">1 = Poor, 5 = Best</span>
        </div>
      ) : field.type === 'textarea' ? (
        <textarea className={base} rows={3} disabled placeholder={placeholder} />
      ) : field.type === 'select' ? (
        <select className={base} disabled><option>{(field.options || ['Option A'])[0]}</option></select>
      ) : (
        <input
          type={field.type === 'email' ? 'email' : field.type === 'date' ? 'date' : 'text'}
          className={`${base} ${field.readonly ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
          disabled
          defaultValue={field.type === 'date' && field.autofill ? sample[field.autofill] : ''}
          placeholder={placeholder}
        />
      )}
    </div>
  );
};

export const FeedbackFormBuilder: React.FC = () => {
  const [template, setTemplate] = useState<FeedbackFormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/feedback-form-template')
      .then(r => r.json())
      .then(j => {
        if (j.success) setTemplate(j.data);
        else setStatus(j.error || 'Failed to load');
      })
      .catch(e => setStatus(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Card className="p-6">Loading…</Card>;
  if (!template) return <Card className="p-6">No template available. {status}</Card>;

  const updateSections = (updater: (sections: FeedbackFormSection[]) => FeedbackFormSection[]) =>
    setTemplate(prev => prev && { ...prev, sections: updater(prev.sections) });

  const addSection = () =>
    updateSections(s => [...s, { id: `section-${newId()}`, title: 'New Section', fields: [] }]);

  const removeSection = (sid: string) => updateSections(s => s.filter(x => x.id !== sid));

  const moveSection = (idx: number, dir: -1 | 1) =>
    updateSections(s => {
      const next = [...s];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return s;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

  const updateSection = (sid: string, patch: Partial<FeedbackFormSection>) =>
    updateSections(s => s.map(x => (x.id === sid ? { ...x, ...patch } : x)));

  const addField = (sid: string) =>
    updateSection(sid, undefined as any); // placeholder, real work below

  const fieldMutator = (sid: string) => ({
    add: () =>
      updateSections(s =>
        s.map(x =>
          x.id === sid
            ? { ...x, fields: [...x.fields, { id: `field-${newId()}`, label: 'New question', type: 'text' as const, required: false }] }
            : x
        )
      ),
    remove: (fid: string) =>
      updateSections(s => s.map(x => (x.id === sid ? { ...x, fields: x.fields.filter(f => f.id !== fid) } : x))),
    update: (fid: string, patch: Partial<FeedbackFormField>) =>
      updateSections(s =>
        s.map(x =>
          x.id === sid
            ? { ...x, fields: x.fields.map(f => (f.id === fid ? { ...f, ...patch } : f)) }
            : x
        )
      ),
    move: (idx: number, dir: -1 | 1) =>
      updateSections(s =>
        s.map(x => {
          if (x.id !== sid) return x;
          const fields = [...x.fields];
          const target = idx + dir;
          if (target < 0 || target >= fields.length) return x;
          [fields[idx], fields[target]] = [fields[target], fields[idx]];
          return { ...x, fields };
        })
      ),
  });

  const save = async () => {
    if (!template) return;
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch('/api/admin/feedback-form-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: template.title, sections: template.sections, is_active: template.is_active ?? true }),
      });
      const j = await r.json();
      if (j.success) {
        setTemplate(j.data);
        setStatus('Saved.');
      } else {
        setStatus(j.error || 'Save failed');
      }
    } catch (e) {
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`grid grid-cols-1 ${showPreview ? 'xl:grid-cols-2' : ''} gap-4`}>
      <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-2xl font-bold mb-2 dark:text-white">Feedback Form Builder</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Customize the in-app learner feedback form. Fields with autofill resolve from the class context.
            </p>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Form Title</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              value={template.title}
              onChange={e => setTemplate(prev => prev && { ...prev, title: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button onClick={addSection} variant="secondary">+ Section</Button>
            <Button onClick={() => setShowPreview(p => !p)} variant="outline">{showPreview ? 'Hide Preview' : 'Show Preview'}</Button>
          </div>
        </div>
        {status && <p className="mt-3 text-sm text-blue-600">{status}</p>}
      </Card>

      {template.sections.map((section, sIdx) => {
        const fm = fieldMutator(section.id);
        return (
          <Card key={section.id} className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <input
                className="flex-1 text-lg font-semibold px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                value={section.title}
                onChange={e => updateSection(section.id, { title: e.target.value })}
              />
              <button onClick={() => moveSection(sIdx, -1)} className="px-2 py-1 text-sm text-gray-500 hover:text-blue-600" aria-label="Move section up">↑</button>
              <button onClick={() => moveSection(sIdx, 1)} className="px-2 py-1 text-sm text-gray-500 hover:text-blue-600" aria-label="Move section down">↓</button>
              <button onClick={() => removeSection(section.id)} className="p-2 text-gray-500 hover:text-red-600" aria-label="Remove section">
                <Icon name={IconName.Delete} className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {section.fields.map((field, fIdx) => (
                <div key={field.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                  <div className="md:col-span-5">
                    <label className="block text-xs text-gray-500 mb-1">Label</label>
                    <input
                      className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm"
                      value={field.label}
                      onChange={e => fm.update(field.id, { label: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Type</label>
                    <select
                      className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm"
                      value={field.type}
                      onChange={e => fm.update(field.id, { type: e.target.value as FeedbackFormField['type'] })}
                    >
                      {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Autofill</label>
                    <select
                      className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm"
                      value={field.autofill || ''}
                      onChange={e => fm.update(field.id, { autofill: (e.target.value || null) as any })}
                    >
                      {AUTOFILL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-1 flex items-center pt-4">
                    <label className="flex items-center text-xs text-gray-500 gap-1">
                      <input
                        type="checkbox"
                        checked={!!field.required}
                        onChange={e => fm.update(field.id, { required: e.target.checked })}
                      />
                      Req
                    </label>
                  </div>
                  <div className="md:col-span-2 flex gap-1 justify-end">
                    <button onClick={() => fm.move(fIdx, -1)} className="px-2 py-0.5 text-sm text-gray-500 hover:text-blue-600" aria-label="Move up">↑</button>
                    <button onClick={() => fm.move(fIdx, 1)} className="px-2 py-0.5 text-sm text-gray-500 hover:text-blue-600" aria-label="Move down">↓</button>
                    <button onClick={() => fm.remove(field.id)} className="p-1 text-gray-500 hover:text-red-600" aria-label="Remove">
                      <Icon name={IconName.Delete} className="w-4 h-4" />
                    </button>
                  </div>
                  {field.type === 'select' && (
                    <div className="md:col-span-12">
                      <label className="block text-xs text-gray-500 mb-1">Options (comma separated)</label>
                      <input
                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm"
                        value={(field.options || []).join(', ')}
                        onChange={e => fm.update(field.id, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3">
              <Button onClick={fm.add} variant="secondary">+ Field</Button>
            </div>
          </Card>
        );
      })}
      </div>

      {showPreview && (
        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold dark:text-white">Live Preview</h3>
              <span className="text-xs text-gray-500">As the learner sees it</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{template.title}</p>
            <div className="space-y-5">
              {template.sections.map(section => (
                <div key={section.id} className="space-y-3">
                  <h4 className="text-base font-semibold text-gray-800 dark:text-gray-100 border-b pb-1">{section.title}</h4>
                  {section.fields.map(f => <PreviewField key={f.id} field={f} />)}
                  {section.fields.length === 0 && <p className="text-xs text-gray-400">No fields in this section.</p>}
                </div>
              ))}
              <button type="button" disabled className="w-full bg-blue-600 text-white font-medium py-2.5 rounded-lg opacity-70">Submit Feedback</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default FeedbackFormBuilder;
