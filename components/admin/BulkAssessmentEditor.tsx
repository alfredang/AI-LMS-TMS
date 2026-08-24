import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

// All Course Runs sheet headers (0-indexed) — matches the Update Assessment tab column order
export const ALL_COURSE_RUNS_HEADERS = [
    'Course Run', 'Course Code', 'Course Title', 'Start Date', 'End Date',
    'Trainee', 'Trainee Email', 'Trainee Contact', 'Trainee ID', 'Trainee DOB',
    'Sponsorship Type', 'UEN of Employer', 'Employer Name', 'Employer Phone Country Code',
    'Employer Phone', 'Employer Contact Name', 'Employer Contact Email', 'Company Address',
    'Enrolement Status', 'Enrolment Response', 'Enrolment ID', 'Grant Appl Date',
    'Grant Status (BL)', 'Grant ID (BL)', 'Amount (BL)', 'Grant Status (MCES/SME/IBF)',
    'Grant ID (MCES/SME)', 'Funding Scheme Code', 'Amount (MCES/SME)', 'Total TG Amount',
    'TG Payment Status', 'SFC Claim ID', 'SFC Amount', 'SFC Payment Date',
    'SFC Payout Request ID', 'SFC Application ID', 'SFC Payment Status', 'QB SFC Invoice Num',
    'QB SFC Invoice Amount', 'QB SFC Status', 'TG Payment Date', 'Financial Transaction ID (BL)',
    'Financial Transaction ID (MCES/SME)', 'Attendance', 'Assessment', 'Fee Collection Update Status',
    'Assessment ID', 'Assessment ID Date', 'Skill Code', 'Assessment Update',
    'QB Invoice # (Net Fee)', 'QB Net Fee Amount', 'Payment Type', 'QB Net Fee Status',
    'QB Invoice # (Grant)', 'QB TG Status', 'Bank Reference ID (BL)', 'Course Fees',
    'Bank Reference ID (MCES/SME)', 'Course Type', 'Unique Course Run ID', 'Invoice No.',
    'Pay by SFC', 'Terms', 'Payable Fees', 'Invoice Creation',
    'Column 65', 'Column 66', 'Column 67',
];

// Columns used by SSG API (highlighted in the table)
export const SSG_USED_COLS = new Set([0, 1, 4, 5, 8, 20, 46, 47, 48]);

// Column indices from "All Course Runs" sheet (0-indexed)
export const COL = {
    COURSE_RUN: 0, COURSE_CODE: 1, COURSE_TITLE: 2, START_DATE: 3, END_DATE: 4,
    TRAINEE: 5, TRAINEE_ID: 8, ENROLMENT_ID: 20,
    ASSESSMENT_ID: 46, ASSESSMENT_ID_DATE: 47, SKILL_CODE: 48, ASSESSMENT_UPDATE: 49,
};

// Assessment-relevant course type, from Funding Validity (course.course_type). That screen shows
// 'Non-WSQ' as "CASL"; CASL courses have no SSG skill code, so the column is optional for them.
// undefined = the LMS doesn't recognise the pasted course code — treated as still-required.
export type AssessmentCourseType = 'WSQ' | 'IBF' | 'CASL';

export interface BulkAssessmentRow {
    rawCols: string[];
    // Editable per-row inputs (primary)
    action: string;
    result: string;
    assessmentDate: string;
    skillCode: string;
    courseType?: AssessmentCourseType;
    // Editable per-row inputs (advanced — auto-filled from paste)
    courseRunId: string;
    courseCode: string;
    traineeFullName: string;
    traineeId: string;
    enrolmentId: string;
}

// WSQ and IBF assessments carry an SSG skill code; CASL courses have none, so a blank cell is
// correct for them rather than an error. An unrecognised course code stays required.
export const needsSkillCode = (r: BulkAssessmentRow): boolean => r.courseType !== 'CASL';

export interface BulkAssessmentResult {
    enrolmentId: string;
    traineeFullName: string;
    status: 'success' | 'error' | 'pending';
    assessmentReferenceNumber?: string;
    createdOn?: string;
    updatedOn?: string;
    error?: string;
    paymentWarning?: string;
}

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const BrailleSpinner: React.FC = () => {
    const [i, setI] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setI((x) => (x + 1) % BRAILLE_FRAMES.length), 80);
        return () => clearInterval(t);
    }, []);
    return <span className="font-mono" aria-hidden>{BRAILLE_FRAMES[i]}</span>;
};

/**
 * Auto-fill each row's Skill Code from the saved course→skill-code mapping, but ONLY where the
 * row didn't already carry one (an existing skill code always overrides the mapping).
 */
// Auto-fill each row's Skill Code from the saved course→skill-code mapping, but ONLY where the
// row didn't already carry one (an existing skill code always overrides the mapping), and tag
// every row with its course type so CASL rows can skip the skill-code requirement.
//
// The two code lists are deliberately different: resolving a skill code can cost a live SSG
// lookup, so only rows that actually need one are sent as course_codes — every row's code goes
// in type_codes, which is just a DB read.
export const fillSkillCodesFromMapping = async (newRows: BulkAssessmentRow[]): Promise<BulkAssessmentRow[]> => {
    const allCodes = Array.from(new Set(
        newRows.map(r => r.courseCode?.trim()).filter(Boolean) as string[]
    ));
    const needCodes = Array.from(new Set(
        newRows.filter(r => !r.skillCode?.trim() && r.courseCode?.trim()).map(r => r.courseCode.trim())
    ));
    if (allCodes.length === 0) return newRows;
    try {
        const params = new URLSearchParams();
        if (needCodes.length > 0) params.set('course_codes', needCodes.join(','));
        params.set('type_codes', allCodes.join(','));
        const resp = await fetch(`/api/admin/course-skill-codes?${params.toString()}`);
        const data = await resp.json();
        const map: Record<string, string> = data?.map || {};
        const types: Record<string, AssessmentCourseType> = data?.types || {};
        return newRows.map(r => {
            const cc = r.courseCode?.trim();
            return {
                ...r,
                courseType: cc ? types[cc] : undefined,
                skillCode: (!r.skillCode?.trim() && cc && map[cc]) ? map[cc] : r.skillCode,
            };
        });
    } catch { return newRows; }
};

const cellInputClasses = "w-full px-1.5 py-1 text-xs bg-white border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white";

interface BulkAssessmentEditorProps {
    rows: BulkAssessmentRow[];
    setRows: React.Dispatch<React.SetStateAction<BulkAssessmentRow[]>>;
}

/**
 * The editable "N Enrolments to Process" preview table + Submit All + results table, shared by
 * the paste-from-Google-Sheet flow (BulkUpdateAssessmentView) and the select-from-Consolidated-
 * Finance-Data flow — both feed this the SAME BulkAssessmentRow[] shape and get identical
 * behavior (Action/Result/Assessment Date/Skill Code inputs, skill-code save, SSG submit).
 */
export const BulkAssessmentEditor: React.FC<BulkAssessmentEditorProps> = ({ rows, setRows }) => {
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [results, setResults] = useState<BulkAssessmentResult[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<{ total: number; success: number; error: number } | null>(null);
    const [savingMapping, setSavingMapping] = useState(false);
    const [mappingMsg, setMappingMsg] = useState<string | null>(null);

    const saveSkillCodeMapping = async () => {
        const pairs = new Map<string, string>();
        for (const r of rows) {
            const cc = r.courseCode?.trim(); const sc = r.skillCode?.trim();
            if (cc && sc) pairs.set(cc, sc);  // last non-empty per course wins
        }
        if (pairs.size === 0) { setMappingMsg('No course + skill-code pairs to save (fill in a Skill Code first).'); return; }
        setSavingMapping(true); setMappingMsg(null);
        try {
            const items = Array.from(pairs.entries()).map(([course_code, skill_code]) => ({ course_code, skill_code }));
            const resp = await fetch('/api/admin/course-skill-codes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
            });
            const data = await resp.json();
            setMappingMsg(data?.success ? `Saved skill code for ${data.saved} course(s) — future entries auto-fill.` : (data?.error || 'Save failed'));
        } catch { setMappingMsg('Save failed'); } finally { setSavingMapping(false); }
    };

    const updateRow = (idx: number, field: keyof BulkAssessmentRow, value: string) => {
        setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    };

    const removeRow = (idx: number) => {
        setRows(prev => prev.filter((_, i) => i !== idx));
    };

    const handleSubmit = async () => {
        if (rows.length === 0) { setError('No rows to submit.'); return; }

        const missingDate = rows.filter(r => !r.assessmentDate?.trim()).length;
        const missingSkillCodeRows = rows.filter(r => needsSkillCode(r) && !r.skillCode?.trim());
        if (missingDate > 0 || missingSkillCodeRows.length > 0) {
            setError([
                missingDate > 0 ? `${missingDate} row(s) missing Assessment Date.` : '',
                missingSkillCodeRows.length > 0 ? `${missingSkillCodeRows.length} WSQ/IBF row(s) missing Skill Code.` : '',
            ].filter(Boolean).join(' '));
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setResults(rows.map(r => ({
            enrolmentId: r.enrolmentId,
            traineeFullName: r.traineeFullName,
            status: 'pending' as const,
        })));
        setSummary(null);

        try {
            const response = await fetch('/api/assessments/ssg-bulk-update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: rows.map(r => ({
                        enrolmentReferenceNumber: r.enrolmentId,
                        courseRunId: r.courseRunId,
                        courseReferenceNumber: r.courseCode,
                        traineeFullName: r.traineeFullName,
                        traineeId: r.traineeId,
                        action: r.action,
                        result: r.result,
                        assessmentDate: r.assessmentDate,
                        skillCode: r.skillCode,
                    })),
                }),
            });

            const data = await response.json();

            if (!data.success) {
                setError(data.error || 'Bulk update failed');
                setResults([]);
                return;
            }

            setResults((data.results || []).map((r: Record<string, unknown>) => ({
                ...r,
                enrolmentId: r.enrolmentReferenceNumber || r.enrolmentId,
            })));
            setSummary(data.summary || null);
        } catch (err) {
            console.error('Bulk assessment error:', err);
            setError(err instanceof Error ? err.message : 'Failed to submit bulk assessment');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Number of columns to display (up to what we have headers for, or raw data length)
    const displayColCount = Math.min(ALL_COURSE_RUNS_HEADERS.length, rows[0]?.rawCols.length || ALL_COURSE_RUNS_HEADERS.length);

    return (
        <>
            {error && (
                <Card className="p-4 mb-6 border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700">
                    <pre className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{error}</pre>
                </Card>
            )}

            {/* Parsed Table with all columns + editable inputs */}
            {rows.length > 0 && results.length === 0 && (
                <Card className="p-6 mb-6">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-4">
                            <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200">
                                {rows.length} Enrolment{rows.length !== 1 ? 's' : ''} to Process
                            </h3>
                            <button
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                            >
                                {showAdvanced ? 'Hide' : 'Show'} advanced fields
                            </button>
                            <button
                                onClick={saveSkillCodeMapping}
                                disabled={savingMapping || isSubmitting}
                                title="Save each course's Skill Code so future entries auto-fill it"
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                            >
                                {savingMapping ? 'Saving…' : 'Save skill codes for these courses'}
                            </button>
                        </div>
                        <Button onClick={handleSubmit} disabled={isSubmitting}>
                            {isSubmitting ? 'Submitting...' : `Submit All (${rows.length})`}
                        </Button>
                    </div>
                    {mappingMsg && <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">{mappingMsg}</p>}
                    {rows.filter(r => needsSkillCode(r) && !r.skillCode?.trim()).length > 0 && (
                        <p className="text-xs text-yellow-800 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded px-2 py-1.5 mb-3">
                            ⚠️ {rows.filter(r => needsSkillCode(r) && !r.skillCode?.trim()).length} WSQ/IBF row(s) have no Skill Code found automatically. <strong>Try the storefront's "Skills Framework" code first. If it fails with TGS-425, submit one assessment for this course directly in SSG TPGateway</strong> — that fixes it automatically. Then enter the working code below and save.
                        </p>
                    )}

                    <div className="overflow-x-auto">
                        <table className="text-sm border-collapse whitespace-nowrap">
                            <thead>
                                {/* Group headers row */}
                                <tr className="border-b dark:border-gray-700">
                                    <th className="sticky left-0 z-10 bg-gray-100 dark:bg-gray-800"></th>
                                    <th colSpan={4} className="p-2 text-center text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 border-r-2 border-blue-300 dark:border-blue-600">
                                        SSG Input Fields
                                    </th>
                                    {showAdvanced && (
                                        <th colSpan={5} className="p-2 text-center text-xs font-bold uppercase tracking-wider text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 border-r-2 border-orange-300 dark:border-orange-600">
                                            Advanced (auto-filled)
                                        </th>
                                    )}
                                    <th colSpan={displayColCount} className="p-2 text-center text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                                        Parsed Data from All Course Runs
                                    </th>
                                </tr>
                                {/* Column headers row */}
                                <tr className="border-b-2 dark:border-gray-600">
                                    <th className="sticky left-0 z-10 bg-gray-100 dark:bg-gray-800 p-2 font-bold text-gray-600 dark:text-gray-300 text-left"></th>
                                    <th className="p-2 font-bold text-blue-600 dark:text-blue-400 text-left min-w-[90px] bg-blue-50 dark:bg-blue-900/20">Action</th>
                                    <th className="p-2 font-bold text-blue-600 dark:text-blue-400 text-left min-w-[80px] bg-blue-50 dark:bg-blue-900/20">Result</th>
                                    <th className="p-2 font-bold text-blue-600 dark:text-blue-400 text-left min-w-[150px] bg-blue-50 dark:bg-blue-900/20">Assessment Date <span className="font-normal text-[10px] text-gray-400">(DD/MM/YYYY)</span></th>
                                    <th className="p-2 font-bold text-blue-600 dark:text-blue-400 text-left min-w-[160px] bg-blue-50 dark:bg-blue-900/20 border-r-2 border-blue-300 dark:border-blue-600">Skill Code</th>
                                    {showAdvanced && (
                                        <>
                                            <th className="p-2 font-bold text-orange-600 dark:text-orange-400 text-left min-w-[100px] bg-orange-50/50 dark:bg-orange-900/10">Course Run ID</th>
                                            <th className="p-2 font-bold text-orange-600 dark:text-orange-400 text-left min-w-[130px] bg-orange-50/50 dark:bg-orange-900/10">Course Code</th>
                                            <th className="p-2 font-bold text-orange-600 dark:text-orange-400 text-left min-w-[150px] bg-orange-50/50 dark:bg-orange-900/10">Trainee Name</th>
                                            <th className="p-2 font-bold text-orange-600 dark:text-orange-400 text-left min-w-[110px] bg-orange-50/50 dark:bg-orange-900/10">Trainee ID</th>
                                            <th className="p-2 font-bold text-orange-600 dark:text-orange-400 text-left min-w-[140px] bg-orange-50/50 dark:bg-orange-900/10 border-r-2 border-orange-300 dark:border-orange-600">Enrolment ID</th>
                                        </>
                                    )}
                                    {Array.from({ length: displayColCount }, (_, i) => (
                                        <th key={i} className={`p-2 font-bold text-left text-xs ${SSG_USED_COLS.has(i) ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10' : 'text-gray-500 dark:text-gray-400'}`}>
                                            {ALL_COURSE_RUNS_HEADERS[i] || `Col ${i}`}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, idx) => {
                                    const existingDate = row.rawCols[COL.ASSESSMENT_ID_DATE] || '';
                                    const existingSkill = row.rawCols[COL.SKILL_CODE] || '';
                                    // Format YYYY-MM-DD to DD/MM/YYYY
                                    const formatDateDisplay = (d: string) => {
                                        if (!d) return '';
                                        const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                                        return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
                                    };
                                    const dateChanged = row.assessmentDate !== existingDate;
                                    const skillChanged = row.skillCode !== existingSkill;

                                    return (
                                        <tr key={idx} className="border-b dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                                            <td className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-800 p-1 text-center">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-gray-400 text-xs w-5">{idx + 1}</span>
                                                    <button
                                                        onClick={() => removeRow(idx)}
                                                        className="text-red-400 hover:text-red-600 dark:hover:text-red-300 text-xs px-1"
                                                        title="Remove row"
                                                        disabled={isSubmitting}
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                            </td>
                                            {/* Editable input cells */}
                                            <td className="p-1 bg-blue-50/50 dark:bg-blue-900/10">
                                                <select value={row.action} onChange={(e) => updateRow(idx, 'action', e.target.value)} className={cellInputClasses} disabled={isSubmitting}>
                                                    <option value="update">Update</option>
                                                    <option value="void">Void</option>
                                                </select>
                                            </td>
                                            <td className="p-1 bg-blue-50/50 dark:bg-blue-900/10">
                                                <select value={row.result} onChange={(e) => updateRow(idx, 'result', e.target.value)} className={cellInputClasses} disabled={isSubmitting}>
                                                    <option value="Pass">Pass</option>
                                                    <option value="Fail">Fail</option>
                                                    <option value="Exempt">Exempt</option>
                                                </select>
                                            </td>
                                            <td className="p-1 bg-blue-50/50 dark:bg-blue-900/10">
                                                <input type="date" value={row.assessmentDate} onChange={(e) => updateRow(idx, 'assessmentDate', e.target.value)} className={`${cellInputClasses} ${dateChanged ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20' : ''}`} disabled={isSubmitting} />
                                                <div className={`text-[10px] mt-0.5 ${!existingDate ? 'text-red-400 italic' : dateChanged ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400'}`}>
                                                    {existingDate ? `was: ${formatDateDisplay(existingDate)}` : 'existing cell is empty'}
                                                </div>
                                            </td>
                                            <td className="p-1 bg-blue-50/50 dark:bg-blue-900/10 border-r-2 border-blue-300 dark:border-blue-600">
                                                <input type="text" value={row.skillCode} onChange={(e) => updateRow(idx, 'skillCode', e.target.value)} className={`${cellInputClasses} ${skillChanged ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20' : ''}`} disabled={isSubmitting} placeholder={row.courseType === 'CASL' ? 'not required' : ''} />
                                                <div className={`text-[10px] mt-0.5 ${row.courseType === 'CASL' && !existingSkill ? 'text-gray-400' : !existingSkill ? 'text-red-400 italic' : skillChanged ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400'}`}>
                                                    {existingSkill ? `was: ${existingSkill}`
                                                        : row.courseType === 'CASL' ? 'CASL — no skill code'
                                                        : 'existing cell is empty'}
                                                </div>
                                            </td>
                                            {/* Advanced editable inputs (hidden by default) */}
                                            {showAdvanced && (() => {
                                                const advancedFields: { field: keyof BulkAssessmentRow; colIdx: number; isLast?: boolean }[] = [
                                                    { field: 'courseRunId', colIdx: COL.COURSE_RUN },
                                                    { field: 'courseCode', colIdx: COL.COURSE_CODE },
                                                    { field: 'traineeFullName', colIdx: COL.TRAINEE },
                                                    { field: 'traineeId', colIdx: COL.TRAINEE_ID },
                                                    { field: 'enrolmentId', colIdx: COL.ENROLMENT_ID, isLast: true },
                                                ];
                                                return advancedFields.map(({ field, colIdx, isLast }) => {
                                                    const original = row.rawCols[colIdx] || '';
                                                    const current = row[field] as string;
                                                    const changed = current !== original;
                                                    return (
                                                        <td key={field} className={`p-1 bg-orange-50/30 dark:bg-orange-900/10 ${isLast ? 'border-r-2 border-orange-300 dark:border-orange-600' : ''}`}>
                                                            <input type="text" value={current} onChange={(e) => updateRow(idx, field, e.target.value)} className={`${cellInputClasses} ${changed ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20' : ''}`} disabled={isSubmitting} />
                                                            <div className={`text-[10px] mt-0.5 ${!original ? 'text-red-400 italic' : changed ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400'}`}>
                                                                {original ? `was: ${original}` : 'existing cell is empty'}
                                                            </div>
                                                        </td>
                                                    );
                                                });
                                            })()}
                                            {/* All columns from the sheet */}
                                            {Array.from({ length: displayColCount }, (_, i) => (
                                                <td key={i} className={`p-2 text-xs ${SSG_USED_COLS.has(i) ? 'bg-blue-50/30 dark:bg-blue-900/10 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                                                    {row.rawCols[i] || <span className="text-gray-300 dark:text-gray-600">—</span>}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Results Table */}
            {results.length > 0 && (
                <Card className="p-6 mb-6">
                    {summary && (
                        <div className="flex gap-4 mb-4">
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">
                                Total: {summary.total}
                            </span>
                            <span className="text-sm font-bold text-green-600 dark:text-green-400">
                                Success: {summary.success}
                            </span>
                            <span className="text-sm font-bold text-red-600 dark:text-red-400">
                                Errors: {summary.error}
                            </span>
                        </div>
                    )}

                    {isSubmitting && (
                        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-sm text-blue-700 dark:text-blue-300">
                            Processing {rows.length} assessments... This may take a while (2s delay between SSG calls).
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b dark:border-gray-700">
                                    <th className="text-left p-2 font-bold text-gray-600 dark:text-gray-300">#</th>
                                    <th className="text-left p-2 font-bold text-gray-600 dark:text-gray-300">Enrolment ID</th>
                                    <th className="text-left p-2 font-bold text-gray-600 dark:text-gray-300">Trainee</th>
                                    <th className="text-left p-2 font-bold text-gray-600 dark:text-gray-300">Status</th>
                                    <th className="text-left p-2 font-bold text-gray-600 dark:text-gray-300">Assessment Ref #</th>
                                    <th className="text-left p-2 font-bold text-gray-600 dark:text-gray-300">Date</th>
                                    <th className="text-left p-2 font-bold text-gray-600 dark:text-gray-300">Error / Warning</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map((r, idx) => (
                                    <tr key={idx} className={`border-b dark:border-gray-700 ${r.status === 'error' ? 'bg-red-50 dark:bg-red-900/10' : r.status === 'success' ? 'bg-green-50 dark:bg-green-900/10' : ''}`}>
                                        <td className="p-2 text-gray-500">{idx + 1}</td>
                                        <td className="p-2 font-mono text-xs">{r.enrolmentId}</td>
                                        <td className="p-2">{r.traineeFullName}</td>
                                        <td className="p-2">
                                            {r.status === 'success' && <span className="text-green-600 dark:text-green-400 font-bold">Success</span>}
                                            {r.status === 'error' && <span className="text-red-600 dark:text-red-400 font-bold">Error</span>}
                                            {r.status === 'pending' && <span className="text-gray-400 italic">Pending...</span>}
                                        </td>
                                        <td className="p-2 font-mono text-xs">{r.assessmentReferenceNumber || '-'}</td>
                                        <td className="p-2 text-xs">{r.createdOn ? `${r.createdOn}${r.updatedOn ? ` (updated ${r.updatedOn})` : ''}` : '-'}</td>
                                        <td className="p-2 text-xs">
                                            {r.error && <span className="text-red-600 dark:text-red-400">{r.error}</span>}
                                            {r.error && /TGS-?425/i.test(r.error) && (
                                                <span className="text-red-600 dark:text-red-400 block mt-0.5">
                                                    <strong>Submit one assessment for this course directly in SSG TPGateway</strong> — that fixes this automatically. Then retry.
                                                </span>
                                            )}
                                            {r.paymentWarning && <span className="text-amber-600 dark:text-amber-400 block mt-0.5">⚠ {r.paymentWarning}</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </>
    );
};
