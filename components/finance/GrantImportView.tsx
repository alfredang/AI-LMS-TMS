import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
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
  /** Set by preview API for live FMS/QB status */
  fms_updated_live?: boolean;
  qb_applied_live?: boolean;
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

const CircularProgress: React.FC<{ pct: number; label?: string }> = ({ pct, label }) => {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-5 w-5 rounded-full"
        style={{
          background: `conic-gradient(currentColor ${p}%, rgba(255,255,255,0.25) 0)`,
        }}
      >
        <div className="absolute inset-[2px] rounded-full bg-primary-foreground/0 dark:bg-slate-900 bg-white" />
      </div>
      <span className="text-xs font-semibold tabular-nums">{p}%</span>
      {label ? <span className="text-xs text-on-surface-secondary">{label}</span> : null}
    </div>
  );
};

function extractDoneTotal(message: string): { done: number; total: number } | null {
  const m = String(message || '').match(/\((\d+)\s*\/\s*(\d+)\)/);
  if (!m) return null;
  const done = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return { done, total };
}

const GrantImportView: React.FC = () => {
  const { currentUser } = useLms();
  const actorUserId = currentUser?.id ? String(currentUser.id) : '';
  const fileInputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const showDryRunToggle = String(process.env.NEXT_PUBLIC_GRANT_IMPORT_SHOW_DRY_RUN || '').toLowerCase() === 'true';
  const [dryRun, setDryRun] = useState(false);
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<any | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadMsg, setUploadMsg] = useState('Processing…');
  const [uploadCounts, setUploadCounts] = useState<{ done: number; total: number } | null>(null);
  const [applyCounts, setApplyCounts] = useState<{ done: number; total: number } | null>(null);
  const [applyPct, setApplyPct] = useState(0);
  const [applyMsg, setApplyMsg] = useState('Applying payments…');
  const [rowFilter, setRowFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

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
    const problem = by('unmatched') + by('ambiguous') + by('invalid');
    return {
      total,
      ready: by('ready'),
      already: by('already_applied'),
      unmatched: by('unmatched'),
      ambiguous: by('ambiguous'),
      invalid: by('invalid'),
      problem,
    };
  }, [preview]);

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    const applyStatuses = ['applied', 'skipped', 'failed', 'pending'];
    let result = preview.rows;
    if (rowFilter !== 'all') {
      if (applyStatuses.includes(rowFilter))
        result = result.filter((r) => String(r.apply_status || '').toLowerCase() === rowFilter);
      else
        result = result.filter((r) => String(r.match_status) === rowFilter);
    }
    if (dateFrom) result = result.filter((r) => r.payment_date_parsed != null && r.payment_date_parsed >= dateFrom);
    if (dateTo) result = result.filter((r) => r.payment_date_parsed != null && r.payment_date_parsed <= dateTo);
    return result;
  }, [preview, rowFilter, dateFrom, dateTo]);

  /** Count of selected+ready rows in the currently-visible (date-filtered) view. */
  const selectedCount = useMemo(
    () => filteredRows.filter((r) => r.selected_for_apply && String(r.match_status) === 'ready').length,
    [filteredRows]
  );

  const loadPreview = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/grant-import/batches/${encodeURIComponent(id)}/preview`, {
        headers: { 'x-actor-user-id': actorUserId },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to load preview');
      setPreview(json.data);
    },
    [actorUserId]
  );

  const upload = async () => {
    if (!file) return;
    setError(null);
    setInfo(null);
    setApplyResult(null);
    setRowFilter('all');
    setDateFrom('');
    setDateTo('');
    setUploading(true);
    setUploadJobId(null);
    setUploadPct(0);
    setUploadMsg('Uploading…');
    setUploadCounts(null);
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
      const jobId = String(json?.data?.jobId || '').trim();
      if (!jobId) throw new Error('Upload job did not start');
      setUploadJobId(jobId);
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
    }
  };

  // Poll upload job progress until it finishes (accurate backend progress).
  useEffect(() => {
    if (!uploadJobId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/grant-import/jobs/${encodeURIComponent(uploadJobId)}`, {
          headers: { 'x-actor-user-id': actorUserId },
        });
        const json = await res.json();
        if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to fetch upload progress');
        const job = json.data as { status: string; pct: number; message: string; result?: any; error?: string };
        if (cancelled) return;
        setUploadPct(Number(job.pct) || 0);
        const msg = String(job.message || 'Processing…');
        setUploadMsg(msg);
        setUploadCounts(extractDoneTotal(msg));

        if (job.status === 'done') {
          const data = job.result;
          setBatchId(data?.batch?.id || null);
          setPreview({ batch: data.batch, rows: data.rows, enrolmentImpact: data.enrolmentImpact });
          const synced = Number(data?.summary?.qbSyncedRows || 0);
          if (synced > 0) {
            setInfo(`Updated in FMS: ${synced} row(s) (found in QuickBooks, not previously recorded in FMS).`);
          }
          setUploading(false);
          setUploadJobId(null);
          setUploadCounts(null);
          return;
        }

        if (job.status === 'failed') {
          setError(String(job.error || 'Upload processing failed'));
          setUploading(false);
          setUploadJobId(null);
          setUploadCounts(null);
          return;
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Upload progress failed');
        setUploading(false);
        setUploadJobId(null);
        setUploadCounts(null);
        return;
      }

      setTimeout(tick, 500);
    };

    setUploading(true);
    void tick();
    return () => {
      cancelled = true;
    };
  }, [uploadJobId, actorUserId]);

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
    setDateFrom('');
    setDateTo('');
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

  const patchRowSelections = async (batchId: string, updates: Array<{ id: string; selected: boolean }>) => {
    const CHUNK = 500; // API limit in `pages/api/grant-import/batches/[batchId]/rows.ts`
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const res = await fetch(`/api/grant-import/batches/${encodeURIComponent(batchId)}/rows`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
        body: JSON.stringify({ updates: chunk }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Failed to update row selection (chunk ${i + 1}-${i + chunk.length})`);
    }
  };

  const selectAllReady = async (selected: boolean) => {
    if (!preview || !batchId) return;
    const filteredIds = new Set(filteredRows.map((r) => r.id));
    const updates = filteredRows
      .filter((r) => String(r.match_status) === 'ready')
      .map((r) => ({ id: r.id, selected }));
    if (updates.length === 0) return;
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r) =>
              String(r.match_status) === 'ready' && filteredIds.has(r.id) ? { ...r, selected_for_apply: selected } : r
            ),
          }
        : p
    );
    try {
      await patchRowSelections(batchId, updates);
      await loadPreview(batchId);
    } catch (e: any) {
      setError(e?.message || 'Failed to update selections');
      await loadPreview(batchId);
    }
  };

  const setAllSelectable = async (selected: boolean) => {
    if (!preview || !batchId) return;
    const filteredIds = new Set(filteredRows.map((r) => r.id));
    const updates = filteredRows
      .filter((r) => String(r.match_status) === 'ready')
      .map((r) => ({ id: r.id, selected }));
    if (updates.length === 0) return;
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r) =>
              String(r.match_status) === 'ready' && filteredIds.has(r.id)
                ? { ...r, selected_for_apply: selected }
                : r
            ),
          }
        : p
    );
    try {
      await patchRowSelections(batchId, updates);
      await loadPreview(batchId);
    } catch (e: any) {
      setError(e?.message || 'Failed to update selections');
      await loadPreview(batchId);
    }
  };

  const apply = async () => {
    if (!batchId) return;
    setError(null);
    setApplyCounts({ done: 0, total: Math.max(0, selectedCount) });
    setApplyPct(0);
    setApplyMsg('Applying payments…');
    setApplying(true);
    try {
      const res = await fetch(`/api/grant-import/batches/${encodeURIComponent(batchId)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
        body: JSON.stringify({
          dryRun,
          allowOverwriteAlreadyApplied: allowOverwrite,
          rowIds: filteredRows
            .filter((r) => !!r.selected_for_apply && String(r.match_status) === 'ready')
            .map((r) => r.id),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Apply failed');
      setApplyResult(json.data);
    } catch (e: any) {
      setError(e?.message || 'Apply failed');
    } finally {
      setApplying(false);
      setApplyCounts(null);
      setApplyPct(0);
      // Refresh preview after modal closes so UI doesn't feel "stuck" at 100%.
      void loadPreview(batchId).catch(() => {});
    }
  };

  // During apply, poll a lightweight endpoint (counts only), not the full preview.
  useEffect(() => {
    if (!applying || !batchId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/grant-import/batches/${encodeURIComponent(batchId)}/apply-progress`, {
          headers: { 'x-actor-user-id': actorUserId },
        });
        const json = await res.json();
        const data = json?.data as
          | {
              total_selected_ready?: number;
              done_selected_ready?: number;
            }
          | null
          | undefined;
        if (cancelled || !data) return;
        const total = Number(data.total_selected_ready ?? 0);
        const done = Number(data.done_selected_ready ?? 0);
        setApplyCounts((prev) => ({ done: Math.min(done, total), total: Math.max(total, prev?.total ?? 0) }));
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        setApplyPct(pct);
        setApplyMsg(done >= total ? `Finishing… (${done}/${total})` : `Processing… (${done}/${total})`);
      } catch {
        // ignore
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 800);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [applying, batchId, actorUserId]);

  useEffect(() => {
    if (!batchId) return;
    void loadPreview(batchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-bold text-on-surface">Bulk Grant Payment Sync</h2>
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

          {info && !error && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 rounded-lg text-sm">
              {info}
            </div>
          )}

          {batchId && (
            <div className="p-3 bg-surface-elevated rounded-lg text-xs text-on-surface-secondary">
              Batch: <span className="font-mono">{batchId}</span>
            </div>
          )}

          <div className="flex justify-end items-center">
            <Button type="submit" disabled={!file || uploading || !!fileValidationError || !actorUserId}>
              {uploading ? 'Processing…' : 'Upload & Process'}
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
              <div className="mt-2 text-xs text-amber-700">
                <span className="font-semibold">Ambiguous</span> = Grant ID matches more than one record (needs manual fix).{' '}
                <span className="font-semibold">Unmatched</span> = Grant ID / enrolment isn’t found in our system yet (add it first, then re-upload).
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3 text-center">
              <div className="text-lg font-bold text-on-surface">{counts.total}</div>
              <div className="text-[11px] text-on-surface-secondary">Total</div>
            </Card>
            <Card className="p-3 text-center border border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-900/10">
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{counts.ready}</div>
              <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">Ready</div>
            </Card>
            <Card className="p-3 text-center border border-amber-500/30 bg-amber-50/40 dark:bg-amber-900/10">
              <div className="text-lg font-bold text-amber-700 dark:text-amber-300">{counts.already}</div>
              <div className="text-[11px] text-amber-700/80 dark:text-amber-300/80">Already Applied</div>
            </Card>
            <Card className="p-3 text-center border border-red-500/30 bg-red-50/40 dark:bg-red-900/10">
              <div className="text-lg font-bold text-red-700 dark:text-red-300">{counts.problem}</div>
              <div className="text-[11px] text-red-700/80 dark:text-red-300/80">Need Attention</div>
            </Card>
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
                  Selected: <span className="font-semibold text-on-surface">{selectedCount}</span>
                </span>
              </div>

              <div className="flex items-center gap-3 flex-wrap justify-end">
                {showDryRunToggle && (
                  <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
                    <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                    Dry-run (no QB writes)
                  </label>
                )}
                <label className="flex items-center gap-2 text-xs text-on-surface-secondary">
                  <input
                    type="checkbox"
                    checked={allowOverwrite}
                    onChange={(e) => setAllowOverwrite(e.target.checked)}
                  />
                  Allow overwrite already-applied
                </label>
                <Button onClick={() => void apply()} disabled={applying || !batchId || selectedCount === 0}>
                  {applying ? 'Applying…' : `Apply Selected (${selectedCount})`}
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
            {/* Filter pill bar */}
            <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-default bg-surface-elevated">
              <span className="text-[11px] font-semibold text-on-surface-secondary uppercase tracking-wider mr-1">Filter:</span>
              {(
                [
                  { key: 'all',            label: 'All',            count: preview.rows.length,                                                                     activeClass: 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900' },
                  { key: 'ready',          label: 'Ready',          count: counts.ready,                                                                            activeClass: 'bg-emerald-600 text-white' },
                  { key: 'already_applied',label: 'Already Applied',count: counts.already,                                                                          activeClass: 'bg-amber-500 text-white' },
                  { key: 'unmatched',      label: 'Unmatched',      count: counts.unmatched,                                                                        activeClass: 'bg-red-500 text-white' },
                  { key: 'ambiguous',      label: 'Ambiguous',      count: counts.ambiguous,                                                                        activeClass: 'bg-red-500 text-white' },
                  { key: 'invalid',        label: 'Invalid',        count: counts.invalid,                                                                          activeClass: 'bg-gray-500 text-white' },
                  ...(applyResult ? [
                    { key: 'applied', label: 'Applied', count: preview.rows.filter((r) => String(r.apply_status || '') === 'applied').length, activeClass: 'bg-emerald-600 text-white' },
                    { key: 'skipped', label: 'Skipped', count: preview.rows.filter((r) => String(r.apply_status || '') === 'skipped').length, activeClass: 'bg-amber-500 text-white' },
                    { key: 'failed',  label: 'Failed',  count: preview.rows.filter((r) => String(r.apply_status || '') === 'failed').length,  activeClass: 'bg-red-500 text-white' },
                  ] : []),
                ] as Array<{ key: string; label: string; count: number; activeClass: string }>
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setRowFilter(opt.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    rowFilter === opt.key
                      ? opt.activeClass
                      : 'bg-surface text-on-surface-secondary border border-default hover:bg-surface-hover'
                  }`}
                >
                  {opt.label} ({opt.count})
                </button>
              ))}
              {(rowFilter !== 'all' || dateFrom || dateTo) && (
                <span className="ml-auto text-[11px] text-on-surface-secondary">
                  Showing {filteredRows.length} of {preview.rows.length} rows
                </span>
              )}
            </div>
            {/* Payment date range filter */}
            <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-default bg-surface-elevated/60">
              <span className="text-[11px] font-semibold text-on-surface-secondary uppercase tracking-wider mr-1">Payment Date:</span>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-on-surface-secondary">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-2 py-1 rounded border border-default bg-surface text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-on-surface-secondary">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-2 py-1 rounded border border-default bg-surface text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="text-[11px] text-on-surface-secondary hover:text-on-surface underline"
                >
                  Clear dates
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-default bg-surface-elevated">
                    <th className="px-3 py-2 text-xs text-left">
                      {(() => {
                        const selectable = filteredRows.filter((r) => String(r.match_status) === 'ready');
                        const allSelected = selectable.length > 0 && selectable.every((r) => !!r.selected_for_apply);
                        const someSelected = selectable.some((r) => !!r.selected_for_apply);
                        const nextChecked = !allSelected;
                        return (
                          <button
                            type="button"
                            onClick={() => void setAllSelectable(nextChecked)}
                            className="inline-flex items-center justify-center -m-2 p-2 rounded-md hover:bg-surface-hover cursor-pointer"
                            title="Select / deselect all READY rows"
                            aria-label="Select / deselect all READY rows"
                          >
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = !allSelected && someSelected;
                              }}
                              onChange={() => {}}
                              className="pointer-events-none"
                            />
                          </button>
                        );
                      })()}
                    </th>
                    <th className="px-3 py-2 text-xs text-left">#</th>
                    <th className="px-3 py-2 text-xs text-left">ENR</th>
                    <th className="px-3 py-2 text-xs text-left">GRN</th>
                    <th className="px-3 py-2 text-xs text-left">Scheme</th>
                    <th className="px-3 py-2 text-xs text-right">Amount</th>
                    <th className="px-3 py-2 text-xs text-left">Payment Date</th>
                    <th className="px-3 py-2 text-xs text-left">Bank Ref</th>
                    <th className="px-3 py-2 text-xs text-left">FMS status</th>
                    <th className="px-3 py-2 text-xs text-left">QuickBooks</th>
                    <th className="px-3 py-2 text-xs text-left">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-6 text-center text-xs text-on-surface-secondary">
                        No rows match the selected filter.
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => {
                    const disabled = ['unmatched', 'ambiguous', 'invalid'].includes(String(r.match_status));
                    const selectable = String(r.match_status) === 'ready';
                    const disabledAny = disabled || !selectable;
                    const fmsStatus = r.fms_updated_live ? 'updated' : 'not updated';
                    const qbStatus = r.qb_applied_live ? 'applied' : 'not applied';
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
                          <button
                            type="button"
                            disabled={disabledAny}
                            onClick={() => void toggleRow(r.id, !r.selected_for_apply)}
                            className={`inline-flex items-center justify-center -m-2 p-2 rounded-md ${
                              disabledAny ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-hover cursor-pointer'
                            }`}
                            title={disabledAny ? 'Only READY rows can be selected' : 'Select / deselect row'}
                            aria-label={disabledAny ? 'Only READY rows can be selected' : 'Select / deselect row'}
                          >
                            <input
                              type="checkbox"
                              checked={!!r.selected_for_apply}
                              disabled={disabledAny}
                              onChange={() => {}}
                              className="pointer-events-none"
                            />
                          </button>
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
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                              fmsStatus === 'updated'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-300'
                            }`}
                          >
                            {fmsStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                              qbStatus === 'applied'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-300'
                            }`}
                          >
                            {qbStatus}
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

      {uploading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[460px] max-w-[92vw] rounded-xl border border-default bg-surface p-6 shadow-2xl">
            <div className="text-base font-semibold text-on-surface">Processing file…</div>
            <div className="mt-1 text-xs text-on-surface-secondary">{uploadMsg}</div>
            {uploadCounts ? (
              <div className="mt-1 text-xs text-on-surface-secondary">
                {uploadCounts.done}/{uploadCounts.total}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-center">
              <CircularProgress pct={uploadPct} label={uploadMsg} />
            </div>

            <div className="mt-4 h-2 w-full rounded-full bg-surface-elevated overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, uploadPct))}%` }} />
            </div>

            <div className="mt-3 text-[11px] text-on-surface-secondary text-center">
              This step does read-only QuickBooks checks and builds the preview.
            </div>
          </div>
        </div>
      )}

      {applying && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[460px] max-w-[92vw] rounded-xl border border-default bg-surface p-6 shadow-2xl">
            <div className="text-base font-semibold text-on-surface">Applying payments (Step 2)…</div>
            <div className="mt-1 text-xs text-on-surface-secondary">{applyMsg}</div>
            {applyCounts && applyCounts.total > 0 ? (
              <div className="mt-1 text-xs font-semibold tabular-nums text-on-surface">
                {applyCounts.done}/{applyCounts.total}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-center">
              <CircularProgress pct={applyPct} label={applyMsg} />
            </div>

            <div className="mt-4 h-2 w-full rounded-full bg-surface-elevated overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, applyPct))}%` }} />
            </div>

            <div className="mt-3 text-[11px] text-on-surface-secondary text-center">
              Updates QuickBooks and FMS as each selected row finishes. You can leave this page open until it completes.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GrantImportView;

