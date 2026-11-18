import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { getApiUrl } from '@lib/urlHelpers';
import type {
  UpsertFromSsgResponse,
  UpsertFromSsgCrResult,
} from '../../types/upsert-from-ssg';
import { UPSERT_FROM_SSG_MAX_BATCH } from '../../types/upsert-from-ssg';

interface UpsertFromSsgModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyComplete: () => void;
}

const parseCourseRunIds = (text: string): string[] => {
  if (!text) return [];
  // Split on comma, newline, tab, or whitespace. Trim each. Drop empties. Dedupe.
  const tokens = text.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
};

const statusBadgeClass = (status: string): string => {
  switch (status) {
    case 'success': return 'bg-success-bg text-success border-emerald-200';
    case 'failed':  return 'bg-danger-bg text-danger border-red-200';
    case 'partial': return 'bg-warning-bg text-warning border-amber-200';
    default:        return 'bg-gray-100 text-on-surface border-default';
  }
};

const UpsertFromSsgModal: React.FC<UpsertFromSsgModalProps> = ({ isOpen, onClose, onApplyComplete }) => {
  const [inputText, setInputText] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewResults, setPreviewResults] = useState<UpsertFromSsgResponse | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<UpsertFromSsgResponse | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const parsedIds = useMemo(() => parseCourseRunIds(inputText), [inputText]);
  const overCap = parsedIds.length > UPSERT_FROM_SSG_MAX_BATCH;
  const canPreview = parsedIds.length > 0 && !overCap && !isPreviewLoading && !isApplying;
  const canApply = previewResults !== null && !isApplying && !isPreviewLoading;

  // Reset all state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInputText('');
      setPreviewResults(null);
      setApplyResults(null);
      setIsPreviewLoading(false);
      setIsApplying(false);
      setExpandedRows(new Set());
      setError(null);
    }
  }, [isOpen]);

  // Close on Escape (unless loading)
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPreviewLoading && !isApplying) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, isPreviewLoading, isApplying, onClose]);

  // Whenever the input changes, invalidate any existing preview
  useEffect(() => {
    setPreviewResults(null);
    setApplyResults(null);
    setExpandedRows(new Set());
  }, [inputText]);

  const handlePreview = useCallback(async () => {
    if (!canPreview) return;
    setError(null);
    setPreviewResults(null);
    setApplyResults(null);
    setIsPreviewLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/admin/upsert-from-ssg'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunIds: parsedIds, mode: 'preview' }),
      });
      const json: UpsertFromSsgResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error || `Preview failed (${res.status})`);
      }
      setPreviewResults(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setIsPreviewLoading(false);
    }
  }, [canPreview, parsedIds]);

  const handleApply = useCallback(async () => {
    if (!canApply || !previewResults) return;
    setError(null);
    setIsApplying(true);
    try {
      const res = await fetch(getApiUrl('/api/admin/upsert-from-ssg'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunIds: parsedIds, mode: 'apply' }),
      });
      const json: UpsertFromSsgResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error || `Apply failed (${res.status})`);
      }
      setApplyResults(json);
      // Notify parent to auto-refresh calendar
      onApplyComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setIsApplying(false);
    }
  }, [canApply, previewResults, parsedIds, onApplyComplete]);

  const toggleRowExpanded = useCallback((crId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(crId)) next.delete(crId);
      else next.add(crId);
      return next;
    });
  }, []);

  const handleBackdropClick = useCallback(() => {
    if (!isPreviewLoading && !isApplying) onClose();
  }, [isPreviewLoading, isApplying, onClose]);

  if (!isOpen) return null;

  const activeResults = applyResults ?? previewResults;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-surface rounded-lg shadow-xl max-w-4xl w-full my-8 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-default flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-on-surface">Upsert from SSG</h2>
            <p className="text-sm text-muted mt-1">
              Bulk-hydrate local DB from SSG for up to {UPSERT_FROM_SSG_MAX_BATCH} Course Run IDs. Preview first, then Apply.
            </p>
          </div>
          <button
            onClick={() => !isPreviewLoading && !isApplying && onClose()}
            className="text-muted hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none p-1"
            disabled={isPreviewLoading || isApplying}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* Input */}
          <label className="block text-sm font-semibold text-on-surface-secondary mb-2">
            Course Run IDs (comma or newline separated)
          </label>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="e.g. 1324510, 1325270"
            rows={4}
            disabled={isPreviewLoading || isApplying}
            className="block w-full px-3 py-2 text-sm text-on-surface bg-surface border border-strong rounded-md shadow-sm placeholder-muted focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
          />
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className={overCap ? 'text-danger font-semibold' : 'text-muted'}>
              {parsedIds.length === 0
                ? 'No CR IDs entered'
                : `${parsedIds.length} CR${parsedIds.length === 1 ? '' : 's'} entered${overCap ? ` — exceeds max of ${UPSERT_FROM_SSG_MAX_BATCH}` : ''}`}
            </span>
            <span className="text-muted">Trainer fields are never modified.</span>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-danger-bg border border-red-200 dark:border-red-800 rounded text-sm text-danger">
              {error}
            </div>
          )}

          {/* Results */}
          {activeResults && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-on-surface-secondary">
                  {applyResults ? 'Apply Results' : 'Preview — no writes yet'}
                </h3>
                <div className="text-xs text-on-surface-secondary">
                  {activeResults.summary.succeeded} succeeded · {activeResults.summary.partial} partial · {activeResults.summary.failed} failed
                </div>
              </div>

              <div className="border border-default rounded-md overflow-x-auto">
                <table className="w-full text-sm min-w-[780px]">
                  <thead className="bg-surface-elevated">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-on-surface-secondary"></th>
                      <th className="px-3 py-2 text-left font-semibold text-on-surface-secondary">CR ID</th>
                      <th className="px-3 py-2 text-left font-semibold text-on-surface-secondary">Title</th>
                      <th className="px-3 py-2 text-right font-semibold text-on-surface-secondary">Course Run</th>
                      <th className="px-3 py-2 text-right font-semibold text-on-surface-secondary">Sessions</th>
                      <th className="px-3 py-2 text-right font-semibold text-on-surface-secondary">Enrolments</th>
                      <th className="px-3 py-2 text-center font-semibold text-on-surface-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeResults.results.map((r: UpsertFromSsgCrResult) => {
                      const isExpanded = expandedRows.has(r.courseRunId);
                      const crChanged = r.courseRun.inserted + r.courseRun.updated > 0;
                      const sessChanged = r.sessions.inserted + r.sessions.updated + r.sessions.softDeleted > 0;
                      const enrolChanged = r.enrolments.inserted + r.enrolments.updated + r.enrolments.orphans.length + (r.enrolments.dupWarnings?.length || 0) > 0;
                      return (
                        <React.Fragment key={r.courseRunId}>
                          <tr className="border-t border-default hover:bg-gray-50 dark:hover:bg-gray-900/50">
                            <td className="px-3 py-2">
                              <button
                                onClick={() => toggleRowExpanded(r.courseRunId)}
                                className="text-muted hover:text-on-surface"
                                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                              >
                                {isExpanded ? '▼' : '▶'}
                              </button>
                            </td>
                            <td className="px-3 py-2 font-mono text-on-surface">
                              <div className="flex items-center gap-1">
                                {r.courseRunId}
                                {r.courseRun.inserted > 0 && (
                                  <span
                                    className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded bg-purple-600 text-white uppercase tracking-wide"
                                    title="Course run did not exist locally — will be inserted as a new row"
                                  >
                                    New
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-on-surface-secondary max-w-[180px] truncate" title={r.courseTitle}>{r.courseTitle || '—'}</td>
                            <td className="px-3 py-2 text-right text-on-surface-secondary whitespace-nowrap">
                              {crChanged
                                ? (r.courseRun.inserted > 0
                                    ? <span className="text-purple-700 dark:text-purple-400 font-semibold">new ({r.courseRun.fieldsChanged.length}f)</span>
                                    : <span className="text-primary">~{r.courseRun.updated} ({r.courseRun.fieldsChanged.length}f)</span>)
                                : <span className="text-muted">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-on-surface-secondary whitespace-nowrap font-mono text-xs">
                              {sessChanged
                                ? `+${r.sessions.inserted} ~${r.sessions.updated} -${r.sessions.softDeleted}`
                                : <span className="text-muted">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-on-surface-secondary whitespace-nowrap font-mono text-xs">
                              {enrolChanged ? (
                                <span className="inline-flex items-center gap-1">
                                  <span>+{r.enrolments.inserted} ~{r.enrolments.updated}</span>
                                  {(r.enrolments.orphans.length > 0 || (r.enrolments.dupWarnings?.length || 0) > 0) && (
                                    <span
                                      className="text-warning"
                                      title={`${r.enrolments.orphans.length} orphan(s), ${r.enrolments.dupWarnings?.length || 0} dup warning(s)`}
                                    >
                                      ⚠{r.enrolments.orphans.length + (r.enrolments.dupWarnings?.length || 0)}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${statusBadgeClass(r.status)}`}>
                                {r.status}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-surface-elevated border-t border-default">
                              <td colSpan={7} className="px-6 py-3 text-xs">
                                {r.error && (
                                  <div className="mb-2 text-danger">
                                    <strong>Error:</strong> {r.error}{r.failedStep && ` (at step ${r.failedStep})`}
                                  </div>
                                )}

                                {/* NEW course run banner */}
                                {r.courseRun.inserted > 0 && (
                                  <div className="mb-3 p-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded">
                                    <span className="font-semibold text-purple-800 dark:text-purple-300">✨ New course run</span>
                                    <span className="text-purple-700 dark:text-purple-400"> — this course run does not exist in local DB yet and will be inserted.</span>
                                  </div>
                                )}

                                {/* Course Run field diff */}
                                {r.courseRun.fieldsChanged.length > 0 && (
                                  <div className="mb-3">
                                    <div className="font-semibold text-on-surface-secondary mb-1">
                                      Course Run field diff ({r.courseRun.fieldsChanged.length} field{r.courseRun.fieldsChanged.length === 1 ? '' : 's'}):
                                    </div>
                                    <ul className="list-disc list-inside space-y-0.5 text-on-surface-secondary">
                                      {r.courseRun.fieldsChanged.map((d, i) => (
                                        <li key={i}>
                                          <span className="font-mono">{d.field}</span>: <span className="text-danger">{d.old ?? '∅'}</span> → <span className="text-success">{d.new ?? '∅'}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Sessions detail */}
                                {(r.sessions.inserted + r.sessions.updated + r.sessions.softDeleted) > 0 && (
                                  <div className="mb-3">
                                    <div className="font-semibold text-on-surface-secondary mb-1">Sessions:</div>
                                    {r.sessions.insertedDetails.length > 0 && (
                                      <div className="mb-1.5 ml-2">
                                        <div className="text-success font-medium">+{r.sessions.insertedDetails.length} new:</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-on-surface-secondary ml-2">
                                          {r.sessions.insertedDetails.map((s, i) => (
                                            <li key={i}>
                                              <span className="font-mono text-xs">{s.sessionNumber || s.ssgSessionId}</span>{' '}
                                              {s.startDate} {s.startTime}–{s.endTime}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {r.sessions.updatedDetails.length > 0 && (
                                      <div className="mb-1.5 ml-2">
                                        <div className="text-primary font-medium">~{r.sessions.updatedDetails.length} updated:</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-on-surface-secondary ml-2">
                                          {r.sessions.updatedDetails.map((s, i) => (
                                            <li key={i}>
                                              <span className="font-mono text-xs">{s.sessionNumber || s.ssgSessionId}</span>{' '}
                                              {s.startDate} {s.startTime}–{s.endTime}
                                              {s.fieldsChanged && s.fieldsChanged.length > 0 && (
                                                <ul className="list-disc list-inside ml-4 text-[11px]">
                                                  {s.fieldsChanged.map((d, j) => (
                                                    <li key={j}>
                                                      <span className="font-mono">{d.field}</span>: <span className="text-danger">{d.old ?? '∅'}</span> → <span className="text-success">{d.new ?? '∅'}</span>
                                                    </li>
                                                  ))}
                                                </ul>
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {r.sessions.softDeletedDetails.length > 0 && (
                                      <div className="mb-1.5 ml-2">
                                        <div className="text-danger font-medium">-{r.sessions.softDeletedDetails.length} soft-deleted (not in SSG):</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-on-surface-secondary ml-2">
                                          {r.sessions.softDeletedDetails.map((s, i) => (
                                            <li key={i}>
                                              <span className="font-mono text-xs">{s.sessionNumber || s.ssgSessionId}</span>{' '}
                                              {s.startDate}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Enrolments detail */}
                                {(r.enrolments.inserted + r.enrolments.updated) > 0 && (
                                  <div className="mb-3">
                                    <div className="font-semibold text-on-surface-secondary mb-1">Enrolments:</div>
                                    {r.enrolments.insertedDetails.length > 0 && (
                                      <div className="mb-1.5 ml-2">
                                        <div className="text-success font-medium">+{r.enrolments.insertedDetails.length} new:</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-on-surface-secondary ml-2">
                                          {r.enrolments.insertedDetails.map((e, i) => (
                                            <li key={i}>
                                              <span className="font-mono text-xs">{e.enrolmentId}</span>
                                              {e.traineeName && ` — ${e.traineeName}`}
                                              {e.email && ` (${e.email})`}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {r.enrolments.updatedDetails.length > 0 && (
                                      <div className="mb-1.5 ml-2">
                                        <div className="text-primary font-medium">~{r.enrolments.updatedDetails.length} updated:</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-on-surface-secondary ml-2">
                                          {r.enrolments.updatedDetails.map((e, i) => (
                                            <li key={i}>
                                              <span className="font-mono text-xs">{e.enrolmentId}</span>
                                              {e.traineeName && ` — ${e.traineeName}`}
                                              {e.fieldsChanged && e.fieldsChanged.length > 0 && (
                                                <ul className="list-disc list-inside ml-4 text-[11px]">
                                                  {e.fieldsChanged.map((d, j) => (
                                                    <li key={j}>
                                                      <span className="font-mono">{d.field}</span>: <span className="text-danger">{d.old ?? '∅'}</span> → <span className="text-success">{d.new ?? '∅'}</span>
                                                    </li>
                                                  ))}
                                                </ul>
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* SSG duplicate-enrolment warnings */}
                                {r.enrolments.dupWarnings && r.enrolments.dupWarnings.length > 0 && (
                                  <div className="mb-3 p-2 bg-warning-bg border border-amber-200 dark:border-amber-800 rounded">
                                    <div className="font-semibold text-warning mb-1">
                                      ⚠ SSG returned multiple enrolments for the same learner on this CR ({r.enrolments.dupWarnings.length} case{r.enrolments.dupWarnings.length === 1 ? '' : 's'})
                                    </div>
                                    <div className="text-[11px] text-warning mb-1">
                                      Local DB has UNIQUE (user_id, course_run_id). Policy: Confirmed wins over Cancelled; other statuses skipped.
                                    </div>
                                    <ul className="list-disc list-inside space-y-1 text-on-surface-secondary">
                                      {r.enrolments.dupWarnings.map((w, i) => (
                                        <li key={i}>
                                          <span className="font-medium">{w.traineeName || w.traineeEmail}</span>
                                          {' — picked '}
                                          <span className="font-mono text-success">{w.picked.enrolmentId}</span>
                                          {' ('}{w.picked.status}{') '}
                                          <span className="text-muted">skipped:</span>{' '}
                                          {w.skipped.map((s, j) => (
                                            <span key={j} className="font-mono text-danger">
                                              {j > 0 && ', '}
                                              {s.enrolmentId} ({s.status})
                                            </span>
                                          ))}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Orphans — never written */}
                                {r.enrolments.orphans.length > 0 && (
                                  <div className="mb-3">
                                    <div className="font-semibold text-warning mb-1">
                                      ⚠ {r.enrolments.orphans.length} enrolment{r.enrolments.orphans.length === 1 ? '' : 's'} exist locally but not in SSG (NEVER written — report only):
                                    </div>
                                    <ul className="list-disc list-inside space-y-0.5 text-on-surface-secondary">
                                      {r.enrolments.orphans.slice(0, 10).map((o, i) => (
                                        <li key={i}>
                                          <span className="font-mono">{o.enrolmentId}</span>{o.email && ` — ${o.email}`}
                                        </li>
                                      ))}
                                      {r.enrolments.orphans.length > 10 && (
                                        <li className="text-muted">...and {r.enrolments.orphans.length - 10} more</li>
                                      )}
                                    </ul>
                                  </div>
                                )}

                                {r.courseRun.fieldsChanged.length === 0 &&
                                 (r.sessions.inserted + r.sessions.updated + r.sessions.softDeleted) === 0 &&
                                 (r.enrolments.inserted + r.enrolments.updated) === 0 &&
                                 r.enrolments.orphans.length === 0 &&
                                 (r.enrolments.dupWarnings?.length || 0) === 0 &&
                                 !r.error && (
                                  <div className="text-muted">No differences detected.</div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {applyResults && (
                <div className="mt-4 p-3 bg-success-bg border border-emerald-200 dark:border-emerald-800 rounded text-sm text-success">
                  ✓ Apply complete. Calendar will refresh when you close this modal.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-default flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isPreviewLoading || isApplying}
            className="px-4 py-2 text-sm font-medium rounded border border-strong text-on-surface-secondary hover:bg-surface-hover bg-surface disabled:opacity-50"
          >
            {applyResults ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handlePreview}
            disabled={!canPreview}
            className="px-4 py-2 text-sm font-medium rounded border border-blue-600 text-primary hover:bg-blue-50 dark:hover:bg-blue-900/30 bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPreviewLoading ? 'Previewing…' : 'Preview'}
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply || applyResults !== null}
            className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApplying ? 'Applying…' : 'Apply to DB'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpsertFromSsgModal;
