import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { useLms } from '@contexts/LmsContext';
import { authService } from '@lib/services/authService';

type SfcPreviewRow = {
  id: number;
  row_index: number;
  claim_id: string | null;
  individual_nric: string | null;
  individual_name: string | null;
  course_name: string | null;
  course_reference_number: string | null;
  course_start_date: string | null;
  disbursement_date: string | null;
  disbursement_date_iso: string | null;
  claim_amount: string | null;
  payout_request_id: string | null;
  match_status: string;
  apply_status: string | null;
  apply_error: string | null;
  matched_enrolment_id: string | null;
  matched_qbo_invoice_id: string | null;
  matched_qbo_doc_number: string | null;
  matched_qbo_invoice_balance: string | null;
  matched_qb_payment_id: string | null;
  da_application_id: string | null;
  da_sfc_invoice_id: string | null;
  main_qbo_invoice_id: string | null;
  main_qbo_doc_number: string | null;
  fms_updated: boolean;
  qb_updated: boolean;
  is_da: boolean;
  validation_errors: string[];
};

type SfcBatch = {
  id: number;
  filename: string;
  status: string;
  total_rows: number;
  ready_count: number;
  already_applied_count: number;
  unmatched_count: number;
  skipped_da_count: number;
  invalid_count: number;
  applied_count: number;
  skipped_count: number;
  failed_count: number;
};

function maskNric(nric: string | null): string {
  if (!nric) return '-';
  const s = nric.trim();
  if (s.length <= 4) return s;
  return '•'.repeat(s.length - 4) + s.slice(-4);
}

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const matchBadgeClass = (s: string) => {
  switch (s) {
    case 'ready': return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400';
    case 'already_applied': return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300';
    case 'unmatched': return 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300';
    case 'invalid': return 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300';
    case 'skipped_da': return 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300';
    case 'needs_review': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300';
  }
};

const matchBadgeLabel = (s: string) => {
  switch (s) {
    case 'ready': return 'Ready';
    case 'already_applied': return 'Already Applied';
    case 'unmatched': return 'Unmatched';
    case 'invalid': return 'Invalid';
    case 'skipped_da': return 'DA-Skipped';
    case 'needs_review': return 'Needs Review';
    default: return s;
  }
};

const applyBadgeClass = (s: string | null) => {
  switch (String(s || '').toLowerCase()) {
    case 'applied': return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400';
    case 'skipped': return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300';
    case 'failed': return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300';
    case 'pending': return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300';
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300';
  }
};

const CircularProgress: React.FC<{ pct: number; label?: string }> = ({ pct, label }) => {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-5 w-5 rounded-full"
        style={{ background: `conic-gradient(currentColor ${p}%, rgba(255,255,255,0.25) 0)` }}
      >
        <div className="absolute inset-[2px] rounded-full bg-white dark:bg-slate-900" />
      </div>
      <span className="text-xs font-semibold tabular-nums">{p}%</span>
      {label ? <span className="text-xs text-on-surface-secondary">{label}</span> : null}
    </div>
  );
};

const NON_APPLICABLE_MATCH_STATUSES = ['unmatched', 'invalid', 'skipped_da', 'already_applied', 'needs_review'];

const SfcPaymentSyncView: React.FC = () => {
  const { currentUser } = useLms();
  const actorUserId = currentUser?.id ? String(currentUser.id) : '';
  const fileInputId = useId();

  // One-off catch-up for Direct Applications confirmed before claim ids were
  // copied across. New payout imports fill them automatically.
  const [claimFixBusy, setClaimFixBusy] = useState(false);
  const [claimFixMsg, setClaimFixMsg] = useState<string | null>(null);
  const [claimFixPending, setClaimFixPending] = useState<number | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadMsg, setUploadMsg] = useState('Processing…');
  const [error, setError] = useState<string | null>(null);

  const [batchId, setBatchId] = useState<number | null>(null);
  const [batch, setBatch] = useState<SfcBatch | null>(null);
  const [rows, setRows] = useState<SfcPreviewRow[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [rowFilter, setRowFilter] = useState<string>('all');
  const [applying, setApplying] = useState(false);
  const [applyPct, setApplyPct] = useState(0);
  const [applyMsg, setApplyMsg] = useState('Applying payments…');
  const [applyResult, setApplyResult] = useState<any | null>(null);

  const [invoiceGenLoading, setInvoiceGenLoading] = useState<Set<number>>(new Set());
  const [invoiceGenErrors, setInvoiceGenErrors] = useState<Map<number, string>>(new Map());

  const [syncingInvoiceIds, setSyncingInvoiceIds] = useState(false);
  const [syncInvoiceResult, setSyncInvoiceResult] = useState<{ resolved: number; notFound: number; rejected: number; errors: number; total: number; warnings?: string[] } | null>(null);

  const [bulkGeneratingSfc, setBulkGeneratingSfc] = useState(false);
  const [bulkGenerateSfcResult, setBulkGenerateSfcResult] = useState<{ total: number; generated: number; failed: number; errors: Array<{ rowId: number; claimId: string | null; error: string }> } | null>(null);

  const fileValidationError = useMemo(() => {
    if (!file) return null;
    return file.name.toLowerCase().endsWith('.xlsx') ? null : 'Invalid file type. Please upload an Excel file (.xlsx).';
  }, [file]);

  const counts = useMemo(() => {
    const total = rows.length;
    const by = (k: string) => rows.filter((r) => r.match_status === k).length;
    return {
      total,
      ready: by('ready'),
      already_applied: by('already_applied'),
      skipped_da: by('skipped_da'),
      da: rows.filter((r) => r.is_da).length,
      unmatched: by('unmatched'),
      invalid: by('invalid'),
      needs_review: by('needs_review'),
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (rowFilter === 'all') return rows;
    if (rowFilter === 'da') return rows.filter((r) => r.is_da);
    const applyStatuses = ['applied', 'skipped', 'failed', 'pending'];
    if (applyStatuses.includes(rowFilter)) return rows.filter((r) => String(r.apply_status || '') === rowFilter);
    return rows.filter((r) => r.match_status === rowFilter);
  }, [rows, rowFilter]);

  const loadPreview = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/sfc-import/batches/${id}/preview`, {
        headers: { 'x-actor-user-id': actorUserId },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to load preview');
      setBatch(json.data.batch);
      setRows(json.data.rows ?? []);
    },
    [actorUserId]
  );

  const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(isOver);
  };

  const applySelectedFile = (f: File | null) => {
    setFile(f);
    setError(null);
    setApplyResult(null);
    setBatch(null);
    setRows([]);
    setBatchId(null);
    setSelectedIds(new Set());
    setRowFilter('all');
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    applySelectedFile(e.dataTransfer.files?.[0] || null);
  };

  const upload = async () => {
    if (!file) return;
    setError(null);
    setApplyResult(null);
    setRowFilter('all');
    setSelectedIds(new Set());
    setUploading(true);
    setUploadJobId(null);
    setUploadPct(0);
    setUploadMsg('Uploading…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/sfc-import/upload', {
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
      setUploading(false);
    }
  };

  // Poll upload job
  useEffect(() => {
    if (!uploadJobId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/sfc-import/jobs/${encodeURIComponent(uploadJobId)}`, {
          headers: { 'x-actor-user-id': actorUserId },
        });
        const json = await res.json();
        if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to fetch job progress');
        const job = json.data as { status: string; pct: number; message: string; batchId: number | null; error?: string };
        if (cancelled) return;

        setUploadPct(Number(job.pct) || 0);
        setUploadMsg(String(job.message || 'Processing…'));

        if (job.status === 'done') {
          if (job.batchId) {
            setBatchId(job.batchId);
            await loadPreview(job.batchId);
          }
          setUploading(false);
          setUploadJobId(null);
          return;
        }

        if (job.status === 'failed') {
          setError(String(job.error || 'Upload processing failed'));
          setUploading(false);
          setUploadJobId(null);
          return;
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Upload progress failed');
        setUploading(false);
        setUploadJobId(null);
        return;
      }

      setTimeout(tick, 500);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [uploadJobId, actorUserId, loadPreview]);

  // Poll preview during apply
  useEffect(() => {
    if (!applying || !batchId) return;
    void loadPreview(batchId).catch(() => {});
    const id = setInterval(() => void loadPreview(batchId).catch(() => {}), 500);
    return () => clearInterval(id);
  }, [applying, batchId, loadPreview]);

  // Compute apply progress from live row statuses
  useEffect(() => {
    if (!applying) return;
    const selected = rows.filter((r) => selectedIds.has(r.id));
    const total = selected.length;
    const done = selected.filter((r) => ['applied', 'skipped', 'failed'].includes(String(r.apply_status || ''))).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    setApplyPct(pct);
    setApplyMsg(`Applying payments… (${done}/${total})`);
  }, [applying, rows, selectedIds]);

  useEffect(() => {
    if (!batchId) return;
    void loadPreview(batchId);
  }, [batchId]);

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllReady = () => {
    setSelectedIds(new Set(filteredRows.filter((r) => r.match_status === 'ready').map((r) => r.id)));
  };

  const deselectAll = () => setSelectedIds(new Set());

  const applySelected = async () => {
    if (!batchId || selectedIds.size === 0) return;
    setError(null);
    setApplying(true);
    setApplyPct(0);
    setApplyMsg('Starting…');
    try {
      const res = await fetch(`/api/sfc-import/batches/${batchId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
        body: JSON.stringify({ rowIds: Array.from(selectedIds) }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Apply failed');
      setApplyResult(json.data);
      await loadPreview(batchId);
      // Applied rows move to match_status='already_applied' and become non-selectable — clear the
      // selection so it doesn't keep counting rows that can no longer be re-applied.
      setSelectedIds(new Set());
    } catch (e: any) {
      setError(e?.message || 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const unmatchedWithEnrolment = useMemo(
    () => rows.filter((r) => r.match_status === 'unmatched' && r.matched_enrolment_id && !r.matched_qbo_invoice_id),
    [rows]
  );

  const syncInvoiceIds = async () => {
    if (!batchId) return;
    setSyncingInvoiceIds(true);
    setSyncInvoiceResult(null);
    try {
      const res = await fetch(`/api/sfc-import/batches/${batchId}/sync-invoice-ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Sync failed');
      setSyncInvoiceResult(json.data);
      await loadPreview(batchId);
    } catch (e: any) {
      setError(e?.message || 'Sync QB invoice IDs failed');
    } finally {
      setSyncingInvoiceIds(false);
    }
  };

  const generateInvoice = async (rowId: number, enrolmentId: string) => {
    if (!batchId) return;
    setInvoiceGenLoading((prev) => new Set(prev).add(rowId));
    setInvoiceGenErrors((prev) => { const m = new Map(prev); m.delete(rowId); return m; });
    try {
      const res = await fetch(`/api/sfc-import/batches/${batchId}/generate-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
        body: JSON.stringify({ rowId, enrolmentId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Invoice generation failed');
      await loadPreview(batchId);
    } catch (e: any) {
      setInvoiceGenErrors((prev) => new Map(prev).set(rowId, e?.message || 'Invoice generation failed'));
    } finally {
      setInvoiceGenLoading((prev) => { const s = new Set(prev); s.delete(rowId); return s; });
    }
  };

  // DA-only counterpart: creates the SFC-CA supplemental invoice (not the main Customer invoice
  // generateInvoice above creates), for a DA row that has none yet.
  const generateSfcInvoice = async (row: SfcPreviewRow) => {
    if (!batchId || !row.matched_enrolment_id || !row.claim_id || !row.da_application_id) return;
    setInvoiceGenLoading((prev) => new Set(prev).add(row.id));
    setInvoiceGenErrors((prev) => { const m = new Map(prev); m.delete(row.id); return m; });
    try {
      const res = await fetch(`/api/sfc-import/batches/${batchId}/generate-sfc-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
        body: JSON.stringify({
          rowId: row.id,
          enrolmentId: row.matched_enrolment_id,
          claimId: row.claim_id,
          applicationId: row.da_application_id,
          mainInvoiceDocNumber: row.main_qbo_doc_number,
          fallbackAmount: row.claim_amount ? Number(row.claim_amount) : 0,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'SFC invoice generation failed');
      await loadPreview(batchId);
    } catch (e: any) {
      setInvoiceGenErrors((prev) => new Map(prev).set(row.id, e?.message || 'SFC invoice generation failed'));
    } finally {
      setInvoiceGenLoading((prev) => { const s = new Set(prev); s.delete(row.id); return s; });
    }
  };

  // Bulk counterpart to generateSfcInvoice above — same underlying call, run one row at a time
  // server-side (not in parallel), for every Ready DA row missing its SFC-CA invoice.
  const bulkGenerateSfcInvoices = async () => {
    if (!batchId) return;
    setBulkGeneratingSfc(true);
    setBulkGenerateSfcResult(null);
    try {
      const res = await fetch(`/api/sfc-import/batches/${batchId}/generate-sfc-invoices-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-actor-user-id': actorUserId },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Bulk SFC invoice generation failed');
      setBulkGenerateSfcResult(json.data);
      await loadPreview(batchId);
    } catch (e: any) {
      setError(e?.message || 'Bulk SFC invoice generation failed');
    } finally {
      setBulkGeneratingSfc(false);
    }
  };

  const daReadyMissingSfc = useMemo(
    () => rows.filter((r) => r.is_da && r.match_status === 'ready' && !(r.matched_qbo_doc_number && /^SFC-/i.test(r.matched_qbo_doc_number))),
    [rows]
  );

  // Dry run first, always: it reports the count without writing, so the number
  // is visible before anything changes. Filling only ever populates a blank.
  const runClaimFix = async (dryRun: boolean) => {
    setClaimFixBusy(true);
    setClaimFixMsg(null);
    try {
      const token = authService.getAuthToken();
      const res = await fetch('/api/admin/backfill-da-sfc-claim-ids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ dryRun }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not check claim ids');
      setClaimFixMsg(json.message);
      setClaimFixPending(dryRun ? json.matched : 0);
    } catch (e) {
      setClaimFixMsg(e instanceof Error ? e.message : 'Could not check claim ids');
    } finally {
      setClaimFixBusy(false);
    }
  };

  const readyCount = rows.filter((r) => r.match_status === 'ready').length;
  const allReadySelected = readyCount > 0 && rows.filter((r) => r.match_status === 'ready').every((r) => selectedIds.has(r.id));
  const someReadySelected = rows.filter((r) => r.match_status === 'ready').some((r) => selectedIds.has(r.id));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-on-surface">SFC Claim Payment Sync</h2>
          <p className="text-sm text-on-surface-secondary mt-1">
            Upload TPGateway SFC payout report to reconcile SFC claim payments in QuickBooks
          </p>
        </div>
      </div>

      {/* Step 1 — Upload */}
      <Card className="p-4 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!actorUserId) { setError('Login required.'); return; }
            if (!file) { setError('Please choose an Excel file (.xlsx) to upload.'); return; }
            if (fileValidationError) { setError(fileValidationError); return; }
            void upload();
          }}
          className="space-y-4"
        >
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 className="font-semibold text-amber-800 mb-1">Step 1 — Upload & Preview</h4>
            <p className="text-sm text-amber-700">
              Upload the TPGateway SFC Payout Excel (.xlsx). Only rows with <strong>Claim Status = Paid</strong> are processed. No QB writes happen in Step 1.
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
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">XLSX file format only</p>
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
              <button type="button" onClick={() => setError(null)} className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <Icon name={IconName.Close} className="w-5 h-5" />
              </button>
            </div>
          )}

          {batchId && (
            <div className="p-3 bg-surface-elevated rounded-lg text-xs text-on-surface-secondary">
              Batch ID: <span className="font-mono">{batchId}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={!file || uploading || !!fileValidationError || !actorUserId}>
              {uploading ? 'Processing…' : 'Upload & Parse'}
            </Button>
          </div>
          {!actorUserId && <p className="text-xs text-red-600 dark:text-red-300">Login required.</p>}
        </form>
      </Card>

      {/* DA info banner — shown when DA enrolments are present in this batch */}
      {batch && counts.da > 0 && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-800 p-4 flex items-start gap-3">
          <Icon name={IconName.InfoCircle} className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-purple-800 dark:text-purple-200">
            <strong>{counts.da}</strong> Direct Application (DA) enrolment{counts.da !== 1 ? 's' : ''} detected.
            For DA rows, SFC payments are applied to the supplemental QB invoice with DocNumber <strong>SFC-CA-…</strong> (from the SSG Application ID).
            If the SFC-CA invoice is missing, it will be created automatically during <strong>Apply Selected</strong>.
          </p>
        </div>
      )}

      {/* Summary cards + table */}
      {batch && rows.length >= 0 && batchId !== null && (
        <>
          <Card className="p-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="font-semibold text-amber-800 mb-1">Step 2 — Review & Select</h4>
              <p className="text-sm text-amber-700">
                Review matched rows. Only <strong>Ready</strong> rows can be applied. Select them and click <strong>Apply Selected</strong>.
              </p>
            </div>
          </Card>

          {/* Sync QB Invoice IDs banner */}
          {unmatchedWithEnrolment.length > 0 && (
            <Card className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="flex items-start gap-3">
                  <Icon name={IconName.InfoCircle} className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-on-surface">
                      {unmatchedWithEnrolment.length} row{unmatchedWithEnrolment.length !== 1 ? 's' : ''} matched to an enrolment but no QB invoice found.
                    </p>
                    <p className="text-xs text-on-surface-secondary mt-0.5">
                      Click <strong>Sync QB Invoice IDs</strong> to search QuickBooks for existing invoices and automatically resolve these rows.
                    </p>
                    {syncInvoiceResult && (
                      <>
                        <p className="text-xs mt-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                          Last sync: {syncInvoiceResult.resolved} resolved, {syncInvoiceResult.notFound} not found in QB, {syncInvoiceResult.rejected} rejected (failed content verification), {syncInvoiceResult.errors} errors (of {syncInvoiceResult.total} processed)
                        </p>
                        {!!syncInvoiceResult.warnings?.length && (
                          <p className="text-xs mt-1 font-semibold text-red-600 dark:text-red-400">
                            {syncInvoiceResult.warnings.join(' · ')}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  disabled={syncingInvoiceIds}
                  onClick={() => void syncInvoiceIds()}
                  className="flex-shrink-0"
                >
                  {syncingInvoiceIds ? 'Searching QB…' : `Sync QB Invoice IDs (${unmatchedWithEnrolment.length})`}
                </Button>
              </div>
            </Card>
          )}

          {/* Bulk Generate SFC Invoice banner */}
          {daReadyMissingSfc.length > 0 && (
            <Card className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="flex items-start gap-3">
                  <Icon name={IconName.InfoCircle} className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-on-surface">
                      {daReadyMissingSfc.length} Ready DA row{daReadyMissingSfc.length !== 1 ? 's' : ''} with no SFC-CA invoice yet.
                    </p>
                    <p className="text-xs text-on-surface-secondary mt-0.5">
                      Click <strong>Generate SFC Invoices</strong> to create them all in QuickBooks, one at a time.
                    </p>
                    {bulkGenerateSfcResult && (
                      <>
                        <p className="text-xs mt-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                          Last run: {bulkGenerateSfcResult.generated} generated, {bulkGenerateSfcResult.failed} failed (of {bulkGenerateSfcResult.total} processed)
                        </p>
                        {bulkGenerateSfcResult.errors.slice(0, 5).map((e) => (
                          <p key={e.rowId} className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                            Claim {e.claimId || e.rowId}: {e.error}
                          </p>
                        ))}
                        {bulkGenerateSfcResult.errors.length > 5 && (
                          <p className="text-[11px] text-on-surface-secondary mt-0.5">
                            +{bulkGenerateSfcResult.errors.length - 5} more error{bulkGenerateSfcResult.errors.length - 5 !== 1 ? 's' : ''}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  disabled={bulkGeneratingSfc}
                  onClick={() => void bulkGenerateSfcInvoices()}
                  className="flex-shrink-0"
                >
                  {bulkGeneratingSfc ? 'Generating…' : `Generate SFC Invoices (${daReadyMissingSfc.length})`}
                </Button>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <Card className="p-3 text-center">
              <div className="text-lg font-bold text-on-surface">{counts.total}</div>
              <div className="text-[11px] text-on-surface-secondary">Total Rows</div>
            </Card>
            <Card className="p-3 text-center border border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-900/10">
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{counts.ready}</div>
              <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">Ready</div>
            </Card>
            <Card className="p-3 text-center border border-blue-500/30 bg-blue-50/40 dark:bg-blue-900/10">
              <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{counts.already_applied}</div>
              <div className="text-[11px] text-blue-700/80 dark:text-blue-300/80">Already Applied</div>
            </Card>
            <Card className="p-3 text-center border border-purple-500/30 bg-purple-50/40 dark:bg-purple-900/10">
              <div className="text-lg font-bold text-purple-700 dark:text-purple-300">{counts.da}</div>
              <div className="text-[11px] text-purple-700/80 dark:text-purple-300/80">DA Enrolments</div>
            </Card>
            <Card className="p-3 text-center border border-yellow-500/30 bg-yellow-50/40 dark:bg-yellow-900/10">
              <div className="text-lg font-bold text-yellow-700 dark:text-yellow-300">{counts.needs_review}</div>
              <div className="text-[11px] text-yellow-700/80 dark:text-yellow-300/80">Needs Review</div>
            </Card>
            <Card className="p-3 text-center border border-red-500/30 bg-red-50/40 dark:bg-red-900/10">
              <div className="text-lg font-bold text-red-700 dark:text-red-300">{counts.unmatched + counts.invalid}</div>
              <div className="text-[11px] text-red-700/80 dark:text-red-300/80">Need Attention</div>
            </Card>
          </div>

          {/* Controls */}
          <Card className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" onClick={selectAllReady}>Select all Ready</Button>
                <Button variant="outline" onClick={deselectAll}>Deselect all</Button>
                <span className="text-xs text-on-surface-secondary">
                  Selected: <span className="font-semibold text-on-surface">{selectedIds.size}</span>
                </span>
              </div>
              <Button onClick={() => void applySelected()} disabled={applying || selectedIds.size === 0}>
                {applying ? 'Applying…' : `Apply Selected (${selectedIds.size})`}
              </Button>
            </div>
          </Card>

          {/* Apply result summary */}
          {applyResult && (
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
            </Card>
          )}

          {/* Filter pills + table */}
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-default bg-surface-elevated">
              <span className="text-[11px] font-semibold text-on-surface-secondary uppercase tracking-wider mr-1">Filter:</span>
              {(
                [
                  { key: 'all', label: 'All', count: rows.length, cls: 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900' },
                  { key: 'ready', label: 'Ready', count: counts.ready, cls: 'bg-emerald-600 text-white' },
                  { key: 'already_applied', label: 'Already Applied', count: counts.already_applied, cls: 'bg-blue-600 text-white' },
                  { key: 'da', label: 'DA', count: counts.da, cls: 'bg-purple-600 text-white' },
                  { key: 'needs_review', label: 'Needs Review', count: counts.needs_review, cls: 'bg-yellow-500 text-white' },
                  { key: 'unmatched', label: 'Unmatched', count: counts.unmatched, cls: 'bg-red-500 text-white' },
                  { key: 'invalid', label: 'Invalid', count: counts.invalid, cls: 'bg-orange-500 text-white' },
                  ...(applyResult ? [
                    { key: 'applied', label: 'Applied', count: rows.filter((r) => r.apply_status === 'applied').length, cls: 'bg-emerald-600 text-white' },
                    { key: 'failed', label: 'Failed', count: rows.filter((r) => r.apply_status === 'failed').length, cls: 'bg-red-500 text-white' },
                    { key: 'skipped', label: 'Skipped', count: rows.filter((r) => r.apply_status === 'skipped').length, cls: 'bg-amber-500 text-white' },
                  ] : []),
                ] as Array<{ key: string; label: string; count: number; cls: string }>
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setRowFilter(opt.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    rowFilter === opt.key ? opt.cls : 'bg-surface text-on-surface-secondary border border-default hover:bg-surface-hover'
                  }`}
                >
                  {opt.label} ({opt.count})
                </button>
              ))}
              {rowFilter !== 'all' && (
                <span className="ml-auto text-[11px] text-on-surface-secondary">
                  Showing {filteredRows.length} of {rows.length} rows
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-default bg-surface-elevated">
                    <th className="px-3 py-2 text-xs text-left">
                      <button
                        type="button"
                        onClick={() => {
                          if (allReadySelected) deselectAll();
                          else selectAllReady();
                        }}
                        className="inline-flex items-center justify-center -m-2 p-2 rounded-md hover:bg-surface-hover"
                        title="Select / deselect all Ready rows"
                      >
                        <input
                          type="checkbox"
                          checked={allReadySelected}
                          ref={(el) => { if (el) el.indeterminate = !allReadySelected && someReadySelected; }}
                          onChange={() => {}}
                          className="pointer-events-none"
                        />
                      </button>
                    </th>
                    <th className="px-3 py-2 text-xs text-left">Claim ID</th>
                    <th className="px-3 py-2 text-xs text-left">Trainee</th>
                    <th className="px-3 py-2 text-xs text-left">NRIC</th>
                    <th className="px-3 py-2 text-xs text-left">Course</th>
                    <th className="px-3 py-2 text-xs text-left">Course Ref No</th>
                    <th className="px-3 py-2 text-xs text-left">Course Start Date</th>
                    <th className="px-3 py-2 text-xs text-left">Disbursement Date</th>
                    <th className="px-3 py-2 text-xs text-right">Amount</th>
                    <th className="px-3 py-2 text-xs text-left">Payout Req ID</th>
                    <th className="px-3 py-2 text-xs text-left">Enrolment ID</th>
                    <th className="px-3 py-2 text-xs text-left">Customer Invoice No</th>
                    <th className="px-3 py-2 text-xs text-left">SFC Invoice No</th>
                    <th className="px-3 py-2 text-xs text-right">QB Balance</th>
                    <th className="px-3 py-2 text-xs text-left">FMS Status</th>
                    <th className="px-3 py-2 text-xs text-left">QB Status</th>
                    <th className="px-3 py-2 text-xs text-left">Match</th>
                    <th className="px-3 py-2 text-xs text-left">Type</th>
                    <th className="px-3 py-2 text-xs text-left">Apply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={19} className="px-4 py-6 text-center text-xs text-on-surface-secondary">
                        No rows match the selected filter.
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => {
                    const disabled = NON_APPLICABLE_MATCH_STATUSES.includes(r.match_status);
                    const isSelected = selectedIds.has(r.id);
                    return (
                      <tr
                        key={r.id}
                        className={
                          r.match_status === 'already_applied'
                            ? 'bg-blue-50/30 dark:bg-blue-900/10'
                            : r.match_status === 'skipped_da' || r.is_da
                              ? 'bg-purple-50/20 dark:bg-purple-900/5'
                              : disabled
                                ? 'bg-red-50/20 dark:bg-red-900/10'
                                : ''
                        }
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => !disabled && toggleRow(r.id)}
                            className={`inline-flex items-center justify-center -m-2 p-2 rounded-md ${
                              disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-hover cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={disabled}
                              onChange={() => {}}
                              className="pointer-events-none"
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{r.claim_id || '-'}</td>
                        <td className="px-3 py-2 text-xs max-w-[140px] truncate" title={r.individual_name || ''}>
                          {r.individual_name || '-'}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{maskNric(r.individual_nric)}</td>
                        <td className="px-3 py-2 text-xs max-w-[180px] truncate" title={r.course_name || ''}>
                          {r.course_name || '-'}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{r.course_reference_number || '-'}</td>
                        <td className="px-3 py-2 text-xs font-mono">{r.course_start_date || '-'}</td>
                        <td className="px-3 py-2 text-xs font-mono">{r.disbursement_date || '-'}</td>
                        <td className="px-3 py-2 text-xs text-right font-mono">{fmtMoney(r.claim_amount)}</td>
                        <td className="px-3 py-2 text-xs font-mono max-w-[120px] truncate" title={r.payout_request_id || ''}>
                          {r.payout_request_id || '-'}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono max-w-[140px] truncate" title={r.matched_enrolment_id || ''}>
                          {r.matched_enrolment_id || '-'}
                        </td>
                        {/* main_qbo_doc_number is a dedicated, always-content-verified field — it
                            persists independently of matched_qbo_doc_number, which for a DA row
                            gets overwritten once its SFC-CA invoice is generated. Never sourced
                            from the raw, unverified cache lookup stage-1 matching used to use. */}
                        <td className="px-3 py-2 text-xs font-mono">{r.main_qbo_doc_number || '-'}</td>
                        <td className="px-3 py-2 text-xs font-mono">
                          {!r.is_da ? (
                            '-'
                          ) : r.matched_qbo_doc_number && /^SFC-/i.test(r.matched_qbo_doc_number) ? (
                            r.matched_qbo_doc_number
                          ) : (
                            <div className="space-y-1">
                              <button
                                type="button"
                                disabled={invoiceGenLoading.has(r.id) || !r.claim_id || !r.da_application_id}
                                onClick={() => void generateSfcInvoice(r)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-900/20 dark:text-purple-300 dark:hover:bg-purple-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {invoiceGenLoading.has(r.id) ? 'Generating…' : 'Generate Invoice'}
                              </button>
                              {invoiceGenErrors.has(r.id) && (
                                <p className="text-[10px] text-red-600 dark:text-red-400 max-w-[200px] whitespace-pre-wrap">{invoiceGenErrors.get(r.id)}</p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-right font-mono">{fmtMoney(r.matched_qbo_invoice_balance)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${r.fms_updated ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300'}`}>
                            {r.fms_updated ? 'Paid' : 'Not Received'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${r.qb_updated ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300'}`}>
                            {r.qb_updated ? 'Applied' : 'Pending'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${matchBadgeClass(r.match_status)}`}
                            title={r.match_status === 'needs_review' && r.validation_errors?.length ? r.validation_errors.join('\n') : ''}
                          >
                            {matchBadgeLabel(r.match_status)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.is_da ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300">DA</span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-500 dark:bg-gray-700/30 dark:text-gray-400">Non-DA</span>
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[130px]">
                          {r.apply_status ? (
                            <span
                              className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${applyBadgeClass(r.apply_status)}`}
                              title={r.apply_error || ''}
                            >
                              {r.apply_status.charAt(0).toUpperCase() + r.apply_status.slice(1)}
                            </span>
                          ) : r.match_status === 'unmatched' && r.matched_enrolment_id && !r.matched_qbo_invoice_id && !r.is_da ? (
                            <div className="space-y-1">
                              <button
                                type="button"
                                disabled={invoiceGenLoading.has(r.id)}
                                onClick={() => void generateInvoice(r.id, r.matched_enrolment_id!)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300 dark:hover:bg-indigo-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {invoiceGenLoading.has(r.id) ? 'Generating…' : 'Generate Invoice'}
                              </button>
                              {invoiceGenErrors.has(r.id) && (
                                <p className="text-[10px] text-red-600 dark:text-red-400 max-w-[200px] whitespace-pre-wrap">{invoiceGenErrors.get(r.id)}</p>
                              )}
                            </div>
                          ) : (
                            // DA rows with no invoice linked yet show the "Generate Invoice" action
                            // under the SFC Invoice No column instead — that's the button that actually
                            // creates the SFC-CA supplemental invoice.
                            <span className="text-[11px] text-on-surface-secondary">—</span>
                          )}
                          {r.apply_status === 'failed' && r.apply_error && (
                            <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 max-w-[200px] whitespace-pre-wrap">{r.apply_error}</p>
                          )}
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

      {/* Upload progress overlay */}
      {uploading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[460px] max-w-[92vw] rounded-xl border border-default bg-surface p-6 shadow-2xl">
            <div className="text-base font-semibold text-on-surface">Processing SFC file…</div>
            <div className="mt-1 text-xs text-on-surface-secondary">{uploadMsg}</div>
            <div className="mt-5 flex items-center justify-center">
              <CircularProgress pct={uploadPct} label={uploadMsg} />
            </div>
            <div className="mt-4 h-2 w-full rounded-full bg-surface-elevated overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, uploadPct))}%` }} />
            </div>
            <div className="mt-3 text-[11px] text-on-surface-secondary text-center">
              Parsing rows, matching claim IDs, and checking QuickBooks balances.
            </div>
          </div>
        </div>
      )}

      {/* Apply progress overlay */}
      {applying && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[460px] max-w-[92vw] rounded-xl border border-default bg-surface p-6 shadow-2xl">
            <div className="text-base font-semibold text-on-surface">Applying SFC payments…</div>
            <div className="mt-1 text-xs text-on-surface-secondary">{applyMsg}</div>
            <div className="mt-5 flex items-center justify-center">
              <CircularProgress pct={applyPct} label={applyMsg} />
            </div>
            <div className="mt-4 h-2 w-full rounded-full bg-surface-elevated overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, applyPct))}%` }} />
            </div>
            <div className="mt-3 text-[11px] text-on-surface-secondary text-center">
              Creating QuickBooks payments and updating FMS claim status.
            </div>
          </div>
        </div>
      )}

      {/* One-off catch-up — new payout imports fill claim ids automatically. */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Claim IDs on Direct Applications</h3>
            <p className="text-xs text-on-surface-secondary mt-1 max-w-2xl">
              A claim ID only exists once a learner has claimed, so applications confirmed
              earlier can be missing it. Uploading a payout report now fills them in
              automatically — use this once to catch up the older ones. It only fills blanks
              and never changes a claim ID that is already there.
            </p>
            {claimFixMsg && (
              <p className="text-xs mt-2 text-on-surface">{claimFixMsg}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => runClaimFix(true)} disabled={claimFixBusy}>
              {claimFixBusy ? 'Checking…' : 'Check'}
            </Button>
            <Button
              onClick={() => runClaimFix(false)}
              disabled={claimFixBusy || !claimFixPending}
              title={!claimFixPending ? 'Run Check first' : undefined}
            >
              Fill{claimFixPending ? ` ${claimFixPending}` : ''}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SfcPaymentSyncView;
