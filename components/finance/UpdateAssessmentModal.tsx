import React, { useEffect, useRef, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
    BulkAssessmentEditor,
    BulkAssessmentRow,
    COL,
    fillSkillCodesFromMapping,
    BrailleSpinner,
} from '../admin/BulkAssessmentEditor';

interface PrefillRow {
    enrolment_id: string;
    trainee_name: string | null;
    trainee_nric: string | null;
    course_reference: string | null;
    course_title: string | null;
    enrolment_status: string | null;
    course_run_number: string | null;
    start_date: string | null;
    end_date: string | null;
}

interface UpdateAssessmentPanelProps {
    /** Currently ticked "Assessment" checkboxes on Consolidated Finance Data — the single source of truth for who's in this batch. */
    enrolmentIds: string[];
    /** Untick one enrolment's Assessment checkbox back in the main table (row removed from here). */
    onRemove: (enrolmentId: string) => void;
    /** Untick every Assessment checkbox and dismiss the panel. */
    onClose: () => void;
}

const buildRow = (p: PrefillRow): BulkAssessmentRow => {
    const rawCols: string[] = [];
    rawCols[COL.COURSE_RUN] = p.course_run_number || '';
    rawCols[COL.COURSE_CODE] = p.course_reference || '';
    rawCols[COL.COURSE_TITLE] = p.course_title || '';
    rawCols[COL.START_DATE] = p.start_date || '';
    rawCols[COL.END_DATE] = p.end_date || '';
    rawCols[COL.TRAINEE] = p.trainee_name || '';
    rawCols[COL.TRAINEE_ID] = p.trainee_nric || '';
    rawCols[COL.ENROLMENT_ID] = p.enrolment_id || '';
    for (let i = 0; i < 68; i++) if (rawCols[i] === undefined) rawCols[i] = '';

    return {
        rawCols,
        action: 'update',
        result: 'Pass',
        assessmentDate: p.end_date || '',
        skillCode: '',
        courseRunId: p.course_run_number || '',
        courseCode: p.course_reference || '',
        traineeFullName: p.trainee_name || '',
        traineeId: p.trainee_nric || '',
        enrolmentId: p.enrolment_id || '',
    };
};

/**
 * Same "N Enrolments to Process" editor as the paste-from-Google-Sheet Bulk Update Assessment
 * page — literally the same BulkAssessmentEditor component, so Skill Code auto-fill and the SSG
 * submit call behave identically. Only the source of rows differs: here they track whichever
 * "Assessment" checkboxes are ticked on Consolidated Finance Data (via
 * /api/finance/assessment-prefill), live — same as pasting instantly showing the table, ticking a
 * box instantly (re)builds this preview, no extra button click.
 */
export const UpdateAssessmentPanel: React.FC<UpdateAssessmentPanelProps> = ({ enrolmentIds, onRemove, onClose }) => {
    const [rows, setRows] = useState<BulkAssessmentRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchingMore, setFetchingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rowsRef = useRef<BulkAssessmentRow[]>([]);
    useEffect(() => { rowsRef.current = rows; }, [rows]);

    // Re-fetch base fields whenever the checked set changes, but preserve any edits already made
    // (Action/Result/Assessment Date/Skill Code) for rows that stay selected — ticking one more
    // box must not wipe out what was typed for the others.
    const idsKey = enrolmentIds.map((id) => id.trim()).filter(Boolean).sort().join(',');
    useEffect(() => {
        const ids = idsKey ? idsKey.split(',') : [];
        if (ids.length === 0) { setRows([]); setLoading(false); setFetchingMore(false); return; }
        let cancelled = false;
        (async () => {
            if (rowsRef.current.length === 0) setLoading(true); else setFetchingMore(true);
            setError(null);
            try {
                const resp = await fetch('/api/finance/assessment-prefill', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enrolmentIds: ids }),
                });
                const data = await resp.json();
                if (cancelled) return;
                if (!data.success) {
                    setError(data.error || 'Failed to load selected enrolments');
                    return;
                }
                const prefillRows: PrefillRow[] = data.rows || [];
                const baseRows = prefillRows.map(buildRow);
                const existingById = new Map(rowsRef.current.map((r) => [r.enrolmentId, r]));
                const merged = baseRows.map((base) => {
                    const existing = existingById.get(base.enrolmentId);
                    return existing
                        ? { ...base, action: existing.action, result: existing.result, assessmentDate: existing.assessmentDate, skillCode: existing.skillCode, courseType: existing.courseType }
                        : base;
                });
                const filled = await fillSkillCodesFromMapping(merged);
                if (!cancelled) setRows(filled);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load selected enrolments');
            } finally {
                if (!cancelled) { setLoading(false); setFetchingMore(false); }
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);

    // Wraps BulkAssessmentEditor's setRows so a row removed from the full table (its own × button)
    // also unticks that enrolment's Assessment checkbox back in Consolidated Finance Data — rows
    // and checkboxes never drift out of sync.
    const setRowsAndSyncSelection: React.Dispatch<React.SetStateAction<BulkAssessmentRow[]>> = (update) => {
        setRows((prev) => {
            const next = typeof update === 'function' ? (update as (p: BulkAssessmentRow[]) => BulkAssessmentRow[])(prev) : update;
            const nextIds = new Set(next.map((r) => r.enrolmentId));
            for (const r of prev) if (!nextIds.has(r.enrolmentId)) onRemove(r.enrolmentId);
            return next;
        });
    };

    if (enrolmentIds.length === 0) return null;

    return (
        <Card className="p-6 mb-6 border-2 border-cyan-300 dark:border-cyan-600">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold dark:text-white">Update Assessment</h2>
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none px-2"
                    title="Close and clear selection"
                >
                    &times;
                </button>
            </div>

            {loading && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 py-6">
                    <BrailleSpinner /> Loading selected enrolments…
                </div>
            )}

            {error && (
                <Card className="p-4 mb-4 border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700">
                    <pre className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{error}</pre>
                </Card>
            )}

            {!loading && (
                <>
                    {/* Preview card: who's selected, before the full editable table */}
                    <Card className="p-4 mb-6 bg-gray-50 dark:bg-gray-800/50">
                        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                            Selected People ({rows.length})
                            {fetchingMore && <BrailleSpinner />}
                        </h3>
                        {rows.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400">No enrolments left in this batch.</p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {rows.map((r) => (
                                    <span
                                        key={r.enrolmentId}
                                        className="inline-flex items-center gap-2 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full pl-3 pr-1.5 py-1"
                                    >
                                        <span className="font-medium text-gray-800 dark:text-gray-100">{r.traineeFullName || 'Unknown'}</span>
                                        <span className="text-gray-400">·</span>
                                        <span className="text-gray-500 dark:text-gray-400">{r.rawCols[COL.COURSE_TITLE] || r.courseCode || '—'}</span>
                                        <span className="text-gray-400">·</span>
                                        <span className="font-mono text-gray-500 dark:text-gray-400">{r.enrolmentId}</span>
                                        <button
                                            onClick={() => setRowsAndSyncSelection((prev) => prev.filter((x) => x.enrolmentId !== r.enrolmentId))}
                                            className="text-red-400 hover:text-red-600 dark:hover:text-red-300 px-1"
                                            title="Remove from batch"
                                        >
                                            &times;
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </Card>

                    {rows.length > 0 && <BulkAssessmentEditor rows={rows} setRows={setRowsAndSyncSelection} />}
                </>
            )}

            <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={onClose}>Close</Button>
            </div>
        </Card>
    );
};
