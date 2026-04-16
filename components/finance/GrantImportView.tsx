import React, { useEffect, useId, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { useLms } from '@contexts/LmsContext';

type PreviewRow = {
  id: string;
  row_number: number;
  financial_transaction_id: string | null;
  enrolment_id: string | null;
  grant_id: string | null;
  scheme: string | null;
  trainee_name: string | null;
  employer_name: string | null;
  amount_raw: string | null;
  amount_parsed: string | null;
  payment_date_parsed: string | null;
  bank_reference_id: string | null;
  match_status: 'ready' | 'already_applied' | 'ambiguous' | 'unmatched' | 'invalid' | string;
  selected_for_apply: boolean;
  apply_status: string | null;
  apply_error: string | null;
};

type PreviewPayload = {
  batch: any;
  rows: PreviewRow[];
  enrolmentImpact: Array<{
    enrolmentId: string;
    expectedTotal: number | null;
    receivedSoFar: number;
    willReceiveIfApplied: number;
    projectedReceived: number;
    projectedPending: number | null;
    projectedStatus: 'NOT_RECEIVED' | 'PARTIAL' | 'FULLY_PAID';
  }>;
};

const badge = (s: string) => {
  const x = s.toLowerCase();
  if (x === 'ready') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400';
  if (x === 'already_applied') return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
  if (x === 'unmatched' || x === 'ambiguous') return 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300';
  if (x === 'invalid') return 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300';
};

const applyBadge = (s: string | null | undefined) => {
  const x = String(s || '').toLowerCase();
  if (!x) return 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300';
  if (x === 'applied') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400';
  if (x === 'pending') return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300';
  if (x === 'skipped') return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
  if (x === 'failed') return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300';
};

const fmtMoney = (v: number | null | undefined) =>
  v == null ? '-' : `$${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const GrantImportView: React.FC = () => {
  const { currentUser } = useLms();
  const actorUserId = currentUser?.id ? String(currentUser.id) : '';
  const fileInputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<any | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileValidationError = useMemo(() => {
    if (!file) return null;
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx')) return null;
    return 'Invalid file type. Please upload an Excel file (.xlsx).';
  }, [file]);

  const counts = useMemo(() => {
    const rows = preview?.rows || [];
    const total = rows.length;
    const by = (k: string) => rows.filter((r) => String(r.match_status) === k).length;
    return {
      total,
      ready: by('ready'),
      already: by('already_applied'),
      unmatched: by('unmatched'),
      ambiguous: by('ambiguous'),
      invalid: by('invalid'),
      selected: rows.filter((r) => r.selected_for_apply).length,
    };
  }, [preview]);

  const loadPreview = async (id: string) => {
    const res = await fetch(`/api/grant-import/batches/${encodeURIComponent(id)}/preview`, {
      headers: { 'x-actor-user-id': actorUserId },
    });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to load preview');
    setPreview(json.data);
  };

  const upload = async () => {
    if (!file) return;
    setError(null);
    setApplyResult(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/grant-import/upload', {
        method: 'POST',
        headers: { 'x-actor-user-id': actorUserId },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Upload failed');
      const data = json.data;
      setBatchId(data?.batch?.id || null);
      setPreview({ batch: data.batch, rows: data.rows, enrolmentImpact: data.enrolmentImpact });
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(isOver);
  };

  const applySelectedFile = (selected: File | null) => {
    setFile(selected);
    setError(null);
    setApplyResult(null);
    setPreview(null);
    setBatchId(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0] || null;
    applySelectedFile(droppedFile);
  };

  const toggleRow = async (rowId: string, selected: boolean) => {
    if (!batchId) return;
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r) => (r.id === rowId ? { ...r, selected_for_apply: selected } : r)),
          }
        : p
    );
    await fetch(`/api/grant-import/batches/${encodeURIComponent(batchId)}/rows`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
      body: JSON.stringify({ updates: [{ id: rowId, selected }] }),
    }).catch(() => {});
    await loadPreview(batchId);
  };

  const selectAllReady = async (selected: boolean) => {
    if (!preview || !batchId) return;
    const updates = preview.rows
      .filter((r) => String(r.match_status) === 'ready')
      .map((r) => ({ id: r.id, selected }));
    if (updates.length === 0) return;
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r) => (String(r.match_status) === 'ready' ? { ...r, selected_for_apply: selected } : r)),
          }
        : p
    );
    await fetch(`/api/grant-import/batches/${encodeURIComponent(batchId)}/rows`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
      body: JSON.stringify({ updates }),
    });
    await loadPreview(batchId);
  };

  const apply = async () => {
    if (!batchId) return;
    setError(null);
    setApplying(true);
    try {
      const res = await fetch(`/api/grant-import/batches/${encodeURIComponent(batchId)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
        body: JSON.stringify({ dryRun, allowOverwriteAlreadyApplied: allowOverwrite }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Apply failed');
      setApplyResult(json.data);
      await loadPreview(batchId);
    } catch (e: any) {
      setError(e?.message || 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => {
    if (!batchId) return;
    void loadPreview(batchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-bold text-on-surface">Bulk Grant Payment Sync</h2>
        <div className="text-xs text-on-surface-secondary">Step 1 → Step 2 → Step 3</div>
      </div>

      <Card className="p-4 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!actorUserId) {
              setError('Login required.');
              return;
            }
            if (!file) {
              setError('Please choose an Excel file (.xlsx) to upload.');
              return;
            }
            if (fileValidationError) {
              setError(fileValidationError);
              return;
            }
            void upload();
          }}
          className="space-y-4"
        >
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 className="font-semibold text-amber-800 mb-1">Step 1 — Upload & Preview</h4>
            <div className="text-sm text-amber-700">
              Upload the TPGateway Disbursement Excel (.xlsx). We will parse, validate, match and show a full preview. No QB writes happen
              in Step 1.
            </div>
          </div>

          <div className="text-center">
            <h3 className="text-xl font-bold dark:text-white">Upload Disbursement File</h3>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Upload a TPGateway disbursement export to preview matches before applying any QB updates.
            </p>
          </div>

          <div
            onDragOver={(e) => handleDragEvents(e, true)}
            onDragLeave={(e) => handleDragEvents(e, false)}
            onDrop={handleDrop}
            className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${
              isDragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'
            }`}
          >
            <input
              id={fileInputId}
              type="file"
              className="hidden"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => applySelectedFile(e.target.files?.[0] || null)}
            />
            <label htmlFor={fileInputId} className="cursor-pointer">
              <Icon name={IconName.Upload} className="w-12 h-12 mx-auto text-gray-400" />
              <p className="mt-2 font-semibold text-gray-900 dark:text-white">
                {file ? file.name : 'Drag & drop your file here, or click to browse'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">XLSX file format</p>
              {file && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>}
            </label>
          </div>

          {fileValidationError && !error && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-lg text-sm">
              {fileValidationError}
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-white dark:bg-red-900/50 border border-red-200 dark:border-red-700 rounded-full flex items-center justify-center">
                <Icon name={IconName.Close} className="w-5 h-5 text-red-500 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100">Something went wrong!</h4>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-line">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                <Icon name={IconName.Close} className="w-5 h-5" />
              </button>
            </div>
          )}

          {batchId && (
            <div className="p-3 bg-surface-elevated rounded-lg text-xs text-on-surface-secondary">
              Batch: <span className="font-mono">{batchId}</span>
            </div>
          )}

          <div className="flex justify-end items-center">
            <Button type="submit" disabled={!file || uploading || !!fileValidationError || !actorUserId}>
              {uploading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Processing...
                </div>
              ) : (
                'Upload & Process'
              )}
            </Button>
          </div>

          {!actorUserId && <p className="text-xs text-red-600 dark:text-red-300">Login required.</p>}
        </form>
      </Card>

      {preview && (
        <>
          <Card className="p-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="font-semibold text-amber-800 mb-1">Step 2 — Review & Select</h4>
              <div className="text-sm text-amber-700">
                Review the preview rows and keep only <span className="font-semibold">READY</span> rows selected. Unmatched / Ambiguous /
                Invalid rows cannot be applied.
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[
              { label: 'Total', value: counts.total },
              { label: 'Ready', value: counts.ready },
              { label: 'Already', value: counts.already },
              { label: 'Unmatched', value: counts.unmatched },
              { label: 'Ambiguous', value: counts.ambiguous },
              { label: 'Invalid', value: counts.invalid },
            ].map((x) => (
              <Card key={x.label} className="p-3 text-center">
                <div className="text-lg font-bold text-on-surface">{x.value}</div>
                <div className="text-[11px] text-on-surface-secondary">{x.label}</div>
              </Card>
            ))}
          </div>

          <Card className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" onClick={() => void selectAllReady(true)}>
                  Select all Ready
                </Button>
                <Button variant="outline" onClick={() => void selectAllReady(false)}>
                  Deselect all Ready
                </Button>
                <span className="text-xs text-on-surface-secondary">
                  Selected: <span className="font-semibold text-on-surface">{counts.selected}</span>
                </span>
              </div>

              <div className="flex items-center gap-3 flex-wrap justify-end">
                <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
                  <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                  Dry-run (no QB writes)
                </label>
                <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
                  <input
                    type="checkbox"
                    checked={allowOverwrite}
                    onChange={(e) => setAllowOverwrite(e.target.checked)}
                  />
                  Allow overwrite already-applied
                </label>
                <Button onClick={() => void apply()} disabled={applying || !batchId || counts.selected === 0}>
                  {applying ? 'Applying…' : `Apply Selected (${counts.selected})`}
                </Button>
              </div>
            </div>
          </Card>

          {applyResult && (
            <>
              <Card className="p-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h4 className="font-semibold text-amber-800 mb-1">Step 3 — Apply & Results</h4>
                  <div className="text-sm text-amber-700">
                    Click <span className="font-semibold">Apply Selected</span> to update QB and then recalculate enrolment grant payment
                    status. Review the results below.
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <Icon name={IconName.CheckCircle} className="w-5 h-5 text-emerald-500" />
                  <div className="text-sm font-semibold text-on-surface">Apply finished</div>
                </div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Total selected', value: applyResult?.summary?.totalSelected ?? '-' },
                    { label: 'Applied', value: applyResult?.summary?.applied ?? '-' },
                    { label: 'Skipped', value: applyResult?.summary?.skipped ?? '-' },
                    { label: 'Failed', value: applyResult?.summary?.failed ?? '-' },
                  ].map((x) => (
                    <div key={x.label} className="rounded-xl border border-default bg-surface p-3">
                      <div className="text-xs text-on-surface-secondary">{x.label}</div>
                      <div className="text-2xl font-bold text-on-surface">{x.value}</div>
                    </div>
                  ))}
                </div>

                {Array.isArray(applyResult?.results) && applyResult.results.some((r: any) => r?.status === 'failed') && (
                  <div className="mt-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50/70 dark:bg-red-900/20 p-3">
                    <div className="text-sm font-semibold text-red-800 dark:text-red-200">Failed rows</div>
                    <ul className="mt-2 space-y-1 text-xs text-red-800 dark:text-red-200">
                      {applyResult.results
                        .filter((r: any) => r?.status === 'failed')
                        .slice(0, 10)
                        .map((r: any) => (
                          <li key={String(r.rowId)} className="font-mono whitespace-pre-wrap">
                            {String(r.rowId)} — {String(r.error || 'Failed')}
                          </li>
                        ))}
                    </ul>
                    {applyResult.results.filter((r: any) => r?.status === 'failed').length > 10 && (
                      <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">
                        Showing first 10 failures. See table for per-row errors.
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-default bg-surface-elevated">
                    <th className="px-3 py-2 text-xs text-left">☑</th>
                    <th className="px-3 py-2 text-xs text-left">#</th>
                    <th className="px-3 py-2 text-xs text-left">ENR</th>
                    <th className="px-3 py-2 text-xs text-left">GRN</th>
                    <th className="px-3 py-2 text-xs text-left">Scheme</th>
                    <th className="px-3 py-2 text-xs text-right">Amount</th>
                    <th className="px-3 py-2 text-xs text-left">Payment Date</th>
                    <th className="px-3 py-2 text-xs text-left">Bank Ref</th>
                    <th className="px-3 py-2 text-xs text-left">Status</th>
                    <th className="px-3 py-2 text-xs text-left">Apply</th>
                    <th className="px-3 py-2 text-xs text-left">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {preview.rows.map((r) => {
                    const disabled = ['unmatched', 'ambiguous', 'invalid'].includes(String(r.match_status));
                    return (
                      <tr
                        key={r.id}
                        className={
                          String(r.match_status) === 'already_applied'
                            ? 'bg-amber-50/40 dark:bg-amber-900/10'
                            : disabled
                              ? 'bg-red-50/30 dark:bg-red-900/10'
                              : ''
                        }
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!!r.selected_for_apply}
                            disabled={disabled}
                            onChange={(e) => void toggleRow(r.id, e.target.checked)}
                          />
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{r.row_number}</td>
                        <td className="px-3 py-2 text-xs font-mono">{r.enrolment_id || '-'}</td>
                        <td className="px-3 py-2 text-xs font-mono">{r.grant_id || '-'}</td>
                        <td className="px-3 py-2 text-xs">{r.scheme || '-'}</td>
                        <td className="px-3 py-2 text-xs text-right font-mono">
                          {r.amount_raw || (r.amount_parsed ? fmtMoney(Number(r.amount_parsed)) : '-') }
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{r.payment_date_parsed || '-'}</td>
                        <td className="px-3 py-2 text-xs font-mono">{r.bank_reference_id || '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${badge(String(r.match_status))}`}>
                            {String(r.match_status)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${applyBadge(r.apply_status)}`}>
                            {r.apply_status ? String(r.apply_status) : '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-on-surface-secondary whitespace-pre-wrap max-w-[420px]">
                          {r.apply_error ? String(r.apply_error) : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default GrantImportView;

