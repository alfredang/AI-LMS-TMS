/**
 * SupportingDocsModal
 *
 * Gate the admin must clear before invoice emails are sent for a Company
 * Application upload.
 *
 *   Step 1 (initialStep='ask') — Yes/No prompt. Used after the upload
 *   pipeline finishes when admin may not have collected docs yet. View-page
 *   entrypoints pass initialStep='verify' to skip this and go straight to
 *   the verification UI.
 *
 *   Step 2 — One card per learner. Admin uploads the supporting doc and
 *   reviews it (inline preview) against the Excel row. Each of name / NRIC /
 *   employer / UEN must be confirmed individually. Strict block: any ✗
 *   marks the row as mismatch and clears the doc, forcing a re-upload.
 *
 * The invoice is generated per (employer × course-run) group, so the email
 * is also per group. Once every row in a group flips to 'verified', the
 * verify-and-send endpoint fires the consolidated invoice email for that
 * group. Idempotent — already-sent invoices stay sent.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { ConfirmPopup } from './ConfirmPopup';
import { maskNric } from './CompanyApplicationViews';

interface LearnerRow {
  id: string;
  traineeFullName: string;
  traineeNric: string;
  employerOrgName: string;
  employerUen: string;
  courseTitle: string;
  invoiceId: string;
  supportingDocLink: string;
  supportingDocFileId: string;
  verificationStatus: string;
}

type FieldKey = 'name' | 'nric' | 'employer' | 'uen';
type FieldVerdict = '' | 'match' | 'mismatch' | 'na';
type FieldState = Record<FieldKey, FieldVerdict>;

const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Trainee full name',
  nric: 'Trainee NRIC / FIN',
  employer: 'Employer name',
  uen: 'Employer UEN',
};

const EMPTY_FIELDS: FieldState = { name: '', nric: '', employer: '', uen: '' };

interface Props {
  applicationIds: string[];
  onClose: () => void;
  onCompleted?: () => void;
  verifiedBy?: string;
  initialStep?: 'ask' | 'verify';
}

// Bulk upload state. Files picked via "Upload all docs" sit here (in-memory)
// until admin assigns each to a learner. Click-to-assign and drag-and-drop
// both terminate by calling the same upload endpoint with the chosen
// (file, learnerId) pair. previewUrl is an object URL revoked when the file
// leaves the strip (assigned, removed, or modal unmounts).
interface UnassignedFile {
  id: string;
  file: File;
  previewUrl: string;
  uploading?: boolean;
  aiProcessing?: boolean;  // AI vision call in flight
  aiNoMatch?: boolean;     // AI ran but couldn't match to any learner — assign manually
  aiNoMatchReason?: string; // Human-readable explanation for the no-match (e.g. "Couldn't read NRIC")
  error?: string | null;
}

interface AiResult {
  // Pre-filled match/mismatch verdicts per field. Admin can override.
  verdicts: FieldState;
  confidence: 'high' | 'medium' | 'low';
  // If false, AI flagged at least one mismatch — admin must review before confirming.
  allMatch: boolean;
}

type SendOutcome = 'sent' | 'held' | 'no-invoice' | 'unknown';

// Response shapes for the API endpoints this modal hits. Centralising them
// here so a typo in field access fails at compile time instead of silently
// returning undefined at runtime when the backend contract drifts.
interface FetchRowsResponse {
  rows?: Array<Record<string, unknown>>;
  success?: boolean;
  error?: string;
}
interface UploadDocResponse {
  success: boolean;
  fileId?: string;
  webViewLink?: string;
  traineeFullName?: string;
  error?: string;
}
interface DeleteDocResponse {
  success: boolean;
  driveDeleted?: boolean;
  driveError?: string | null;
  error?: string;
}
interface AiProcessResponse {
  success: boolean;
  matchedLearnerId?: string | null;
  verdicts?: { name?: string; nric?: string; employer?: string; uen?: string } | null;
  extracted?: { nric?: string | null; fullName?: string | null; employerName?: string | null; employerUen?: string | null };
  confidence?: 'high' | 'medium' | 'low';
  error?: string;
}
interface VerifyAndSendResponse {
  success: boolean;
  status?: 'verified' | 'mismatch';
  groupSent?: boolean;
  heldInTestMode?: boolean;
  groupTotal?: number;
  groupVerified?: number;
  emailSummary?: { sent?: number; toggleDisabled?: boolean } | null;
  emailError?: string;
  error?: string;
}

const SupportingDocsModal: React.FC<Props> = ({ applicationIds, onClose, onCompleted, verifiedBy, initialStep = 'ask' }) => {
  const [step, setStep] = useState<'ask' | 'verify'>(initialStep);
  const [rows, setRows] = useState<LearnerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the latest verify-and-send API result so the footer can show
  // accurate copy. Without this we'd render "invoice email released" even
  // when the master toggle held the email back (heldInTestMode).
  const [lastSendOutcome, setLastSendOutcome] = useState<SendOutcome>('unknown');

  const [unassignedFiles, setUnassignedFiles] = useState<UnassignedFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [dragOverLearnerId, setDragOverLearnerId] = useState<string | null>(null);
  // AI extraction results keyed by learner ID. Populated when the AI endpoint
  // matches a doc to a candidate and returns per-field verdicts. LearnerCard
  // reads these to pre-fill its match/mismatch pills.
  const [aiResults, setAiResults] = useState<Record<string, AiResult>>({});
  // Bulk-approve in-flight indicator for the "Approve all AI-confirmed" button.
  const [bulkApproving, setBulkApproving] = useState(false);
  // True once the AI endpoint failed (typically no API key) — switches the
  // UI to manual mode and stops auto-extraction attempts.
  const [aiDisabled, setAiDisabled] = useState(false);

  const idSet = useMemo(() => new Set(applicationIds.map(String)), [applicationIds]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/fetch-company-applications');
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const json: FetchRowsResponse = await res.json();
      // Backend keys are dynamic strings; safe-coerce each field through String()
      // so the resulting LearnerRow object is always typed.
      const filtered: LearnerRow[] = (json.rows || [])
        .filter(r => idSet.has(String(r['id'] || '')))
        .map(r => ({
          id: String(r['id'] || ''),
          traineeFullName: String(r['Trainee FULL Name as on government ID*'] || ''),
          traineeNric: String(r['Trainee NRIC/FIN Number*'] || ''),
          employerOrgName: String(r['Employer Organization Name*'] || ''),
          employerUen: String(r['Employer UEN*'] || ''),
          courseTitle: String(r['Course Title*'] || ''),
          invoiceId: String(r['Invoice ID'] || ''),
          supportingDocLink: String(r['Supporting Doc Drive Link'] || ''),
          supportingDocFileId: String(r['Supporting Doc Drive File ID'] || ''),
          verificationStatus: String(r['Supporting Doc Verification Status'] || ''),
        }));
      setRows(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rows');
    } finally {
      setLoading(false);
    }
  }, [idSet]);

  useEffect(() => {
    if (step === 'verify') void loadRows();
  }, [step, loadRows]);

  // Object-URL cleanup. Each preview thumbnail holds a blob URL that must
  // be revoked when the file leaves the strip — otherwise the browser
  // retains those blobs for the page lifetime.
  useEffect(() => {
    return () => {
      unassignedFiles.forEach(f => {
        try { URL.revokeObjectURL(f.previewUrl); } catch { /* noop */ }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forward-declared so addBulkFiles can fire AI extraction immediately on add.
  // The actual ref is filled in the AI-extract effect below.
  const aiExtractRef = useRef<((wrapped: UnassignedFile) => Promise<void>) | null>(null);

  // Always-current ref over `rows` so async work inside runAiExtract sees
  // the latest learner list (e.g. if a row was just verified in another tab,
  // we shouldn't re-match a freshly-uploaded doc to it). Avoids the stale
  // closure risk that would otherwise tie candidates to whatever rows was
  // at useCallback-recompute time.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const addBulkFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const wrapped: UnassignedFile[] = arr.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      aiProcessing: !aiDisabled,
    }));
    setUnassignedFiles(prev => [...prev, ...wrapped]);
    // Kick off AI extraction for each in parallel — falls through to manual
    // mode if the endpoint reports no API key.
    if (!aiDisabled && aiExtractRef.current) {
      for (const w of wrapped) {
        void aiExtractRef.current(w);
      }
    }
  }, [aiDisabled]);

  const removeUnassignedFile = useCallback((fileId: string) => {
    setUnassignedFiles(prev => {
      const target = prev.find(f => f.id === fileId);
      if (target) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* noop */ }
      }
      return prev.filter(f => f.id !== fileId);
    });
    setSelectedFileId(prev => (prev === fileId ? null : prev));
  }, []);

  // Run AI vision against one unassigned file: identify the matching learner
  // and pre-fill the 4 match/mismatch verdicts. On success, the file is
  // immediately uploaded to that learner's Drive folder so the LearnerCard
  // picks up the doc + the AI's verdicts in one round-trip from the admin's
  // perspective. On failure (no API key / parse error), the file stays in
  // the strip so the admin can drag/assign manually.
  const runAiExtract = useCallback(async (uf: UnassignedFile) => {
    // Build the candidate roster of UNVERIFIED rows so AI doesn't try to
    // re-assign docs to already-verified learners. Read from rowsRef so the
    // candidate set is always the latest snapshot, not whatever it was when
    // this useCallback was last recomputed.
    const candidates = rowsRef.current
      .filter(r => r.verificationStatus.toLowerCase() !== 'verified')
      .map(r => ({
        id: r.id,
        nric: r.traineeNric,
        fullName: r.traineeFullName,
        employerName: r.employerOrgName,
        employerUen: r.employerUen,
      }));
    if (candidates.length === 0) {
      setUnassignedFiles(prev => prev.map(f => f.id === uf.id ? { ...f, aiProcessing: false } : f));
      return;
    }
    try {
      const form = new FormData();
      form.append('file', uf.file);
      form.append('learners', JSON.stringify(candidates));
      const res = await fetch('/api/admin/ca-ai-process-supporting-doc', {
        method: 'POST',
        body: form,
      });
      const json: AiProcessResponse = await res.json();

      if (!res.ok || !json.success) {
        // 400 with "ANTHROPIC_API_KEY not configured" → disable AI for the rest
        // of this session. Admin keeps manual flow.
        if (res.status === 400 && typeof json.error === 'string' && json.error.includes('ANTHROPIC_API_KEY')) {
          setAiDisabled(true);
        }
        // Mark as no-match so the admin sees an amber badge — same outcome
        // from the admin's perspective (this file needs manual assignment).
        setUnassignedFiles(prev => prev.map(f => f.id === uf.id ? { ...f, aiProcessing: false, aiNoMatch: true } : f));
        return;
      }

      const matchedId = json.matchedLearnerId ?? null;
      const verdictsRaw = json.verdicts ?? null;

      if (!matchedId || !verdictsRaw) {
        // AI couldn't match this doc to any learner — build a specific reason
        // from what AI extracted. Matching is on name + employer, so the reason
        // explains which of those was missing or didn't line up with this batch.
        const extracted = json.extracted || {};
        const docName = (extracted.fullName || '').trim();
        const docEmployer = (extracted.employerName || '').trim();
        let reason: string;
        if (!docName && !docEmployer) {
          reason = 'AI could not extract a name or employer from this document — may not be a valid supporting doc.';
        } else if (!docName) {
          reason = `AI read employer "${docEmployer}" but could not read a learner name. Needs both to auto-match.`;
        } else if (!docEmployer) {
          reason = `AI read name "${docName}" but could not read an employer. Needs both to auto-match.`;
        } else {
          reason = `AI read "${docName}" at "${docEmployer}" — no learner in this batch matches both. Likely the wrong doc for this group.`;
        }
        setUnassignedFiles(prev => prev.map(f => f.id === uf.id
          ? { ...f, aiProcessing: false, aiNoMatch: true, aiNoMatchReason: reason }
          : f
        ));
        return;
      }

      // AI returns 'match' | 'mismatch' | 'unknown'. Map 'unknown' to 'na' —
      // it usually means the doc doesn't show that field at all (very common
      // for UEN on payslips, for example). Admin can override.
      const toVerdict = (v: string | undefined): FieldVerdict =>
        v === 'match' ? 'match' : v === 'mismatch' ? 'mismatch' : v === 'unknown' ? 'na' : '';
      const verdicts: FieldState = {
        name: toVerdict(verdictsRaw.name),
        nric: toVerdict(verdictsRaw.nric),
        employer: toVerdict(verdictsRaw.employer),
        uen: toVerdict(verdictsRaw.uen),
      };
      // Critical fields are trainee name + employer name. NRIC and UEN are
      // sanity-check info — useful context for the admin, but not gating.
      const allMatch = verdicts.name === 'match' && verdicts.employer === 'match';
      const confidence = (json.confidence === 'high' || json.confidence === 'medium' || json.confidence === 'low')
        ? json.confidence
        : 'low';

      setAiResults(prev => ({ ...prev, [matchedId]: { verdicts, confidence, allMatch } }));

      // Upload the file to that learner's Drive folder, then drop from strip.
      const upForm = new FormData();
      upForm.append('file', uf.file);
      upForm.append('companyApplicationId', matchedId);
      const upRes = await fetch('/api/admin/ca-upload-supporting-doc', {
        method: 'POST',
        body: upForm,
      });
      const upJson = await upRes.json();
      if (!upRes.ok || !upJson.success) {
        setUnassignedFiles(prev => prev.map(f => f.id === uf.id
          ? { ...f, aiProcessing: false, error: upJson.error || 'Upload after AI match failed' }
          : f));
        return;
      }

      try { URL.revokeObjectURL(uf.previewUrl); } catch { /* noop */ }
      setUnassignedFiles(prev => prev.filter(f => f.id !== uf.id));
      void loadRows();
    } catch (err) {
      setUnassignedFiles(prev => prev.map(f => f.id === uf.id
        ? { ...f, aiProcessing: false, error: err instanceof Error ? err.message : 'AI processing failed' }
        : f));
    }
  }, [loadRows]);

  // Wire the ref so addBulkFiles can call runAiExtract without a stale closure.
  useEffect(() => {
    aiExtractRef.current = runAiExtract;
  }, [runAiExtract]);

  // Bulk-approve every learner where the AI returned all-4-match verdicts and
  // the row is still unverified. Calls /api/admin/ca-verify-and-send per row —
  // when each group hits full verification, the email auto-sends.
  const bulkApproveAiConfirmed = useCallback(async () => {
    const targets = rows.filter(r => {
      if (r.verificationStatus.toLowerCase() === 'verified') return false;
      // Stale AI results survive doc deletion in this component's state.
      // Without a doc to verify against, the AI verdict is meaningless —
      // skip these rows so admin can't bulk-approve empty cards.
      if (!r.supportingDocLink) return false;
      const ai = aiResults[r.id];
      return !!ai && ai.allMatch;
    });
    if (targets.length === 0) return;
    setBulkApproving(true);
    try {
      const results: Array<VerifyAndSendResponse | null> = await Promise.all(targets.map(r =>
        fetch('/api/admin/ca-verify-and-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyApplicationId: r.id, verdict: 'verified', verifiedBy }),
        }).then(res => res.json() as Promise<VerifyAndSendResponse>).catch(() => null)
      ));
      // Capture the outcome from the last successful response — that's the
      // one most likely to reflect what happens for the final row in a
      // group (which is when the email would actually fire).
      const last = [...results].reverse().find(r => r && r.success);
      if (last) {
        if (last.heldInTestMode) setLastSendOutcome('held');
        else if (last.groupSent) setLastSendOutcome('sent');
        else setLastSendOutcome('no-invoice');
      }
      void loadRows();
    } finally {
      setBulkApproving(false);
    }
  }, [rows, aiResults, verifiedBy, loadRows]);

  const aiConfirmedCount = useMemo(() => {
    return rows.filter(r => {
      if (r.verificationStatus.toLowerCase() === 'verified') return false;
      if (!r.supportingDocLink) return false;
      const ai = aiResults[r.id];
      return !!ai && ai.allMatch;
    }).length;
  }, [rows, aiResults]);

  const assignFileToLearner = useCallback(async (fileId: string, learnerId: string) => {
    const target = unassignedFiles.find(f => f.id === fileId);
    if (!target) return;
    setUnassignedFiles(prev => prev.map(f => f.id === fileId ? { ...f, uploading: true, error: null } : f));
    try {
      const form = new FormData();
      form.append('file', target.file);
      form.append('companyApplicationId', learnerId);
      const res = await fetch('/api/admin/ca-upload-supporting-doc', {
        method: 'POST',
        body: form,
      });
      const json: UploadDocResponse = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed');
      // Success — drop from strip, refresh rows so the learner card picks up
      // the new supportingDocLink.
      try { URL.revokeObjectURL(target.previewUrl); } catch { /* noop */ }
      setUnassignedFiles(prev => prev.filter(f => f.id !== fileId));
      setSelectedFileId(prev => (prev === fileId ? null : prev));
      void loadRows();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUnassignedFiles(prev => prev.map(f => f.id === fileId ? { ...f, uploading: false, error: message } : f));
    }
  }, [unassignedFiles, loadRows]);

  const verifiedCount = rows.filter(r => r.verificationStatus.toLowerCase() === 'verified').length;
  const allVerified = rows.length > 0 && verifiedCount === rows.length;
  const progressPct = rows.length > 0 ? Math.round((verifiedCount / rows.length) * 100) : 0;

  useEffect(() => {
    if (allVerified && step === 'verify') {
      onCompleted?.();
    }
  }, [allVerified, step, onCompleted]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <ModalHeader
          step={step}
          verifiedCount={verifiedCount}
          totalCount={rows.length}
          progressPct={progressPct}
          allVerified={allVerified}
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950/40">
          {step === 'ask' && <AskStep onYes={() => setStep('verify')} onNo={onClose} />}

          {step === 'verify' && (
            <div className="p-5 space-y-3">
              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                  <Icon name={IconName.Warning} className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {loading && rows.length === 0 ? (
                <LoadingState />
              ) : rows.length === 0 ? (
                <EmptyState />
              ) : (
                <>
                  {/* Hide bulk upload + AI banner when there's nothing left to
                      verify — admin opened the modal in "view" mode for an
                      already-cleared row and shouldn't be invited to re-upload. */}
                  {!allVerified && (
                    <>
                      <BulkUploadZone
                        unassignedFiles={unassignedFiles}
                        selectedFileId={selectedFileId}
                        onAddFiles={addBulkFiles}
                        onSelectFile={setSelectedFileId}
                        onRemoveFile={removeUnassignedFile}
                        aiDisabled={aiDisabled}
                      />
                      {aiConfirmedCount > 0 && (
                        <AiConfirmedBanner
                          count={aiConfirmedCount}
                          approving={bulkApproving}
                          onApproveAll={bulkApproveAiConfirmed}
                        />
                      )}
                    </>
                  )}
                  {rows.map(row => (
                    <LearnerCard
                      key={row.id}
                      row={row}
                      verifiedBy={verifiedBy}
                      onChanged={loadRows}
                      onSendResult={setLastSendOutcome}
                      viewMode={allVerified}
                      selectedFileId={selectedFileId}
                      dragOverLearnerId={dragOverLearnerId}
                      onDragOver={setDragOverLearnerId}
                      onAssignFile={assignFileToLearner}
                      aiResult={aiResults[row.id]}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <ModalFooter step={step} allVerified={allVerified} sendOutcome={lastSendOutcome} onClose={onClose} />
      </div>
    </div>
  );
};

// ── Header / Footer ────────────────────────────────────────────────────────

const ModalHeader: React.FC<{
  step: 'ask' | 'verify';
  verifiedCount: number;
  totalCount: number;
  progressPct: number;
  allVerified: boolean;
  onClose: () => void;
}> = ({ step, verifiedCount, totalCount, progressPct, allVerified, onClose }) => (
  <div className="p-5 border-b dark:border-gray-700 bg-white dark:bg-gray-900">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          step === 'ask'
            ? 'bg-amber-100 dark:bg-amber-900/30'
            : allVerified
              ? 'bg-emerald-100 dark:bg-emerald-900/30'
              : 'bg-blue-100 dark:bg-blue-900/30'
        }`}>
          <Icon
            name={step === 'ask' ? IconName.Warning : allVerified ? IconName.CheckCircle : IconName.Shield}
            className={`w-5 h-5 ${
              step === 'ask'
                ? 'text-amber-600 dark:text-amber-400'
                : allVerified
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-blue-600 dark:text-blue-400'
            }`}
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-bold dark:text-white truncate">
            {step === 'ask' ? 'Supporting Documents Check' : 'Verify Supporting Documents'}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {step === 'ask'
              ? 'All learners are enrolled. Invoices are ready. Confirm docs before emailing.'
              : totalCount > 0
                ? `${verifiedCount} of ${totalCount} learner${totalCount === 1 ? '' : 's'} verified`
                : 'Loading…'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
        aria-label="Close"
      >
        <Icon name={IconName.Close} className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      </button>
    </div>

    {step === 'verify' && totalCount > 0 && (
      <div className="mt-4">
        <div className="h-2 w-full bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ease-out ${
              allVerified ? 'bg-emerald-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    )}
  </div>
);

const ModalFooter: React.FC<{
  step: 'ask' | 'verify';
  allVerified: boolean;
  sendOutcome: SendOutcome;
  onClose: () => void;
}> = ({ step, allVerified, sendOutcome, onClose }) => {
  // When the group is fully verified, the API response from the last verdict
  // tells us what actually happened to the invoice email. Footer copy mirrors
  // that — claiming "released" while the master toggle is OFF was misleading.
  const renderVerifiedMessage = () => {
    if (sendOutcome === 'sent') {
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
          <Icon name={IconName.CheckCircle} className="w-4 h-4" />
          Every learner verified — invoice email released to the employer.
        </span>
      );
    }
    if (sendOutcome === 'held') {
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-semibold">
          <Icon name={IconName.Warning} className="w-4 h-4" />
          Every learner verified — invoice email held (master send toggle is OFF).
        </span>
      );
    }
    if (sendOutcome === 'no-invoice') {
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-semibold">
          <Icon name={IconName.Warning} className="w-4 h-4" />
          Every learner verified — invoice email not sent (no invoice generated yet for this group).
        </span>
      );
    }
    // Outcome unknown — most often when the group was already verified before
    // this modal opened (no fresh verdict captured). Stay neutral.
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
        <Icon name={IconName.CheckCircle} className="w-4 h-4" />
        Every learner verified.
      </span>
    );
  };

  return (
    <div className="p-4 border-t dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center justify-between gap-3">
      <p className="text-xs text-gray-500 dark:text-gray-400 flex-1">
        {step === 'verify' && allVerified ? renderVerifiedMessage() : step === 'verify' ? (
          "Invoice emails stay on hold until every learner from the same employer and course is verified."
        ) : ''}
      </p>
      <Button onClick={onClose} variant={allVerified ? 'primary' : 'secondary'}>
        {allVerified ? 'Done' : 'Close'}
      </Button>
    </div>
  );
};

// ── Ask Step ───────────────────────────────────────────────────────────────

const AskStep: React.FC<{ onYes: () => void; onNo: () => void }> = ({ onYes, onNo }) => (
  <div className="p-8 md:p-10">
    <div className="max-w-xl mx-auto text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-200 dark:ring-amber-800/60 mb-5">
        <Icon name={IconName.Shield} className="w-8 h-8 text-amber-600 dark:text-amber-400" />
      </div>
      <h4 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
        Are supporting documents ready?
      </h4>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-3 leading-relaxed">
        Screenshots, CPF statements, payslips, or bank statements for each learner.
        Each doc must match the Excel data — <strong className="text-gray-800 dark:text-gray-100">trainee name, NRIC, employer name, UEN</strong> —
        before the invoice email is released to the employer.
      </p>

      <div className="mt-7 flex items-center justify-center gap-2 text-xs">
        <FlowChip step={1} icon={IconName.Upload} label="Upload" />
        <FlowArrow />
        <FlowChip step={2} icon={IconName.CheckCircle} label="Verify each field" />
        <FlowArrow />
        <FlowChip step={3} icon={IconName.Mail} label="Email sends" />
      </div>

      <div className="flex justify-center gap-3 mt-8">
        <button
          type="button"
          onClick={onNo}
          className="px-5 py-2.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Not yet — I&apos;ll do this later
        </button>
        <button
          type="button"
          onClick={onYes}
          className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 ring-1 ring-emerald-400/50 shadow-md shadow-emerald-900/40 transition-colors"
        >
          Yes, upload &amp; verify
        </button>
      </div>
    </div>
  </div>
);

const FlowChip: React.FC<{ step: number; icon: IconName; label: string }> = ({ step, icon, label }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
      {step}
    </span>
    <Icon name={icon} className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
    <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">{label}</span>
  </div>
);

const FlowArrow: React.FC = () => (
  <svg
    className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

// ── Loading / Empty ─────────────────────────────────────────────────────────

const LoadingState: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
    <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-blue-500 mb-3" />
    <p className="text-sm">Loading learners…</p>
  </div>
);

const EmptyState: React.FC = () => (
  <div className="text-center py-16 text-gray-500 dark:text-gray-400">
    <Icon name={IconName.InfoCircle} className="w-8 h-8 mx-auto mb-2 opacity-60" />
    <p className="text-sm">No matching rows found.</p>
  </div>
);

// ── Per-learner Card ────────────────────────────────────────────────────────

const LearnerCard: React.FC<{
  row: LearnerRow;
  verifiedBy?: string;
  onChanged: () => void;
  onSendResult?: (outcome: SendOutcome) => void;
  // When true, the card stays expanded even after the row is verified —
  // used when the modal is opened in view mode (all rows already verified)
  // so the admin sees the doc on open instead of just a collapsed pill.
  viewMode?: boolean;
  selectedFileId?: string | null;
  dragOverLearnerId?: string | null;
  onDragOver?: (learnerId: string | null) => void;
  onAssignFile?: (fileId: string, learnerId: string) => void;
  aiResult?: AiResult;
}> = ({ row, verifiedBy, onChanged, onSendResult, viewMode = false, selectedFileId, dragOverLearnerId, onDragOver, onAssignFile, aiResult }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fields, setFields] = useState<FieldState>(aiResult?.verdicts || EMPTY_FIELDS);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Pre-fill verdicts when AI result arrives after initial render.
  // Once admin manually changes a field, do not overwrite with AI's value.
  const adminTouchedRef = useRef(false);
  useEffect(() => {
    if (aiResult?.verdicts && !adminTouchedRef.current) {
      setFields(aiResult.verdicts);
    }
  }, [aiResult]);

  const setFieldVerdict = (key: FieldKey, value: FieldVerdict) => {
    adminTouchedRef.current = true;
    setFields(f => ({ ...f, [key]: value }));
  };

  const status = row.verificationStatus.toLowerCase();
  const isVerified = status === 'verified';
  const isMismatch = status === 'mismatch';
  const hasDoc = !!row.supportingDocLink;
  const isDropTarget = !isVerified && !hasDoc;
  const isDraggingOver = isDropTarget && dragOverLearnerId === row.id;
  const isClickAssignTarget = isDropTarget && !!selectedFileId;

  // Auto-collapse cards once they're verified so admins can focus on
  // remaining learners. Skip when viewMode is on — admin came to look at
  // already-verified rows, so expanded-by-default is what they want.
  useEffect(() => {
    if (isVerified && !viewMode) setCollapsed(true);
  }, [isVerified, viewMode]);

  // Critical fields are trainee name + employer. NRIC and UEN remain on the
  // card as sanity-check info but don't gate the verdict — admin only needs
  // to confirm name/employer match to mark the row verified.
  const allMatched = fields.name === 'match' && fields.employer === 'match';
  const anyMismatch = fields.name === 'mismatch' || fields.employer === 'mismatch';

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('companyApplicationId', row.id);
      const res = await fetch('/api/admin/ca-upload-supporting-doc', {
        method: 'POST',
        body: form,
      });
      const json: UploadDocResponse = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed');
      setFields(EMPTY_FIELDS);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ca-delete-supporting-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyApplicationId: row.id }),
      });
      const json: DeleteDocResponse = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Delete failed');
      setFields(EMPTY_FIELDS);
      setConfirmingDelete(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const submitVerdict = async (verdict: 'verified' | 'mismatch') => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ca-verify-and-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyApplicationId: row.id, verdict, verifiedBy }),
      });
      const json: VerifyAndSendResponse = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Submit failed');
      // Surface the email send outcome to the parent so the footer can show
      // accurate copy (sent vs held by toggle vs no invoice yet). Mismatch
      // verdicts never trigger a send, so skip the callback for those.
      if (verdict === 'verified' && onSendResult) {
        if (json.heldInTestMode) onSendResult('held');
        else if (json.groupSent) onSendResult('sent');
        else onSendResult('no-invoice');
      }
      setFields(EMPTY_FIELDS);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Drop-target visual treatment overrides the resting ring colour so admin
  // can see exactly which card will receive a dropped or click-assigned file.
  const ringColor = isDraggingOver
    ? 'ring-2 ring-blue-500 dark:ring-blue-400'
    : isClickAssignTarget
      ? 'ring-2 ring-blue-300 dark:ring-blue-700/60'
      : isVerified
        ? 'ring-emerald-300 dark:ring-emerald-700/60'
        : isMismatch
          ? 'ring-red-300 dark:ring-red-700/60'
          : 'ring-gray-200 dark:ring-gray-700/60';

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isDropTarget) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverLearnerId !== row.id) onDragOver?.(row.id);
  }, [isDropTarget, dragOverLearnerId, row.id, onDragOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isDropTarget) return;
    // Only clear when the cursor actually leaves the card, not when it
    // moves between children inside it (event.relatedTarget check).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverLearnerId === row.id) onDragOver?.(null);
  }, [isDropTarget, dragOverLearnerId, row.id, onDragOver]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!isDropTarget) return;
    e.preventDefault();
    onDragOver?.(null);
    const fileId = e.dataTransfer.getData('text/x-unassigned-file-id');
    if (fileId && onAssignFile) onAssignFile(fileId, row.id);
  }, [isDropTarget, onDragOver, onAssignFile, row.id]);

  const handleClickAssign = useCallback(() => {
    if (isClickAssignTarget && selectedFileId && onAssignFile) {
      onAssignFile(selectedFileId, row.id);
    }
  }, [isClickAssignTarget, selectedFileId, onAssignFile, row.id]);

  return (
    <div
      className={`rounded-xl bg-white dark:bg-gray-900 ring-1 ${ringColor} shadow-sm overflow-hidden transition-all ${isClickAssignTarget ? 'cursor-pointer' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={isClickAssignTarget ? handleClickAssign : undefined}
    >
      {isClickAssignTarget && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-3 py-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
          <Icon name={IconName.InfoCircle} className="w-3 h-3" />
          Click anywhere on this card to assign the selected document
        </div>
      )}
      <button
        type="button"
        onClick={(e) => {
          if (isClickAssignTarget) { e.stopPropagation(); handleClickAssign(); return; }
          if (isVerified) setCollapsed(c => !c);
        }}
        className={`w-full px-4 py-3 flex items-center justify-between gap-3 ${isVerified ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusDot status={status} />
          <div className="min-w-0 text-left">
            <p className="text-sm font-semibold dark:text-white truncate">{row.traineeFullName || '(unnamed learner)'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {row.employerOrgName || '(no employer)'} · {row.courseTitle || '(no course)'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {aiResult && !isVerified && hasDoc && (
            <AiBadge result={aiResult} />
          )}
          <StatusPill status={status} />
          {isVerified && (
            <Icon
              name={IconName.ChevronDown}
              className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            />
          )}
        </div>
      </button>

      {!collapsed && isVerified && (
        <div className="border-t dark:border-gray-700 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <SectionLabel>Verified document</SectionLabel>
              {hasDoc ? (
                <DocPreview fileId={row.supportingDocFileId} link={row.supportingDocLink} />
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-xs text-gray-500 dark:text-gray-400">
                  Document reference no longer available. Status remains verified.
                </div>
              )}
            </div>
            <div className="lg:col-span-2 space-y-3">
              <div>
                <SectionLabel>From Excel</SectionLabel>
                <ExcelDataPanel row={row} />
              </div>
              <div className="rounded-lg p-3 bg-emerald-50 dark:bg-emerald-900/20 ring-1 ring-emerald-200 dark:ring-emerald-800/60 text-xs text-emerald-700 dark:text-emerald-300 inline-flex items-start gap-2">
                <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>This row is locked. To make changes, delete the doc and re-upload from the other learners&apos; verify flow.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!collapsed && !isVerified && (
        <div className="border-t dark:border-gray-700 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3">
              <SectionLabel>Supporting document</SectionLabel>
              {hasDoc ? (
                <DocPreview fileId={row.supportingDocFileId} link={row.supportingDocLink} />
              ) : (
                <UploadDropzone
                  uploading={uploading}
                  onPick={() => fileInputRef.current?.click()}
                  onDropFile={(file) => void handleFile(file)}
                />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={e => handleFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              {hasDoc && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={uploading || deleting}
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    <Icon name={IconName.Upload} className="w-3.5 h-3.5" />
                    {uploading ? 'Replacing…' : 'Replace document'}
                  </button>
                  <button
                    type="button"
                    disabled={uploading || deleting}
                    onClick={() => setConfirmingDelete(true)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                    title="Remove the uploaded doc from Drive and reset this row"
                  >
                    <Icon name={IconName.Delete} className="w-3.5 h-3.5" />
                    Delete document
                  </button>
                </div>
              )}
              {confirmingDelete && (
                <ConfirmPopup
                  tone="danger"
                  icon={IconName.Warning}
                  confirmIcon={IconName.Delete}
                  title="Remove this doc from Drive?"
                  subtitle={row.traineeFullName}
                  confirmLabel="Confirm delete"
                  busyLabel="Deleting…"
                  busy={deleting}
                  onConfirm={handleDelete}
                  onCancel={() => setConfirmingDelete(false)}
                >
                  The supporting document will be deleted from Drive and this row will reset so you can upload a new one. This cannot be undone.
                </ConfirmPopup>
              )}
            </div>

            <div className="lg:col-span-2 space-y-3">
              <div>
                <SectionLabel>From Excel</SectionLabel>
                <ExcelDataPanel row={row} />
              </div>

              {hasDoc && (
                <div>
                  <SectionLabel>Confirm fields match</SectionLabel>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2 -mt-1">
                    Trainee name and employer are required to confirm verified.
                    NRIC and UEN are sanity-check info — mark <strong>N/A</strong> if the document doesn&apos;t show them.
                  </p>
                  <div className="space-y-2">
                    {(Object.keys(FIELD_LABELS) as FieldKey[]).map(key => (
                      <FieldVerdictPill
                        key={key}
                        label={FIELD_LABELS[key]}
                        value={fields[key]}
                        onChange={v => setFieldVerdict(key, v)}
                        required={key === 'name' || key === 'employer'}
                      />
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      type="button"
                      disabled={submitting || !allMatched}
                      onClick={() => submitVerdict('verified')}
                      title={!allMatched ? 'Mark trainee name and employer name as match before confirming.' : 'Confirm trainee name and employer match'}
                      className="text-xs px-3 py-2 rounded-lg font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                    >
                      <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5" />
                      {submitting ? 'Saving…' : 'Verified documents'}
                    </button>
                    <button
                      type="button"
                      disabled={submitting || !anyMismatch}
                      onClick={() => submitVerdict('mismatch')}
                      title={!anyMismatch ? 'Mark trainee name or employer name as mismatch to flag this row.' : 'Flag mismatch; doc will be cleared.'}
                      className="text-xs px-3 py-2 rounded-lg font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                    >
                      <Icon name={IconName.Warning} className="w-3.5 h-3.5" />
                      Flag mismatch
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-3 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{children}</p>
);

const ExcelDataPanel: React.FC<{ row: LearnerRow }> = ({ row }) => (
  <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3 space-y-1.5 text-xs">
    <ExcelField label="Name" value={row.traineeFullName} />
    <ExcelField label="NRIC / FIN" value={maskNric(row.traineeNric)} mono />
    <ExcelField label="Employer" value={row.employerOrgName} />
    <ExcelField label="UEN" value={row.employerUen} mono />
  </div>
);

const ExcelField: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex justify-between gap-2 min-w-0">
    <span className="text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
    <span className={`text-gray-900 dark:text-gray-100 truncate text-right ${mono ? 'font-mono' : ''}`} title={value}>
      {value || '—'}
    </span>
  </div>
);

const DocPreview: React.FC<{ fileId: string; link: string }> = ({ fileId, link }) => {
  // Drive's /preview endpoint embeds both images and PDFs in an iframe.
  // Falls back to a link if no file ID (shouldn't happen, but defensive).
  const previewUrl = fileId ? `https://drive.google.com/file/d/${fileId}/preview` : '';
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 overflow-hidden">
      {previewUrl ? (
        <iframe
          src={previewUrl}
          title="Supporting document preview"
          className="w-full h-72 border-0"
          allow="autoplay"
        />
      ) : (
        <div className="p-4 text-center text-xs text-gray-500">
          Preview unavailable —{' '}
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            open in Drive
          </a>
        </div>
      )}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between bg-white dark:bg-gray-900">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">Uploaded document</span>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
        >
          <Icon name={IconName.ExternalLink} className="w-3 h-3" />
          Open in Drive
        </a>
      </div>
    </div>
  );
};

const UploadDropzone: React.FC<{
  uploading: boolean;
  onPick: () => void;
  onDropFile?: (file: File) => void;
}> = ({ uploading, onPick, onDropFile }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  // Thumbnail drags from the bulk upload strip carry our custom mime — let
  // those bubble to the parent learner card's drop handler. Only external
  // file drops from the OS file picker land here.
  const isExternalFileDrag = (e: React.DragEvent) =>
    !Array.from(e.dataTransfer.types).includes('text/x-unassigned-file-id');

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (uploading || !isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, [uploading]);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (uploading || !isExternalFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) return;
    onDropFile?.(file);
  }, [uploading, onDropFile]);

  return (
    <div
      role="button"
      tabIndex={uploading ? -1 : 0}
      aria-disabled={uploading}
      onClick={() => { if (!uploading) onPick(); }}
      onKeyDown={(e) => { if (!uploading && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(); } }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`w-full h-72 rounded-lg border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-2 select-none ${
        uploading
          ? 'opacity-50 cursor-not-allowed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/40'
          : isDragOver
            ? 'cursor-copy border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'cursor-pointer border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/40 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/30 dark:hover:bg-blue-900/10'
      }`}
    >
      {uploading ? (
        <>
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-300 border-t-blue-500" />
          <p className="text-sm text-gray-600 dark:text-gray-400">Uploading…</p>
        </>
      ) : (
        <>
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Icon name={IconName.Upload} className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {isDragOver ? 'Drop to upload' : 'Click or drop a file to upload'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Image or PDF · max 20MB</p>
        </>
      )}
    </div>
  );
};

const FieldVerdictPill: React.FC<{
  label: string;
  value: FieldVerdict;
  onChange: (v: FieldVerdict) => void;
  required?: boolean;
}> = ({ label, value, onChange, required = false }) => (
  <div className="flex items-center justify-between gap-2 py-1">
    <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 inline-flex items-center gap-1">
      {label}
      {required ? (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
          Required
        </span>
      ) : (
        <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
          Optional
        </span>
      )}
    </span>
    <div className="inline-flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
      <button
        type="button"
        onClick={() => onChange(value === 'match' ? '' : 'match')}
        className={`px-3 py-1 text-xs font-medium inline-flex items-center gap-1 transition-colors ${
          value === 'match'
            ? 'bg-emerald-600 text-white'
            : 'bg-white dark:bg-gray-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
        }`}
        title="Field matches"
      >
        <Icon name={IconName.CheckCircle} className="w-3 h-3" />
        Match
      </button>
      <button
        type="button"
        onClick={() => onChange(value === 'mismatch' ? '' : 'mismatch')}
        className={`px-3 py-1 text-xs font-medium inline-flex items-center gap-1 transition-colors border-l border-gray-300 dark:border-gray-600 ${
          value === 'mismatch'
            ? 'bg-red-600 text-white'
            : 'bg-white dark:bg-gray-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
        }`}
        title="Field does not match"
      >
        <Icon name={IconName.Close} className="w-3 h-3" />
        Mismatch
      </button>
      <button
        type="button"
        onClick={() => onChange(value === 'na' ? '' : 'na')}
        className={`px-3 py-1 text-xs font-medium inline-flex items-center gap-1 transition-colors border-l border-gray-300 dark:border-gray-600 ${
          value === 'na'
            ? 'bg-gray-600 text-white'
            : 'bg-white dark:bg-gray-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
        }`}
        title="Field is not shown on the document"
      >
        <Icon name={IconName.InfoCircle} className="w-3 h-3" />
        N/A
      </button>
    </div>
  </div>
);

const StatusDot: React.FC<{ status: string }> = ({ status }) => {
  const cls =
    status === 'verified'
      ? 'bg-emerald-500'
      : status === 'mismatch'
        ? 'bg-red-500'
        : 'bg-amber-400';
  return <span className={`w-2.5 h-2.5 rounded-full ${cls} flex-shrink-0`} />;
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
        <Icon name={IconName.CheckCircle} className="w-3 h-3" />
        Verified
      </span>
    );
  }
  if (status === 'mismatch') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
        <Icon name={IconName.Warning} className="w-3 h-3" />
        Mismatch
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
      Pending
    </span>
  );
};

// ── Bulk Upload Zone + Thumbnail Strip ──────────────────────────────────────

const BulkUploadZone: React.FC<{
  unassignedFiles: UnassignedFile[];
  selectedFileId: string | null;
  onAddFiles: (files: FileList | File[]) => void;
  onSelectFile: (id: string | null) => void;
  onRemoveFile: (id: string) => void;
  aiDisabled?: boolean;
}> = ({ unassignedFiles, selectedFileId, onAddFiles, onSelectFile, onRemoveFile, aiDisabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOverZone, setIsDragOverZone] = useState(false);

  const onZoneDragOver = (e: React.DragEvent) => {
    // Only react to external file drags. Thumbnails being dragged carry our
    // custom mime — let those fall through to the learner-card drop targets.
    if (Array.from(e.dataTransfer.types).includes('text/x-unassigned-file-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOverZone(true);
  };
  const onZoneDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOverZone(false);
  };
  const onZoneDrop = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('text/x-unassigned-file-id')) return;
    e.preventDefault();
    setIsDragOverZone(false);
    onAddFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`rounded-xl border-2 border-dashed transition-colors ${
        isDragOverZone
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900/40'
      }`}
      onDragOver={onZoneDragOver}
      onDragLeave={onZoneDragLeave}
      onDrop={onZoneDrop}
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <Icon name={IconName.Upload} className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold dark:text-white flex items-center gap-2">
                Bulk upload supporting docs
                {!aiDisabled && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">
                    <Icon name={IconName.Shield} className="w-3 h-3" />
                    AI auto-assign
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {aiDisabled
                  ? 'Pick all files at once, then drag or click each thumbnail onto its learner card below.'
                  : 'Pick all files at once — AI reads each doc, matches by trainee name + employer, and pre-fills the verification verdicts. Manual drag/click is the fallback for unmatched files.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1.5 flex-shrink-0"
          >
            <Icon name={IconName.Upload} className="w-3.5 h-3.5" />
            Select files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={e => {
              if (e.target.files) onAddFiles(e.target.files);
              if (inputRef.current) inputRef.current.value = '';
            }}
            className="hidden"
          />
        </div>

        {unassignedFiles.length === 0 ? (
          <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400 italic">
            No files queued. Drop files here or click <span className="font-semibold">Select files</span> to start.
          </p>
        ) : (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                  {unassignedFiles.length} file{unassignedFiles.length === 1 ? '' : 's'} queued
                </p>
                {unassignedFiles.some(f => f.aiProcessing) && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">
                    <span className="inline-block animate-spin rounded-full h-2.5 w-2.5 border-2 border-teal-600 dark:border-teal-400 border-t-transparent" />
                    AI reading {unassignedFiles.filter(f => f.aiProcessing).length}
                  </span>
                )}
                {unassignedFiles.some(f => f.aiNoMatch && !f.aiProcessing) && (
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-1 ring-red-300/60"
                    title="AI couldn't match these docs to any learner in this batch — likely wrong document or unreadable NRIC. Drag or click-assign manually, or remove."
                  >
                    <Icon name={IconName.Warning} className="w-3 h-3" />
                    {unassignedFiles.filter(f => f.aiNoMatch && !f.aiProcessing).length} no AI match
                  </span>
                )}
              </div>
              {selectedFileId && (
                <button
                  type="button"
                  onClick={() => onSelectFile(null)}
                  className="text-[11px] text-gray-500 dark:text-gray-400 hover:underline"
                >
                  Clear selection
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {unassignedFiles.map(f => (
                <ThumbnailTile
                  key={f.id}
                  file={f}
                  selected={selectedFileId === f.id}
                  onSelect={() => onSelectFile(selectedFileId === f.id ? null : f.id)}
                  onRemove={() => onRemoveFile(f.id)}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
              {selectedFileId
                ? '✓ File selected — click a learner card below to assign it.'
                : 'Drag a thumbnail onto a learner card, or click a thumbnail then click a learner card.'}
            </p>
            {(() => {
              const noMatch = unassignedFiles.filter(f => f.aiNoMatch && !f.aiProcessing);
              if (noMatch.length === 0) return null;
              return (
                <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-900/20 ring-1 ring-red-200 dark:ring-red-800/60 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon name={IconName.Warning} className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                      {noMatch.length} file{noMatch.length === 1 ? '' : 's'} flagged by AI
                    </span>
                  </div>
                  <ul className="space-y-1 ml-5">
                    {noMatch.map(f => (
                      <li key={f.id} className="text-[11px] text-red-700 dark:text-red-300 leading-snug">
                        <span className="font-mono text-red-800 dark:text-red-200">{f.file.name}</span>
                        {f.aiNoMatchReason && (
                          <span className="block text-red-600 dark:text-red-400">{f.aiNoMatchReason}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-red-600 dark:text-red-400 mt-1.5 ml-5 italic">
                    Drag the thumbnail onto the correct learner card to assign manually — or remove it if uploaded by mistake.
                  </p>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};

const ThumbnailTile: React.FC<{
  file: UnassignedFile;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}> = ({ file, selected, onSelect, onRemove }) => {
  const isImage = file.file.type.startsWith('image/');
  const busy = !!file.uploading || !!file.aiProcessing;
  const handleDragStart = (e: React.DragEvent) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-unassigned-file-id', file.id);
  };

  return (
    <div
      draggable={!busy}
      onDragStart={handleDragStart}
      onClick={onSelect}
      className={`group relative w-24 h-24 rounded-lg border-2 overflow-hidden cursor-pointer transition-all ${
        selected
          ? 'border-blue-500 ring-2 ring-blue-300 dark:ring-blue-700/60'
          : file.error
            ? 'border-red-400'
            : file.aiProcessing
              ? 'border-teal-400 ring-2 ring-teal-300/60 dark:ring-teal-700/60'
              : file.aiNoMatch
                ? 'border-red-500 ring-2 ring-red-300/60 dark:ring-red-700/60'
                : 'border-gray-200 dark:border-gray-700 hover:border-blue-400'
      } ${busy ? 'opacity-60' : ''}`}
      title={
        file.aiProcessing
          ? `${file.file.name} — AI processing…`
          : file.aiNoMatch
            ? `${file.file.name}\n\n${file.aiNoMatchReason || "AI couldn't match to any learner in this batch."}\n\nDrag onto the correct learner card to assign manually, or remove if uploaded by mistake.`
            : file.file.name
      }
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.previewUrl} alt={file.file.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 px-1">
          <Icon name={IconName.FileText} className="w-7 h-7 text-gray-400" />
          <span className="text-[9px] text-gray-500 mt-1 text-center truncate w-full">PDF</span>
        </div>
      )}

      {file.uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
        </div>
      )}

      {!file.uploading && file.aiProcessing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-teal-900/50">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-teal-200 border-t-transparent" />
          <span className="mt-1 text-[9px] font-bold uppercase tracking-wider text-teal-100">AI…</span>
        </div>
      )}

      {!busy && file.aiNoMatch && (
        <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-red-600/95 text-white flex items-center justify-center gap-1">
          <Icon name={IconName.Warning} className="w-3 h-3 flex-shrink-0" />
          <span className="text-[9px] font-bold uppercase tracking-wider truncate">No AI match</span>
        </div>
      )}

      {!busy && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove file"
        >
          <Icon name={IconName.Close} className="w-3 h-3" />
        </button>
      )}

      {file.error && (
        <div
          className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-red-600 text-white text-[9px] truncate"
          title={file.error}
        >
          {file.error}
        </div>
      )}
    </div>
  );
};

// ── AI badges + bulk-approve banner ─────────────────────────────────────────

const AiBadge: React.FC<{ result: AiResult }> = ({ result }) => {
  if (result.allMatch) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300"
        title={`AI matched trainee name and employer with ${result.confidence} confidence`}
      >
        <Icon name={IconName.Shield} className="w-3 h-3" />
        AI Confirmed
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
      title="AI flagged at least one mismatch — review before confirming"
    >
      <Icon name={IconName.Warning} className="w-3 h-3" />
      AI Review
    </span>
  );
};

const AiConfirmedBanner: React.FC<{
  count: number;
  approving: boolean;
  onApproveAll: () => void;
}> = ({ count, approving, onApproveAll }) => (
  <div className="rounded-xl bg-teal-50 dark:bg-teal-900/20 ring-1 ring-teal-200 dark:ring-teal-800/60 p-4 flex items-center justify-between gap-3">
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center flex-shrink-0">
        <Icon name={IconName.Shield} className="w-5 h-5 text-teal-600 dark:text-teal-400" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-teal-900 dark:text-teal-100">
          {count} learner{count === 1 ? '' : 's'} AI-confirmed
        </p>
        <p className="text-xs text-teal-700 dark:text-teal-300">
          AI matched trainee name and employer. Approve in one click and skip individual review.
        </p>
      </div>
    </div>
    <button
      type="button"
      onClick={onApproveAll}
      disabled={approving}
      className="text-xs font-semibold px-3.5 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 flex-shrink-0"
    >
      {approving ? (
        <>
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
          Approving…
        </>
      ) : (
        <>
          <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5" />
          Approve all {count}
        </>
      )}
    </button>
  </div>
);

export default SupportingDocsModal;
