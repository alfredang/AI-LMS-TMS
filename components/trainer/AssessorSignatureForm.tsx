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

interface Props {
  /** Pre-fill the date (e.g. the class end date) when the trainer has no saved record yet */
  defaultSignDate?: string;
  /** Hide the Date field (profile page — the date is chosen per class when signing) */
  showDate?: boolean;
  onSaved?: (record: AssessorRecord) => void;
  onCancel?: () => void;
  saveLabel?: string;
  compact?: boolean;
}

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';

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
    fetch('/api/trainer/assessor-signature')
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (!json?.success) throw new Error(json?.error || 'Failed to load assessor details');
        const d: AssessorRecord = json.data;
        setExists(!!json.exists);
        setName(d.assessor_name || '');
        setNric(d.nric || '');
        // A saved date is the trainer's last choice; a fresh record takes the class date.
        setSignDate(json.exists && d.sign_date ? d.sign_date : (defaultSignDate || todayIso()));
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
    if (!name.trim()) { setError('Assessor name is required.'); return; }

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
      const res = await fetch('/api/trainer/assessor-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), nric: nric.trim(), signDate, signaturePng }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to save');
      const rec: AssessorRecord = json.data;
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
      <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
        <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" /> Loading assessor details…
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className={`grid gap-3 ${showDate ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Assessor Name <span className="text-red-500">*</span>
          </label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="As shown on the assessment" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Assessor NRIC</label>
          <input type="text" value={nric} onChange={e => setNric(e.target.value.toUpperCase())} className={inputClass} placeholder="e.g. S1234567A" />
        </div>
        {showDate && (
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
            <input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} className={inputClass} />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Signature {!savedSignature && <span className="text-red-500">*</span>}
          </label>
          <div className="flex items-center gap-2">
            {redrawing && (
              <button
                type="button"
                onClick={() => { padRef.current?.clear(); }}
                disabled={padEmpty}
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                Clear
              </button>
            )}
            {savedSignature && (
              <button
                type="button"
                onClick={() => { setRedrawing(r => !r); setPadEmpty(true); }}
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {redrawing ? 'Use saved signature' : 'Redraw'}
              </button>
            )}
          </div>
        </div>

        {redrawing ? (
          <>
            <SignaturePad ref={padRef} onChange={setPadEmpty} />
            <p className="text-[11px] text-gray-400 mt-1">Sign inside the box with your mouse, trackpad, finger or pen.</p>
          </>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white p-3 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={savedSignature!} alt="Saved signature" className="max-h-24 object-contain" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <Icon name={IconName.Close} className="w-3.5 h-3.5" /> {error}
        </p>
      )}

      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
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
      {exists && !compact && (
        <p className="text-[11px] text-gray-400">
          These details are stamped onto learners&apos; submitted assessments when you tick <span className="font-semibold">SIG</span> on the grading roster.
        </p>
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
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-2xl mx-4" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Close"
        >
          <Icon name={IconName.Close} className="w-5 h-5" />
        </button>
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">Assessor Sign-off</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Your name, NRIC, the date and your signature are stamped into the <span className="font-semibold">Assessor</span> block of each learner&apos;s submitted assessment (PDF or Word). The signature you save here is also kept on your Trainer Profile.
        </p>
        <AssessorSignatureForm defaultSignDate={defaultSignDate} onSaved={onSaved} onCancel={onClose} saveLabel="Save & Use" compact />
      </div>
    </div>
  );
};

export default AssessorSignatureForm;
