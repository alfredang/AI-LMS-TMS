import React, { useEffect, useState } from 'react';
import { PayoutTier, validateTiers } from '@lib/payroll/calculate';

const PayrollSettingsView: React.FC = () => {
  const [tiers, setTiers] = useState<PayoutTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/payroll/tiers');
      const j = await r.json();
      if (j.success) setTiers(j.data.tiers);
      else setError(j.error || 'Failed to load tiers');
    } catch (e: any) {
      setError(e?.message || 'Failed to load tiers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateTier = (idx: number, patch: Partial<PayoutTier>) => {
    setTiers((ts) => ts.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
    setSuccess(false);
  };

  const addTier = () => {
    setTiers((ts) => {
      if (ts.length === 0) return [{ minPax: 1, maxPax: 1, percent: 0 }];
      const last = ts[ts.length - 1];
      const lastMax = last.maxPax === null ? last.minPax : last.maxPax;
      const newRow: PayoutTier = { minPax: lastMax + 1, maxPax: lastMax + 1, percent: 0 };
      // make the previous "open" tier closed
      const prev = ts.slice(0, -1);
      const closed: PayoutTier = { ...last, maxPax: lastMax };
      return [...prev, closed, newRow];
    });
    setSuccess(false);
  };

  const removeTier = (idx: number) => {
    setTiers((ts) => ts.filter((_, i) => i !== idx));
    setSuccess(false);
  };

  const setOpenEnded = (idx: number) => {
    setTiers((ts) => ts.map((t, i) => (i === idx ? { ...t, maxPax: null } : t)));
    setSuccess(false);
  };

  const save = async () => {
    setError(null);
    setSuccess(false);
    const err = validateTiers(tiers);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/payroll/tiers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiers }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to save');
      setTiers(j.data.tiers);
      setSuccess(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Payout Tier Settings</h1>
        <p className="text-sm text-on-surface-secondary">
          Defines the trainer payout as a percentage of course fee × number of learners. Tiers must be
          contiguous and sorted; the last tier should have an open-ended max (5+ pax → blank).
        </p>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-default p-4">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-on-surface-secondary">
              <tr>
                <th className="text-left py-2">Min Pax</th>
                <th className="text-left py-2">Max Pax</th>
                <th className="text-left py-2">Percent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={i} className="border-t border-default">
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={1}
                      value={t.minPax}
                      onChange={(e) => updateTier(i, { minPax: Number(e.target.value) })}
                      className="w-24 border rounded px-2 py-1 bg-white dark:bg-slate-700"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={t.maxPax === null || t.maxPax === undefined ? '' : t.maxPax}
                        placeholder="(open)"
                        onChange={(e) =>
                          updateTier(i, {
                            maxPax: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        className="w-24 border rounded px-2 py-1 bg-white dark:bg-slate-700"
                      />
                      {t.maxPax !== null && (
                        <button
                          onClick={() => setOpenEnded(i)}
                          className="text-xs text-blue-600 hover:underline"
                          title="Set open-ended"
                        >
                          Open-end
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={t.percent}
                        onChange={(e) => updateTier(i, { percent: Number(e.target.value) })}
                        className="w-24 border rounded px-2 py-1 bg-white dark:bg-slate-700"
                      />
                      <span>%</span>
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => removeTier(i)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={addTier}
              className="px-3 py-1 text-sm border rounded hover:bg-gray-100 dark:hover:bg-slate-700"
            >
              + Add tier
            </button>
            <div className="flex items-center gap-3">
              {error && <span className="text-sm text-red-700">{error}</span>}
              {success && <span className="text-sm text-green-700">Saved.</span>}
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1 text-sm bg-primary text-white rounded hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="text-xs text-on-surface-secondary">
        Note: existing payout rows are <em>not</em> recomputed when tiers change. Only newly-materialized
        rows (course runs that complete after this change) use the new tiers.
      </div>
    </div>
  );
};

export default PayrollSettingsView;
