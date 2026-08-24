import React, { useState, useRef, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { authService } from '@lib/services/authService';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';
import { displayApplicationId, realApplicationId } from '@lib/daApplicationId';
import type { TpgJob } from '@lib/tpg/jobStore';

// Lets the panel re-attach to a TPGateway run that outlived its tab.
const TPG_JOB_KEY = 'lms.tpgConfirm.jobId';

/**
 * Is the TPGateway automation usable in this environment?
 *
 * Mirrors the server-side refusal in pages/api/admin/tpg-confirm/run.ts. Next
 * inlines process.env.NODE_ENV at build time, so this is a compile-time constant
 * in the client bundle — the deployed build simply never contains the card.
 */


const inputClasses ="block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
        case 'approved': case 'success': case 'successful': case 'confirmed':
            return 'bg-green-100 text-green-800 border-green-200';
        case 'processing': case 'pending': case 'pending_identity': case 'in progress':
            return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        case 'rejected': case 'failed': case 'cancelled':
            return 'bg-red-100 text-red-800 border-red-200';
        default:
            return 'bg-gray-100 text-gray-800 border-gray-200';
    }
};

/**
 * How to name one application in a message to the admin. A row minted for a
 * manual TPG enrolment carries only the internal `MANUAL-…` key, never a real
 * application id — fall through to the learner's name rather than show it.
 */
const applicationLabel = (app: any, fallback: string): string =>
    realApplicationId(app?.application_id) || app?.trainee_name || fallback;

type DaFilterCategory = 'all' | 'inserted' | 'updated' | 'skipped' | 'failed';

interface DaResultRow {
    action: 'inserted' | 'updated' | 'skipped' | 'failed';
    id?: string;
    application_id: string;
    trainee_name: string;
    trainee_id: string;
    message: string;
    enrolStatus?: 'pending' | 'pending_identity' | 'enroled' | 'grant_found' | 'invoiced' | 'failed' | null;
    enrolmentId?: string | null;
    grantId?: string | null;
    invoiceId?: string | null;
    /** Whether the learner reached the course's Google Calendar entry. */
    calendarAdded?: boolean;
    enrolError?: string | null;
}

/**
 * What the learner still owes, worked out from the figures on the row.
 *
 * `payable_fee` is TPGateway's number from the moment the application was
 * uploaded. Grants are issued asynchronously afterwards, so a row whose grant
 * arrived later still displays a pre-grant figure — showing a learner owing
 * $317.50 whose grant had since reduced it to $292.50, next to the very grant
 * columns that contradict it.
 *
 * SkillsFuture Credit is capped at what is owed, because it draws down a
 * balance rather than paying out: a learner electing $500 against a pre-grant
 * bill can only use what the bill has since become. This mirrors the invoice
 * builder, so the screen and the invoice agree.
 *
 * Returns null when the fee is unknown, so the caller can fall back rather than
 * print a confident $0.00.
 */
function computeDaBilling(app: any): { payable: number; creditApplied: number; declaredCredit: number } | null {
    const num = (v: any) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    if (app?.full_course_fee == null) return null;

    // The grant total lives in whichever of these the row happens to carry.
    // skillsfuture_subsidy is frequently null even when grants exist — the
    // amounts arrive from ssg_grants as tg_amount (the total) or as the
    // baseline/other pair. Preferring tg_amount avoids double counting, since
    // it already equals bl_amount + other_amount.
    const grantTotal =
        num(app.skillsfuture_subsidy) ||
        num(app.tg_amount) ||
        num(app.bl_amount) + num(app.other_amount);

    const owedBeforeCredit = num(app.full_course_fee) + num(app.gst) - grantTotal;
    const declaredCredit = num(app.skillsfuture_credit);
    const creditApplied = Math.min(declaredCredit, Math.max(0, owedBeforeCredit));
    return {
        payable: Math.max(0, Number((owedBeforeCredit - creditApplied).toFixed(2))),
        creditApplied: Number(creditApplied.toFixed(2)),
        declaredCredit,
    };
}

/**
 * WSQ / CASL / IBF for a DA row - as this enrolment was BILLED, not as the
 * course is typed today.
 *
 * The distinction matters because a renewal is not retroactive. `course_type`
 * is current state: renewing a course to CASL flips it for every row of that
 * course, including learners invoiced months earlier under the WSQ reference.
 * The invoice does not work that way - it resolves the QuickBooks product from
 * the TGS reference stamped on the DA row at application time, so a pre-renewal
 * learner's invoice correctly says WSQ forever.
 *
 * A column reading CASL next to an invoice reading WSQ would look like a fault.
 * So the row's own reference decides: cite the course's current code and you get
 * its current type; cite a superseded one and you were billed under what came
 * before, which for the Aug 2026 conversion means WSQ.
 *
 * The SSG course title is NOT a fallback - checked against all 196 live rows,
 * none carries a WSQ-/CASL- prefix.
 */
const FundingTypeBadge: React.FC<{
    courseType?: string | null;
    currentCode?: string | null;
    rowCode?: string | null;
    hasInvoice?: boolean;
}> = ({ courseType, currentCode, rowCode, hasInvoice }) => {
    const current = String(courseType || '').trim().toUpperCase();
    if (!current) return <span className="text-gray-400 dark:text-gray-500" title="No course record matches this SSG reference">-</span>;

    const rowRef = String(rowCode || '').trim().toUpperCase();
    const currentRef = String(currentCode || '').trim().toUpperCase();
    // "Behind" means this learner's reference is not the one the course carries
    // today, so they predate its renewal.
    const behind = !!rowRef && !!currentRef && rowRef !== currentRef;

    // Only the Aug 2026 CASL conversion is known to have changed a type, so it is
    // the only previous value named. Anything else keeps its current one.
    const previous = current === 'CASL' ? 'WSQ' : current;
    const asBilled = behind ? previous : current;

    const tone =
        asBilled === 'CASL' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300'
        : asBilled === 'WSQ' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
        : asBilled === 'IBF' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-200';

    const title = !behind
        ? `Course is typed ${current}`
        : hasInvoice
            ? `Invoiced as ${previous} under ${rowRef}. The course has since been renewed to ${current} under ${currentRef}; the issued invoice keeps its original wording.`
            : `Enrolled under ${rowRef}, which the course has since replaced with ${currentRef}. Nothing has been invoiced yet; an invoice generated now would be billed as ${previous}.`;

    return (
        <span className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide rounded ${tone}`} title={title}>
            {asBilled}
        </span>
    );
};

const RESULTS_PER_PAGE = 10;
const BATCH_SIZE_DA = 20;

export const UploadDirectApplicationView: React.FC = () => {
    const { setAdminPage } = useLms();
    const [file, setFile] = useState<File | null>(null);
    const [viewState, setViewState] = useState<'upload' | 'processing' | 'results'>('upload');
    const [allResults, setAllResults] = useState<DaResultRow[]>([]);
    const [summary, setSummary] = useState({ inserted: 0, updated: 0, skipped: 0, failed: 0 });
    const [filterCategory, setFilterCategory] = useState<DaFilterCategory>('all');
    const [resultsPage, setResultsPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [showTraineeId, setShowTraineeId] = useState(false);
    const [progressCurrent, setProgressCurrent] = useState(0);
    const [progressTotal, setProgressTotal] = useState(0);
    const [isAutoEnrolling, setIsAutoEnrolling] = useState(false);
    const [autoEnrolQueued, setAutoEnrolQueued] = useState(0);
    const [autoEnrolPolling, setAutoEnrolPolling] = useState(false);
    // Enrolling is the long half of a run (SSG + grant + invoice, per learner,
    // in series). Without a clock and a count it reads as a frozen spinner.
    const [autoEnrolStartedAt, setAutoEnrolStartedAt] = useState<number | null>(null);
    const [refreshingStatuses, setRefreshingStatuses] = useState(false);
    // TPGateway "confirm & fetch" automation (local-only; drives a headed browser)
    const [tpgJob, setTpgJob] = useState<TpgJob | null>(null);
    const [tpgRunning, setTpgRunning] = useState(false);
    const [tpgMax, setTpgMax] = useState('');
    const [tpgProgress, setTpgProgress] = useState(0);
    const [tpgJobId, setTpgJobId] = useState<string | null>(null);
    const [tpgCancelling, setTpgCancelling] = useState(false);
    const [tpgApproving, setTpgApproving] = useState(false);
    // Which learners are ticked while a "Choose learners" run waits.
    const [tpgChosen, setTpgChosen] = useState<Set<string>>(new Set());
    const [tpgSubmittingChoice, setTpgSubmittingChoice] = useState(false);
    // Drives the elapsed clock. Kept separate from the job so the time keeps
    // moving between polls instead of jumping every 2s.
    const [tpgNow, setTpgNow] = useState(() => Date.now());
    const tpgFeedRef = useRef<HTMLDivElement | null>(null);
    // Whether a helper machine is listening. Runs started here are driven by one
    // (see /api/admin/tpg-confirm/helper), and if none is on, a click just waits
    // — better to say so before it is pressed than after.
    const [tpgHelper, setTpgHelper] = useState<{ notNeeded: boolean; online: boolean } | null>(null);
    // A run that fails to START has no job, so it never reached the progress
    // panel — the message went to the upload card's error banner further down
    // the page, where it read as "the button did nothing".
    const [tpgError, setTpgError] = useState<string | null>(null);
    // Same toast pattern as ViewDirectApplicationView below, so a run that
    // finishes while you are looking elsewhere on the page still announces
    // itself — the panel alone is easy to miss once the browser window closes.
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [toastIsError, setToastIsError] = useState(false);
    const [toastVisible, setToastVisible] = useState(false);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = React.useCallback((message: string, isError = false) => {
        setToastMsg(message);
        setToastIsError(isError);
        setToastVisible(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
            setToastVisible(false);
            setTimeout(() => setToastMsg(null), 300);
        }, 5000);
    }, []);
    const [emailToggleOn, setEmailToggleOn] = useState(false);
    const [emailToggleSaving, setEmailToggleSaving] = useState(false);
    const [invoiceEmailCc, setInvoiceEmailCc] = useState('');
    const [invoiceEmailBcc, setInvoiceEmailBcc] = useState('');

    React.useEffect(() => {
        fetch('/api/admin/da-email-toggle')
            .then(r => r.json())
            .then(j => {
                if (j?.success) {
                    setEmailToggleOn(!!j.value);
                    setInvoiceEmailCc(j.cc || '');
                    setInvoiceEmailBcc(j.bcc || '');
                }
            })
            .catch(() => { /* keep default off */ });
    }, []);

    const handleEmailToggle = async () => {
        const next = !emailToggleOn;
        setEmailToggleSaving(true);
        setEmailToggleOn(next);
        try {
            const res = await fetch('/api/admin/da-email-toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: next }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Toggle failed');
        } catch (err) {
            setEmailToggleOn(!next);
            alert(`Failed to update setting: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setEmailToggleSaving(false);
        }
    };

    const handleEmailRecipientsSave = async () => {
        setEmailToggleSaving(true);
        try {
            const res = await fetch('/api/admin/da-email-toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cc: invoiceEmailCc, bcc: invoiceEmailBcc }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Save failed');
            setInvoiceEmailCc(json.cc || '');
            setInvoiceEmailBcc(json.bcc || '');
        } catch (err) {
            alert(`Failed to save recipients: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setEmailToggleSaving(false);
        }
    };

    const handlePullEmailRecipientsFromQuickBooks = async () => {
        setEmailToggleSaving(true);
        try {
            const res = await fetch('/api/admin/da-email-toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ importFromQuickBooks: true }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Import failed');
            setInvoiceEmailCc(json.cc || '');
            setInvoiceEmailBcc(json.bcc || '');
        } catch (err) {
            alert(`Failed to pull recipients from QuickBooks: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setEmailToggleSaving(false);
        }
    };

    const maskTraineeId = (id: string | null) => {
        if (!id) return 'N/A';
        if (showTraineeId) return id;
        if (id.length <= 4) return id;
        return '****' + id.slice(-4);
    };

    const handleFileChange = (selectedFile: File | undefined | null) => {
        if (selectedFile) {
            if (selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                selectedFile.type === 'application/vnd.ms-excel' ||
                selectedFile.name.endsWith('.xlsx') ||
                selectedFile.name.endsWith('.xls')) {
                setFile(selectedFile);
                setError(null);
            } else {
                setError('Invalid file type. Please upload an Excel file (.xlsx, .xls).');
                setFile(null);
            }
        }
    };

    const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(isOver);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const droppedFile = e.dataTransfer.files?.[0];
        handleFileChange(droppedFile);
    };

    const parseExcelFile = async (file: File): Promise<any[]> => {
        const XLSX = await import('xlsx');
        if (file.size < 100) {
            throw new Error(`File appears to be empty or corrupted (size: ${file.size} bytes).\n\nIf you just downloaded this file, please:\n1. Open the file in Excel\n2. Click "Enable Editing" if prompted\n3. Save the file (Ctrl+S)\n4. Upload the saved file`);
        }
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const firstBytes = new TextDecoder().decode(data.slice(0, 100));
                    if (firstBytes.includes('<!DOCTYPE') || firstBytes.includes('<html')) {
                        throw new Error('The uploaded file appears to be an HTML page, not an Excel file.\n\nThis usually happens when the download requires authentication.\nPlease download the file properly and try again.');
                    }
                    const workbook = XLSX.read(data, { type: 'array' });
                    if (!workbook.SheetNames.length) throw new Error('Excel file has no sheets.');
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '', raw: false });
                    if (!rawRows.length) throw new Error('Excel file is empty.\n\nThe first sheet contains no data.');

                    // Locate the real header row instead of assuming it is row 1.
                    // Some exports prepend a title/blank row, which would otherwise make every
                    // column key come through as "__EMPTY" and fail with "Missing Application ID".
                    const norm = (v: any) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
                    const HEADER_SIGNALS = ['application id', 'trainee id', 'trainee name', 'course run id'];
                    const headerRowIndex = rawRows.findIndex(
                        row => Array.isArray(row) && row.some(cell => HEADER_SIGNALS.includes(norm(cell)))
                    );
                    if (headerRowIndex === -1) {
                        const firstRowCells = (rawRows[0] || [])
                            .map(c => String(c ?? '').trim())
                            .filter(Boolean);
                        const seen = firstRowCells.length
                            ? `\n\nColumns found in the first row:\n${firstRowCells.join(' | ')}`
                            : '';
                        throw new Error(
                            `Could not find a header row containing "Application ID", "Trainee ID", "Trainee Name", or "Course Run ID".${seen}\n\nMake sure you are uploading the Direct Applications export with its column headers present.`
                        );
                    }
                    if (headerRowIndex > 0) {
                        console.warn(`Header row detected at line ${headerRowIndex + 1}; skipping ${headerRowIndex} preamble row(s).`);
                    }

                    const headers = rawRows[headerRowIndex].map(h => String(h ?? '').trim());
                    const dataRows = rawRows.slice(headerRowIndex + 1);
                    if (!dataRows.length) throw new Error('Only headers found, no data rows.\n\nSolution: Open the file in Excel, ensure data is visible, save it, and upload again.');

                    const objects = dataRows
                        .map(row => {
                            const obj: Record<string, any> = {};
                            headers.forEach((h, idx) => { if (h) obj[h] = row[idx] ?? ''; });
                            return obj;
                        })
                        .filter(obj => Object.values(obj).some(v => String(v ?? '').trim() !== ''));

                    resolve(objects);
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('Failed to read the file. Please try again.'));
            reader.readAsArrayBuffer(file);
        });
    };

    // Shared ingest: takes already-parsed rows (from a file upload OR the
    // TPGateway automation) and pushes them through the DA upload API in
    // batches. Returns the flat result rows so callers can chain auto-enrol.
    const ingestDaRows = async (excelData: any[]): Promise<DaResultRow[]> => {
        setViewState('processing');
        setAllResults([]);
        setSummary({ inserted: 0, updated: 0, skipped: 0, failed: 0 });
        setFilterCategory('all');
        setResultsPage(1);
        setError(null);
        setProgressCurrent(0);
        setProgressTotal(0);
        {
            const total = excelData.length;
            setProgressTotal(total);
            const flat: DaResultRow[] = [];
            let ins = 0, upd = 0, skip = 0, fail = 0;
            for (let i = 0; i < total; i += BATCH_SIZE_DA) {
                const batch = excelData.slice(i, i + BATCH_SIZE_DA);
                const response = await fetch('/api/admin/upload-da-applications', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: batch }),
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || (response.status === 500 ? 'Server error.' : `Error ${response.status}`));
                }
                const result = await response.json();
                (result.newRecords ?? []).forEach((r: any) => { flat.push({ action: 'inserted', id: r.id ?? '', application_id: r.application_id ?? '', trainee_name: r.trainee_name ?? '', trainee_id: r.trainee_id ?? '', message: 'Inserted successfully.' }); ins++; });
                (result.updatedRecords ?? []).forEach((r: any) => { flat.push({ action: 'updated', id: r.id ?? '', application_id: r.application_id ?? '', trainee_name: r.trainee_name ?? '', trainee_id: r.trainee_id ?? '', message: `Status updated to "${r.application_status ?? ''}"` }); upd++; });
                (result.errors ?? []).forEach((e: any) => { flat.push({ action: 'failed', application_id: e.application_id ?? `Row ${e.row ?? '?'}`, trainee_name: '', trainee_id: '', message: e.error ?? 'Unknown error' }); fail++; });
                const skipCount: number = result.duplicates ?? 0;
                const skipIds: string[] = result.duplicateIds ?? [];
                skipIds.forEach((id: string) => { flat.push({ action: 'skipped', application_id: id, trainee_name: '', trainee_id: '', message: `Application ID "${id}" already exists and is already up to date.` }); });
                if (skipCount > skipIds.length) flat.push({ action: 'skipped', application_id: `(${skipCount - skipIds.length} more)`, trainee_name: '', trainee_id: '', message: `${skipCount - skipIds.length} additional application(s) already up to date.` });
                skip += skipCount;
                setProgressCurrent(Math.min(i + BATCH_SIZE_DA, total));
            }
            setAllResults(flat);
            setSummary({ inserted: ins, updated: upd, skipped: skip, failed: fail });
            setViewState('results');
            return flat;
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        try {
            const excelData = await parseExcelFile(file);
            await ingestDaRows(excelData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to upload file');
            setViewState('upload');
        }
    };

    const resetView = () => {
        setFile(null); setAllResults([]); setSummary({ inserted: 0, updated: 0, skipped: 0, failed: 0 });
        setFilterCategory('all'); setResultsPage(1); setError(null); setShowTraineeId(false);
        setProgressCurrent(0); setProgressTotal(0); setViewState('upload');
    };

    const handleAutoEnrol = async (rowsArg?: DaResultRow[]) => {
        // rowsArg lets the TPGateway flow pass freshly-ingested rows directly;
        // onClick handlers pass a MouseEvent, so guard with Array.isArray.
        const source = Array.isArray(rowsArg) ? rowsArg : allResults;
        const eligibleRows = source.filter(r => (r.action === 'inserted' || r.action === 'updated') && r.id);
        const eligibleIds = eligibleRows.map(r => r.id!).filter(Boolean);
        if (eligibleIds.length === 0) return;
        setIsAutoEnrolling(true);
        try {
            const res = await fetch('/api/admin/auto-enrol-direct-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: eligibleIds }) });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to trigger auto-enrol');
            setAutoEnrolQueued(json.queued || eligibleIds.length);
            setAutoEnrolStartedAt(Date.now());
            setAutoEnrolPolling(true);
            pollEnrolStatus(eligibleRows.map(r => r.application_id).filter(Boolean));
        } catch (err) { setError(err instanceof Error ? err.message : 'Auto-enrol failed'); }
        finally { setIsAutoEnrolling(false); }
    };

    // --- TPGateway "confirm & fetch" automation (local-only) -----------------
    const authHeaders = (): Record<string, string> => {
        const t = authService.getAuthToken();
        return t ? { Authorization: `Bearer ${t}` } : {};
    };

    const notifyTpg = (title: string, body: string) => {
        try {
            if (typeof window === 'undefined' || !('Notification' in window)) return;
            if (Notification.permission === 'granted') { new Notification(title, { body }); return; }
            if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((p) => { if (p === 'granted') new Notification(title, { body }); });
            }
        } catch { /* notifications unsupported/blocked — ignore */ }
    };

    // Where the bar "wants" to be for the current phase (the creep eases toward this).
    const tpgTargetPct = (job: TpgJob | null): number => {
        if (!job) return 0;
        // Queued is genuinely 0% — nothing has started. Letting the bar creep
        // here suggests progress that does not exist.
        if (job.phase === 'queued') return 0;
        if (job.phase === 'done') return 100;
        if (job.phase === 'confirming' && job.total > 0) {
            const done = job.apps.filter(a => ['confirmed', 'would-confirm', 'skipped', 'failed'].includes(a.status)).length;
            return 32 + Math.round((done / job.total) * 50); // 32 → 82 as apps complete
        }
        const base: Record<string, number> = { starting: 4, awaiting_login: 12, collecting: 26, awaiting_approval: 30, confirming: 32, downloading: 86, parsing: 92, error: 100 };
        return base[job.phase] ?? 5;
    };

    // Continuously ease the displayed bar toward its phase target so it always
    // looks like it's moving (never frozen), and surges forward on phase changes.
    useEffect(() => {
        if (!tpgRunning) return;
        const iv = setInterval(() => {
            setTpgProgress(prev => {
                const target = tpgTargetPct(tpgJob);
                const softCap = Math.min(target + 6, 97); // let it creep a bit past the base, never to 100
                if (prev >= softCap) return prev;
                return Math.min(softCap, prev + Math.max(0.3, (softCap - prev) * 0.08));
            });
        }, 180);
        return () => clearInterval(iv);
    }, [tpgRunning, tpgJob]);

    // Keep the newest line in view. Without this the feed silently grows past
    // the fold and the one line you want — what it is doing now — is the one
    // you cannot see.
    useEffect(() => {
        const el = tpgFeedRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [tpgJob?.log?.length]);

    // Poll the helper's presence. Slow on purpose: this only decides a label,
    // and a run in progress is already reporting through /status.
    useEffect(() => {
        let cancelled = false;
        const check = async () => {
            try {
                const res = await fetch('/api/admin/tpg-confirm/helper', { headers: authHeaders() });
                const json = await res.json();
                if (!cancelled && json?.success) {
                    setTpgHelper({ notNeeded: !!json.notNeeded, online: !!json.online });
                }
            } catch { /* leave the last known state rather than flicker */ }
        };
        check();
        const iv = setInterval(check, 20000);
        return () => { cancelled = true; clearInterval(iv); };
    }, []);

    // Elapsed clock, once a second. Covers BOTH halves of a run — the browser
    // phase and the enrolment phase — since either can be the one you are sat
    // watching.
    useEffect(() => {
        if (!tpgRunning && !autoEnrolPolling) return;
        setTpgNow(Date.now());
        const iv = setInterval(() => setTpgNow(Date.now()), 1000);
        return () => clearInterval(iv);
    }, [tpgRunning, autoEnrolPolling]);

    /** Forward a click or keystroke to the browser the server is driving. */
    const sendTpgInput = async (input: { kind: 'click'; x: number; y: number } | { kind: 'type'; text: string } | { kind: 'key'; key: string }) => {
        if (!tpgJobId) return;
        try {
            await fetch('/api/admin/tpg-confirm/input', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ jobId: tpgJobId, ...input }),
            });
            // Deliberately no error surfaced: the driver applies gestures on its
            // next tick and the very next frame shows whether it landed, which
            // is faster feedback than any message could be.
        } catch { /* the operator can click again */ }
    };

    // Everything starts ticked: the operator is usually removing a few rather
    // than picking a few, and an empty list would make the primary button dead
    // on arrival.
    const tpgSelectableIds = (tpgJob?.phase === 'awaiting_selection'
        ? (tpgJob.apps || []).filter(a => a.status !== 'failed').map(a => a.id)
        : []
    ).join(',');

    // Everything starts ticked: the operator is usually removing a few rather
    // than picking a few. Keyed on the ids, not their count — keying on the
    // count meant a list arriving after the phase flipped never got ticked.
    useEffect(() => {
        if (!tpgSelectableIds) return;
        setTpgChosen(new Set(tpgSelectableIds.split(',')));
    }, [tpgSelectableIds]);

    const submitTpgChoice = async () => {
        if (!tpgJobId) return;
        setTpgSubmittingChoice(true);
        try {
            const res = await fetch('/api/admin/tpg-confirm/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ jobId: tpgJobId, applicationIds: [...tpgChosen] }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not submit your choice');
        } catch (err) {
            setTpgError(err instanceof Error ? err.message : 'Could not submit your choice');
        } finally {
            setTpgSubmittingChoice(false);
        }
    };

    const cancelTpg = async () => {
        if (!tpgJobId) return;
        setTpgCancelling(true);
        try {
            await fetch('/api/admin/tpg-confirm/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ jobId: tpgJobId }),
            });
            // The driver stops at its next safe point; the poll below reports it.
        } catch { /* the run keeps polling; the operator can close the browser */ }
    };

    const approveTpg = async () => {
        if (!tpgJobId) return;
        setTpgApproving(true);
        try {
            const res = await fetch('/api/admin/tpg-confirm/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ jobId: tpgJobId }),
            });
            const json = await res.json();
            if (!json.success) setError(json.error || 'Could not approve the run');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not approve the run');
        } finally {
            setTpgApproving(false);
        }
    };

    const runTpg = async (dryRun: boolean, chooseFirst = false) => {
        setError(null);
        setTpgError(null);
        setTpgJob(null);
        setTpgProgress(0);
        setTpgJobId(null);
        setTpgCancelling(false);
        setTpgRunning(true);
        // Ask for notification permission up-front so the completion ping can fire.
        try { if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
        try {
            const maxNum = parseInt(tpgMax, 10);
            const max = Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null;
            const res = await fetch('/api/admin/tpg-confirm/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ dryRun, max, chooseFirst }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to start TPGateway run');
            setTpgJobId(json.jobId);
            try { window.localStorage.setItem(TPG_JOB_KEY, json.jobId); } catch { /* ignore */ }
            await pollTpg(json.jobId);
        } catch (err) {
            setTpgError(err instanceof Error ? err.message : 'TPGateway run failed');
            setTpgRunning(false);
        }
    };

    const pollTpg = (jobId: string): Promise<void> => new Promise<void>((resolve) => {
        // Poll for as long as the JOB says it is running. An attempt cap used to
        // stop the UI after ~10 minutes while the driver kept confirming — the
        // ingest happens in here, so anything confirmed after that was left on
        // TPGateway and never reached the LMS. Only a job that has finished, or a
        // status endpoint that keeps failing, ends the loop now.
        let consecutiveFailures = 0;
        const finish = () => {
            try { window.localStorage.removeItem(TPG_JOB_KEY); } catch { /* ignore */ }
            resolve();
        };
        const tick = async () => {
            try {
                const res = await fetch(`/api/admin/tpg-confirm/status?jobId=${encodeURIComponent(jobId)}`, { headers: authHeaders() });
                if (res.status === 404) {
                    // The dev server restarted: the in-memory job is gone, so there
                    // is nothing left to wait for.
                    setTpgRunning(false);
                    setTpgCancelling(false);
                    setTpgError('That TPGateway run is no longer available (the dev server restarted).');
                    finish();
                    return;
                }
                const json = await res.json();
                if (json.success && json.job) {
                    consecutiveFailures = 0;
                    const job = json.job as TpgJob;
                    setTpgJob(job);
                    // A cancelled run is treated like a finished one: anything it
                    // already confirmed is live on TPGateway and must still be
                    // ingested, or it would be stranded.
                    if (job.phase === 'done' || job.phase === 'cancelled') {
                        const stopped = job.phase === 'cancelled';
                        setTpgRunning(false);
                        setTpgCancelling(false);
                        setTpgProgress(100);
                        const confirmedCount = job.apps.filter(a => a.status === 'confirmed').length;
                        const wouldCount = job.apps.filter(a => a.status === 'would-confirm').length;
                        // "Found none" is a normal, successful outcome, not a
                        // lesser version of "confirmed 5" — say so in its own
                        // words rather than reporting a count of zero.
                        const nothingFound = !stopped && job.found === 0;
                        notifyTpg(
                            stopped ? 'TPGateway run stopped'
                                : nothingFound ? 'TPGateway — nothing to confirm'
                                : job.dryRun ? 'TPGateway dry run complete' : 'TPGateway confirm & enrol complete',
                            nothingFound ? 'Every Direct Application is already confirmed.'
                                : job.dryRun ? `${wouldCount} application(s) would be confirmed. Nothing changed.`
                                : `Confirmed ${confirmedCount} application(s).${confirmedCount > 0 ? ' Now enrolling…' : ''}`,
                        );
                        showToast(
                            stopped ? 'TPGateway run stopped. Anything already confirmed was still enrolled.'
                                : nothingFound ? 'All caught up — no applications are waiting to be confirmed.'
                                : job.dryRun ? `Dry run complete — ${wouldCount} application(s) would be confirmed. Nothing changed.`
                                : `Confirmed ${confirmedCount} application(s).${confirmedCount > 0 ? ' Enrolling now…' : ''}`,
                            stopped,
                        );
                        // Live run: feed the fetched export rows through the existing
                        // ingest, then auto-enrol — the whole loop in one click.
                        if (!job.dryRun && Array.isArray(job.rows) && job.rows.length > 0) {
                            try {
                                const flat = await ingestDaRows(job.rows as any[]);
                                await handleAutoEnrol(flat);
                            } catch (e) {
                                setError(e instanceof Error ? e.message : 'Failed to ingest fetched applications');
                            }
                        }
                        finish();
                        return;
                    }
                    if (job.phase === 'error') {
                        setTpgRunning(false);
                        setTpgCancelling(false);
                        setError(job.error || 'TPGateway run failed');
                        notifyTpg('TPGateway run failed', job.error || 'See the panel for details.');
                        finish();
                        return;
                    }
                } else {
                    consecutiveFailures++;
                }
            } catch {
                consecutiveFailures++; // transient network blip — keep polling
            }
            // Only give up if the status endpoint itself has been unreachable for
            // a solid minute, never merely because the run is taking a while.
            if (consecutiveFailures > 40) {
                setTpgRunning(false);
                setTpgCancelling(false);
                setError('Lost contact with the TPGateway run. Check the dev terminal.');
                finish();
                return;
            }
            setTimeout(tick, 1500);
        };
        tick();
    });

    // Re-attach to a run still in flight after a reload or an accidentally closed
    // tab. The job (and its scraped rows) live on the server, so picking it back
    // up is what stops a confirmed application from being stranded. Re-ingesting
    // is harmless: the upload dedupes on application_id and auto-enrol skips rows
    // that already hold a real SSG enrolment id.
    useEffect(() => {
        let saved: string | null = null;
        try { saved = window.localStorage.getItem(TPG_JOB_KEY); } catch { /* ignore */ }
        if (!saved) return;
        setTpgJobId(saved);
        setTpgRunning(true);
        void pollTpg(saved);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * Re-read the enrolment status for every row on screen, once.
     *
     * pollEnrolStatus gives up after 60 attempts (~5 min) or when the page
     * reloads, and until now that left rows stuck showing nothing forever even
     * though the enrolment had completed. This makes that state recoverable.
     */
    const refreshEnrolStatuses = async () => {
        const ids = allResults.map(r => r.application_id).filter(Boolean);
        if (ids.length === 0) return;
        setRefreshingStatuses(true);
        try {
            const res = await fetch('/api/admin/da-enrol-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ applicationIds: ids }),
            });
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                const byId = new Map<string, any>();
                for (const row of json.data) if (row.application_id) byId.set(row.application_id, row);
                setAllResults(prev => prev.map(r => {
                    const dbRow = byId.get(r.application_id);
                    if (!dbRow) return r;
                    return {
                        ...r,
                        enrolStatus: dbRow.auto_enrol_status || null,
                        enrolmentId: dbRow.enrolment_id || null,
                        grantId: dbRow.grant_id || null,
                        invoiceId: dbRow.invoice_id || null,
                        calendarAdded: dbRow.calendar_added === true,
                        enrolError: dbRow.auto_enrol_error || null,
                    };
                }));
            }
        } catch {
            /* leave the current values in place */
        } finally {
            setRefreshingStatuses(false);
        }
    };

    const pollEnrolStatus = async (appIds: string[]) => {
        const appIdSet = new Set(appIds);
        let attempts = 0;
        // Used to notice when the pipeline has stopped moving — see the stop
        // condition below.
        let lastFingerprint = '';
        let stagnantPolls = 0;
        const poll = async () => {
            attempts++;
            try {
                // Ask only for the rows being watched. This used to refetch every
                // DA row in the system (a 1-2.5s query) every 5 seconds.
                const res = await fetch('/api/admin/da-enrol-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ applicationIds: [...appIdSet] }),
                });
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    const byId = new Map<string, any>();
                    for (const row of json.data) { if (row.application_id && appIdSet.has(row.application_id)) byId.set(row.application_id, row); }
                    setAllResults(prev => prev.map(r => { const dbRow = byId.get(r.application_id); if (!dbRow) return r; return { ...r, enrolStatus: dbRow.auto_enrol_status || null, enrolmentId: dbRow.enrolment_id || null, grantId: dbRow.grant_id || null, invoiceId: dbRow.invoice_id || null, calendarAdded: dbRow.calendar_added === true, enrolError: dbRow.auto_enrol_error || null }; }));
                    // 'enroled' and 'grant_found' are NOT the end — the pipeline
                    // carries on to the QuickBooks invoice and only then reaches
                    // 'invoiced'. Treating them as final stopped the display at
                    // "Completed" while invoicing was still running, so the invoice
                    // never appeared without pressing Refresh status.
                    const isFinal = (st: string) => ['invoiced', 'failed', 'pending_identity'].includes(st);
                    const allDone = [...appIdSet].every(id => { const row = byId.get(id); return row && isFinal(row.auto_enrol_status); });

                    // Invoicing is optional (training_provider.auto_generate_qb_invoice),
                    // so a run with it switched off legitimately ends at 'grant_found'
                    // and would otherwise poll until the attempt cap. Stop once every
                    // row has at least enrolled AND nothing has moved for a while.
                    const fingerprint = [...appIdSet].map(id => byId.get(id)?.auto_enrol_status || '').join('|');
                    if (fingerprint !== lastFingerprint) { lastFingerprint = fingerprint; stagnantPolls = 0; }
                    else { stagnantPolls++; }
                    // Must be a state that means the learner actually enrolled. Testing
                    // for "not pending" also matched 'failed', which a row sits at
                    // while the SSG retries run — so polling gave up mid-retry and the
                    // screen froze on a failure the pipeline went on to recover from.
                    const allAtLeastEnrolled = [...appIdSet].every(id => {
                        const st = byId.get(id)?.auto_enrol_status;
                        return st === 'enroled' || st === 'grant_found' || st === 'invoiced';
                    });

                    if (allDone || (allAtLeastEnrolled && stagnantPolls >= 9) || attempts >= 60) {
                        // The pipeline clears auto_enrol_error as its final act, which
                        // often lands just AFTER the status that satisfies the stop
                        // condition. Stopping here left the screen showing a message the
                        // database no longer held — a recovered error reported as a
                        // live one. Read once more before letting go.
                        setTimeout(async () => {
                            try {
                                const last = await fetch('/api/admin/da-enrol-status', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                                    body: JSON.stringify({ applicationIds: [...appIdSet] }),
                                });
                                const lastJson = await last.json();
                                if (lastJson.success && Array.isArray(lastJson.data)) {
                                    const fresh = new Map<string, any>();
                                    for (const row of lastJson.data) { if (row.application_id) fresh.set(row.application_id, row); }
                                    setAllResults(prev => prev.map(r => {
                                        const dbRow = fresh.get(r.application_id);
                                        if (!dbRow) return r;
                                        return { ...r, enrolStatus: dbRow.auto_enrol_status || null, enrolmentId: dbRow.enrolment_id || null, grantId: dbRow.grant_id || null, invoiceId: dbRow.invoice_id || null, calendarAdded: dbRow.calendar_added === true, enrolError: dbRow.auto_enrol_error || null };
                                    }));
                                }
                            } catch { /* the Refresh button remains */ }
                        }, 2500);
                        setAutoEnrolPolling(false);
                        return;
                    }
                }
            } catch { }
            setTimeout(poll, 5000);
        };
        setTimeout(poll, 3000);
    };

    const filteredResults = filterCategory === 'all' ? allResults : allResults.filter(r => r.action === filterCategory);
    const totalResultPages = Math.ceil(filteredResults.length / RESULTS_PER_PAGE);
    const paginatedResults = filteredResults.slice((resultsPage - 1) * RESULTS_PER_PAGE, resultsPage * RESULTS_PER_PAGE);
    const progressPct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;

    // Muted surfaces with a single accent per state. The previous version gave
    // each filter its own tinted panel, so four saturated blocks competed at the
    // top of the page and the numbers — the actual content — came second.
    const categoryCards: { key: DaFilterCategory; label: string; count: number; accent: string; text: string }[] = [
        { key: 'all', label: 'All', count: allResults.length, accent: 'bg-gray-400 dark:bg-gray-500', text: 'text-gray-800 dark:text-gray-100' },
        { key: 'inserted', label: 'Inserted', count: summary.inserted, accent: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
        { key: 'updated', label: 'Updated', count: summary.updated, accent: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-400' },
        { key: 'failed', label: 'Failed', count: summary.failed, accent: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
    ];

    const headerRow = (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                {viewState === 'results' && (<Button variant="ghost" onClick={resetView}><Icon name={IconName.Back} className="w-4 h-4 mr-1" />Back</Button>)}
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Upload Direct Applications</h1>
            </div>
            {viewState === 'results' && (
                <Button variant="ghost" onClick={resetView} className="border border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900/20">
                    <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />New Upload
                </Button>
            )}
        </div>
    );

    const fmtElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

    // Progress of the enrolment half, read off the statuses the poll already
    // fetches — no extra request. 'done' means SSG accepted the enrolment; the
    // grant and invoice steps follow it, so they are counted separately rather
    // than folded into one number.
    //
    // Declared ABOVE the early returns below: the results view uses them, and a
    // const declared after a `return` that renders it is a TDZ crash, not a
    // compile error — nothing would catch it until the screen was on-screen.
    const enrolCounts = React.useMemo(() => {
        const rows = allResults.filter(r => r.action === 'inserted' || r.action === 'updated');
        return {
            done: rows.filter(r => r.enrolStatus && !['pending', 'pending_identity', 'failed'].includes(r.enrolStatus)).length,
            granted: rows.filter(r => r.enrolStatus === 'grant_found' || r.enrolStatus === 'invoiced').length,
            invoiced: rows.filter(r => r.enrolStatus === 'invoiced').length,
            failed: rows.filter(r => r.enrolStatus === 'failed').length,
            total: rows.length,
        };
    }, [allResults]);
    // Name the stage actually in progress. Enrolment finishes well before the
    // QuickBooks invoice does, and reporting the whole run as "Enrolling" made
    // the invoice look like it never happened.
    const enrolStage =
        enrolCounts.done > 0 && enrolCounts.done >= enrolCounts.total && enrolCounts.invoiced < enrolCounts.done
            ? 'Generating invoices'
            : 'Enrolling';

    const autoEnrolElapsed = autoEnrolStartedAt
        ? Math.max(0, Math.round(((autoEnrolPolling ? tpgNow : Date.now()) - autoEnrolStartedAt) / 1000))
        : 0;

    if (viewState === 'processing') {
        return (
            <div className="space-y-6">
                {headerRow}
                <Card className="p-10 dark:bg-gray-800 dark:border-gray-700 flex flex-col items-center justify-center min-h-[360px]">
                    <div className="w-full max-w-md text-center space-y-6">
                        <div className="animate-spin rounded-full h-14 w-14 border-4 border-blue-200 border-t-blue-600 mx-auto" />
                        <div>
                            <p className="text-lg font-semibold text-gray-900 dark:text-white">Uploading Applications...</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Please do not close this page.</p>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-300">
                                <span>Progress</span><span>{Math.min(progressCurrent, progressTotal)} / {progressTotal}</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                                <div className="h-3 bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 text-right">{progressPct}%</p>
                        </div>
                    </div>
                </Card>
            </div>
        );
    }

    if (viewState === 'results') {
        const failedCount = summary.failed;
        const okCount = summary.inserted + summary.updated;
        const outcome = failedCount === 0 ? 'ok' : okCount === 0 ? 'bad' : 'mixed';

        return (
            <div className="space-y-5">
                {headerRow}

                {/* One clear statement of how it went. Four equal-weight tiles made
                    the reader assemble that themselves out of "0 Failed" and "1
                    Inserted"; the answer to "did it work" should not need arithmetic. */}
                <div className={`rounded-xl border p-5 ${
                    outcome === 'ok'
                        ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-900/15'
                        : outcome === 'bad'
                            ? 'border-rose-200 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-900/15'
                            : 'border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/15'
                }`}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-start gap-3.5">
                            <span className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                                outcome === 'ok' ? 'bg-emerald-500/15' : outcome === 'bad' ? 'bg-rose-500/15' : 'bg-amber-500/15'
                            }`}>
                                {autoEnrolPolling ? (
                                    <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                ) : outcome === 'ok' ? (
                                    <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                ) : (
                                    <svg className={`w-5 h-5 ${outcome === 'bad' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                                )}
                            </span>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">
                                    {autoEnrolPolling
                                        ? `${enrolStage}…`
                                        : outcome === 'ok'
                                            ? 'All done'
                                            : outcome === 'bad'
                                                ? 'Nothing went through'
                                                : 'Finished with problems'}
                                </h2>
                                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                    {autoEnrolPolling
                                        ? `${enrolCounts.done} of ${autoEnrolQueued} enrolled${enrolCounts.granted > 0 ? `, ${enrolCounts.granted} with grant` : ''}${enrolCounts.invoiced > 0 ? `, ${enrolCounts.invoiced} invoiced` : ''} · ${fmtElapsed(autoEnrolElapsed)}`
                                        : `${okCount} application${okCount === 1 ? '' : 's'} processed${failedCount > 0 ? `, ${failedCount} failed` : ''}${autoEnrolElapsed > 0 ? ` · ${fmtElapsed(autoEnrolElapsed)}` : ''}`}
                                </p>
                                {autoEnrolPolling ? (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                                        Each learner goes to SSG, then their grant is looked up, then the invoice is raised.
                                    </p>
                                ) : (
                                    // What actually landed, rather than only how many rows moved.
                                    // "1 processed" says nothing about whether they were invoiced.
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                                        {[
                                            { label: 'enrolled', n: enrolCounts.done },
                                            { label: 'with grant', n: enrolCounts.granted },
                                            { label: 'invoiced', n: enrolCounts.invoiced },
                                        ].filter(x => x.n > 0).map(x => (
                                            <span key={x.label} className="inline-flex items-baseline gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                                                <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{x.n}</span>
                                                {x.label}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Icon only: it sits beside the primary action and repeats
                                on every card list, so a full-width word competes with the
                                button that matters. Square, matched to the primary's
                                height, and it spins while it works so the state is legible
                                without a label. */}
                            <button
                                onClick={refreshEnrolStatuses}
                                disabled={refreshingStatuses}
                                title="Re-read enrolment status from SSG"
                                aria-label="Refresh status"
                                className="flex-shrink-0 w-10 h-10 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white hover:bg-white/60 dark:hover:bg-gray-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center">
                                <Icon name={IconName.Sync} className={`w-4 h-4 ${refreshingStatuses ? 'animate-spin' : ''}`} />
                            </button>
                            {/* When it all worked, the next thing anyone wants is to go and
                                look at the records — not to run it again. Re-run stays, but
                                demoted; when something failed it becomes the lead action
                                because that IS the next step. */}
                            {outcome === 'ok' && !autoEnrolPolling ? (
                                <>
                                    <Button variant="outline" onClick={() => handleAutoEnrol()} disabled={isAutoEnrolling}>
                                        {isAutoEnrolling ? 'Starting…' : 'Re-run'}
                                    </Button>
                                    <Button onClick={() => setAdminPage(AdminPage.ViewDirectApplication)}>
                                        View Direct Applications
                                    </Button>
                                </>
                            ) : (
                                <Button onClick={() => handleAutoEnrol()} disabled={isAutoEnrolling || autoEnrolPolling}>
                                    {isAutoEnrolling ? 'Starting…' : autoEnrolPolling ? 'Working…' : 'Re-run Auto-Enrol'}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Filters only earn their place when there is something to filter. */}
                {allResults.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                        {categoryCards.filter(c => c.key === 'all' || c.count > 0).map(({ key, label, count, accent }) => {
                            const active = filterCategory === key;
                            return (
                                <button key={key} onClick={() => { setFilterCategory(key); setResultsPage(1); }}
                                    aria-pressed={active}
                                    className={`inline-flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                                        active
                                            ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white'
                                            : 'bg-transparent text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                                    }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${accent}`} />
                                    {label}
                                    <span className="tabular-nums opacity-70">{count}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* A card per learner. Runs are typically one to a handful, and a
                    seven-column table for three rows buries the two things anyone
                    actually looks for: who it was, and how far they got. */}
                {filteredResults.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 py-14 text-center text-sm text-gray-500 dark:text-gray-400">
                        Nothing in this filter.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {paginatedResults.map((r, i) => {
                            const st = r.enrolStatus;
                            const isEnrolled = st === 'enroled' || st === 'grant_found' || st === 'invoiced';
                            // The order an operator thinks in, which is also the order
                            // these become true. Calendar sits between the grant and the
                            // invoice in their heads even though the pipeline raises the
                            // invoice first — what matters here is the checklist, not the
                            // internal sequence.
                            const stages = [
                                { label: 'Enrolled', done: isEnrolled, detail: r.enrolmentId || null },
                                { label: 'Grant', done: !!r.grantId, detail: r.grantId || null },
                                { label: 'Calendar', done: r.calendarAdded === true, detail: null },
                                { label: 'Invoice', done: !!r.invoiceId || st === 'invoiced', detail: r.invoiceId || null },
                            ];
                            return (
                                <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700/80 bg-white dark:bg-gray-800/50 px-5 py-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm transition-all">
                                    <div className="flex items-start justify-between gap-4 flex-wrap">
                                        <div className="flex items-start gap-3 min-w-0">
                                            {/* An initial gives the row a fixed anchor point; a list of
                                                names all starting at different widths reads as a wall. */}
                                            <span className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm font-semibold text-gray-600 dark:text-gray-200">
                                                {(r.trainee_name || '?').trim().charAt(0).toUpperCase()}
                                            </span>
                                            <div className="min-w-0">
                                            <div className="flex items-center gap-2.5 flex-wrap">
                                                <span className="text-base font-semibold text-gray-900 dark:text-white">{r.trainee_name || '—'}</span>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
                                                    r.action === 'inserted' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                        : r.action === 'updated' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                                                            : r.action === 'skipped' ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                                                                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                                                    {r.action}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                                                <span className="font-mono text-gray-600 dark:text-gray-300">{r.application_id || '—'}</span>
                                                <span className="text-gray-300 dark:text-gray-600">·</span>
                                                <span className="flex items-center gap-1">
                                                    <span className="font-mono text-gray-400 dark:text-gray-500">{maskTraineeId(r.trainee_id || null)}</span>
                                                    {r.trainee_id && (
                                                        <button onClick={() => setShowTraineeId(v => !v)} className="p-0.5 text-gray-400 hover:text-blue-500 rounded">
                                                            <Icon name={showTraineeId ? IconName.EyeOff : IconName.Eye} className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </span>
                                            </div>
                                            </div>
                                        </div>

                                        {/* How far this learner got, as a trail rather than one word. */}
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {st === 'failed' ? (
                                                <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" title={r.enrolError || undefined}>failed</span>
                                            ) : st === 'pending_identity' ? (
                                                <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" title={r.enrolError || undefined}>needs ID</span>
                                            ) : !st || st === 'pending' ? (
                                                autoEnrolPolling
                                                    ? <span className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400"><span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />working…</span>
                                                    : <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">not checked</span>
                                            ) : (
                                                <div className="flex items-start pt-0.5">
                                                    {stages.map((stage, si) => (
                                                        <div key={stage.label} className="flex items-start">
                                                            {si > 0 && (
                                                                <span className={`mt-[9px] h-px w-8 sm:w-10 ${
                                                                    stage.done ? 'bg-emerald-400/70' : 'bg-gray-200 dark:bg-gray-700'
                                                                }`} />
                                                            )}
                                                            <div className="flex flex-col items-center gap-1.5 w-[62px]">
                                                                <span
                                                                    title={stage.detail || undefined}
                                                                    className={`w-[19px] h-[19px] rounded-full flex items-center justify-center transition-colors ${
                                                                        stage.done
                                                                            ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                                                            : 'border-[1.5px] border-dashed border-gray-300 dark:border-gray-600'
                                                                    }`}>
                                                                    {stage.done && (
                                                                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                        </svg>
                                                                    )}
                                                                </span>
                                                                <span className={`text-[10px] font-medium tracking-wide whitespace-nowrap ${
                                                                    stage.done
                                                                        ? 'text-gray-700 dark:text-gray-200'
                                                                        : 'text-gray-400 dark:text-gray-500'
                                                                }`}>
                                                                    {stage.label}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {(r.enrolmentId || r.grantId) && (
                                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
                                            {r.enrolmentId && <span className="text-gray-500 dark:text-gray-400">Enrolment <span className="font-mono text-gray-700 dark:text-gray-200">{r.enrolmentId}</span></span>}
                                            {r.grantId && <span className="text-gray-500 dark:text-gray-400">Grant <span className="font-mono text-gray-700 dark:text-gray-200">{r.grantId}</span></span>}
                                        </div>
                                    )}

                                    {/* A message deserves its own notice rather than being the third
                                        item on a row of reference numbers — it is the one thing here
                                        that might need acting on. */}
                                    {r.enrolError && !stages.every(x => x.done) && (
                                        <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200/70 dark:border-amber-800/50 px-3 py-2">
                                            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                            </svg>
                                            <span className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300 min-w-0">{r.enrolError}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {totalResultPages > 1 && (
                            <div className="flex justify-between items-center pt-1">
                                <Button variant="ghost" onClick={() => setResultsPage(p => Math.max(1, p - 1))} disabled={resultsPage === 1}>Previous</Button>
                                <span className="text-sm text-gray-500 dark:text-gray-400">Page {resultsPage} of {totalResultPages}</span>
                                <Button variant="ghost" onClick={() => setResultsPage(p => Math.min(totalResultPages, p + 1))} disabled={resultsPage === totalResultPages}>Next</Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    const UploadStep = () => (
        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
            <div className={`mb-4 p-4 rounded-lg border-2 ${emailToggleOn ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700'}`}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center ${emailToggleOn ? 'bg-emerald-100 dark:bg-emerald-800/40' : 'bg-amber-100 dark:bg-amber-800/40'}`}>
                            <Icon name={emailToggleOn ? IconName.Mail : IconName.Warning} className={`w-5 h-5 ${emailToggleOn ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`} />
                        </div>
                        <div>
                            <p className={`text-sm font-semibold ${emailToggleOn ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-200'}`}>
                                Send Tax Invoice Email to Learner: {emailToggleOn ? 'ON' : 'OFF (test mode)'}
                            </p>
                            <p className={`text-xs mt-0.5 ${emailToggleOn ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                {emailToggleOn
                                    ? 'After invoice generation, the main tax invoice will be emailed to the learner.'
                                    : 'Invoices will still be generated and saved to Drive — emails are NOT sent. Safe for testing.'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleEmailToggle}
                        disabled={emailToggleSaving}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${emailToggleOn ? 'bg-emerald-500 focus:ring-emerald-500' : 'bg-gray-300 dark:bg-gray-600 focus:ring-amber-500'} ${emailToggleSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                        aria-label="Toggle invoice email"
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${emailToggleOn ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
                    <label className="block">
                        <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">CC recipients</span>
                        <input
                            type="text"
                            value={invoiceEmailCc}
                            onChange={(e) => setInvoiceEmailCc(e.target.value)}
                            placeholder="finance@example.com, admin@example.com"
                            className={inputClasses}
                        />
                    </label>
                    <label className="block">
                        <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">BCC recipients</span>
                        <input
                            type="text"
                            value={invoiceEmailBcc}
                            onChange={(e) => setInvoiceEmailBcc(e.target.value)}
                            placeholder="audit@example.com"
                            className={inputClasses}
                        />
                    </label>
                    <Button variant="secondary" onClick={handleEmailRecipientsSave} disabled={emailToggleSaving}>
                        {emailToggleSaving ? 'Saving...' : 'Save Recipients'}
                    </Button>
                    <Button variant="outline" onClick={handlePullEmailRecipientsFromQuickBooks} disabled={emailToggleSaving}>
                        Pull from QuickBooks
                    </Button>
                </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-amber-800 mb-2">Important: For Direct Application File</h4>
                <p className="text-sm text-amber-700">If you just downloaded this Excel file, please do the following before uploading:</p>
                <ul className="text-sm text-amber-700 mt-2 list-disc list-inside space-y-1">
                    <li><strong>Windows:</strong> Open the file in Excel -&gt; Click &quot;Enable Editing&quot; -&gt; Save the file</li>
                    <li><strong>Mac:</strong> Open the file in Excel -&gt; Save the file (Cmd+S)</li>
                </ul>
                                <p className="text-sm text-amber-700 mt-2"><strong>Reason:</strong> The Excel file downloaded from TPG opens in Protected View.</p>
            </div>
            <div className="text-center mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Upload Direct Application</h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">Submit DA application data in bulk by uploading an Excel file.</p>
            </div>
            <div onDragOver={(e) => handleDragEvents(e, true)} onDragLeave={(e) => handleDragEvents(e, false)} onDrop={handleDrop}
                className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'}`}>
                <input type="file" id="file-upload-da" className="hidden" accept=".xlsx, .xls" onChange={(e) => handleFileChange(e.target.files?.[0])} />
                <label htmlFor="file-upload-da" className="cursor-pointer">
                    <Icon name={IconName.Upload} className="w-12 h-12 mx-auto text-gray-400" />
                    <p className="mt-2 font-semibold text-gray-900 dark:text-white">{file ? file.name : 'Drag & drop your file here, or click to browse'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">XLSX or XLS file format</p>
                </label>
            </div>
            {error && (
                <div className="mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-white border border-red-200 rounded-full flex items-center justify-center"><Icon name={IconName.Close} className="w-5 h-5 text-red-500" /></div>
                    <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 dark:text-red-100">Something went wrong!</h4>
                        <p className="text-sm text-gray-600 dark:text-red-200/90 mt-1 whitespace-pre-line">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:text-red-300 dark:hover:text-red-100"><Icon name={IconName.Close} className="w-5 h-5" /></button>
                </div>
            )}
            <div className="flex justify-end items-center mt-6">
                <Button onClick={handleUpload} disabled={!file}>Upload &amp; Process</Button>
            </div>
        </Card>
    );

    const TPG_PHASE_LABEL: Record<string, string> = {
        queued: 'Waiting to start',
        awaiting_selection: 'Choose who to confirm',
        starting: 'Starting…',
        awaiting_login: 'Waiting for Singpass login',
        collecting: 'Finding pending applications',
        awaiting_approval: 'Waiting for your approval',
        confirming: 'Confirming applications',
        downloading: 'Preparing enrolment data',
        parsing: 'Preparing enrolment data',
        done: 'Done',
        cancelled: 'Stopped',
        error: 'Error',
    };
    // 'pending' (queued, not yet looked at) and 'would-confirm' (checked, dry run
    // stopped short of confirming) must read differently — sharing a label made a
    // dry run look like it had processed everything it found.
    const tpgStatusLabel = (s: string): string => ({
        pending: 'queued',
        confirming: 'confirming…',
        confirmed: 'confirmed',
        'would-confirm': 'would be confirmed',
        skipped: 'skipped',
        failed: 'failed',
    } as Record<string, string>)[s] || s;
    const tpgAppChipClass = (s: string) =>
        s === 'confirmed' ? 'bg-green-100 text-green-700'
            : s === 'would-confirm' ? 'bg-yellow-100 text-yellow-700'
                : s === 'confirming' ? 'bg-blue-100 text-blue-700'
                    : s === 'failed' ? 'bg-red-100 text-red-700'
                        : s === 'skipped' ? 'bg-gray-100 text-gray-600'
                            : 'bg-gray-100 text-gray-500';

    // A finished run that found nothing. `found` is the count BEFORE Limit is
    // applied, so this stays true whatever Limit was typed — a Limit of 1 over an
    // empty list still means there was nothing to confirm.
    const tpgNothingToConfirm = !!tpgJob && tpgJob.phase === 'done' && tpgJob.found === 0;
    // When it was checked matters more than that it was checked: this panel can
    // sit on screen long after the run, and a stale "all clear" is misleading.
    // Known-offline only. While the first check is still in flight tpgHelper is
    // null, and disabling the buttons on "not yet known" would make the page
    // look broken for its first second.
    const tpgHelperOffline = !!tpgHelper && !tpgHelper.notNeeded && !tpgHelper.online;
    const OFFLINE_HINT = 'Not available right now — try again shortly.';

    const tpgCheckedAt = tpgJob?.updatedAt
        ? new Date(tpgJob.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
    // A run takes minutes, so "how long has this been going?" is the first thing
    // you want to know when it feels stuck. Ticks off tpgNow while running.
    const tpgElapsed = tpgJob?.startedAt
        ? Math.max(0, Math.round(((tpgRunning ? tpgNow : tpgJob.updatedAt) - tpgJob.startedAt) / 1000))
        : 0;

    return (
        <div className="space-y-6">
            {headerRow}
            {/* Hidden on the deployed server. The run endpoint refuses outright when
                NODE_ENV is production (pages/api/admin/tpg-confirm/run.ts) because the
                flow drives a HEADED Chromium that a human signs into with Singpass —
                impossible on the Coolify container. Showing the card there offered
                every admin two buttons that could only ever return an error. */}
            <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3">
                        <div className="w-9 h-9 flex-shrink-0 rounded-full bg-purple-100 dark:bg-purple-800/40 flex items-center justify-center">
                            <Icon name={IconName.Download} className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Confirm &amp; fetch from TPGateway</h3>
                                {/* Can a run start right now — nothing about where it runs,
                                    which is our problem to solve and not the operator's. */}
                                {tpgHelper && (
                                    tpgHelperOffline ? (
                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                            Not ready
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            Ready
                                        </span>
                                    )
                                )}
                            </div>
                            {/* Read once, then acted on — so it leads with what happens, and
                                separates the two buttons rather than burying the difference in
                                a paragraph. Confirming cannot be undone, which is why the safe
                                option is described first. */}
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xl space-y-1">
                                <p>
                                    Signs in to TPGateway with your Singpass, confirms every Direct Application
                                    waiting for confirmation, and enrols those learners with SSG — in one go.
                                </p>
                                <p>
                                    <strong>Dry run</strong> shows what it would confirm and changes nothing.
                                    <span className="mx-1">·</span>
                                    <strong>Confirm &amp; Enrol</strong> does it for real, and cannot be undone.
                                </p>
                                <p>
                                    Set <strong>Limit</strong> to try a few first, or leave it empty to see the
                                    full count and approve before anything is confirmed.
                                </p>
                            </div>
                            {/* The card is shown in BOTH environments on purpose: hiding it on
                                the server made a working feature look deleted. What changes is
                                the action — the server cannot open a Singpass browser, so it
                                hands over to the LMS running on the operator's machine, which
                                talks to this same database. */}
                        </div>
                    </div>
                    {/* Same controls everywhere. On the server the browser runs
                        headless and its screen is streamed into the panel below, so
                        there is no longer anything the operator must do locally. */}
                    <div className="flex items-end gap-2">
                        <label className="block">
                            <span className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Limit</span>
                            <input type="number" min="1" value={tpgMax} onChange={e => setTpgMax(e.target.value)} placeholder="all"
                                disabled={tpgRunning}
                                className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                        </label>
                        {/* Disabled rather than explained: a button that queues a run nothing
                            can pick up is worse than no button, and the badge above already
                            says why. */}
                        <Button variant="outline" onClick={() => runTpg(true)} disabled={tpgRunning || tpgHelperOffline}
                            title={tpgHelperOffline ? OFFLINE_HINT : undefined}>Dry run</Button>
                        <Button variant="outline" onClick={() => runTpg(false, true)} disabled={tpgRunning || tpgHelperOffline}
                            title={tpgHelperOffline ? OFFLINE_HINT : 'Read each application first, then pick who to confirm'}>Choose learners</Button>
                        <Button onClick={() => runTpg(false)} disabled={tpgRunning || tpgHelperOffline}
                            title={tpgHelperOffline ? OFFLINE_HINT : undefined}>Confirm &amp; Enrol</Button>
                        {tpgRunning && (
                            <Button variant="outline" onClick={cancelTpg} disabled={tpgCancelling}
                                className="!text-red-600 !border-red-300 hover:!bg-red-50 dark:!text-red-300 dark:!border-red-700 dark:hover:!bg-red-900/30">
                                {tpgCancelling ? 'Stopping…' : 'Cancel'}
                            </Button>
                        )}
                    </div>
                </div>

                {tpgError && (
                    <div className="mt-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                            <Icon name={IconName.Close} className="w-3 h-3 text-red-500 dark:text-red-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-red-900 dark:text-red-200">Could not start the run</p>
                            <p className="text-xs text-red-800 dark:text-red-300 mt-1">{tpgError}</p>
                            {/* The server rejects legacy and expired tokens outright, so this
                                is by far the most common cause — and it is not obvious from
                                the raw message that re-logging in is the fix. */}
                            {/not authenticated|unauthor/i.test(tpgError) && (
                                <p className="text-xs text-red-800 dark:text-red-300 mt-1.5">
                                    Your sign-in has expired. Log out and log back in, then try again.
                                </p>
                            )}
                        </div>
                        <button onClick={() => setTpgError(null)} aria-label="Dismiss"
                            className="flex-shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-200">
                            <Icon name={IconName.Close} className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {tpgJob && (
                    <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2">
                                {tpgRunning && <span className="inline-block w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />}
                                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{TPG_PHASE_LABEL[tpgJob.phase] || tpgJob.phase}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                {/* Hidden in two cases, both of them duplication: the all-clear
                                    block says it in full, and while running the feed's newest
                                    line already says it — the header was echoing the phase
                                    label verbatim next to itself. */}
                                {!tpgNothingToConfirm && !(tpgRunning && tpgJob.log?.length > 0) && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400 text-right">{tpgJob.message}</span>
                                )}
                                {/* "Clear" implies discarding a result worth keeping. When the
                                    answer is simply "nothing to do", there is no result to
                                    clear — you are just dismissing a notice, which is what an
                                    X means everywhere else. */}
                                {!tpgRunning && (tpgNothingToConfirm ? (
                                    <button onClick={() => setTpgJob(null)} aria-label="Dismiss" title="Dismiss"
                                        className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">
                                        <Icon name={IconName.Close} className="w-4 h-4" />
                                    </button>
                                ) : (
                                    <button onClick={() => setTpgJob(null)}
                                        className="flex-shrink-0 text-xs font-medium px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                                        Clear
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* The Singpass step. The run is on the server, so the operator
                            cannot see its browser — these are live frames of it. Clicking
                            the picture forwards a click at the same spot on the real page,
                            which is all this flow needs: a tap or two, then scan the QR. */}
                        {tpgJob.needsOperator && tpgJob.screen && (
                            <div className="mt-4 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
                                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                                    <div>
                                        <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                                            Sign in with Singpass to continue
                                        </p>
                                        <p className="text-xs text-blue-800 dark:text-blue-300 mt-1 max-w-2xl">
                                            This is the live browser running on the server. Scan the QR with the
                                            Singpass app on your phone — you are signing in as yourself. Click the
                                            picture if you need to press something on the page.
                                        </p>
                                    </div>
                                    <span className="text-[11px] text-blue-700 dark:text-blue-300 tabular-nums">
                                        updated {new Date(tpgJob.screen.at).toLocaleTimeString([], { hour12: false })}
                                    </span>
                                </div>
                                <img
                                    src={tpgJob.screen.dataUrl}
                                    alt="Live view of the sign-in page"
                                    onClick={(e) => {
                                        // Map the click from however large the image is rendered
                                        // back to the page's own coordinate system.
                                        const r = (e.target as HTMLImageElement).getBoundingClientRect();
                                        const x = ((e.clientX - r.left) / r.width) * (tpgJob.screen?.width || 1);
                                        const y = ((e.clientY - r.top) / r.height) * (tpgJob.screen?.height || 1);
                                        void sendTpgInput({ kind: 'click', x: Math.round(x), y: Math.round(y) });
                                    }}
                                    className="w-full rounded border border-blue-200 dark:border-blue-800 cursor-pointer bg-white"
                                />
                            </div>
                        )}
                        {/* A queued run is waiting on something outside this page, so say
                            what — a creeping progress bar alone reads as work happening
                            when in fact nothing has started. */}
                        {/* Short now: the badge above says whether a machine is listening, and
                            the buttons are disabled when none is, so reaching this state at all
                            means the helper dropped out mid-click. */}
                        {tpgJob.phase === 'queued' && (
                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                                Starting…
                            </p>
                        )}
                        {tpgJob.dryRun && !tpgNothingToConfirm && (
                            <p className="text-[11px] mt-1 text-indigo-600 dark:text-indigo-300">Dry run — nothing will be confirmed on TPGateway.</p>
                        )}
                        {/* Finding nothing to do is a success, so it reads as one. The
                            old panel showed a raw status line plus a full purple bar at
                            100%, which looks like work was completed. */}
                        {tpgNothingToConfirm && (
                            <div className="mt-3 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-3">
                                <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                        <svg className="w-3 h-3 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                                            All caught up — nothing to confirm
                                        </p>
                                        {/* One template string, not text split around JSX
                                            expressions — that quietly inserts stray spaces. */}
                                        <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                                            {`No Direct Applications on TPGateway are waiting for confirmation${tpgCheckedAt ? ` as of ${tpgCheckedAt}` : ''}. Nothing was confirmed or changed.`}
                                        </p>
                                        {tpgJob.screenshot && (
                                            <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/70 mt-1.5">
                                                Expecting some? A screenshot of the TPGateway list was saved to scratch/ so you can check what it showed.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        {tpgJob.phase === 'awaiting_approval' && (
                            <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
                                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                                    {tpgJob.total} application(s) are ready to confirm.
                                </p>
                                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                                    Nothing has been confirmed on TPGateway yet. Check the list below, then approve.
                                    Confirming cannot be undone.
                                </p>
                                <div className="flex items-center gap-2 mt-3">
                                    <Button onClick={approveTpg} disabled={tpgApproving}>
                                        {tpgApproving ? 'Approving…' : `Confirm all ${tpgJob.total}`}
                                    </Button>
                                    <Button variant="outline" onClick={cancelTpg} disabled={tpgCancelling}>
                                        {tpgCancelling ? 'Stopping…' : 'Cancel'}
                                    </Button>
                                </div>
                            </div>
                        )}
                        {tpgJob.found > tpgJob.total && tpgJob.total > 0 && (
                            <p className="text-[11px] mt-1 text-gray-500 dark:text-gray-400">
                                {tpgJob.found} application(s) are awaiting confirmation — this run is limited to {tpgJob.total}.
                            </p>
                        )}
                        {tpgJob.phase === 'cancelled' && (
                            <p className="text-[11px] mt-1 text-red-600 dark:text-red-300">
                                Stopped by you. Anything already confirmed on TPGateway was still enrolled.
                            </p>
                        )}
                        {!tpgNothingToConfirm && (() => {
                            const doneCount = tpgJob.apps.filter(a => ['confirmed', 'would-confirm', 'skipped', 'failed'].includes(a.status)).length;
                            const total = tpgJob.total || 0;
                            return (
                                <div className="mt-3">
                                    <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                                        <span>{total > 0 ? `${doneCount} / ${total}` : (tpgJob.phase === 'done' ? 'Complete' : 'Working…')}</span>
                                        <span className="tabular-nums">{fmtElapsed(tpgElapsed)} · {Math.round(tpgProgress)}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                                        <div className="h-2 rounded-full bg-purple-500 transition-all duration-200 ease-out"
                                            style={{ width: `${tpgProgress}%` }} />
                                    </div>
                                </div>
                            );
                        })()}
                        {/* What it is doing right now. The chips below say where each
                            application ended up; this says what the run is touching at
                            this second, which is the difference between "slow" and
                            "hung". Newest last, so it reads like a terminal. */}
                        {!tpgNothingToConfirm && tpgJob.log?.length > 0 && (
                            <div className="mt-4">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Activity</p>
                                    {tpgRunning && (
                                        <span className="flex items-center gap-1.5 text-[10px] font-medium text-purple-500 dark:text-purple-400">
                                            <span className="relative flex w-1.5 h-1.5">
                                                <span className="absolute inline-flex w-full h-full rounded-full bg-purple-400 opacity-75 animate-ping" />
                                                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-purple-500" />
                                            </span>
                                            Live
                                        </span>
                                    )}
                                </div>
                                <div ref={tpgFeedRef}
                                    className="max-h-44 overflow-y-auto rounded-xl border border-gray-200/80 dark:border-gray-700/60 bg-gray-50/70 dark:bg-gray-900/40 px-4 py-3">
                                    <ol className="space-y-3">
                                        {tpgJob.log.slice(-12).map((entry, i, shown) => {
                                            const isLast = i === shown.length - 1;
                                            const isCurrent = isLast && tpgRunning;
                                            return (
                                                <li key={`${entry.at}-${i}`} className="relative flex gap-3">
                                                    {/* Thread the dots together so the feed reads as one
                                                        sequence of steps rather than loose lines. */}
                                                    {!isLast && (
                                                        <span aria-hidden
                                                            className="absolute left-[4px] top-3 -bottom-3 w-px bg-gray-200 dark:bg-gray-700" />
                                                    )}
                                                    <span className="relative flex-shrink-0 mt-1.5 w-[9px] h-[9px]">
                                                        {isCurrent ? (
                                                            <>
                                                                <span className="absolute inset-0 rounded-full bg-purple-400 opacity-60 animate-ping" />
                                                                <span className="relative block w-[9px] h-[9px] rounded-full bg-purple-500" />
                                                            </>
                                                        ) : (
                                                            <span className="block w-[9px] h-[9px] rounded-full bg-gray-300 dark:bg-gray-600 ring-4 ring-gray-50/70 dark:ring-gray-900/40" />
                                                        )}
                                                    </span>
                                                    <div className="min-w-0 flex-1 flex items-baseline justify-between gap-3">
                                                        <span className={`text-xs leading-relaxed ${isCurrent
                                                            ? 'font-semibold text-gray-900 dark:text-gray-50'
                                                            : 'text-gray-500 dark:text-gray-400'}`}>
                                                            {entry.text}
                                                        </span>
                                                        <span className="flex-shrink-0 text-[10px] tabular-nums text-gray-400 dark:text-gray-600">
                                                            {new Date(entry.at).toLocaleTimeString([], { hour12: false })}
                                                        </span>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ol>
                                </div>
                            </div>
                        )}
                        {/* Nothing has been confirmed at this point — the run has only
                            read each application to find out who it is — so this is the
                            last moment before anything irreversible. */}
                        {tpgJob.phase === 'awaiting_selection' && (() => {
                            const selectable = tpgJob.apps.filter(a => a.status !== 'failed');
                            const allTicked = selectable.length > 0 && selectable.every(a => tpgChosen.has(a.id));
                            return (
                                <div className="mt-4 rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50/70 dark:bg-amber-900/15 p-4">
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div>
                                            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                                                Choose who to confirm
                                                <span className="ml-2 font-normal text-xs text-amber-800 dark:text-amber-300">
                                                    {tpgChosen.size} of {selectable.length} selected
                                                </span>
                                            </p>
                                            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 max-w-2xl">
                                                Nothing has been confirmed on TPGateway yet. Untick anyone you are not
                                                confirming today. Confirming cannot be undone.
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => setTpgChosen(allTicked ? new Set() : new Set(selectable.map(a => a.id)))}
                                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-amber-400 text-amber-800 dark:text-amber-200 dark:border-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
                                            {allTicked ? 'Untick all' : 'Tick all'}
                                        </button>
                                    </div>

                                    <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-amber-200 dark:border-amber-800/70 divide-y divide-amber-200/60 dark:divide-amber-800/50 bg-white/70 dark:bg-gray-900/40">
                                        {selectable.map(a => {
                                            const ticked = tpgChosen.has(a.id);
                                            return (
                                                <label key={a.id}
                                                    className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                                                        ticked ? '' : 'opacity-55 hover:opacity-80'}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={ticked}
                                                        onChange={() => setTpgChosen(prev => {
                                                            const next = new Set(prev);
                                                            if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                                                            return next;
                                                        })}
                                                        className="w-4 h-4 mt-0.5 flex-shrink-0 accent-amber-600"
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                                                            {a.name || '(name not read)'}
                                                        </div>
                                                        {(a.course || a.startDate) && (
                                                            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                                                {a.course || ''}
                                                                {a.course && a.startDate ? ' · ' : ''}
                                                                {a.startDate ? `starts ${a.startDate}` : ''}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <span className="flex-shrink-0 mt-0.5 font-mono text-[11px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700/70 dark:text-gray-200">
                                                        {a.id}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>

                                    <div className="flex items-center gap-2 mt-3">
                                        <Button onClick={submitTpgChoice} disabled={tpgSubmittingChoice || tpgChosen.size === 0}>
                                            {tpgSubmittingChoice ? 'Starting…' : `Confirm ${tpgChosen.size} selected`}
                                        </Button>
                                        <Button variant="outline" onClick={cancelTpg} disabled={tpgCancelling}>
                                            {tpgCancelling ? 'Stopping…' : 'Cancel'}
                                        </Button>
                                    </div>
                                </div>
                            );
                        })()}
                        {tpgJob.phase !== 'awaiting_selection' && tpgJob.apps.length > 0 && (
                            <div className="mt-3 max-h-64 overflow-y-auto rounded border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                                {tpgJob.apps.map(a => (
                                    <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                                        <span className="min-w-0 truncate">
                                            <span className="font-semibold text-gray-800 dark:text-gray-100">{a.name || '—'}</span>
                                            <span className="ml-2 font-mono text-gray-400 dark:text-gray-500">{a.id}</span>
                                        </span>
                                        <span className={`flex-shrink-0 px-2 py-0.5 rounded-full font-semibold ${tpgAppChipClass(a.status)}`} title={a.reason || ''}>
                                            {tpgStatusLabel(a.status)}{a.reason ? ` — ${a.reason}` : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {tpgJob.phase === 'error' && tpgJob.screenshot && (
                            <p className="text-[11px] mt-2 text-gray-500 dark:text-gray-400">A debug screenshot was saved to scratch/ for troubleshooting.</p>
                        )}
                    </div>
                )}
            </Card>

            <UploadStep />

            {toastMsg && (
                <div className={`fixed top-5 right-5 z-[9999] max-w-sm w-full transition-all duration-300 ${toastVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}>
                    <div className={`flex items-start gap-3 px-4 py-3.5 rounded-xl shadow-lg border backdrop-blur-sm ${toastIsError ? 'bg-red-950/90 border-red-800/40 text-red-200' : 'bg-emerald-950/90 border-emerald-800/40 text-emerald-200'}`}>
                        <div className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${toastIsError ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}>
                            {toastIsError
                                ? <Icon name={IconName.Close} className="w-3 h-3 text-red-400" />
                                : <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                        </div>
                        <p className="text-sm leading-snug">{toastMsg}</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export const ViewDirectApplicationView: React.FC = () => {
    type DaDocumentType = 'main' | 'grant' | 'sfc';
    const [isLoading, setIsLoading] = useState(false);
    const [applications, setApplications] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const currentPageRef = useRef(currentPage);
    currentPageRef.current = currentPage;
    const itemsPerPage = 20;

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isCancelling, setIsCancelling] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isEnrolling, setIsEnrolling] = useState(false);
    // [ARCHIVED] const [isAutoEnrolling, setIsAutoEnrolling] = useState(false);
    const [isAddingToCal, setIsAddingToCal] = useState(false);
    const [isGeneratingInv, setIsGeneratingInv] = useState(false);
    const [isSendingInvoiceEmail, setIsSendingInvoiceEmail] = useState(false);
    const [showPii, setShowPii] = useState(false);
    // Single "Sync / Reconcile" control replaces the old Recover Enrolment IDs /
    // Sync Enrolment / Sync Grants / Sync Calendar buttons — it runs all four in
    // sequence. syncAllStep drives the spinner label so the admin sees progress.
    const [isSyncingAll, setIsSyncingAll] = useState(false);
    const [syncAllStep, setSyncAllStep] = useState('');
    // Repair for rows wrongly marked failed (see lib/daEnrolStatusRepair.ts).
    const [repairBusy, setRepairBusy] = useState(false);
    const [repairCount, setRepairCount] = useState<number | null>(null);
    const [repairMsg, setRepairMsg] = useState<string | null>(null);
    const [emailToggleOn, setEmailToggleOn] = useState(false);
    const [emailToggleSaving, setEmailToggleSaving] = useState(false);
    const [invoiceEmailCc, setInvoiceEmailCc] = useState('');
    const [invoiceEmailBcc, setInvoiceEmailBcc] = useState('');

    React.useEffect(() => {
        fetch('/api/admin/da-email-toggle')
            .then(r => r.json())
            .then(j => {
                if (j?.success) {
                    setEmailToggleOn(!!j.value);
                    setInvoiceEmailCc(j.cc || '');
                    setInvoiceEmailBcc(j.bcc || '');
                }
            })
            .catch(() => { /* keep default off */ });
    }, []);

    const handleEmailToggle = async () => {
        const next = !emailToggleOn;
        setEmailToggleSaving(true);
        setEmailToggleOn(next);
        try {
            const res = await fetch('/api/admin/da-email-toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: next }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Toggle failed');
        } catch (err) {
            setEmailToggleOn(!next);
            alert(`Failed to update setting: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setEmailToggleSaving(false);
        }
    };

    const handleEmailRecipientsSave = async () => {
        setEmailToggleSaving(true);
        try {
            const res = await fetch('/api/admin/da-email-toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cc: invoiceEmailCc, bcc: invoiceEmailBcc }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Save failed');
            setInvoiceEmailCc(json.cc || '');
            setInvoiceEmailBcc(json.bcc || '');
        } catch (err) {
            alert(`Failed to save recipients: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setEmailToggleSaving(false);
        }
    };

    const handlePullEmailRecipientsFromQuickBooks = async () => {
        setEmailToggleSaving(true);
        try {
            const res = await fetch('/api/admin/da-email-toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ importFromQuickBooks: true }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Import failed');
            setInvoiceEmailCc(json.cc || '');
            setInvoiceEmailBcc(json.bcc || '');
        } catch (err) {
            alert(`Failed to pull recipients from QuickBooks: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setEmailToggleSaving(false);
        }
    };

    // Note
    const isManualInvoiceMarker = (invoiceId: unknown) => String(invoiceId || '').trim().toUpperCase() === 'MANUAL';
    const hasInvoiceMarker = (invoiceId: unknown) => String(invoiceId || '').trim() !== '';
    const hasRealInvoice = (invoiceId: unknown) => hasInvoiceMarker(invoiceId) && !isManualInvoiceMarker(invoiceId);
    const hasMainInvoiceDocument = (app: any) => !!(
        (app?.invoice_drive_file_id && String(app.invoice_drive_file_id).trim() !== '') ||
        (app?.invoice_drive_web_view_link && String(app.invoice_drive_web_view_link).trim() !== '')
    );

    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [toastIsError, setToastIsError] = useState(false);
    const [toastVisible, setToastVisible] = useState(false);
    const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [verifyingDocumentKey, setVerifyingDocumentKey] = useState<string | null>(null);
    const [brokenDocumentKeys, setBrokenDocumentKeys] = useState<Set<string>>(new Set());

    const showToast = React.useCallback((message: string, isError = false) => {
        setToastMsg(message);
        setToastIsError(isError);
        setToastVisible(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
            setToastVisible(false);
            setTimeout(() => setToastMsg(null), 300);
        }, 5000);
    }, []);

    const getDocumentKey = (app: any, documentType: DaDocumentType) => `${app.id}:${documentType}`;
    const isInvoiceCheckboxChecked = (app: any) => {
        if (!hasInvoiceMarker(app?.invoice_id)) return false;
        if (!hasRealInvoice(app?.invoice_id)) return true;
        return hasMainInvoiceDocument(app) && !brokenDocumentKeys.has(getDocumentKey(app, 'main'));
    };
    const hasVisibleMainInvoice = (app: any) => hasRealInvoice(app?.invoice_id) && isInvoiceCheckboxChecked(app);
    const getDisplayInvoiceNumber = (app: any) => String(app?.invoice_doc_number || app?.invoice_id || '').trim();
    const getVisibleInvoiceNumber = (app: any) => (hasVisibleMainInvoice(app) ? getDisplayInvoiceNumber(app) : '');

    const getDocumentUrl = (app: any, documentType: DaDocumentType): string => {
        if (documentType === 'main') {
            return app.invoice_drive_web_view_link || (app.invoice_drive_file_id ? `https://drive.google.com/file/d/${app.invoice_drive_file_id}/view` : '');
        }
        if (documentType === 'grant') {
            return app.grant_invoice_drive_web_view_link || (app.grant_invoice_drive_file_id ? `https://drive.google.com/file/d/${app.grant_invoice_drive_file_id}/view` : '');
        }
        return app.sfc_invoice_drive_web_view_link || (app.sfc_invoice_drive_file_id ? `https://drive.google.com/file/d/${app.sfc_invoice_drive_file_id}/view` : '');
    };

    const getDocumentFileId = (app: any, documentType: DaDocumentType): string => {
        if (documentType === 'main') return String(app.invoice_drive_file_id || '').trim();
        if (documentType === 'grant') return String(app.grant_invoice_drive_file_id || '').trim();
        return String(app.sfc_invoice_drive_file_id || '').trim();
    };

    const clearDocumentLocally = (applicationId: string, documentType: DaDocumentType) => {
        setApplications(prev => prev.map(app => {
            if (app.id !== applicationId) return app;
            if (documentType === 'main') return { ...app, invoice_id: null, invoice_doc_number: null, invoice_drive_file_id: null, invoice_drive_web_view_link: null };
            if (documentType === 'grant') return { ...app, grant_invoice_drive_file_id: null, grant_invoice_drive_web_view_link: null };
            return { ...app, sfc_invoice_drive_file_id: null, sfc_invoice_drive_web_view_link: null };
        }));
    };

    const handleViewDocument = async (app: any, documentType: DaDocumentType) => {
        const key = getDocumentKey(app, documentType);
        const url = getDocumentUrl(app, documentType);
        const fileId = getDocumentFileId(app, documentType);
        if (!url && !fileId) {
            setBrokenDocumentKeys(prev => new Set(prev).add(key));
            clearDocumentLocally(app.id, documentType);
            showToast('Document may have been deleted', true);
            return;
        }

        setVerifyingDocumentKey(key);
        try {
            const params = new URLSearchParams({
                applicationId: app.id,
                documentType,
            });
            if (url) params.set('url', url);
            if (fileId) params.set('fileId', fileId);

            const res = await fetch(`/api/admin/da-verify-drive?${params.toString()}`);
            const json = await res.json();
            if (json.valid) {
                window.open(url || `https://drive.google.com/file/d/${fileId}/view`, '_blank');
            } else {
                setBrokenDocumentKeys(prev => new Set(prev).add(key));
                clearDocumentLocally(app.id, documentType);
                showToast('Document may have been deleted', true);
            }
        } catch {
            window.open(url || `https://drive.google.com/file/d/${fileId}/view`, '_blank');
        } finally {
            setVerifyingDocumentKey(null);
        }
    };

    const renderDocumentButton = (app: any, documentType: DaDocumentType, colorClasses: string) => {
        const key = getDocumentKey(app, documentType);
        if (brokenDocumentKeys.has(key)) {
            return (
                <div className="flex flex-col items-start gap-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        <Icon name={IconName.Warning} className="w-3 h-3" />
                        Unavailable
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">Document may have been deleted</span>
                </div>
            );
        }

        return (
            <button
                onClick={() => handleViewDocument(app, documentType)}
                disabled={verifyingDocumentKey === key}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-60 ${colorClasses}`}
            >
                {verifyingDocumentKey === key ? (
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-current" />
                ) : (
                    <Icon name={IconName.ExternalLink} className="w-3.5 h-3.5" />
                )}
                {verifyingDocumentKey === key ? 'Checking...' : 'View'}
            </button>
        );
    };

    // Note
    const [showInvProgress, setShowInvProgress] = useState(false);
    const [invProgressStartTime, setInvProgressStartTime] = useState(0);
    const [invProgressDone, setInvProgressDone] = useState(false);
    const [invProgressSucceeded, setInvProgressSucceeded] = useState(0);
    const [invProgressFailed, setInvProgressFailed] = useState(0);
    const [invProgressWarnings, setInvProgressWarnings] = useState(0);
    const [invProgressTotal, setInvProgressTotal] = useState(0);
    // Per-row failure/warning reasons. The API has always returned these; the
    // modal used to show only a count, so "1 failed" gave the admin nothing to
    // act on. The pipeline prefixes each message with the step that failed
    // (invoice, invoice_drive, grant_invoice, …), which is usually enough to
    // tell a missing course fee from a QuickBooks outage.
    const [invProgressIssues, setInvProgressIssues] = useState<
        { label: string; message: string; kind: 'failed' | 'warning' }[]
    >([]);

    const toggleDaField = async (appId: string, field: 'enrol' | 'calendar' | 'invoice', newValue: boolean) => {
        setApplications(prev => prev.map(a => {
            if (a.id !== appId) return a;
            if (field === 'enrol') return { ...a, enrolment_status: newValue ? 'Confirmed' : null, enrolment_id: newValue ? (a.enrolment_id || 'MANUAL') : null };
            if (field === 'calendar') return { ...a, calendar_added: newValue };
            if (field === 'invoice') return { ...a, invoice_id: newValue ? (a.invoice_id || 'MANUAL') : null, invoice_doc_number: newValue ? a.invoice_doc_number : null };
            return a;
        }));
        try {
            const res = await fetch('/api/admin/da-toggle-field', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: appId, field, value: newValue }) });
            if (!res.ok) console.error('Failed to save toggle');
        } catch { console.error('Failed to save toggle'); }
    };

    const handleAddToCalendar = async () => {
        const cancelledStatuses = ['cancelled', 'rejected', 'failed'];
        const ids = Array.from(selectedIds).filter(appId => { const app = applications.find(a => a.application_id === appId); return app && !app.calendar_added && !cancelledStatuses.includes((app.application_status || '').toLowerCase()); }).map(appId => applications.find(a => a.application_id === appId)?.id).filter(Boolean);
        if (ids.length === 0) { alert('No eligible applications selected (all already added to calendar).'); return; }
        if (!window.confirm(`Add ${ids.length} learner(s) to their Google Calendar events?`)) return;
        setIsAddingToCal(true);
        try {
            const res = await fetch('/api/admin/da-add-to-calendar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: ids }) });
            const json = await res.json();
            const succeeded = (json.results || []).filter((r: any) => r.success).length;
            const failed = (json.results || []).filter((r: any) => !r.success);
            const successIds = new Set((json.results || []).filter((r: any) => r.success).map((r: any) => r.id));
            setApplications(prev => prev.map(a => successIds.has(a.id) ? { ...a, calendar_added: true } : a));
            let msg = `${succeeded} learner(s) added to calendar.`;
            if (failed.length > 0) msg += `\n${failed.length} failed:\n` + failed.map((f: any) => `- ${f.error}`).join('\n');
            alert(msg);
        } catch { alert('Failed to add to calendar.'); }
        finally { setIsAddingToCal(false); }
    };

    // Note
    const handleGenerateInvoice = async () => {
        const cancelledStatuses = ['cancelled', 'rejected', 'failed'];
        const ids = applications
            .filter(app =>
                selectedIds.has(app.application_id) &&
                app.id &&
                !cancelledStatuses.includes((app.application_status || '').toLowerCase())
            )
            .map(app => app.id)
            .filter(Boolean);
        if (ids.length === 0) { showToast('No eligible selected applications found.', true); return; }
        if (!window.confirm(`Run invoice generation for ${ids.length} selected application(s)?\n\nThis will create or refresh the main / grant / SFC invoice flow as needed.`)) return;

        setIsGeneratingInv(true);
        setShowInvProgress(true);
        setInvProgressDone(false);
        setInvProgressSucceeded(0);
        setInvProgressFailed(0);
        setInvProgressWarnings(0);
        setInvProgressIssues([]);
        setInvProgressTotal(ids.length);
        setInvProgressStartTime(Date.now());

        try {
            const res = await fetch('/api/admin/da-generate-invoice', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationIds: ids }),
            });
            const json = await res.json();
            const succeeded = (json.results || []).filter((r: any) => r.success);
            const warnings = succeeded.filter((r: any) => r.partial || r.warning);
            const failed = (json.results || []).filter((r: any) => !r.success);
            setInvProgressSucceeded(succeeded.length);
            setInvProgressFailed(failed.length);
            setInvProgressWarnings(warnings.length);

            // Surface WHY, not just how many. Failures first — those are the
            // rows that produced no invoice and need the admin to act.
            const labelForResult = (r: any) => {
                const app = applications.find(a => a.id === r.id);
                return applicationLabel(app, String(r.id || '').slice(0, 8));
            };
            setInvProgressIssues([
                ...failed.map((r: any) => ({
                    label: labelForResult(r),
                    message: String(r.error || 'Unknown error'),
                    kind: 'failed' as const,
                })),
                ...warnings.map((r: any) => ({
                    label: labelForResult(r),
                    message: String(r.warning || 'Supplemental invoice issue'),
                    kind: 'warning' as const,
                })),
            ]);
            setInvProgressDone(true);
            fetchApplications();
            if (warnings.length > 0) {
                console.warn('DA invoice generation warnings:', warnings.map((w: any) => ({ id: w.id, warning: w.warning })));
                const parts = [`${succeeded.length} invoice${succeeded.length !== 1 ? 's' : ''} generated`];
                parts.push(`${warnings.length} supplemental issue${warnings.length !== 1 ? 's' : ''}`);
                if (failed.length > 0) parts.push(`${failed.length} failed`);
                showToast(parts.join(' | '), true);
                return;
            }
            if (failed.length > 0) {
                showToast(`${succeeded.length} invoice${succeeded.length !== 1 ? 's' : ''} generated | ${failed.length} failed`, true);
            } else {
                showToast(`${succeeded.length} invoice${succeeded.length !== 1 ? 's' : ''} generated successfully`);
            }
        } catch (err) {
            // Network drop / non-JSON response — no per-row detail exists, so
            // report the transport error itself rather than a bare "failed".
            const message = err instanceof Error ? err.message : String(err);
            setInvProgressFailed(ids.length);
            setInvProgressWarnings(0);
            setInvProgressIssues([{ label: 'Request', message, kind: 'failed' }]);
            setInvProgressDone(true);
            showToast(`Invoice generation failed: ${message}`, true);
        } finally {
            setIsGeneratingInv(false);
        }
    };

    const handleSendInvoiceEmail = async () => {
        const selectedRows = applications.filter(app => selectedIds.has(app.application_id));
        if (selectedRows.length === 0) {
            showToast('No applications selected.', true);
            return;
        }

        const isAppCancelled = (app: any) =>
            app.enrolment_status === 'Cancelled' || (app.application_status || '').toLowerCase() === 'cancelled';
        const isEnrolDone = (app: any) => {
            return !!(app.enrolment_id && String(app.enrolment_id).trim()) && !isAppCancelled(app);
        };
        const isCalDone = (app: any) => !!app.calendar_added;
        const isInvDone = (app: any) => isInvoiceCheckboxChecked(app);

        const cancelled = selectedRows.filter(app => isAppCancelled(app));
        if (cancelled.length > 0) {
            const first = cancelled[0];
            const label = applicationLabel(first, 'one application');
            const msg = cancelled.length === 1
                ? `Cannot send: ${label} enrolment is cancelled (red X in the Enrol column). Re-enrol the learner before emailing.`
                : `Cannot send: ${cancelled.length} selected application(s) have a cancelled enrolment (red X in the Enrol column). Re-enrol before emailing.`;
            showToast(msg, true);
            return;
        }

        const incomplete = selectedRows.filter(app => !isEnrolDone(app) || !isCalDone(app) || !isInvDone(app));
        if (incomplete.length > 0) {
            const first = incomplete[0];
            const missing: string[] = [];
            if (!isEnrolDone(first)) missing.push('Enrol');
            if (!isCalDone(first)) missing.push('Cal');
            if (!isInvDone(first)) missing.push('Inv');
            const label = applicationLabel(first, 'one application');
            const msg = incomplete.length === 1
                ? `Cannot send: ${label} is missing ${missing.join(' + ')}. All three columns (Enrol, Cal, Inv) must be ticked before emailing.`
                : `Cannot send: ${incomplete.length} selected application(s) are missing one or more of Enrol/Cal/Inv. All three columns must be ticked first.`;
            showToast(msg, true);
            return;
        }

        const alreadySent = selectedRows.filter(app => !!app.invoice_sent_at);
        if (alreadySent.length > 0) {
            const first = alreadySent[0];
            const label = applicationLabel(first, 'this application');
            const sentOn = first.invoice_sent_at ? new Date(first.invoice_sent_at).toLocaleString('en-SG') : '';
            const msg = alreadySent.length === 1
                ? `Cannot send: invoice email for ${label} was already sent${sentOn ? ` on ${sentOn}` : ''}. Re-sending is not allowed.`
                : `Cannot send: ${alreadySent.length} selected application(s) already had their invoice email sent. Re-sending is not allowed.`;
            showToast(msg, true);
            return;
        }

        const cancelledStatuses = ['cancelled', 'rejected', 'failed'];
        const rows = selectedRows.filter(app =>
            app.id &&
            hasVisibleMainInvoice(app) &&
            app.trainee_email &&
            !cancelledStatuses.includes((app.application_status || '').toLowerCase())
        );
        const ids = rows.map(app => app.id).filter(Boolean);
        if (ids.length === 0) {
            showToast('No eligible invoices to email. Selected rows are missing a learner email or use a manual invoice marker (no real QBO invoice to send).', true);
            return;
        }
        if (!window.confirm(`Send ${ids.length} generated tax invoice email${ids.length !== 1 ? 's' : ''} to learner${ids.length !== 1 ? 's' : ''}?`)) return;

        setIsSendingInvoiceEmail(true);
        try {
            const res = await fetch('/api/admin/da-send-invoice-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationIds: ids }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || 'Send failed');
            fetchApplications();
            const parts = [`${json.sent || 0} sent`];
            if (json.skipped) parts.push(`${json.skipped} skipped`);
            if (json.failed) parts.push(`${json.failed} failed`);
            const detail = json.failures?.[0]?.error || json.skippedRows?.[0]?.reason;
            showToast(detail ? `${parts.join(' | ')} - ${detail}` : parts.join(' | '), !!json.failed);
        } catch (err) {
            showToast(`Invoice email send failed: ${err instanceof Error ? err.message : 'Unknown error'}`, true);
        } finally {
            setIsSendingInvoiceEmail(false);
        }
    };

    // Runs the four reconcile steps in sequence, tolerating per-step failure so a
    // later step still runs if an earlier one errors. One confirmation, one summary.
    //   1. Recover Enrolment IDs — live SSG search for MANUAL/placeholder rows
    //   2. Sync Enrolment        — fill enrolment_id from the local enrollment table
    //   3. Sync Grants           — pull grants from SSG into ssg_grants
    //   4. Sync Calendar         — reconcile the calendar_added flag
    /**
     * Two-step by design: the first click only reports the count (writes
     * nothing), the second applies it. Corrects rows marked failed that hold a
     * real SSG enrolment id — it never marks anything AS failed.
     */
    const runStatusRepair = async (dryRun: boolean) => {
        setRepairBusy(true);
        setRepairMsg(null);
        try {
            const token = authService.getAuthToken();
            const res = await fetch('/api/admin/repair-da-enrol-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ dryRun }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Could not check enrol statuses');
            setRepairMsg(json.message);
            if (dryRun) {
                setRepairCount(json.matched);
            } else {
                setRepairCount(null);
                await fetchApplications(); // pull the corrected rows back in
            }
        } catch (e) {
            setRepairMsg(e instanceof Error ? e.message : 'Could not check enrol statuses');
        } finally {
            setRepairBusy(false);
        }
    };

    const handleSyncAll = async () => {
        if (!window.confirm(
            'Run full sync for ALL applications?\n\n' +
            '1. Recover enrolment IDs (live SSG search for MANUAL records)\n' +
            '2. Reconcile enrolments from the local records\n' +
            '3. Pull grants from SSG\n' +
            '4. Update Google Calendar flags\n\nContinue?'
        )) return;

        setIsSyncingAll(true);
        const lines: string[] = [];
        const runStep = async (
            label: string, url: string, summarise: (j: any) => string,
        ) => {
            setSyncAllStep(label);
            try {
                const res = await fetch(url, { method: 'POST' });
                const json = await res.json();
                if (json.success) lines.push(`✓ ${label}: ${summarise(json)}`);
                else lines.push(`✗ ${label}: ${json.error || 'failed'}`);
            } catch (err) {
                lines.push(`✗ ${label}: ${err instanceof Error ? err.message : 'request failed'}`);
            }
        };

        try {
            await runStep('Recover enrolment IDs', '/api/admin/da-live-ssg-recovery',
                j => `found ${j.summary?.found ?? 0}, missing ${j.summary?.notFound ?? 0}, errors ${j.summary?.errors ?? 0}`);
            await runStep('Sync enrolment', '/api/admin/da-sync-enrolment',
                j => `${j.enrolmentsMatched ?? 0} enrolment(s), ${j.grantsMatched ?? 0} grant(s) matched`);
            await runStep('Sync grants', '/api/admin/da-sync-grants',
                j => `${j.totalGrantsUpserted ?? 0} grant(s) across ${j.runsProcessed ?? 0} run(s)`);
            await runStep('Sync calendar', '/api/admin/da-sync-calendar',
                j => `${j.checked ?? 0} checked, ${j.matched ?? 0} already in calendar`);
            alert('Sync complete:\n\n' + lines.join('\n'));
            fetchApplications();
        } finally {
            setSyncAllStep('');
            setIsSyncingAll(false);
        }
    };

    const [showPageModal, setShowPageModal] = useState(false);
    const [pendingPage, setPendingPage] = useState<number | null>(null);
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [filterColumn, setFilterColumn] = useState('');
    const [filterValue, setFilterValue] = useState('');
    const [activeFilter, setActiveFilter] = useState<{ column: string; value: string } | null>(null);
    const [showSortDropdown, setShowSortDropdown] = useState(false);
    const [sortColumn, setSortColumn] = useState('');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [toBeEnrolledFilter, setToBeEnrolledFilter] = useState(false);

    const filterableColumns = [
        { value: 'application_id', label: 'Application ID' }, { value: 'trainee_name', label: 'Trainee Name' },
        { value: 'trainee_id', label: 'Trainee ID' }, { value: 'trainee_email', label: 'Email' },
        { value: 'course_title', label: 'Course Title' }, { value: 'course_run_id', label: 'Course Run ID' },
        { value: 'course_type', label: 'Funding Type' },
        { value: 'course_current_code', label: 'Renewed To (course ref)' },
        { value: 'course_previous_code', label: 'Renewed From (course ref)' },
        { value: 'application_status', label: 'Status' }, { value: 'sponsorship_type', label: 'Sponsorship' },
        { value: 'application_date', label: 'Application Date' }, { value: 'highest_qualification', label: 'Highest Qualification' },
        { value: 'auto_enrol_status', label: 'Auto-Enrol Status' },
    ];

    const toggleSelect = (appId: string) => {
        setSelectedIds(prev => { const newSet = new Set(prev); if (newSet.has(appId)) newSet.delete(appId); else newSet.add(appId); return newSet; });
    };

    const toggleSelectAll = () => {
        const allSelected = paginatedApplications.length > 0 && paginatedApplications.every(app => selectedIds.has(app.application_id));
        if (allSelected) setSelectedIds(new Set());
        else setSelectedIds(new Set(paginatedApplications.map(app => app.application_id)));
    };

    const handleCancelEnrolment = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`Are you sure you want to cancel ${selectedIds.size} application(s)?`)) return;
        setIsCancelling(true);
        try {
            const response = await fetch('/api/admin/cancel-da-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: Array.from(selectedIds) }) });
            const result = await response.json();
            if (result.success) {
                const succeededCount = result.results?.succeeded?.length || 0;
                const failedCount = result.results?.failed?.length || 0;
                const qbWarningCount = result.qbWarningCount || 0;
                let msg = failedCount === 0
                    ? `Successfully cancelled ${succeededCount} application(s).`
                    : `${succeededCount} cancelled, ${failedCount} failed.`;
                if (qbWarningCount > 0) {
                    msg += ` Note: ${qbWarningCount} application(s) had a QuickBooks invoice that could not be deleted automatically — check the invoice manually.`;
                }
                alert(msg);
                setSelectedIds(new Set()); fetchApplications();
            } else throw new Error(result.error);
        } catch (err) { alert(`Failed to cancel: ${err instanceof Error ? err.message : 'Unknown error'}`); }
        finally { setIsCancelling(false); }
    };

    // Called by the DeleteConfirmModal's Confirm button.
    const confirmDelete = async () => {
        if (selectedIds.size === 0) return;
        setIsDeleting(true);
        try {
            const response = await fetch('/api/admin/delete-da-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: Array.from(selectedIds) }) });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || `Request failed (${response.status})`);
            let msg = `Deleted ${result.deleted} application(s) (any linked enrolment/grant/invoice was cancelled).`;
            if (result.failedCount > 0) {
                const firstErr = Array.isArray(result.results) ? result.results.find((r: any) => !r.deleted && r.error)?.error : null;
                msg += `\n${result.failedCount} left in place${firstErr ? ` — ${firstErr}` : ''}.`;
            }
            if (Array.isArray(result.warnings) && result.warnings.length > 0) msg += `\n\n` + result.warnings.join('\n');
            setDeleteConfirmOpen(false);
            alert(msg);
            setSelectedIds(new Set());
            fetchApplications();
        } catch (err) { alert(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`); }
        finally { setIsDeleting(false); }
    };

    const handleEnrolment = async () => {
        const toEnrollApps = applications.filter(app => selectedIds.has(app.application_id) && (app.application_status || '').toLowerCase() === 'confirmed');
        if (toEnrollApps.length === 0) { alert('No eligible applications found. Selected applications must have Application Status = Confirmed.'); return; }
        if (!window.confirm(`Are you sure you want to enrol ${toEnrollApps.length} selected application(s) via SSG?`)) return;
        setIsEnrolling(true);
        try {
            const response = await fetch('/api/admin/da-enrol', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applications: toEnrollApps.map(app => ({ ...app, date_of_birth: app.date_of_birth ? String(app.date_of_birth).split('T')[0] : app.date_of_birth })) }) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || `Server error ${response.status}`);
            const results = body.results ?? [];
            const succeeded = results.filter((r: any) => r.success);
            const failed = results.filter((r: any) => !r.success);
            let message = succeeded.length > 0 ? `Enrolment created for ${succeeded.length} application(s).\n` : '';
            if (failed.length > 0) message += `Failed for ${failed.length}:\n` + failed.map((f: any) => ` ${f.application_id}: ${f.error || 'Unknown'}`).join('\n');
            alert(message || 'No results returned.');
            setSelectedIds(new Set()); fetchApplications();
        } catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`); }
        finally { setIsEnrolling(false); }
    };

    /* [ARCHIVED] Keep in case we want the background pipeline back
    const handleAutoEnrol = async () => {
        const selectedRows = applications.filter(app => selectedIds.has(app.application_id));
        const rowIds = selectedRows.map(app => app.id).filter(Boolean);
        if (rowIds.length === 0) { alert('No eligible applications selected.'); return; }
        if (!window.confirm(`Auto-Enrol will run for ${rowIds.length} application(s).\n\n1. Submit to SSG\n2. Look up grant ID\n3. Generate QB invoice (if enabled)\n\nContinue?`)) return;
        // setIsAutoEnrolling(true);
        try {
            const response = await fetch('/api/admin/auto-enrol-direct-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: rowIds }) });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || `Server error ${response.status}`);
            alert(`Queued ${body.queued} application(s) for auto-enrol.`);
            setSelectedIds(new Set()); fetchApplications();
        } catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`); }
        // finally { setIsAutoEnrolling(false); }
    };
    */

    const applyFilter = () => { if (filterColumn && filterValue.trim()) setActiveFilter({ column: filterColumn, value: filterValue.trim() }); setShowFilterDropdown(false); };
    const clearFilter = () => { setActiveFilter(null); setFilterColumn(''); setFilterValue(''); };

    const fetchApplications = async () => {
        setIsLoading(true); setError(null);
        try {
            const response = await fetch('/api/admin/fetch-all-da-applications');
            if (!response.ok) throw new Error(response.status === 500 ? 'Server error.' : `Error ${response.status}`);
            const result = await response.json();
            if (result.success && result.data) {
                setApplications(result.data);
                setSelectedIds(new Set());
                setBrokenDocumentKeys(new Set());
            }
            else throw new Error(result.error || 'Failed to fetch applications');
        } catch (err) { setError(err instanceof Error ? err.message : 'Failed to fetch applications'); }
        finally { setIsLoading(false); }
    };

    // Auto-fetch on component mount
    React.useEffect(() => {
        fetchApplications();
    }, []);
    React.useEffect(() => { setCurrentPage(1); }, [searchQuery]);
    React.useEffect(() => { setCurrentPage(1); }, [sortColumn, sortDirection]);

    const filteredApplications = applications.filter(app => {
        if (toBeEnrolledFilter) {
            if (!(app.application_status || '').toLowerCase().includes('confirmed')) return false;
            if (app.enrolment_status && app.enrolment_status.trim() !== '') return false;
        }
        if (activeFilter) { if (!(app[activeFilter.column] || '').toString().toLowerCase().includes(activeFilter.value.toLowerCase())) return false; }
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        // enrolment_id is searchable too: it is what the Application ID column
        // shows for a manually enrolled learner.
        return (app.trainee_name || '').toLowerCase().includes(query) || (app.application_id || '').toLowerCase().includes(query) || (app.enrolment_id || '').toLowerCase().includes(query) || (app.course_title || '').toLowerCase().includes(query) || (app.trainee_email || '').toLowerCase().includes(query) || (app.trainee_id || '').toLowerCase().includes(query) || (app.course_run_id || '').toLowerCase().includes(query);
    });

    // Columns holding dates must be compared as dates, not text — "22 Jul 2026"
    // and "2026-08-03" sort nonsensically against each other as strings.
    const DATE_COLUMNS = ['application_date', 'course_start_date', 'course_end_date', 'created_at'];
    const timeOf = (v: any): number | null => {
        if (!v) return null;
        const t = new Date(v).getTime();
        return Number.isFinite(t) ? t : null;
    };

    const sortedApplications = [...filteredApplications].sort((a, b) => {
        const col = sortColumn || '__recency';
        const dir = sortColumn ? sortDirection : 'desc';

        // Default view: newest first. Rows added by the TPGateway automation can
        // still lack a DA date, so fall back to when the row was created rather
        // than letting them sink to the bottom as empty strings.
        if (col === '__recency' || DATE_COLUMNS.includes(col)) {
            const ta = col === '__recency' ? (timeOf(a.application_date) ?? timeOf(a.created_at)) : timeOf(a[col]);
            const tb = col === '__recency' ? (timeOf(b.application_date) ?? timeOf(b.created_at)) : timeOf(b[col]);
            if (ta === null && tb === null) return 0;
            if (ta === null) return 1;  // undated rows always last, either direction
            if (tb === null) return -1;
            return dir === 'asc' ? ta - tb : tb - ta;
        }

        const valA = (a[col] || '').toString().toLowerCase(); const valB = (b[col] || '').toString().toLowerCase();
        if (valA < valB) return dir === 'asc' ? -1 : 1; if (valA > valB) return dir === 'asc' ? 1 : -1; return 0;
    });

    const totalPages = Math.ceil(sortedApplications.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedApplications = sortedApplications.slice(startIndex, startIndex + itemsPerPage);

    const goToPage = (page: number) => {
        if (page >= 1 && page <= totalPages && page !== currentPage) {
            if (toBeEnrolledFilter) setCurrentPage(page);
            else if (selectedIds.size > 0) { setPendingPage(page); setShowPageModal(true); }
            else setCurrentPage(page);
        }
    };

    const getPageNumbers = () => {
        const pages: (number | string)[] = [];
        if (totalPages <= 5) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
        else if (currentPage <= 3) { for (let i = 1; i <= 4; i++) pages.push(i); pages.push('...'); pages.push(totalPages); }
        else if (currentPage >= totalPages - 2) { pages.push(1); pages.push('...'); for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i); }
        else { pages.push(1); pages.push('...'); pages.push(currentPage - 1); pages.push(currentPage); pages.push(currentPage + 1); pages.push('...'); pages.push(totalPages); }
        return pages;
    };

    const fmt = (s: number) => s < 60 ? `${Math.ceil(s)}s` : `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`;

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">View Direct Applications</h2>

            {/* KPI Cards */}
            {!isLoading && applications.length > 0 && (() => {
                const total = applications.length;
                const enrolled = applications.filter(a => a.enrolment_id && a.enrolment_id.trim() !== '').length;
                const calAdded = applications.filter(a => !!a.calendar_added).length;
                const invoiced = applications.filter(a => isInvoiceCheckboxChecked(a)).length;
                return (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <Card className="p-4 text-center"><p className="text-3xl font-bold text-blue-600">{total}</p><p className="text-xs text-gray-500 mt-1">Direct Applications</p></Card>
                        <Card className="p-4 text-center"><p className="text-3xl font-bold text-green-600">{enrolled}</p><p className="text-xs text-gray-500 mt-1">Enrolled</p></Card>
                        <Card className="p-4 text-center"><p className="text-3xl font-bold text-indigo-600">{calAdded}</p><p className="text-xs text-gray-500 mt-1">Added to Calendar</p></Card>
                        <Card className="p-4 text-center"><p className="text-3xl font-bold text-amber-600">{invoiced}</p><p className="text-xs text-gray-500 mt-1">Invoice Created</p></Card>
                    </div>
                );
            })()}

            {/* Email-toggle banner */}
            <Card className={`p-4 mb-6 border-2 ${emailToggleOn ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700'}`}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center ${emailToggleOn ? 'bg-emerald-100 dark:bg-emerald-800/40' : 'bg-amber-100 dark:bg-amber-800/40'}`}>
                            <Icon name={emailToggleOn ? IconName.Mail : IconName.Warning} className={`w-5 h-5 ${emailToggleOn ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`} />
                        </div>
                        <div>
                            <p className={`text-sm font-semibold ${emailToggleOn ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-200'}`}>
                                Send Tax Invoice Email to Learner: {emailToggleOn ? 'ON' : 'OFF (test mode)'}
                            </p>
                            <p className={`text-xs mt-0.5 ${emailToggleOn ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                {emailToggleOn
                                    ? 'After invoice generation, the main tax invoice will be emailed to the learner.'
                                    : 'Invoices will still be generated and saved to Drive — emails are NOT sent. Safe for testing.'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleEmailToggle}
                        disabled={emailToggleSaving}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${emailToggleOn ? 'bg-emerald-500 focus:ring-emerald-500' : 'bg-gray-300 dark:bg-gray-600 focus:ring-amber-500'} ${emailToggleSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                        aria-label="Toggle invoice email"
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${emailToggleOn ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
                    <label className="block">
                        <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">CC recipients</span>
                        <input
                            type="text"
                            value={invoiceEmailCc}
                            onChange={(e) => setInvoiceEmailCc(e.target.value)}
                            placeholder="finance@example.com, admin@example.com"
                            className={inputClasses}
                        />
                    </label>
                    <label className="block">
                        <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">BCC recipients</span>
                        <input
                            type="text"
                            value={invoiceEmailBcc}
                            onChange={(e) => setInvoiceEmailBcc(e.target.value)}
                            placeholder="audit@example.com"
                            className={inputClasses}
                        />
                    </label>
                    <Button variant="secondary" onClick={handleEmailRecipientsSave} disabled={emailToggleSaving}>
                        {emailToggleSaving ? 'Saving...' : 'Save Recipients'}
                    </Button>
                    <Button variant="outline" onClick={handlePullEmailRecipientsFromQuickBooks} disabled={emailToggleSaving}>
                        Pull from QuickBooks
                    </Button>
                </div>
            </Card>

            {/* Search and Refresh */}
            <Card className="p-6 mb-6">
                <div className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1">
                        <label htmlFor="search-da" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Search Applications</label>
                        <input id="search-da" type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name, application ID, course, or email..." className={inputClasses} />
                    </div>
                    <Button onClick={fetchApplications} disabled={isLoading}>
                        {isLoading ? <div className="flex items-center"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Loading...</div> : <><Icon name={IconName.Download} className="w-4 h-4 mr-2" />Refresh</>}
                    </Button>
                </div>
                {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            </Card>

            {isLoading && (
                <div className="flex justify-center py-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
                        <p className="mt-4 text-gray-600 dark:text-gray-300">Fetching DA applications from database...</p>
                    </div>
                </div>
            )}

            {!isLoading && (
                <Card className="p-0">
                    <div className="p-6 border-b flex justify-between items-start">
                        <div>
                            <h3 className="text-xl font-bold">DA Applications</h3>
                            <p className="text-gray-500 dark:text-gray-400 mt-1">
                                Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredApplications.length)} of {filteredApplications.length} applications
                                {(searchQuery || toBeEnrolledFilter) && ` (filtered from ${applications.length} total)`}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <button onClick={handleEnrolment} disabled={isEnrolling || selectedIds.size === 0} className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                {isEnrolling ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />Enrolling...</> : <><Icon name={IconName.Users} className="w-3.5 h-3.5 mr-1.5" />Enrol to SSG</>}
                            </button>
                            <button onClick={handleAddToCalendar} disabled={isAddingToCal || selectedIds.size === 0} className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                {isAddingToCal ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />Adding...</> : <><Icon name={IconName.Calendar} className="w-3.5 h-3.5 mr-1.5" />Add to Calendar</>}
                            </button>
                            <button
                                onClick={handleGenerateInvoice}
                                disabled={isGeneratingInv || selectedIds.size === 0}
                                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-amber-600 hover:bg-amber-700 shadow-sm shadow-amber-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Run the QuickBooks invoice pipeline for the selected rows without emailing the learner"
                            >
                                {isGeneratingInv ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />Generating...</> : <><Icon name={IconName.FileText} className="w-3.5 h-3.5 mr-1.5" />Generate Invoice</>}
                            </button>
                            <button
                                onClick={handleSendInvoiceEmail}
                                disabled={isSendingInvoiceEmail || selectedIds.size === 0}
                                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Send selected generated tax invoice emails to learners"
                            >
                                {isSendingInvoiceEmail ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />Sending...</> : <><Icon name={IconName.Mail} className="w-3.5 h-3.5 mr-1.5" />Send Invoice Email</>}
                            </button>
                            <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
                            <button
                                onClick={handleSyncAll}
                                disabled={isSyncingAll}
                                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg text-white bg-purple-600 hover:bg-purple-700 shadow-sm shadow-purple-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Reconcile all applications against SSG & Google Calendar: recover enrolment IDs, sync enrolments, pull grants, and update calendar flags"
                            >
                                {isSyncingAll ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />{syncAllStep ? `${syncAllStep}...` : 'Syncing...'}</> : <><Icon name={IconName.Sync} className="w-3.5 h-3.5 mr-1.5" />Sync</>}
                            </button>
                            <button
                                onClick={() => runStatusRepair(repairCount === null)}
                                disabled={repairBusy}
                                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-lg border border-amber-400 text-amber-700 dark:text-amber-300 dark:border-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Find applications marked failed that actually hold an SSG enrolment ID, and correct their status. Checks first — nothing is changed until you click again."
                            >
                                {repairBusy
                                    ? 'Checking...'
                                    : repairCount === null
                                        ? 'Check enrol statuses'
                                        : repairCount > 0 ? `Fix ${repairCount} status(es)` : 'Nothing to fix'}
                            </button>
                        </div>
                    </div>
                    {repairMsg && (
                        <div className="px-4 py-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-b dark:border-gray-700">
                            {repairMsg}
                        </div>
                    )}

                    {/* Toolbar */}
                    <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 flex flex-wrap items-center gap-2">
                        <div className="relative">
                            <button onClick={() => { setShowFilterDropdown(!showFilterDropdown); setShowSortDropdown(false); }} className="inline-flex items-center px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 hover:bg-gray-50 text-gray-700 dark:text-gray-200">
                                <Icon name={IconName.Eye} className="w-4 h-4 mr-1.5" />Filter
                            </button>
                            {showFilterDropdown && (
                                <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 p-3 space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Column</label>
                                        <select value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200">
                                            <option value="">Select column...</option>
                                            {filterableColumns.map(col => <option key={col.value} value={col.value}>{col.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
                                        <input type="text" value={filterValue} onChange={(e) => setFilterValue(e.target.value)} placeholder="Enter a value..." className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200" />
                                    </div>
                                    <button onClick={applyFilter} disabled={!filterColumn || !filterValue.trim()} className="w-full px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed">Apply filter</button>
                                </div>
                            )}
                        </div>

                        <div className="relative">
                            <button onClick={() => { setShowSortDropdown(!showSortDropdown); setShowFilterDropdown(false); }} className="inline-flex items-center px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 hover:bg-gray-50 text-gray-700 dark:text-gray-200">
                                <Icon name={IconName.ChevronDown} className="w-4 h-4 mr-1.5" />Sort
                            </button>
                            {showSortDropdown && (
                                <div className="absolute left-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 p-3 space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Column</label>
                                        <select value={sortColumn} onChange={(e) => setSortColumn(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200">
                                            <option value="">Default order</option>
                                            {filterableColumns.map(col => <option key={col.value} value={col.value}>{col.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => { setSortDirection('asc'); setShowSortDropdown(false); }} className={`flex-1 px-2 py-1 text-xs rounded border ${sortDirection === 'asc' ? 'bg-blue-100 border-blue-400' : 'bg-white border-gray-300'} dark:text-gray-200`}>Ascending</button>
                                        <button onClick={() => { setSortDirection('desc'); setShowSortDropdown(false); }} className={`flex-1 px-2 py-1 text-xs rounded border ${sortDirection === 'desc' ? 'bg-blue-100 border-blue-400' : 'bg-white border-gray-300'} dark:text-gray-200`}>Descending</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="relative group">
                            <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 hover:bg-gray-50 text-gray-700 dark:text-gray-200 cursor-pointer">
                                <input type="checkbox" checked={toBeEnrolledFilter} onChange={(e) => {
                                    const checked = e.target.checked; setToBeEnrolledFilter(checked); setCurrentPage(1);
                                    if (checked) { const eligibleIds = applications.filter(app => (app.application_status || '').toLowerCase() === 'confirmed' && (!app.enrolment_status || app.enrolment_status.trim() === '')).map(app => app.application_id); setSelectedIds(new Set(eligibleIds)); }
                                    else setSelectedIds(new Set());
                                }} className="w-4 h-4 text-blue-600 rounded border-gray-300" />
                                To be enrolled Learner(s)
                            </label>
                        </div>

                        {activeFilter && (
                            <div className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded border border-blue-200">
                                <span className="font-medium">{filterableColumns.find(c => c.value === activeFilter.column)?.label}:</span>
                                <span className="ml-1">{activeFilter.value}</span>
                                <button onClick={clearFilter} className="ml-1.5 hover:text-red-600">-</button>
                            </div>
                        )}

                        <div className="flex-1" />

                        {selectedIds.size > 0 && (
                            <>
                                <span className="text-sm text-gray-600 dark:text-gray-300">{selectedIds.size} row(s) selected</span>
                                {/* [ARCHIVED] Green button for background auto-enrol pipeline
                                <button onClick={() => handleAutoEnrol()} disabled={isAutoEnrolling || isCancelling || isDeleting || isEnrolling} className="inline-flex items-center px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-green-400">
                                    {isAutoEnrolling ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1.5" />Queuing...</> : 'Auto Enrol Selected'}
                                </button>
                                */}

                                <button onClick={handleCancelEnrolment} disabled={isCancelling || isDeleting} className="inline-flex items-center px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-400">
                                    {isCancelling ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1.5" />Cancelling...</> : 'Cancel Enrolment'}
                                </button>
                                <button onClick={() => setDeleteConfirmOpen(true)} disabled={isDeleting || isCancelling} className="inline-flex items-center px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-400">
                                    <Icon name={IconName.Delete} className="w-3.5 h-3.5 mr-1.5" />
                                    Delete Selected
                                </button>
                            </>
                        )}
                    </div>

                    {deleteConfirmOpen && (
                        <DeleteConfirmModal
                            rows={applications.filter(app => selectedIds.has(app.application_id))}
                            entityLabel="Direct Application"
                            isDeleting={isDeleting}
                            onConfirm={confirmDelete}
                            onClose={() => setDeleteConfirmOpen(false)}
                            description={<>For rows with an Enrolment ID this <strong className="text-red-700 dark:text-red-300">cancels the live TPGateway enrolment</strong>, removes its grant, and voids the QBO invoices (main tax / SFC / grant) — only when no other application shares them — then deletes the record. A shared invoice is flagged for manual adjustment in QuickBooks.</>}
                            columns={[
                                { header: 'Name', className: 'font-semibold text-gray-900 dark:text-gray-100 max-w-[160px] truncate', render: (r: any) => r.trainee_name || '(unnamed)' },
                                { header: 'Course', className: 'max-w-[200px] truncate', render: (r: any) => r.course_title || '-' },
                                { header: 'Course Ref', className: 'font-mono text-[11px] whitespace-nowrap', render: (r: any) => r.course_reference_number || '-' },
                                { header: 'Enrolment', className: 'font-mono text-[11px] whitespace-nowrap', render: (r: any) => r.enrolment_id || '-' },
                                { header: 'Invoice', className: 'font-mono text-[11px] whitespace-nowrap', render: (r: any) => r.invoice_doc_number || r.invoice_no || '-' },
                            ]}
                        />
                    )}

                    {paginatedApplications.length > 0 ? (
                        <>
                            {/* The Type and Renewal columns encode meaning in colour and weight,
                                which nobody can be expected to infer. Spelled out here rather
                                than left to hover-only tooltips. */}
                            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                                <span className="font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Reading the columns</span>
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="px-1.5 py-0.5 font-semibold uppercase tracking-wide rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">WSQ</span>
                                    <span className="px-1.5 py-0.5 font-semibold uppercase tracking-wide rounded bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">CASL</span>
                                    <span>Type &mdash; how this enrolment is billed, not how the course is typed today</span>
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-amber-700 dark:text-amber-400">TGS-old</span>
                                    <span aria-hidden>&rarr;</span>
                                    <span className="font-mono text-gray-400 dark:text-gray-500">TGS-new</span>
                                    <span>enrolled before the course was renewed</span>
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="font-mono text-gray-400 dark:text-gray-500">TGS-old</span>
                                    <span aria-hidden>&rarr;</span>
                                    <span className="font-mono font-bold text-teal-700 dark:text-teal-400">TGS-new</span>
                                    <span>enrolled after it &mdash; <strong className="font-semibold">bold is the reference this learner is on</strong></span>
                                </span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600 text-[11px]">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-2 py-2 w-8"><input type="checkbox" checked={paginatedApplications.length > 0 && paginatedApplications.every(app => selectedIds.has(app.application_id))} onChange={toggleSelectAll} className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300" /></th>
                                            <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="SSG Enrolment Done">Enrol</th>
                                            <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="Added to Google Calendar">Cal</th>
                                            <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="Invoice Generated">Inv</th>
                                            <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap" title="Tax invoice email sent to learner">Email</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Application ID</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">DA Date</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">ID Type</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">NRIC <button onClick={() => setShowPii(v => !v)} className="ml-1 inline-flex align-middle text-gray-400 hover:text-blue-500"><Icon name={showPii ? IconName.EyeOff : IconName.Eye} className="w-3 h-3" /></button></th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">DOB <button onClick={() => setShowPii(v => !v)} className="ml-1 inline-flex align-middle text-gray-400 hover:text-blue-500"><Icon name={showPii ? IconName.EyeOff : IconName.Eye} className="w-3 h-3" /></button></th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Name</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Email</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Phone</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Course Title</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap" title="The SSG reference this learner was enrolled under. It never changes once the application exists.">Course Ref No.</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap" title="Old and new SSG reference for courses that have been renewed. The side this learner is enrolled under is shown in bold.">Renewal (old &rarr; new)</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap" title="WSQ or CASL as this enrolment is billed. Rows enrolled before a renewal keep the older type; the Renewal column shows which reference they are on.">Type</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Start Date</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Run ID</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Sponsor</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Fee</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">GST</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Grant ID (BL)</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Amt (BL)</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Grant ID</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Scheme</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Amount</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">TG Amt</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">SF Claim ID</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">SF Cr</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Payable</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Qualification</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Certification</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Status</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Cancel By</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Enrol Status</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Enrol ID</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Invoice #</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Tax Invoice</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Grant Invoice</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">SFC Invoice</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
                                        {paginatedApplications.map((app, index) => (
                                            <tr
                                                key={app.id || index}
                                                // Tint rows with no MySkillsFuture application: they were enrolled
                                                // directly with SSG, so their invoices cite the enrolment reference
                                                // rather than an application id. Selection still wins — the blue
                                                // has to stay readable while you pick rows to act on.
                                                // Each branch carries its own hover colour: a shared grey hover
                                                // would wash the tint off the moment the cursor crossed the row.
                                                className={
                                                    selectedIds.has(app.application_id)
                                                        ? 'bg-blue-50 dark:bg-blue-900/30 hover:bg-gray-50 dark:hover:bg-gray-600'
                                                        : !realApplicationId(app.application_id)
                                                            ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                                                            : 'hover:bg-gray-50 dark:hover:bg-gray-600'
                                                }
                                            >
                                                <td className="px-2 py-1.5"><input type="checkbox" checked={selectedIds.has(app.application_id)} onChange={() => toggleSelect(app.application_id)} className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300" /></td>
                                                <td className="px-2 py-1.5 text-center">
                                                    {(() => {
                                                        const isCancelled = app.enrolment_status === 'Cancelled' || (app.application_status || '').toLowerCase() === 'cancelled';
                                                        const hasEnrolmentId = !!(app.enrolment_id && String(app.enrolment_id).trim() !== '');
                                                        
                                                        if (isCancelled && hasEnrolmentId) {
                                                            return <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-600 border border-red-200" title={`Cancelled Enrolment: ${app.enrolment_id}`}>X</span>;
                                                        }
                                                        
                                                        return <input type="checkbox" checked={hasEnrolmentId && !isCancelled} onChange={(e) => toggleDaField(app.id, 'enrol', e.target.checked)} className={`w-3.5 h-3.5 rounded border-gray-300 cursor-pointer ${hasEnrolmentId ? 'text-green-600 accent-green-600' : ''}`} title={app.enrolment_id ? `Enrolled: ${app.enrolment_id}` : 'Click to mark as enrolled'} />;
                                                    })()}
                                                </td>
                                                <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!app.calendar_added} onChange={(e) => toggleDaField(app.id, 'calendar', e.target.checked)} className={`w-3.5 h-3.5 rounded border-gray-300 cursor-pointer ${app.calendar_added ? 'text-blue-600 accent-blue-600' : ''}`} title={app.calendar_added ? 'Added to calendar' : 'Click to mark'} /></td>
                                                <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={isInvoiceCheckboxChecked(app)} onChange={(e) => toggleDaField(app.id, 'invoice', e.target.checked)} className={`w-3.5 h-3.5 rounded border-gray-300 cursor-pointer ${isInvoiceCheckboxChecked(app) ? 'text-amber-600 accent-amber-600' : ''}`} title={hasRealInvoice(app.invoice_id) ? (isInvoiceCheckboxChecked(app) ? `Invoice: ${getDisplayInvoiceNumber(app)} - click to uncheck` : `Invoice: ${getDisplayInvoiceNumber(app)} - document may have been deleted`) : hasInvoiceMarker(app.invoice_id) ? 'Marked as invoiced manually - no invoice document linked yet' : 'Click to mark as invoiced'} /></td>
                                                <td className="px-2 py-1.5 text-center">
                                                    {app.invoice_sent_at ? (
                                                        <span
                                                            className="relative inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-50 dark:bg-emerald-900/30 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-700/60 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                                            title={`Sent${app.invoice_sent_to ? ` to ${app.invoice_sent_to}` : ''} on ${new Date(app.invoice_sent_at).toLocaleString('en-SG')}`}
                                                        >
                                                            <Icon name={IconName.Mail} className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-gray-700" />
                                                        </span>
                                                    ) : (
                                                        <span
                                                            className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-dashed border-gray-300 dark:border-gray-600 bg-transparent"
                                                            title="Not sent to learner"
                                                        >
                                                            <Icon name={IconName.Mail} className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-1.5 whitespace-nowrap font-medium text-gray-900 dark:text-white">
                                                    {(() => {
                                                        // Rows minted for a manual TPG enrolment have no MySkillsFuture
                                                        // application, only an internal `MANUAL-…` key. Show the SSG
                                                        // enrolment reference instead — a real, actionable identifier.
                                                        const { label, isPlaceholder } = displayApplicationId(app.application_id, app.enrolment_id);
                                                        return isPlaceholder ? (
                                                            <span className="inline-flex items-center gap-1.5" title="Enrolled directly with SSG — no MySkillsFuture application. Showing the enrolment reference.">
                                                                <span>{label}</span>
                                                                <span className="px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide rounded bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-200">Manual</span>
                                                            </span>
                                                        ) : label;
                                                    })()}
                                                </td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.application_date ? new Date(app.application_date).toLocaleDateString('en-GB') : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.trainee_id_type || 'N/A'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.trainee_id ? (showPii ? app.trainee_id : `${app.trainee_id.charAt(0)}****${app.trainee_id.slice(-3)}`) : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.date_of_birth ? (showPii ? new Date(app.date_of_birth).toLocaleDateString('en-GB') : `**/**/` + new Date(app.date_of_birth).getFullYear()) : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.trainee_name || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 max-w-[160px] truncate" title={app.trainee_email}>{app.trainee_email || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.trainee_phone_country_code && app.trainee_phone ? `+${app.trainee_phone_country_code} ${app.trainee_phone}` : app.trainee_phone || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 max-w-[180px] truncate" title={app.course_title}>{app.course_title || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.course_reference_number || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap font-mono">{(() => {
                                                    // Shows the renewal itself, not this row's position in it. A learner
                                                    // who enrolled AFTER the renewal is on the current code and has
                                                    // nothing "outdated" about them - but the course was still renewed,
                                                    // and hiding that made the column read as "never renewed".
                                                    const previous = String(app.course_previous_code || '').trim();
                                                    const current = String(app.course_current_code || '').trim();
                                                    if (!previous || !current || previous.toUpperCase() === current.toUpperCase()) {
                                                        return <span className="text-gray-400 dark:text-gray-500">-</span>;
                                                    }
                                                    const rowRef = String(app.course_reference_number || '').trim().toUpperCase();
                                                    const onPrevious = rowRef === previous.toUpperCase();
                                                    const onCurrent = rowRef === current.toUpperCase();
                                                    return (
                                                        <span
                                                            className="inline-flex items-center gap-1"
                                                            title={`This course was renewed from ${previous} to ${current}. This learner is enrolled under ${rowRef || '(no reference)'}.`}
                                                        >
                                                            <span className={onPrevious ? 'font-bold text-amber-700 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}>{previous}</span>
                                                            <span className="text-gray-400 text-[9px]" aria-hidden>&rarr;</span>
                                                            <span className={onCurrent ? 'font-bold text-teal-700 dark:text-teal-400' : 'text-gray-400 dark:text-gray-500'}>{current}</span>
                                                        </span>
                                                    );
                                                })()}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap"><FundingTypeBadge courseType={app.course_type} currentCode={app.course_current_code} rowCode={app.course_reference_number} hasInvoice={hasRealInvoice(app.invoice_id)} /></td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.course_start_date ? new Date(app.course_start_date).toLocaleDateString('en-GB') : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.course_run_id || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.sponsorship_type || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.full_course_fee != null ? `$${parseFloat(app.full_course_fee || 0).toFixed(2)}` : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.gst != null ? `$${parseFloat(app.gst || 0).toFixed(2)}` : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.bl_grant_id || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.bl_amount != null ? `$${parseFloat(app.bl_amount).toFixed(2)}` : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.other_grant_id || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.other_scheme_code || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.other_amount != null ? `$${parseFloat(app.other_amount).toFixed(2)}` : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.tg_amount != null ? `$${parseFloat(app.tg_amount).toFixed(2)}` : '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.skillsfuture_credit_claim_id || '-'}</td>
                                                {(() => {
                                                    // Show the credit that actually applies to this bill, not the
                                                    // balance the learner holds — otherwise $500 sits beside a
                                                    // $0.00 payable and the row contradicts itself.
                                                    const b = computeDaBilling(app);
                                                    if (app.skillsfuture_credit == null) {
                                                        return <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">-</td>;
                                                    }
                                                    const capped = b != null && b.creditApplied < b.declaredCredit;
                                                    const shown = b != null ? b.creditApplied : parseFloat(app.skillsfuture_credit || 0);
                                                    return (
                                                        <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300"
                                                            title={capped ? `Learner holds $${b!.declaredCredit.toFixed(2)}; only $${b!.creditApplied.toFixed(2)} applies to this course, the rest stays in their account.` : undefined}>
                                                            {`$${shown.toFixed(2)}`}
                                                            {capped && <span className="ml-1 text-amber-500" aria-hidden>*</span>}
                                                        </td>
                                                    );
                                                })()}
                                                {(() => {
                                                    const live = computeDaBilling(app)?.payable ?? null;
                                                    const uploaded = app.payable_fee != null ? parseFloat(app.payable_fee) : null;
                                                    const stale = live != null && uploaded != null && Math.abs(live - uploaded) >= 0.01;
                                                    return (
                                                        <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300"
                                                            title={stale ? `TPGateway sent $${uploaded!.toFixed(2)} when this was uploaded, before the grant was issued. $${live!.toFixed(2)} is what is owed now.` : undefined}>
                                                            {live != null ? `$${live.toFixed(2)}` : '-'}
                                                            {stale && <span className="ml-1 text-amber-500" aria-hidden>*</span>}
                                                        </td>
                                                    );
                                                })()}
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.highest_qualification || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.highest_relevant_certification || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${getStatusColor(app.application_status || 'Pending')}`}>{app.application_status || 'Pending'}</span></td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.application_cancelled_by || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap">
                                                    {app.enrolment_status && app.enrolment_status.trim() !== '' ? (
                                                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${app.enrolment_status === 'Confirmed' ? 'bg-green-100 text-green-800' : app.enrolment_status === 'Not Found' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}`}>{app.enrolment_status}</span>
                                                    ) : <span className="text-gray-400">-</span>}
                                                </td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.enrolment_id || '-'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{getVisibleInvoiceNumber(app) || '-'}</td>
                                                <td className="px-2 py-1.5">
                                                    {(hasRealInvoice(app.invoice_id) && hasMainInvoiceDocument(app)) || brokenDocumentKeys.has(getDocumentKey(app, 'main'))
                                                        ? renderDocumentButton(app, 'main', 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40')
                                                        : <span className="text-gray-400">-</span>}
                                                </td>
                                                <td className="px-2 py-1.5">
                                                    {hasVisibleMainInvoice(app) && (app.grant_id || app.bl_grant_id || app.other_grant_id) && app.grant_invoice_id && ((app.grant_invoice_drive_web_view_link || app.grant_invoice_drive_file_id) || brokenDocumentKeys.has(getDocumentKey(app, 'grant')))
                                                        ? renderDocumentButton(app, 'grant', 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40')
                                                        : <span className="text-gray-400">-</span>}
                                                </td>
                                                <td className="px-2 py-1.5">
                                                    {/* Mirrors shouldGenerateSfcInvoice in the pipeline: a claim id OR an SFC
                                                        amount means this row has SFC. Requiring the claim id hid invoices that
                                                        had genuinely been created — the id only exists once a learner claims,
                                                        which is long after the invoice is raised. */}
                                                    {hasVisibleMainInvoice(app) && (app.skillsfuture_credit_claim_id || parseFloat(app.skillsfuture_credit || 0) > 0) && app.sfc_invoice_id && ((app.sfc_invoice_drive_web_view_link || app.sfc_invoice_drive_file_id) || brokenDocumentKeys.has(getDocumentKey(app, 'sfc')))
                                                        ? renderDocumentButton(app, 'sfc', 'bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/40')
                                                        : <span className="text-gray-400">-</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {totalPages > 1 && (
                                <div className="p-4 border-t flex items-center justify-between">
                                    <div className="text-sm text-gray-500">Page {currentPage} of {totalPages}</div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
                                        {getPageNumbers().map((page, idx) => typeof page === 'number' ? (
                                            <button key={idx} onClick={() => goToPage(page)} className={`px-3 py-1 text-sm border rounded ${currentPage === page ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-gray-100'}`}>{page}</button>
                                        ) : <span key={idx} className="px-2 text-gray-400">...</span>)}
                                        <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="p-12 text-center text-gray-500 dark:text-gray-400">
                            <Icon name={IconName.FileText} className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p className="text-lg font-medium">No applications found</p>
                            <p className="text-sm mt-2">{searchQuery ? 'Try adjusting your search query' : 'No DA applications in the database yet'}</p>
                        </div>
                    )}
                </Card>
            )}

            {/* Note */}
            {showInvProgress && (() => {
                const elapsed = (Date.now() - invProgressStartTime) / 1000;
                const allFailed = invProgressDone && invProgressFailed === invProgressTotal;
                const hasWarnings = invProgressDone && invProgressWarnings > 0 && !allFailed;
                return (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" style={{ backdropFilter: 'blur(8px)' }}>
                        <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-gray-800 shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
                            <div className={`h-1 ${invProgressDone ? (allFailed ? 'bg-red-500' : hasWarnings ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-amber-500'}`} />
                            <div className="flex flex-col items-center pt-7 pb-2 px-6">
                                <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${invProgressDone ? (allFailed ? 'bg-red-100 dark:bg-red-900/30' : hasWarnings ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30') : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                                    {invProgressDone ? (
                                        allFailed ? (
                                            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                        ) : hasWarnings ? (
                                            <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M10.29 3.86l-7.5 13A1 1 0 003.65 18h16.7a1 1 0 00.86-1.5l-7.5-13a1 1 0 00-1.72 0z" /></svg>
                                        ) : (
                                            <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                        )
                                    ) : (
                                        <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-amber-200 border-t-amber-500" />
                                    )}
                                </div>
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                    {invProgressDone ? (allFailed ? 'Generation Failed' : hasWarnings ? 'Generated With Warnings' : 'Invoices Generated!') : 'Generating Invoices...'}
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {invProgressDone ? `Completed in ${fmt(elapsed)}` : `Processing ${invProgressTotal} invoice(s), please wait...`}
                                </p>
                            </div>

                            <div className="px-6 pt-4 pb-2">
                                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    {invProgressDone ? (
                                        <div className={`h-full rounded-full w-full ${allFailed ? 'bg-red-500' : hasWarnings ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                    ) : (
                                        <div className="h-full w-full rounded-full overflow-hidden relative">
                                            <div className="absolute inset-0 bg-amber-200 dark:bg-amber-900/40" />
                                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-pulse" style={{ backgroundSize: '200% 100%' }} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {invProgressDone && (
                                <div className="px-6 pt-3 pb-1">
                                    <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 divide-x divide-gray-200 dark:divide-gray-600 overflow-hidden">
                                        <div className="flex-1 py-3 text-center">
                                            <div className="text-base font-bold text-emerald-500">{invProgressSucceeded}</div>
                                            <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Generated</div>
                                        </div>
                                        <div className="flex-1 py-3 text-center">
                                            <div className={`text-base font-bold ${invProgressFailed > 0 ? 'text-red-400' : 'text-gray-400'}`}>{invProgressFailed}</div>
                                            <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Failed</div>
                                        </div>
                                        <div className="flex-1 py-3 text-center">
                                            <div className="text-base font-bold text-gray-700 dark:text-gray-300">{fmt(elapsed)}</div>
                                            <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mt-0.5">Duration</div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {invProgressDone && invProgressIssues.length > 0 && (
                                <div className="px-6 pt-3">
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                                        What went wrong
                                    </div>
                                    <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 divide-y divide-gray-200 dark:divide-gray-600">
                                        {invProgressIssues.map((issue, idx) => (
                                            <div key={`${issue.label}-${idx}`} className="px-3 py-2">
                                                <div className="flex items-start gap-2">
                                                    <span
                                                        className={`mt-0.5 shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${issue.kind === 'failed'
                                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                                            }`}
                                                    >
                                                        {issue.kind === 'failed' ? 'Failed' : 'Warning'}
                                                    </span>
                                                    <div className="min-w-0">
                                                        <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 truncate">
                                                            {issue.label}
                                                        </div>
                                                        <div className="text-[11px] text-gray-600 dark:text-gray-400 break-words whitespace-pre-wrap">
                                                            {issue.message}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="px-6 pt-4 pb-5">
                                {invProgressDone ? (
                                    <button onClick={() => setShowInvProgress(false)} className={`w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors ${allFailed ? 'bg-red-500 hover:bg-red-600' : hasWarnings ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
                                        Done
                                    </button>
                                ) : (
                                    <p className="text-[11px] text-center text-gray-400 dark:text-gray-500">Please do not close this page while processing.</p>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Page Navigation Confirmation Modal */}
            {showPageModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="text-lg font-semibold text-gray-900">{pendingPage !== null && pendingPage > currentPage ? 'Confirm moving to next page' : 'Confirm moving to previous page'}</h3>
                            <button onClick={() => { setPendingPage(null); setShowPageModal(false); }} className="text-gray-400 hover:text-gray-600"><Icon name={IconName.Close} className="w-5 h-5" /></button>
                        </div>
                        <div className="p-4"><p className="text-gray-600">The currently selected lines will be deselected, do you want to proceed?</p></div>
                        <div className="flex gap-3 p-4 border-t">
                            <button onClick={() => { setPendingPage(null); setShowPageModal(false); }} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
                            <button onClick={() => { if (pendingPage !== null) { setSelectedIds(new Set()); setCurrentPage(pendingPage); setPendingPage(null); setShowPageModal(false); } }} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700">Confirm</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Note */}
            {toastMsg && (
                <div className={`fixed top-5 right-5 z-[9999] max-w-sm w-full transition-all duration-300 ${toastVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}>
                    <div className={`flex items-start gap-3 px-4 py-3.5 rounded-xl shadow-lg border backdrop-blur-sm ${toastIsError ? 'bg-red-950/90 border-red-800/40 text-red-200' : 'bg-emerald-950/90 border-emerald-800/40 text-emerald-200'}`}>
                        <div className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${toastIsError ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}>
                            {toastIsError
                                ? <Icon name={IconName.Close} className="w-3 h-3 text-red-400" />
                                : <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                        </div>
                        <p className="text-sm leading-snug">{toastMsg}</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export const UpdateDirectApplicationView: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [updatedRecordsPage, setUpdatedRecordsPage] = useState(1);
    const resultsPerPage = 10;

    const handleFileChange = (selectedFile: File | undefined | null) => {
        if (selectedFile) {
            if (selectedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || selectedFile.type === 'application/vnd.ms-excel' || selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls')) {
                setFile(selectedFile); setError(null);
            } else { setError('Invalid file type. Please upload an Excel file (.xlsx, .xls).'); setFile(null); }
        }
    };

    const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(isOver); };
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); handleFileChange(e.dataTransfer.files?.[0]); };

    const parseExcelFile = async (file: File): Promise<any[]> => {
        const XLSX = await import('xlsx');
        if (file.size < 100) throw new Error(`File appears to be empty or corrupted.`);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const firstBytes = new TextDecoder().decode(data.slice(0, 100));
                    if (firstBytes.includes('<!DOCTYPE') || firstBytes.includes('<html')) throw new Error('The uploaded file appears to be an HTML page, not an Excel file.');
                    const workbook = XLSX.read(data, { type: 'array' });
                    if (!workbook.SheetNames.length) throw new Error('Excel file has no sheets.');
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
                    if (!rawRows.length) throw new Error('Excel file is empty.');
                    if (rawRows.length === 1) throw new Error('Only headers found, no data rows.');
                    resolve(XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false }));
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('Failed to read the file.'));
            reader.readAsArrayBuffer(file);
        });
    };

    const handleUpload = async () => {
        if (!file) return;
        setIsUploading(true); setUploadResult(null); setError(null);
        try {
            const excelData = await parseExcelFile(file);
            const response = await fetch('/api/admin/update-da-applications-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: excelData }) });
            if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(errorData.error || `Error ${response.status}`); }
            setUploadResult(await response.json());
        } catch (err) { setError(err instanceof Error ? err.message : 'Failed to upload file'); }
        finally { setIsUploading(false); }
    };

    const resetView = () => { setFile(null); setUploadResult(null); setError(null); setUpdatedRecordsPage(1); };
    const UploadStep = () => (
        <Card className="p-6">
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">Update Existing Records</h4>
                <ul className="text-sm text-blue-700 dark:text-blue-400 mt-2 list-disc list-inside space-y-1">
                    <li>Match records by <strong>Application ID</strong></li>
                    <li>Update all fields from the Excel file</li>
                    <li><strong>Preserve</strong> the current <strong>Enrolment Status</strong></li>
                    <li>Skip records that don't exist in the database</li>
                </ul>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-amber-800 mb-2">Important: For Direct Application File</h4>
                <ul className="text-sm text-amber-700 mt-2 list-disc list-inside space-y-1">
                    <li><strong>Windows:</strong> Open in Excel -&gt; Click "Enable Editing" -&gt; Save</li>
                    <li><strong>Mac:</strong> Open in Excel -&gt; Save (Cmd+S)</li>
                </ul>
            </div>
            <div className="text-center mb-4">
                <h3 className="text-xl font-bold dark:text-white">Update Direct Applications</h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">Upload an Excel file to bulk update existing DA records.</p>
            </div>
            <div onDragOver={(e) => handleDragEvents(e, true)} onDragLeave={(e) => handleDragEvents(e, false)} onDrop={handleDrop}
                className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'}`}>
                <input type="file" id="file-upload-da-update" className="hidden" accept=".xlsx, .xls" onChange={(e) => handleFileChange(e.target.files?.[0])} />
                <label htmlFor="file-upload-da-update" className="cursor-pointer">
                    <Icon name={IconName.Upload} className="w-12 h-12 mx-auto text-gray-400" />
                    <p className="mt-2 font-semibold text-gray-900 dark:text-white">{file ? file.name : 'Drag & drop your file here, or click to browse'}</p>
                    <p className="text-xs text-gray-500 mt-1">XLSX or XLS file format</p>
                </label>
            </div>
            {error && (
                <div className="mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-white border border-red-200 rounded-full flex items-center justify-center"><Icon name={IconName.Close} className="w-5 h-5 text-red-500" /></div>
                    <div className="flex-1"><h4 className="font-semibold text-gray-900 dark:text-red-100">Something went wrong!</h4><p className="text-sm text-gray-600 dark:text-red-200/90 mt-1 whitespace-pre-line">{error}</p></div>
                    <button onClick={() => setError(null)} className="text-gray-400 hover:text-gray-600 dark:text-red-300 dark:hover:text-red-100"><Icon name={IconName.Close} className="w-5 h-5" /></button>
                </div>
            )}
            <div className="flex justify-end mt-6">
                <Button onClick={handleUpload} disabled={!file || isUploading}>{isUploading ? <div className="flex items-center"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Updating...</div> : 'Upload & Update'}</Button>
            </div></Card>
    );

    const ResultsStep = () => (
        <Card>
            <div className="p-6 border-b dark:border-gray-700">
                <h3 className="text-xl font-bold dark:text-white">Update Results</h3>
                <p className="text-gray-500 mt-1">The following records were updated.</p>
            </div>
            <div className="p-6">
                {uploadResult?.success && uploadResult?.updated > 0 ? (
                    <div className="space-y-6">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <h4 className="font-bold text-green-800">{uploadResult.updated} Record(s) Updated</h4>
                            <p className="text-sm text-green-700">{uploadResult.notFound || 0} record(s) were not found (skipped)</p>
                        </div>
                        {uploadResult.updatedRecords && uploadResult.updatedRecords.length > 0 && (
                            <div className="border border-blue-200 rounded-lg overflow-hidden">
                                <div className="bg-blue-100 px-4 py-3"><h4 className="font-semibold text-blue-800">Updated Records ({uploadResult.updatedRecords.length})</h4></div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                {['Application ID', 'Trainee Name', 'Course Title', 'Application Date', 'Application Status', 'Enrolment Status'].map(h => (
                                                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {uploadResult.updatedRecords.slice((updatedRecordsPage - 1) * resultsPerPage, updatedRecordsPage * resultsPerPage).map((record: any, index: number) => (
                                                <tr key={index} className="hover:bg-gray-50">
                                                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{record.application_id || 'N/A'}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-500">{record.trainee_name || 'N/A'}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-500">{record.course_title || 'N/A'}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-500">{record.application_date ? new Date(record.application_date).toLocaleDateString('en-GB') : 'N/A'}</td>
                                                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(record.application_status || '')}`}>{record.application_status || 'N/A'}</span></td>
                                                    <td className="px-4 py-3">{record.enrolment_status ? <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${record.enrolment_status === 'Confirmed' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-gray-100 text-gray-800 border-gray-200'}`}>{record.enrolment_status} (preserved)</span> : <span className="text-gray-400">-</span>}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {uploadResult.updatedRecords.length > resultsPerPage && (
                                    <div className="flex items-center justify-between p-3 bg-gray-50 border-t">
                                        <p className="text-sm text-gray-500">Showing {(updatedRecordsPage - 1) * resultsPerPage + 1}-{Math.min(updatedRecordsPage * resultsPerPage, uploadResult.updatedRecords.length)} of {uploadResult.updatedRecords.length}</p>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => setUpdatedRecordsPage(p => Math.max(1, p - 1))} disabled={updatedRecordsPage === 1} className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50">Previous</button>
                                            <button onClick={() => setUpdatedRecordsPage(p => Math.min(Math.ceil(uploadResult.updatedRecords.length / resultsPerPage), p + 1))} disabled={updatedRecordsPage >= Math.ceil(uploadResult.updatedRecords.length / resultsPerPage)} className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-50">Next</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
                        <Icon name={IconName.InfoCircle} className="w-12 h-12 mx-auto text-yellow-500 mb-3" />
                        <h4 className="text-lg font-bold text-yellow-800 mb-2">No Records Updated</h4>
                        <p className="text-yellow-700">{uploadResult?.notFound > 0 ? `None of the ${uploadResult.notFound} record(s) were found in the database.` : 'No matching records found to update.'}</p>
                    </div>
                )}
            </div>
            <div className="p-4 border-t text-right"><Button onClick={resetView}>Start a New Update</Button></div></Card>
    );

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Update Direct Applications</h2>
            {isUploading ? (
                <div className="flex justify-center py-20">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
                        <p className="mt-4 text-gray-600 dark:text-gray-400">Updating records in database...</p>
                    </div>
                </div>
            ) : uploadResult ? <ResultsStep /> : <UploadStep />}
        </div>
    );
};
