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
    case 'success': return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300';
    case 'failed':  return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300';
    case 'partial': return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300';
    default:        return 'bg-gray-100 text-gray-800 border-gray-200';
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
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full my-8 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">Upsert from SSG</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Bulk-hydrate local DB from SSG for up to {UPSERT_FROM_SSG_MAX_BATCH} Course Run IDs. Preview first, then Apply.
            </p>
          </div>
          <button
            onClick={() => !isPreviewLoading && !isApplying && onClose()}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none p-1"
            disabled={isPreviewLoading || isApplying}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* Input */}
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
            Course Run IDs (comma or newline separated)
          </label>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="e.g. 1324510, 1325270"
            rows={4}
            disabled={isPreviewLoading || isApplying}
            className="block w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500 font-mono"
          />
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className={overCap ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}>
              {parsedIds.length === 0
                ? 'No CR IDs entered'
                : `${parsedIds.length} CR${parsedIds.length === 1 ? '' : 's'} entered${overCap ? ` — exceeds max of ${UPSERT_FROM_SSG_MAX_BATCH}` : ''}`}
            </span>
            <span className="text-gray-400">Trainer fields are never modified.</span>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Results */}
          {activeResults && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {applyResults ? 'Apply Results' : 'Preview — no writes yet'}
                </h3>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {activeResults.summary.succeeded} succeeded · {activeResults.summary.partial} partial · {activeResults.summary.failed} failed
                </div>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-md overflow-x-auto">
                <table className="w-full text-sm min-w-[780px]">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300"></th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">CR ID</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Title</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-300">Course Run</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-300">Sessions</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-300">Enrolments</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-300">Status</th>
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
                          <tr className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                            <td className="px-3 py-2">
                              <button
                                onClick={() => toggleRowExpanded(r.courseRunId)}
                                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                              >
                                {isExpanded ? '▼' : '▶'}
                              </button>
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-800 dark:text-gray-100">
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
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[180px] truncate" title={r.courseTitle}>{r.courseTitle || '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                              {crChanged
                                ? (r.courseRun.inserted > 0
                                    ? <span className="text-purple-700 dark:text-purple-400 font-semibold">new ({r.courseRun.fieldsChanged.length}f)</span>
                                    : <span className="text-blue-700 dark:text-blue-400">~{r.courseRun.updated} ({r.courseRun.fieldsChanged.length}f)</span>)
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap font-mono text-xs">
                              {sessChanged
                                ? `+${r.sessions.inserted} ~${r.sessions.updated} -${r.sessions.softDeleted}`
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap font-mono text-xs">
                              {enrolChanged ? (
                                <span className="inline-flex items-center gap-1">
                                  <span>+{r.enrolments.inserted} ~{r.enrolments.updated}</span>
                                  {(r.enrolments.orphans.length > 0 || (r.enrolments.dupWarnings?.length || 0) > 0) && (
                                    <span
                                      className="text-amber-600 dark:text-amber-400"
                                      title={`${r.enrolments.orphans.length} orphan(s), ${r.enrolments.dupWarnings?.length || 0} dup warning(s)`}
                                    >
                                      ⚠{r.enrolments.orphans.length + (r.enrolments.dupWarnings?.length || 0)}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${statusBadgeClass(r.status)}`}>
                                {r.status}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                              <td colSpan={7} className="px-6 py-3 text-xs">
                                {r.error && (
                                  <div className="mb-2 text-red-700 dark:text-red-400">
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
                                    <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">
                                      Course Run field diff ({r.courseRun.fieldsChanged.length} field{r.courseRun.fieldsChanged.length === 1 ? '' : 's'}):
                                    </div>
                                    <ul className="list-disc list-inside space-y-0.5 text-gray-600 dark:text-gray-400">
                                      {r.courseRun.fieldsChanged.map((d, i) => (
                                        <li key={i}>
                                          <span className="font-mono">{d.field}</span>: <span className="text-red-600 dark:text-red-400">{d.old ?? '∅'}</span> → <span className="text-emerald-600 dark:text-emerald-400">{d.new ?? '∅'}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Sessions detail */}
                                {(r.sessions.inserted + r.sessions.updated + r.sessions.softDeleted) > 0 && (
                                  <div className="mb-3">
                                    <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Sessions:</div>
                                    {r.sessions.insertedDetails.length > 0 && (
                                      <div className="mb-1.5 ml-2">
                                        <div className="text-emerald-700 dark:text-emerald-400 font-medium">+{r.sessions.insertedDetails.length} new:</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-gray-600 dark:text-gray-400 ml-2">
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
                                        <div className="text-blue-700 dark:text-blue-400 font-medium">~{r.sessions.updatedDetails.length} updated:</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-gray-600 dark:text-gray-400 ml-2">
                                          {r.sessions.updatedDetails.map((s, i) => (
                                            <li key={i}>
                                              <span className="font-mono text-xs">{s.sessionNumber || s.ssgSessionId}</span>{' '}
                                              {s.startDate} {s.startTime}–{s.endTime}
                                              {s.fieldsChanged && s.fieldsChanged.length > 0 && (
                                                <ul className="list-disc list-inside ml-4 text-[11px]">
                                                  {s.fieldsChanged.map((d, j) => (
                                                    <li key={j}>
                                                      <span className="font-mono">{d.field}</span>: <span className="text-red-600 dark:text-red-400">{d.old ?? '∅'}</span> → <span className="text-emerald-600 dark:text-emerald-400">{d.new ?? '∅'}</span>
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
                                        <div className="text-red-700 dark:text-red-400 font-medium">-{r.sessions.softDeletedDetails.length} soft-deleted (not in SSG):</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-gray-600 dark:text-gray-400 ml-2">
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
                                    <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Enrolments:</div>
                                    {r.enrolments.insertedDetails.length > 0 && (
                                      <div className="mb-1.5 ml-2">
                                        <div className="text-emerald-700 dark:text-emerald-400 font-medium">+{r.enrolments.insertedDetails.length} new:</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-gray-600 dark:text-gray-400 ml-2">
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
                                        <div className="text-blue-700 dark:text-blue-400 font-medium">~{r.enrolments.updatedDetails.length} updated:</div>
                                        <ul className="list-disc list-inside space-y-0.5 text-gray-600 dark:text-gray-400 ml-2">
                                          {r.enrolments.updatedDetails.map((e, i) => (
                                            <li key={i}>
                                              <span className="font-mono text-xs">{e.enrolmentId}</span>
                                              {e.traineeName && ` — ${e.traineeName}`}
                                              {e.fieldsChanged && e.fieldsChanged.length > 0 && (
                                                <ul className="list-disc list-inside ml-4 text-[11px]">
                                                  {e.fieldsChanged.map((d, j) => (
                                                    <li key={j}>
                                                      <span className="font-mono">{d.field}</span>: <span className="text-red-600 dark:text-red-400">{d.old ?? '∅'}</span> → <span className="text-emerald-600 dark:text-emerald-400">{d.new ?? '∅'}</span>
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
                                  <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded">
                                    <div className="font-semibold text-amber-800 dark:text-amber-300 mb-1">
                                      ⚠ SSG returned multiple enrolments for the same learner on this CR ({r.enrolments.dupWarnings.length} case{r.enrolments.dupWarnings.length === 1 ? '' : 's'})
                                    </div>
                                    <div className="text-[11px] text-amber-700 dark:text-amber-400 mb-1">
                                      Local DB has UNIQUE (user_id, course_run_id). Policy: Confirmed wins over Cancelled; other statuses skipped.
                                    </div>
                                    <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                      {r.enrolments.dupWarnings.map((w, i) => (
                                        <li key={i}>
                                          <span className="font-medium">{w.traineeName || w.traineeEmail}</span>
                                          {' — picked '}
                                          <span className="font-mono text-emerald-700 dark:text-emerald-400">{w.picked.enrolmentId}</span>
                                          {' ('}{w.picked.status}{') '}
                                          <span className="text-gray-500">skipped:</span>{' '}
                                          {w.skipped.map((s, j) => (
                                            <span key={j} className="font-mono text-red-600 dark:text-red-400">
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
                                    <div className="font-semibold text-amber-700 dark:text-amber-400 mb-1">
                                      ⚠ {r.enrolments.orphans.length} enrolment{r.enrolments.orphans.length === 1 ? '' : 's'} exist locally but not in SSG (NEVER written — report only):
                                    </div>
                                    <ul className="list-disc list-inside space-y-0.5 text-gray-600 dark:text-gray-400">
                                      {r.enrolments.orphans.slice(0, 10).map((o, i) => (
                                        <li key={i}>
                                          <span className="font-mono">{o.enrolmentId}</span>{o.email && ` — ${o.email}`}
                                        </li>
                                      ))}
                                      {r.enrolments.orphans.length > 10 && (
                                        <li className="text-gray-400">...and {r.enrolments.orphans.length - 10} more</li>
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
                                  <div className="text-gray-500 dark:text-gray-400">No differences detected.</div>
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
                <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded text-sm text-emerald-800 dark:text-emerald-300">
                  ✓ Apply complete. Calendar will refresh when you close this modal.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isPreviewLoading || isApplying}
            className="px-4 py-2 text-sm font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 bg-white dark:bg-gray-800 disabled:opacity-50"
          >
            {applyResults ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handlePreview}
            disabled={!canPreview}
            className="px-4 py-2 text-sm font-medium rounded border border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 bg-white dark:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
