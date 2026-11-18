import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { getApiUrl } from '@/lib/urlHelpers';
import type { AdminTrainerRow } from '@/lib/trainers/adminTrainerRow';

const inputClass = 'w-full px-3 py-2 text-sm border border-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400';
const labelClass = 'block mb-1 text-xs font-medium text-on-surface-secondary';

const ChipInput: React.FC<{
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  suggestions?: string[];
}> = ({ id, values, onChange, placeholder, suggestions }) => {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const parts = draft.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) {
      const lower = new Set(values.map(v => v.toLowerCase()));
      onChange([...values, ...parts.filter(p => !lower.has(p.toLowerCase()))]);
    }
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border border-strong rounded-lg focus-within:ring-2 focus-within:ring-blue-500 dark:bg-gray-700">
      {values.map(v => (
        <span key={v} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs font-medium text-primary bg-info-bg rounded-full">
          {v}
          <button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="rounded-full hover:bg-blue-100 dark:hover:bg-blue-800" aria-label={`Remove ${v}`}>
            <Icon name={IconName.Close} className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        list={suggestions ? `${id}-suggestions` : undefined}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={commit}
        placeholder={values.length ? '' : placeholder}
        className="flex-1 min-w-[8rem] py-0.5 text-sm bg-transparent border-0 outline-none focus:ring-0 dark:text-white dark:placeholder-gray-400"
      />
      {suggestions && (
        <datalist id={`${id}-suggestions`}>
          {suggestions.filter(s => !values.includes(s)).map(s => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; htmlFor: string; children: React.ReactNode; className?: string }> = ({ label, htmlFor, children, className }) => (
  <div className={className}>
    <label htmlFor={htmlFor} className={labelClass}>{label}</label>
    {children}
  </div>
);

interface Props {
  trainer: AdminTrainerRow;
  domainSuggestions: string[];
  countrySuggestions: string[];
  onClose: () => void;
  onSaved: (trainer: AdminTrainerRow) => void;
}

const SearchTrainersEditModal: React.FC<Props> = ({ trainer, domainSuggestions, countrySuggestions, onClose, onSaved }) => {
  const [form, setForm] = useState({
    full_name: trainer.full_name || '',
    common_name: trainer.common_name || '',
    tel: trainer.tel || '',
    secondary_email: trainer.secondary_email || '',
    cn_plus_email: trainer.cn_plus_email || '',
    dob: trainer.dob || '',
    gender: trainer.gender || '',
    nationality: trainer.nationality || '',
    country: trainer.country || '',
    ethnicity: trainer.ethnicity || '',
    new_nric: '',
    trainer_type: trainer.trainer_type || '',
    linkedin_url: trainer.linkedin_url || '',
    education: trainer.education || '',
  });
  const [domains, setDomains] = useState(trainer.domains);
  const [skills, setSkills] = useState(trainer.skills);
  const [certifications, setCertifications] = useState(trainer.certifications);
  const [qualifications, setQualifications] = useState(trainer.qualifications);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(getApiUrl('/api/admin/update-trainer-details'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainerId: trainer.id, details: { ...form, domains, skills, certifications, qualifications } }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Failed to save');
      onSaved(data.data.trainer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => !saving && onClose()}>
      <div className="flex flex-col w-full max-w-3xl max-h-[92vh] bg-surface shadow-2xl rounded-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-default">
          <div>
            <h3 className="text-lg font-bold text-on-surface">Edit Trainer</h3>
            <p className="text-sm text-muted">Login email: {trainer.email || '—'}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="text-muted hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close">
            <Icon name={IconName.Close} className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 px-6 py-5 space-y-6 overflow-y-auto">
          <section>
            <h4 className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Contact</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name *" htmlFor="et-name"><input id="et-name" className={inputClass} value={form.full_name} onChange={set('full_name')} /></Field>
              <Field label="Common name" htmlFor="et-common"><input id="et-common" className={inputClass} value={form.common_name} onChange={set('common_name')} /></Field>
              <Field label="Phone *" htmlFor="et-tel"><input id="et-tel" type="tel" className={inputClass} value={form.tel} onChange={set('tel')} /></Field>
              <Field label="Secondary email" htmlFor="et-sec"><input id="et-sec" type="email" className={inputClass} value={form.secondary_email} onChange={set('secondary_email')} /></Field>
              <Field label="CN Plus email" htmlFor="et-cn"><input id="et-cn" type="email" className={inputClass} value={form.cn_plus_email} onChange={set('cn_plus_email')} /></Field>
              <Field label="LinkedIn URL" htmlFor="et-li"><input id="et-li" className={inputClass} value={form.linkedin_url} onChange={set('linkedin_url')} placeholder="linkedin.com/in/..." /></Field>
            </div>
          </section>

          <section>
            <h4 className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Personal</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Date of birth" htmlFor="et-dob"><input id="et-dob" type="date" className={inputClass} value={form.dob} onChange={set('dob')} /></Field>
              <Field label="Gender *" htmlFor="et-gender">
                <select id="et-gender" className={inputClass} value={form.gender} onChange={set('gender')}>
                  <option value="">Select…</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </Field>
              <Field label="Country" htmlFor="et-country">
                <input id="et-country" list="et-country-list" className={inputClass} value={form.country} onChange={set('country')} placeholder="e.g. Singapore" />
                <datalist id="et-country-list">{countrySuggestions.map(c => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="Nationality" htmlFor="et-nat"><input id="et-nat" className={inputClass} value={form.nationality} onChange={set('nationality')} /></Field>
              <Field label="Ethnicity" htmlFor="et-eth"><input id="et-eth" className={inputClass} value={form.ethnicity} onChange={set('ethnicity')} /></Field>
              <Field label="NRIC" htmlFor="et-nric">
                <input id="et-nric" className={`${inputClass} font-mono uppercase`} value={form.new_nric} onChange={set('new_nric')}
                  placeholder={trainer.nric_masked ? `Leave blank to keep ${trainer.nric_masked}` : 'e.g. S1234567A'} />
              </Field>
            </div>
          </section>

          <section>
            <h4 className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Expertise</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Trainer type *" htmlFor="et-type">
                <select id="et-type" className={inputClass} value={form.trainer_type} onChange={set('trainer_type')}>
                  <option value="">Select…</option>
                  <option value="ACLP">ACLP</option>
                  <option value="non-ACLP">non-ACLP</option>
                  <option value="DACE">DACE</option>
                </select>
              </Field>
              <div className="hidden sm:block" />
              <Field label="Domains" htmlFor="et-domains" className="sm:col-span-2">
                <ChipInput id="et-domains" values={domains} onChange={setDomains} placeholder="Type a domain and press Enter" suggestions={domainSuggestions} />
              </Field>
              <Field label="Skill sets" htmlFor="et-skills" className="sm:col-span-2">
                <ChipInput id="et-skills" values={skills} onChange={setSkills} placeholder="Type a skill and press Enter" />
              </Field>
              <Field label="Certifications" htmlFor="et-certs" className="sm:col-span-2">
                <ChipInput id="et-certs" values={certifications} onChange={setCertifications} placeholder="Type a certification and press Enter" />
              </Field>
              <Field label="Qualifications" htmlFor="et-quals" className="sm:col-span-2">
                <ChipInput id="et-quals" values={qualifications} onChange={setQualifications} placeholder="Type a qualification and press Enter" />
              </Field>
              <Field label="Education" htmlFor="et-edu" className="sm:col-span-2">
                <textarea id="et-edu" rows={3} className={inputClass} value={form.education} onChange={set('education')} />
              </Field>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-default">
          <p className="text-sm text-danger">{error}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchTrainersEditModal;
