import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { authHeader } from '@lib/auth/authHeader';

export interface PayrollTrainer {
  id: string;
  full_name: string;
  email: string;
  common_name: string | null;
  is_active: boolean;
}

export interface TrainerPickerValue {
  name: string;
  trainerId: string | null;
  /** The class belongs to nobody with an account — do not match on the name. */
  unlinked: boolean;
}

/**
 * Trainer field for a non-WSQ class: a name box that also links the class to a
 * real trainer ACCOUNT.
 *
 * It is not a plain <select>, because not every non-WSQ class is taught by
 * somebody with an LMS account — associates and one-off external trainers are
 * normal here, and a picker that refused them would make the form unusable.
 * So a typed name is always accepted; picking from the list is what adds the
 * link on top.
 *
 * The link is worth showing, which is why this reports its own state under the
 * field. It decides whether the class appears in the trainer's own payout
 * history and counts towards the total on their card, and being invisible was
 * exactly how the original free-text field went wrong: it looked filled in and
 * complete while the class was reaching nobody.
 *
 * A match can also be REFUSED. A typed name that fits exactly one trainer is
 * linked automatically (the server does the same match on save), which is right
 * nearly always and wrong when two people share a name — one on staff, one a
 * freelancer. Showing the match without offering a way out would just move the
 * silent error somewhere visible, so "Not them" turns it off for this class.
 */
const TrainerPicker: React.FC<{
  name: string;
  trainerId: string | null;
  unlinked: boolean;
  onChange: (next: TrainerPickerValue) => void;
  inputClassName?: string;
  id?: string;
}> = ({ name, trainerId, unlinked, onChange, inputClassName, id = 'mc-trainer' }) => {
  const [trainers, setTrainers] = useState<PayrollTrainer[]>([]);
  // Distinguishes "still loading" from "loaded, and there are none" — without
  // it an empty list would claim every typed name is unmatched.
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/payroll/trainers', { headers: { ...authHeader() } });
        const j = await r.json();
        if (!alive) return;
        if (j.success) setTrainers(j.data.trainers || []);
        else setLoadFailed(true);
      } catch {
        if (alive) setLoadFailed(true);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const matches = useMemo(() => {
    const q = name.trim().toLowerCase();
    const list = q
      ? trainers.filter(
          (t) =>
            t.full_name.toLowerCase().includes(q) ||
            (t.common_name || '').toLowerCase().includes(q) ||
            t.email.toLowerCase().includes(q)
        )
      : trainers;
    // Capped: the dropdown is for narrowing down, not for browsing every
    // trainer on file.
    return list.slice(0, 8);
  }, [trainers, name]);

  const linked = trainerId ? trainers.find((t) => t.id === trainerId) || null : null;

  /**
   * A typed name that is exactly one trainer's name links itself on save — the
   * server does the same match (lib/payroll/resolveTrainer.ts), so saying so
   * here keeps the field honest about what is about to happen.
   */
  const autoMatch = useMemo(() => {
    if (linked || unlinked || !loaded) return null;
    const q = name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) return null;
    const exact = trainers.filter(
      (t) =>
        t.full_name.trim().toLowerCase().replace(/\s+/g, ' ') === q ||
        (t.common_name || '').trim().toLowerCase().replace(/\s+/g, ' ') === q
    );
    return exact.length === 1 ? exact[0] : null;
  }, [trainers, name, linked, unlinked, loaded]);

  const shown = linked || autoMatch;

  const pick = (t: PayrollTrainer) => {
    onChange({ name: t.full_name, trainerId: t.id, unlinked: false });
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        type="text"
        autoComplete="off"
        value={name}
        // Typing breaks an existing link, and clears a refusal: the name in the
        // box would otherwise keep pointing at whoever was picked before it was
        // edited, and a new name deserves to be matched afresh.
        onChange={(e) => { onChange({ name: e.target.value, trainerId: null, unlinked: false }); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search a trainer, or type a name"
        className={inputClassName}
      />

      {open && matches.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-default rounded-md shadow-lg">
          {matches.map((t) => (
            <button
              key={t.id}
              type="button"
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={(e) => { e.preventDefault(); pick(t); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-primary/10 flex items-center justify-between gap-2 ${
                t.id === trainerId ? 'bg-primary/10 font-medium' : ''
              }`}
            >
              <span className="min-w-0">
                <span className="block text-ellipsis overflow-hidden whitespace-nowrap text-on-surface">{t.full_name}</span>
                <span className="block text-ellipsis overflow-hidden whitespace-nowrap text-[11px] text-on-surface-secondary">{t.email}</span>
              </span>
              {!t.is_active && (
                <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-on-surface-secondary">
                  Inactive
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Whether this class will reach the trainer's own payout history. */}
      {name.trim() !== '' && (
        <p className="mt-1 text-[11px] leading-relaxed">
          {unlinked ? (
            <span className="inline-flex items-start gap-1 text-on-surface-secondary">
              <Icon name={IconName.Close} className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>
                Kept unlinked — the payout is recorded, but it won&apos;t appear in any trainer&apos;s
                history.{' '}
                <button
                  type="button"
                  onClick={() => onChange({ name, trainerId: null, unlinked: false })}
                  className="font-semibold text-primary hover:underline"
                >
                  Undo
                </button>
              </span>
            </span>
          ) : shown ? (
            <span className="inline-flex items-start gap-1 text-emerald-700 dark:text-emerald-400">
              <Icon name={IconName.CheckCircle} className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>
                Linked to {shown.full_name} ({shown.email}) — this class shows in their payout
                history.{' '}
                {/* The escape hatch for a shared name. */}
                <button
                  type="button"
                  onClick={() => onChange({ name, trainerId: null, unlinked: true })}
                  className="font-semibold text-primary hover:underline"
                >
                  Not them
                </button>
              </span>
            </span>
          ) : loadFailed ? (
            <span className="inline-flex items-start gap-1 text-on-surface-secondary">
              <Icon name={IconName.Warning} className="w-3 h-3 flex-shrink-0 mt-0.5" />
              Trainer list unavailable — the name will be matched to an account when you save.
            </span>
          ) : (
            <span className="inline-flex items-start gap-1 text-amber-700 dark:text-amber-400">
              <Icon name={IconName.Warning} className="w-3 h-3 flex-shrink-0 mt-0.5" />
              Not linked to an account — the payout is recorded, but it won&apos;t appear in the
              trainer&apos;s own history. Pick them from the list if they have one.
            </span>
          )}
        </p>
      )}
    </div>
  );
};

export default TrainerPicker;
