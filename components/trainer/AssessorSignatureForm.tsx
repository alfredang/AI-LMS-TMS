import React, { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { SignaturePad, SignaturePadHandle } from './SignaturePad';

/**
 * The trainer's assessor block — Name, NRIC, Date and a drawn signature —
 * backed by /api/trainer/assessor-signature. Used in two places:
 *   - Trainer Profile page ("Assessor Signature" card), where the trainer
 *     saves the signature once.
 *   - Assessment Grading dialog (`AssessorSignatureDialog`), which loads the
 *     saved signature so the trainer only confirms the date before signing.
 */

export interface AssessorRecord {
  user_id: string;
  assessor_name: string;
  nric: string;
  sign_date: string; // yyyy-mm-dd
  signature_png: string | null;
  updated_at?: string;
}

/** Wording / endpoint of the signature block; the assessor variant is the default. */
export interface SignatureFormVariant {
  /** GET/POST endpoint returning { success, exists, data } */
  endpoint: string;
  nameLabel: string;
  nricLabel: string;
  /** Key of the name field in the endpoint's record (assessor_name / learner_name) */
  nameKey: string;
  /** Footnote under the form on the profile page */
  hint?: React.ReactNode;
}

export const ASSESSOR_VARIANT: SignatureFormVariant = {
  endpoint: '/api/trainer/assessor-signature',
  nameLabel: 'Assessor Name',
  nricLabel: 'Assessor NRIC',
  nameKey: 'assessor_name',
  hint: (
    <>These details are stamped onto learners&apos; submitted assessments when you tick <span className="font-semibold">SIGN</span> on the grading roster.</>
  ),
};

export const LEARNER_VARIANT: SignatureFormVariant = {
  endpoint: '/api/learner/signature',
  nameLabel: 'Name (as in NRIC)',
  nricLabel: 'NRIC',
  nameKey: 'learner_name',
};

interface Props {
  /** Pre-fill the date (e.g. the class end date) when the trainer has no saved record yet */
  defaultSignDate?: string;
  /** Hide the Date field (profile page — the date is chosen per class when signing) */
  showDate?: boolean;
  onSaved?: (record: AssessorRecord) => void;
  onCancel?: () => void;
  saveLabel?: string;
  compact?: boolean;
  variant?: SignatureFormVariant;
}

const inputClass =
  'w-full border border-strong rounded px-3 py-2 text-sm bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const AssessorSignatureForm: React.FC<Props> = ({
  defaultSignDate,
  showDate = true,
  onSaved,
  onCancel,
  saveLabel = 'Save',
  compact = false,
  variant = ASSESSOR_VARIANT,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [name, setName] = useState('');
  const [nric, setNric] = useState('');
  const [signDate, setSignDate] = useState(defaultSignDate || todayIso());
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [redrawing, setRedrawing] = useState(false);
  const [padEmpty, setPadEmpty] = useState(true);
  const padRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(variant.endpoint)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (!json?.success) throw new Error(json?.error || 'Failed to load signature details');
        const d: AssessorRecord = json.data;
        setExists(!!json.exists);
        setName((d as any)[variant.nameKey] || d.assessor_name || '');
        setNric(d.nric || '');
        // The date is the signing date, so it always resets to today (or an
        // explicit override) when the dialog opens — never the last saved value.
        setSignDate(defaultSignDate || todayIso());
        setSavedSignature(d.signature_png || null);
        setRedrawing(!d.signature_png);
      })
      .catch(e => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) { setError(`${variant.nameLabel} is required.`); return; }

    let signaturePng: string | null | undefined = undefined; // keep saved
    if (redrawing) {
      const drawn = padRef.current?.toDataURL() || null;
      if (!drawn) {
        if (savedSignature) {
          // Trainer opened the pad but drew nothing — keep the saved one.
          signaturePng = undefined;
        } else {
          setError('Please draw your signature.');
          return;
        }
      } else {
        signaturePng = drawn;
      }
    }

    setSaving(true);
    try {
      const res = await fetch(variant.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), nric: nric.trim(), signDate, signaturePng }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to save');
      const rec: AssessorRecord = { ...json.data, assessor_name: json.data?.[variant.nameKey] ?? json.data?.assessor_name ?? '' };
      setExists(true);
      setSavedSignature(rec.signature_png || null);
      setRedrawing(!rec.signature_png);
      padRef.current?.clear();
      onSaved?.(rec);
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-6">
        <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" /> Loading signature details…
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className={`grid gap-3 ${showDate ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div>
          <label className="block text-xs font-medium text-on-surface-secondary mb-1">
            {variant.nameLabel} <span className="text-danger">*</span>
          </label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="As shown on the assessment" />
        </div>
        <div>
          <label className="block text-xs font-medium text-on-surface-secondary mb-1">{variant.nricLabel}</label>
          <input type="text" value={nric} onChange={e => setNric(e.target.value.toUpperCase())} className={inputClass} placeholder="e.g. S1234567A" />
        </div>
        {showDate && (
          <div>
            <label className="block text-xs font-medium text-on-surface-secondary mb-1">Date</label>
            <input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} className={inputClass} />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-on-surface-secondary">
            Signature {!savedSignature && <span className="text-danger">*</span>}
          </label>
          <div className="flex items-center gap-2">
            {redrawing && (
              <button
                type="button"
                onClick={() => { padRef.current?.clear(); }}
                disabled={padEmpty}
                className="text-xs px-2 py-1 rounded border border-strong text-on-surface-secondary hover:bg-surface-hover disabled:opacity-40"
              >
                Clear
              </button>
            )}
            {savedSignature && (
              <button
                type="button"
                onClick={() => { setRedrawing(r => !r); setPadEmpty(true); }}
                className="text-xs px-2 py-1 rounded border border-strong text-on-surface-secondary hover:bg-surface-hover"
              >
                {redrawing ? 'Use saved signature' : 'Redraw'}
              </button>
            )}
          </div>
        </div>

        {redrawing ? (
          <>
            <SignaturePad ref={padRef} onChange={setPadEmpty} />
            <p className="text-[11px] text-muted mt-1">Sign inside the box with your mouse, trackpad, finger or pen.</p>
          </>
        ) : (
          <div className="rounded-lg border border-default bg-white p-3 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={savedSignature!} alt="Saved signature" className="max-h-24 object-contain" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-danger flex items-center gap-1">
          <Icon name={IconName.Close} className="w-3.5 h-3.5" /> {error}
        </p>
      )}

      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-2 text-sm border border-strong rounded text-on-surface-secondary hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white rounded font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {saving && <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />}
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
      {exists && !compact && variant.hint && (
        <p className="text-[11px] text-muted">{variant.hint}</p>
      )}
    </div>
  );
};

/** Modal wrapper used by the Student Grading Roster. */
export const AssessorSignatureDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (record: AssessorRecord) => void;
  defaultSignDate?: string;
}> = ({ open, onClose, onSaved, defaultSignDate }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative bg-surface rounded-2xl shadow-2xl p-6 w-full max-w-2xl mx-4" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full text-muted hover:text-on-surface hover:bg-surface-hover transition-colors"
          aria-label="Close"
        >
          <Icon name={IconName.Close} className="w-5 h-5" />
        </button>
        <h3 className="text-base font-bold text-on-surface mb-1">Assessor Sign-off</h3>
        <p className="text-xs text-muted mb-4">
          Your name, NRIC, the date and your signature are stamped into the <span className="font-semibold">Assessor</span> block of each learner&apos;s submitted assessment (PDF or Word). The signature you save here is also kept on your Trainer Profile.
        </p>
        <AssessorSignatureForm defaultSignDate={defaultSignDate} onSaved={onSaved} onCancel={onClose} saveLabel="Save & Use" compact />
      </div>
    </div>
  );
};

/** Modal wrapper for the learner's candidate block (Assessment Summary Record). */
export const LearnerSignatureDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (record: AssessorRecord) => void;
}> = ({ open, onClose, onSaved }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative bg-surface rounded-2xl shadow-2xl p-6 w-full max-w-2xl mx-4" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full text-muted hover:text-on-surface hover:bg-surface-hover transition-colors"
          aria-label="Close"
        >
          <Icon name={IconName.Close} className="w-5 h-5" />
        </button>
        <h3 className="text-base font-bold text-on-surface mb-1">Learner Signature</h3>
        <p className="text-xs text-muted mb-4">
          Your name, NRIC (only the last 3 digits and letter are printed), the date and your signature are stamped into the <span className="font-semibold">Candidate</span> block of the Assessment Summary Record. Saved once and reused for every class you sign.
        </p>
        <AssessorSignatureForm variant={LEARNER_VARIANT} showDate={false} onSaved={onSaved} onCancel={onClose} saveLabel="Save & Use" compact />
      </div>
    </div>
  );
};

export default AssessorSignatureForm;
