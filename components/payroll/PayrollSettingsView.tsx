import React, { useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import { PayoutTier, estimatedPayout, validateTiers } from '@lib/payroll/calculate';
import { authHeader } from '@lib/auth/authHeader';

const fmtCurrency = (n: number) =>
  n.toLocaleString('en-SG', { style: 'currency', currency: 'SGD' });

const tierRangeLabel = (t: PayoutTier) => {
  if (t.maxPax === null || t.maxPax === undefined) return `${t.minPax}+ pax`;
  if (t.maxPax === t.minPax) return `${t.minPax} pax`;
  return `${t.minPax}–${t.maxPax} pax`;
};

const PayrollSettingsView: React.FC = () => {
  const [tiers, setTiers] = useState<PayoutTier[]>([]);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Calculator inputs
  const [calcPax, setCalcPax] = useState<number>(4);
  const [calcFee, setCalcFee] = useState<number>(300);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/payroll/tiers', { headers: { ...authHeader() } });
      const j = await r.json();
      if (j.success) {
        setTiers(j.data.tiers || []);
        setEnabled(!!j.data.enabled);
      } else setError(j.error || 'Failed to load tiers');
    } catch (e: any) {
      setError(e?.message || 'Failed to load tiers');
    } finally {
      setLoading(false);
    }
  };

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess((s) => (s === msg ? null : s)), 3000);
  };

  const toggleEnabled = async (next: boolean) => {
    setTogglingEnabled(true);
    setError(null);
    setSuccess(null);
    const prev = enabled;
    setEnabled(next);
    try {
      const r = await fetch('/api/payroll/tiers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ enabled: next }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to update');
      setEnabled(!!j.data.enabled);
      flashSuccess(next ? 'Payroll role enabled.' : 'Payroll role disabled.');
    } catch (e: any) {
      setEnabled(prev);
      setError(e?.message || 'Failed to update');
    } finally {
      setTogglingEnabled(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateTier = (idx: number, patch: Partial<PayoutTier>) => {
    setTiers((ts) => ts.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
    setSuccess(null);
  };

  const addTier = () => {
    setTiers((ts) => {
      if (ts.length === 0) return [{ minPax: 1, maxPax: 1, percent: 0 }];
      const last = ts[ts.length - 1];
      const lastMax = last.maxPax === null ? last.minPax : last.maxPax;
      const newRow: PayoutTier = { minPax: lastMax + 1, maxPax: lastMax + 1, percent: 0 };
      const prev = ts.slice(0, -1);
      const closed: PayoutTier = { ...last, maxPax: lastMax };
      return [...prev, closed, newRow];
    });
    setSuccess(null);
  };

  const removeTier = (idx: number) => {
    setTiers((ts) => ts.filter((_, i) => i !== idx));
    setSuccess(null);
  };

  const toggleOpenEnded = (idx: number, open: boolean) => {
    setTiers((ts) =>
      ts.map((t, i) => (i === idx ? { ...t, maxPax: open ? null : t.minPax } : t))
    );
    setSuccess(null);
  };

  const save = async () => {
    setError(null);
    setSuccess(null);
    const err = validateTiers(tiers);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/payroll/tiers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ tiers }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to save');
      setTiers(j.data.tiers);
      const recomputed = Number(j.data?.recomputed) || 0;
      flashSuccess(
        recomputed > 0
          ? `Tiers saved. ${recomputed} pending payout${recomputed === 1 ? '' : 's'} updated.`
          : 'Tiers saved.'
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const calc = useMemo(() => estimatedPayout(calcPax, calcFee, tiers), [calcPax, calcFee, tiers]);

  const inputBase =
    'w-full border border-default rounded-md px-2.5 py-2 text-sm bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white shadow-lg shadow-primary/20 flex-shrink-0">
          <Icon name={IconName.Settings} className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Payroll Settings</h1>
          <p className="text-sm text-on-surface-secondary mt-0.5">
            Enable or disable the Payroll role, and configure payout tiers.
          </p>
        </div>
      </div>

      {/* Enable Payroll Role */}
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-default p-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
              enabled
                ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            <Icon name={IconName.Users} className="w-5 h-5" />
          </div>
          <div>
            <div className="font-semibold">Enable Payroll Role</div>
            <p className="text-xs text-on-surface-secondary mt-1 max-w-md">
              When off, the Payroll role is hidden from login/role pickers and the Payroll
              dashboard is inaccessible. Existing payout data is preserved either way.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              enabled
                ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                enabled ? 'bg-green-500' : 'bg-gray-400'
              }`}
            />
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Enable Payroll role"
            disabled={togglingEnabled}
            onClick={() => toggleEnabled(!enabled)}
            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-200 ${
              enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
            } ${togglingEnabled ? 'opacity-50' : ''}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
                enabled ? 'translate-x-8' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Payout Tiers */}
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-default overflow-hidden">
        <header className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 border-b border-default">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Icon name={IconName.DollarSign} className="w-5 h-5 text-primary" />
              Payout Tiers
            </h2>
            <p className="text-sm text-on-surface-secondary mt-1 max-w-xl">
              Trainer payout = course fee × number of learners × tier percent. Tiers must be
              contiguous; leave Max blank on the last tier for an open range.
            </p>
          </div>
          {!loading && tiers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {tiers.map((t, i) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/5 border border-primary/20 text-xs"
                >
                  <span className="font-semibold text-primary">{tierRangeLabel(t)}</span>
                  <span className="text-on-surface-secondary">→</span>
                  <span className="font-semibold">{t.percent}%</span>
                </div>
              ))}
            </div>
          )}
        </header>

        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 bg-gray-100 dark:bg-slate-700 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="p-5 space-y-3">
            {tiers.length === 0 && (
              <div className="text-center py-8 text-sm text-on-surface-secondary border border-dashed border-default rounded-lg">
                No tiers configured. Click <strong>Add tier</strong> below to get started.
              </div>
            )}
            {tiers.map((t, i) => {
              const isOpen = t.maxPax === null || t.maxPax === undefined;
              return (
                <div
                  key={i}
                  className="rounded-lg border border-default bg-gray-50/60 dark:bg-slate-900/40 hover:border-primary/30 transition-colors p-4"
                >
                  <div className="flex items-start gap-4">
                    {/* Tier number badge */}
                    <div className="flex-shrink-0 w-11 h-11 rounded-lg bg-primary/10 text-primary font-bold text-base flex flex-col items-center justify-center leading-none">
                      <span className="text-[9px] uppercase tracking-wider font-semibold opacity-70">
                        Tier
                      </span>
                      <span className="mt-0.5">{i + 1}</span>
                    </div>

                    {/* Inputs */}
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_1fr] gap-3 items-end">
                      <label className="block">
                        <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-medium mb-1">
                          Min Learners
                        </div>
                        <input
                          type="number"
                          min={1}
                          value={t.minPax}
                          onChange={(e) =>
                            updateTier(i, { minPax: Number(e.target.value) })
                          }
                          className={inputBase}
                        />
                      </label>

                      <div className="hidden sm:flex items-center justify-center pb-2 text-on-surface-secondary text-sm font-medium">
                        to
                      </div>

                      <label className="block">
                        <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-medium mb-1 flex items-center justify-between gap-2">
                          <span>Max Learners</span>
                          <label className="inline-flex items-center gap-1 cursor-pointer normal-case tracking-normal text-[10px] font-normal text-primary">
                            <input
                              type="checkbox"
                              checked={isOpen}
                              onChange={(e) => toggleOpenEnded(i, e.target.checked)}
                              className="rounded accent-primary"
                            />
                            Open-ended
                          </label>
                        </div>
                        <input
                          type="number"
                          min={1}
                          disabled={isOpen}
                          value={isOpen ? '' : t.maxPax!}
                          placeholder={isOpen ? '∞ (no upper limit)' : ''}
                          onChange={(e) =>
                            updateTier(i, {
                              maxPax: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          className={`${inputBase} ${
                            isOpen ? 'bg-gray-100 dark:bg-slate-800 text-on-surface-secondary' : ''
                          }`}
                        />
                      </label>

                      <label className="block">
                        <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-medium mb-1">
                          Trainer %
                        </div>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            value={t.percent}
                            onChange={(e) =>
                              updateTier(i, { percent: Number(e.target.value) })
                            }
                            className={`${inputBase} pr-7`}
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-secondary pointer-events-none">
                            %
                          </span>
                        </div>
                      </label>
                    </div>

                    {/* Remove */}
                    <button
                      onClick={() => removeTier(i)}
                      title="Remove tier"
                      aria-label={`Remove tier ${i + 1}`}
                      className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md text-on-surface-secondary hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Icon name={IconName.Delete} className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Plain-English summary */}
                  <div className="mt-3 ml-[60px] text-xs text-on-surface-secondary">
                    A class with{' '}
                    <span className="font-semibold text-on-surface dark:text-gray-100">
                      {tierRangeLabel(t)}
                    </span>{' '}
                    pays the trainer{' '}
                    <span className="font-semibold text-primary">{t.percent}%</span> of the
                    course fee, per learner.
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && (
          <footer className="px-5 py-4 border-t border-default bg-gray-50/60 dark:bg-slate-900/40 flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={addTier}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-default rounded-md bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Icon name={IconName.Plus} className="w-4 h-4" />
              Add tier
            </button>
            <div className="flex items-center gap-3">
              {error && (
                <span className="inline-flex items-center gap-1 text-sm text-red-700 dark:text-red-300">
                  <Icon name={IconName.Warning} className="w-4 h-4" />
                  {error}
                </span>
              )}
              {success && (
                <span className="inline-flex items-center gap-1 text-sm text-green-700 dark:text-green-300">
                  <Icon name={IconName.CheckCircle} className="w-4 h-4" />
                  {success}
                </span>
              )}
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary-hover shadow-sm disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <>
                    <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Icon name={IconName.Save} className="w-4 h-4" />
                    Save tiers
                  </>
                )}
              </button>
            </div>
          </footer>
        )}

        <div className="px-5 py-3 border-t border-default bg-amber-50/40 dark:bg-amber-900/10 flex items-start gap-2 text-xs text-on-surface-secondary">
          <Icon
            name={IconName.Warning}
            className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
          />
          <span>
            Saving these tiers will <strong>auto-update all pending payouts</strong> to the
            new rates. Payouts already marked <em>Completed</em> or <em>Cancelled</em> are
            left untouched (they reflect what was actually paid).
          </span>
        </div>
      </section>

      {/* Payout Calculator */}
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-default overflow-hidden">
        <header className="px-5 py-4 border-b border-default">
          <h3 className="font-semibold flex items-center gap-2">
            <Icon name={IconName.Calculator} className="w-5 h-5 text-primary" />
            Payout Calculator
          </h3>
          <p className="text-xs text-on-surface-secondary mt-1">
            Sanity-check your tier configuration with a sample class.
          </p>
        </header>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-medium mb-1">
              # Learners
            </div>
            <input
              type="number"
              min={1}
              value={calcPax}
              onChange={(e) => setCalcPax(Math.max(0, Number(e.target.value)))}
              className={inputBase}
            />
          </label>
          <label className="block">
            <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-medium mb-1">
              Course Fee (SGD)
            </div>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-secondary pointer-events-none">
                S$
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={calcFee}
                onChange={(e) => setCalcFee(Math.max(0, Number(e.target.value)))}
                className={`${inputBase} pl-9`}
              />
            </div>
          </label>
          <div className="block">
            <div className="text-[11px] uppercase tracking-wider text-on-surface-secondary font-medium mb-1">
              Estimated Payout
            </div>
            <div className="rounded-md bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/30 px-3 py-2">
              <div className="font-bold text-primary text-xl leading-tight">
                {fmtCurrency(calc.amount)}
              </div>
              <div className="text-[11px] text-on-surface-secondary mt-0.5">
                {calc.tier
                  ? `${tierRangeLabel(calc.tier)} × ${calc.tier.percent}%`
                  : 'No matching tier'}
              </div>
            </div>
          </div>
        </div>
        {calc.tier && calcPax > 0 && calcFee > 0 && (
          <div className="px-5 pb-5 -mt-1">
            <div className="text-xs text-on-surface-secondary bg-gray-50 dark:bg-slate-900/40 border border-default rounded-md px-3 py-2 font-mono">
              {fmtCurrency(calcFee)} × {calcPax} learner{calcPax === 1 ? '' : 's'} ×{' '}
              {calc.tier.percent}% ={' '}
              <span className="font-semibold text-primary">{fmtCurrency(calc.amount)}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default PayrollSettingsView;
