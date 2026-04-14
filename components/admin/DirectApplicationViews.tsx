import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

const inputClasses = "block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500";

const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
        case 'approved': case 'success': case 'successful': case 'confirmed':
            return 'bg-green-100 text-green-800 border-green-200';
        case 'processing': case 'pending': case 'in progress':
            return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        case 'rejected': case 'failed': case 'cancelled':
            return 'bg-red-100 text-red-800 border-red-200';
        default:
            return 'bg-gray-100 text-gray-800 border-gray-200';
    }
};

type DaFilterCategory = 'all' | 'inserted' | 'updated' | 'skipped' | 'failed';

interface DaResultRow {
    action: 'inserted' | 'updated' | 'skipped' | 'failed';
    application_id: string;
    trainee_name: string;
    trainee_id: string;
    message: string;
    enrolStatus?: 'pending' | 'enroled' | 'grant_found' | 'invoiced' | 'failed' | null;
    enrolmentId?: string | null;
    grantId?: string | null;
    enrolError?: string | null;
}

const RESULTS_PER_PAGE = 10;
const BATCH_SIZE_DA = 20;

export const UploadDirectApplicationView: React.FC = () => {
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
                    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
                    if (!rawRows.length) throw new Error('Excel file is empty.\n\nThe first sheet contains no data.');
                    if (rawRows.length === 1) throw new Error('Only headers found, no data rows.\n\nSolution: Open the file in Excel, ensure data is visible, save it, and upload again.');
                    resolve(XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false }));
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('Failed to read the file. Please try again.'));
            reader.readAsArrayBuffer(file);
        });
    };

    const handleUpload = async () => {
        if (!file) return;
        setViewState('processing');
        setAllResults([]);
        setSummary({ inserted: 0, updated: 0, skipped: 0, failed: 0 });
        setFilterCategory('all');
        setResultsPage(1);
        setError(null);
        setProgressCurrent(0);
        setProgressTotal(0);
        try {
            const excelData = await parseExcelFile(file);
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
                (result.newRecords ?? []).forEach((r: any) => { flat.push({ action: 'inserted', application_id: r.application_id ?? '', trainee_name: r.trainee_name ?? '', trainee_id: r.trainee_id ?? '', message: 'Inserted successfully.' }); ins++; });
                (result.updatedRecords ?? []).forEach((r: any) => { flat.push({ action: 'updated', application_id: r.application_id ?? '', trainee_name: r.trainee_name ?? '', trainee_id: r.trainee_id ?? '', message: `Status updated to "${r.application_status ?? ''}"` }); upd++; });
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

    const handleAutoEnrol = async () => {
        const eligibleIds = allResults.filter(r => r.action === 'inserted' || r.action === 'updated').map(r => r.application_id).filter(Boolean);
        if (eligibleIds.length === 0) return;
        setIsAutoEnrolling(true);
        try {
            const res = await fetch('/api/admin/auto-enrol-direct-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: eligibleIds }) });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to trigger auto-enrol');
            setAutoEnrolQueued(json.queued || eligibleIds.length);
            setAutoEnrolPolling(true);
            pollEnrolStatus(eligibleIds);
        } catch (err) { setError(err instanceof Error ? err.message : 'Auto-enrol failed'); }
        finally { setIsAutoEnrolling(false); }
    };

    const pollEnrolStatus = async (appIds: string[]) => {
        const appIdSet = new Set(appIds);
        let attempts = 0;
        const poll = async () => {
            attempts++;
            try {
                const res = await fetch('/api/admin/fetch-all-da-applications');
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    const byId = new Map<string, any>();
                    for (const row of json.data) { if (row.application_id && appIdSet.has(row.application_id)) byId.set(row.application_id, row); }
                    setAllResults(prev => prev.map(r => { const dbRow = byId.get(r.application_id); if (!dbRow) return r; return { ...r, enrolStatus: dbRow.auto_enrol_status || null, enrolmentId: dbRow.enrolment_id || null, grantId: dbRow.grant_id || null, enrolError: dbRow.auto_enrol_error || null }; }));
                    const allDone = [...appIdSet].every(id => { const row = byId.get(id); return row && ['enroled', 'grant_found', 'invoiced', 'failed'].includes(row.auto_enrol_status); });
                    if (allDone || attempts >= 60) { setAutoEnrolPolling(false); return; }
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

    const categoryCards: { key: DaFilterCategory; label: string; count: number; color: string; activeColor: string; textColor: string }[] = [
        { key: 'all', label: 'All', count: allResults.length, color: 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600', activeColor: 'bg-gray-200 dark:bg-gray-600 border-gray-400', textColor: 'text-gray-800 dark:text-gray-200' },
        { key: 'inserted', label: 'Inserted', count: summary.inserted, color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', activeColor: 'bg-green-100 dark:bg-green-900/40 border-green-500', textColor: 'text-green-700 dark:text-green-400' },
        { key: 'updated', label: 'Updated', count: summary.updated, color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', activeColor: 'bg-blue-100 dark:bg-blue-900/40 border-blue-500', textColor: 'text-blue-700 dark:text-blue-400' },
        { key: 'failed', label: 'Failed', count: summary.failed, color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', activeColor: 'bg-red-100 dark:bg-red-900/40 border-red-500', textColor: 'text-red-700 dark:text-red-400' },
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
        return (
            <div className="space-y-6">
                {headerRow}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {categoryCards.map(({ key, label, count, color, activeColor, textColor }) => (
                        <button key={key} onClick={() => { setFilterCategory(key); setResultsPage(1); }}
                            className={`rounded-lg p-4 text-center border-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${filterCategory === key ? activeColor : `${color} hover:opacity-80`}`}>
                            <p className={`text-3xl font-bold ${textColor}`}>{count}</p>
                            <p className={`text-sm font-medium mt-1 ${textColor}`}>{label}</p>
                            {filterCategory === key && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Showing this filter</p>}
                        </button>
                    ))}
                </div>
                {(summary.inserted > 0 || summary.updated > 0) && (
                    <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-800 dark:text-white">SSG Enrolment & Grant Application</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    {autoEnrolPolling ? `Processing ${autoEnrolQueued} application(s)… refreshing status every 5s` : autoEnrolQueued > 0 ? `Completed — ${autoEnrolQueued} application(s) processed` : `${summary.inserted + summary.updated} eligible application(s) ready to enrol`}
                                </p>
                            </div>
                            <Button onClick={handleAutoEnrol} disabled={isAutoEnrolling || autoEnrolPolling}>
                                {isAutoEnrolling ? 'Triggering…' : autoEnrolPolling ? 'Processing…' : autoEnrolQueued > 0 ? 'Re-run Auto-Enrol' : 'Auto-Enrol to SSG & Apply Grant'}
                            </Button>
                        </div>
                    </Card>
                )}
                <Card className="p-0 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
                    <div className="px-6 py-4 border-b dark:border-gray-700 flex justify-between items-center">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                            {filterCategory === 'all' ? 'All Results' : `${filterCategory.charAt(0).toUpperCase() + filterCategory.slice(1)} (${filteredResults.length})`}
                        </h2>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{filteredResults.length} record{filteredResults.length !== 1 ? 's' : ''}</span>
                    </div>
                    {filteredResults.length === 0 ? (
                        <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">No records in this category.</div>
                    ) : (
                        <>
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-700/50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">#</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Application ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Trainee Name</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Trainee ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Message</th>
                                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">SSG Enrol</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    {paginatedResults.map((r, i) => (
                                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                            <td className="px-4 py-3 text-xs text-gray-400">{(resultsPage - 1) * RESULTS_PER_PAGE + i + 1}</td>
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{r.application_id || 'N/A'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{r.trainee_name || '—'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-mono">{maskTraineeId(r.trainee_id || null)}</span>
                                                    {r.trainee_id && (<button onClick={() => setShowTraineeId(v => !v)} className="p-0.5 text-gray-400 hover:text-blue-600 rounded transition-colors"><Icon name={showTraineeId ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" /></button>)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${r.action === 'inserted' ? 'bg-green-100 text-green-800' : r.action === 'updated' ? 'bg-blue-100 text-blue-800' : r.action === 'skipped' ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-800'}`}>
                                                    {r.action.charAt(0).toUpperCase() + r.action.slice(1)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{r.message}</td>
                                            <td className="px-4 py-3 text-center">
                                                {(() => {
                                                    if (r.action !== 'inserted' && r.action !== 'updated') return <span className="text-gray-300">—</span>;
                                                    const s = r.enrolStatus;
                                                    if (!s || s === 'pending') return autoEnrolPolling ? <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> : <span className="inline-flex items-center justify-center w-5 h-5 rounded border-2 border-gray-300" />;
                                                    if (s === 'failed') return <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-100 text-red-600 text-xs font-bold" title={r.enrolError || 'Failed'}>✗</span>;
                                                    return <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-green-100 text-green-600 text-xs font-bold" title={`${s}${r.enrolmentId ? ` · ${r.enrolmentId}` : ''}`}>✓</span>;
                                                })()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {totalResultPages > 1 && (
                                <div className="p-4 flex justify-between items-center border-t dark:border-gray-700">
                                    <Button variant="ghost" onClick={() => setResultsPage(p => Math.max(1, p - 1))} disabled={resultsPage === 1}>Previous</Button>
                                    <span className="text-sm text-gray-500">Page {resultsPage} of {totalResultPages}</span>
                                    <Button variant="ghost" onClick={() => setResultsPage(p => Math.min(totalResultPages, p + 1))} disabled={resultsPage === totalResultPages}>Next</Button>
                                </div>
                            )}
                        </>
                    )}
                </Card>
            </div>
        );
    }

    const UploadStep = () => (
        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-amber-800 mb-2">⚠️ Important: For Direct Application File</h4>
                <p className="text-sm text-amber-700">If you just downloaded this Excel file, please do the following before uploading:</p>
                <ul className="text-sm text-amber-700 mt-2 list-disc list-inside space-y-1">
                    <li><strong>Windows:</strong> Open the file in Excel → Click "Enable Editing" → Save the file</li>
                    <li><strong>Mac:</strong> Open the file in Excel → Save the file (⌘+S)</li>
                </ul>
                <p className="text-sm text-amber-700 mt-2"><strong>Reason:</strong> The Excel file downloaded from TPG opens in Protected View.</p>
            </div>
            <div className="text-center mb-4">
                <h3 className="text-xl font-bold">Upload Direct Application</h3>
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
                <div className="mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-white border border-red-200 rounded-full flex items-center justify-center"><Icon name={IconName.Close} className="w-5 h-5 text-red-500" /></div>
                    <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900">Something went wrong!</h4>
                        <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{error}</p>
                    </div>
                    <button onClick={() => setError(null)} className="flex-shrink-0 text-gray-400 hover:text-gray-600"><Icon name={IconName.Close} className="w-5 h-5" /></button>
                </div>
            )}
            <div className="flex justify-end items-center mt-6">
                <Button onClick={handleUpload} disabled={!file}>Upload &amp; Process</Button>
            </div>
        </Card>
    );

    return (
        <div className="space-y-6">
            {headerRow}
            <UploadStep />
        </div>
    );
};

export const ViewDirectApplicationView: React.FC = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [applications, setApplications] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    // Track current page in a ref to avoid closure bugs in window event listeners
    const currentPageRef = useRef(currentPage);

    useEffect(() => {
        currentPageRef.current = currentPage;
    }, [currentPage]);

    const itemsPerPage = 20;

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isCancelling, setIsCancelling] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isEnrolling, setIsEnrolling] = useState(false);
    const [isAutoEnrolling, setIsAutoEnrolling] = useState(false);
    const [isAddingToCal, setIsAddingToCal] = useState(false);
    const [isGeneratingInv, setIsGeneratingInv] = useState(false);
    const [isSyncingEnrol, setIsSyncingEnrol] = useState(false);
    const [isSyncingGrants, setIsSyncingGrants] = useState(false);
    const [isSyncingCal, setIsSyncingCal] = useState(false);
    const [isSyncingInv, setIsSyncingInv] = useState(false);
    const [showPii, setShowPii] = useState(false);
    const [invDriveFolderUrl, setInvDriveFolderUrl] = useState<string>('https://drive.google.com/drive/folders/1hBhu-Mr9HPUFdjpbZhN1GrwZBTWns_WK');

    React.useEffect(() => {
        fetch('/api/admin/da-invoice-drive-folder').then(r => r.json()).then(d => { if (d.folderUrl) setInvDriveFolderUrl(d.folderUrl); }).catch(() => {});
    }, []);

    // ── Toast ─────────────────────────────────────────────────────────────────
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    const [toastIsError, setToastIsError] = useState(false);
    const [toastVisible, setToastVisible] = useState(false);
    const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // ── Send Invoice Email modal state ────────────────────────────────────────
    const [showSendEmailModal, setShowSendEmailModal] = useState(false);
    const [isSendingEmail, setIsSendingEmail] = useState(false);
    const [emailFilterCourseRun, setEmailFilterCourseRun] = useState('');
    const [emailFilterCourseCode, setEmailFilterCourseCode] = useState('');
    const [emailFilterCourseTitle, setEmailFilterCourseTitle] = useState('');
    const [emailFilterStartDate, setEmailFilterStartDate] = useState('');
    const [emailFilterEndDate, setEmailFilterEndDate] = useState('');
    const [emailFilterName, setEmailFilterName] = useState('');
    const [emailSendResult, setEmailSendResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
    const [emailSelectedIds, setEmailSelectedIds] = useState<Set<string>>(new Set());

    const emailPreviewRows = applications.filter(app => {
        if (!(app.invoice_id && String(app.invoice_id).trim())) return false;
        if (emailFilterCourseRun && !(app.course_run_id || '').toLowerCase().includes(emailFilterCourseRun.toLowerCase())) return false;
        if (emailFilterCourseCode && !(app.course_reference_number || '').toLowerCase().includes(emailFilterCourseCode.toLowerCase())) return false;
        if (emailFilterCourseTitle && !(app.course_title || '').toLowerCase().includes(emailFilterCourseTitle.toLowerCase())) return false;
        if (emailFilterName && !(app.trainee_name || '').toLowerCase().includes(emailFilterName.toLowerCase())) return false;
        if (emailFilterStartDate && app.course_start_date) {
            const start = new Date(app.course_start_date).toISOString().slice(0, 10);
            if (start < emailFilterStartDate) return false;
        }
        if (emailFilterEndDate && app.course_start_date) {
            const start = new Date(app.course_start_date).toISOString().slice(0, 10);
            if (start > emailFilterEndDate) return false;
        }
        return true;
    });

    const hasEmailFilter = !!(emailFilterCourseRun || emailFilterCourseCode || emailFilterCourseTitle || emailFilterName || emailFilterStartDate || emailFilterEndDate);

    // Keep selection in sync with preview rows (auto-select all when filter changes)
    React.useEffect(() => {
        setEmailSelectedIds(new Set(emailPreviewRows.map(a => a.id).filter(Boolean)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [emailFilterCourseRun, emailFilterCourseCode, emailFilterCourseTitle, emailFilterName, emailFilterStartDate, emailFilterEndDate]);

    const emailAllSelected = emailPreviewRows.length > 0 && emailPreviewRows.every(a => emailSelectedIds.has(a.id));
    const emailSomeSelected = emailPreviewRows.some(a => emailSelectedIds.has(a.id));

    const toggleEmailSelectAll = () => {
        if (emailAllSelected) {
            setEmailSelectedIds(new Set());
        } else {
            setEmailSelectedIds(new Set(emailPreviewRows.map(a => a.id).filter(Boolean)));
        }
    };

    const toggleEmailRow = (id: string) => {
        setEmailSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleSendInvoiceEmails = async () => {
        const ids = emailPreviewRows.map(app => app.id).filter(id => emailSelectedIds.has(id));
        if (ids.length === 0) return;
        setIsSendingEmail(true);
        setEmailSendResult(null);
        try {
            const res = await fetch('/api/admin/da-send-invoice-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationIds: ids }),
            });
            const json = await res.json();
            const result = { sent: json.sent ?? 0, failed: json.failed ?? 0, skipped: json.skipped ?? 0 };
            setEmailSendResult(result);
            if (result.failed > 0) {
                showToast(`${result.sent} sent · ${result.failed} failed · ${result.skipped} skipped`, true);
            } else {
                showToast(`${result.sent} invoice email${result.sent !== 1 ? 's' : ''} sent successfully${result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}`);
            }
        } catch {
            setEmailSendResult({ sent: 0, failed: ids.length, skipped: 0 });
            showToast('Failed to send invoice emails. Please try again.', true);
        } finally {
            setIsSendingEmail(false);
        }
    };

    // ── Invoice progress modal state ──────────────────────────────────────────
    const [showInvProgress, setShowInvProgress] = useState(false);
    const [invProgressStartTime, setInvProgressStartTime] = useState(0);
    const [invProgressDone, setInvProgressDone] = useState(false);
    const [invProgressSucceeded, setInvProgressSucceeded] = useState(0);
    const [invProgressFailed, setInvProgressFailed] = useState(0);
    const [invProgressTotal, setInvProgressTotal] = useState(0);

    const toggleDaField = async (appId: string, field: 'enrol' | 'calendar' | 'invoice', newValue: boolean) => {
        setApplications(prev => prev.map(a => {
            if (a.id !== appId) return a;
            if (field === 'enrol') return { ...a, enrolment_status: newValue ? 'Confirmed' : null, enrolment_id: newValue ? (a.enrolment_id || 'MANUAL') : null };
            if (field === 'calendar') return { ...a, calendar_added: newValue };
            if (field === 'invoice') return { ...a, invoice_id: newValue ? (a.invoice_id || 'MANUAL') : null };
            return a;
        }));
        try {
            const res = await fetch('/api/admin/da-toggle-field', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: appId, field, value: newValue }) });
            if (!res.ok) console.error('Failed to save toggle');
        } catch { console.error('Failed to save toggle'); }
    };

    const handleAddToCalendar = async () => {
        const ids = Array.from(selectedIds).filter(appId => { const app = applications.find(a => a.application_id === appId); return app && !app.calendar_added; }).map(appId => applications.find(a => a.application_id === appId)?.id).filter(Boolean);
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
            if (failed.length > 0) msg += `\n${failed.length} failed:\n` + failed.map((f: any) => `• ${f.error}`).join('\n');
            alert(msg);
        } catch { alert('Failed to add to calendar.'); }
        finally { setIsAddingToCal(false); }
    };

    // ── Generate Invoice with progress modal ──────────────────────────────────
    const handleGenerateInvoice = async () => {
        const ids = Array.from(selectedIds).filter(appId => {
            const app = applications.find(a => a.application_id === appId);
            return app && !(app.invoice_id && String(app.invoice_id).trim());
        }).map(appId => applications.find(a => a.application_id === appId)?.id).filter(Boolean);
        if (ids.length === 0) { showToast('No eligible applications selected (all already have invoices).', true); return; }
        if (!window.confirm(`Generate QuickBooks invoice for ${ids.length} application(s)?`)) return;

        setIsGeneratingInv(true);
        setShowInvProgress(true);
        setInvProgressDone(false);
        setInvProgressSucceeded(0);
        setInvProgressFailed(0);
        setInvProgressTotal(ids.length);
        setInvProgressStartTime(Date.now());

        try {
            const res = await fetch('/api/admin/da-generate-invoice', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationIds: ids }),
            });
            const json = await res.json();
            const succeeded = (json.results || []).filter((r: any) => r.success);
            const failed = (json.results || []).filter((r: any) => !r.success);
            const invoiceMap = new Map(succeeded.map((r: any) => [r.id, r.invoiceId]));
            setInvProgressSucceeded(succeeded.length);
            setInvProgressFailed(failed.length);
            setInvProgressDone(true);
            fetchApplications();
            if (failed.length > 0) {
                showToast(`${succeeded.length} invoice${succeeded.length !== 1 ? 's' : ''} generated · ${failed.length} failed`, true);
            } else {
                showToast(`${succeeded.length} invoice${succeeded.length !== 1 ? 's' : ''} generated successfully`);
            }
        } catch {
            setInvProgressFailed(ids.length);
            setInvProgressDone(true);
            showToast('Invoice generation failed. Please try again.', true);
        } finally {
            setIsGeneratingInv(false);
        }
    };

    const handleSyncGrants = async () => {
        setIsSyncingGrants(true);
        try {
            const res = await fetch('/api/admin/da-sync-grants', { method: 'POST' });
            const json = await res.json();
            if (json.success) { alert(`Grants synced: ${json.totalGrantsUpserted} grant(s) across ${json.runsProcessed} course run(s).`); fetchApplications(); }
            else alert(`Sync failed: ${json.error}`);
        } catch { alert('Sync grants failed.'); }
        finally { setIsSyncingGrants(false); }
    };

    const handleSyncEnrolment = async () => {
        setIsSyncingEnrol(true);
        try {
            const res = await fetch('/api/admin/da-sync-enrolment', { method: 'POST' });
            const json = await res.json();
            if (json.success) { alert(`Sync complete: ${json.enrolmentsMatched} enrolment(s) matched, ${json.grantsMatched} grant(s) matched.`); fetchApplications(); }
            else alert(`Sync failed: ${json.error}`);
        } catch { alert('Sync enrolment failed.'); }
        finally { setIsSyncingEnrol(false); }
    };

    const handleSyncCalendar = async () => {
        setIsSyncingCal(true);
        try {
            const res = await fetch('/api/admin/da-sync-calendar', { method: 'POST' });
            const json = await res.json();
            if (json.success) { alert(`Sync complete: ${json.checked} checked, ${json.matched} already in calendar.`); fetchApplications(); }
            else alert(`Sync failed: ${json.error}`);
        } catch { alert('Sync calendar failed.'); }
        finally { setIsSyncingCal(false); }
    };

    const handleSyncInvoice = async () => {
        setIsSyncingInv(true);
        try {
            const res = await fetch('/api/admin/da-sync-invoice', { method: 'POST' });
            const json = await res.json();
            if (json.success) { alert(`Sync complete: ${json.matched} invoice(s) matched.`); fetchApplications(); }
            else alert(`Sync failed: ${json.error}`);
        } catch { alert('Sync invoice failed.'); }
        finally { setIsSyncingInv(false); }
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
                if (failedCount === 0) alert(`Successfully cancelled ${succeededCount} application(s).`);
                else alert(`${succeededCount} cancelled, ${failedCount} failed.`);
                setSelectedIds(new Set()); fetchApplications();
            } else throw new Error(result.error);
        } catch (err) { alert(`Failed to cancel: ${err instanceof Error ? err.message : 'Unknown error'}`); }
        finally { setIsCancelling(false); }
    };

    const handleDeleteRows = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`Are you sure you want to permanently delete ${selectedIds.size} application(s)?`)) return;
        setIsDeleting(true);
        try {
            const response = await fetch('/api/admin/delete-da-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: Array.from(selectedIds) }) });
            const result = await response.json();
            if (result.success) { alert(`Successfully deleted ${result.deleted} application(s).`); setSelectedIds(new Set()); fetchApplications(); }
            else throw new Error(result.error);
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
            if (failed.length > 0) message += `Failed for ${failed.length}:\n` + failed.map((f: any) => `• ${f.application_id}: ${f.error || 'Unknown'}`).join('\n');
            alert(message || 'No results returned.');
            setSelectedIds(new Set()); fetchApplications();
        } catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`); }
        finally { setIsEnrolling(false); }
    };

    const handleAutoEnrol = async () => {
        const selectedRows = applications.filter(app => selectedIds.has(app.application_id));
        const rowIds = selectedRows.map(app => app.id).filter(Boolean);
        if (rowIds.length === 0) { alert('No eligible applications selected.'); return; }
        if (!window.confirm(`Auto-Enrol will run for ${rowIds.length} application(s).\n\n1. Submit to SSG\n2. Look up grant ID\n3. Generate QB invoice (if enabled)\n\nContinue?`)) return;
        setIsAutoEnrolling(true);
        try {
            const response = await fetch('/api/admin/auto-enrol-direct-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: rowIds }) });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || `Server error ${response.status}`);
            alert(`Queued ${body.queued} application(s) for auto-enrol.`);
            setSelectedIds(new Set()); fetchApplications();
        } catch (err) { alert(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`); }
        finally { setIsAutoEnrolling(false); }
    };

    const applyFilter = () => { if (filterColumn && filterValue.trim()) setActiveFilter({ column: filterColumn, value: filterValue.trim() }); setShowFilterDropdown(false); };
    const clearFilter = () => { setActiveFilter(null); setFilterColumn(''); setFilterValue(''); };

    const fetchApplications = async () => {
        setIsLoading(true); setError(null);
        try {
            const response = await fetch('/api/admin/fetch-all-da-applications');
            if (!response.ok) throw new Error(response.status === 500 ? 'Server error.' : `Error ${response.status}`);
            const result = await response.json();
            if (result.success && result.data) { setApplications(result.data); setSelectedIds(new Set()); }
            else throw new Error(result.error || 'Failed to fetch applications');
        } catch (err) { setError(err instanceof Error ? err.message : 'Failed to fetch applications'); }
        finally { setIsLoading(false); }
    };

    // Auto-fetch on component mount
    React.useEffect(() => {
        fetchApplications();

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('👀 Tab focused, refreshing direct applications for page:', currentPageRef.current);
                fetchApplications();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
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
        return (app.trainee_name || '').toLowerCase().includes(query) || (app.application_id || '').toLowerCase().includes(query) || (app.course_title || '').toLowerCase().includes(query) || (app.trainee_email || '').toLowerCase().includes(query) || (app.trainee_id || '').toLowerCase().includes(query) || (app.course_run_id || '').toLowerCase().includes(query);
    });

    const sortedApplications = [...filteredApplications].sort((a, b) => {
        const col = sortColumn || 'application_date'; const dir = sortColumn ? sortDirection : 'desc';
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
                const invoiced = applications.filter(a => a.invoice_id && a.invoice_id.trim() !== '').length;
                return (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <Card className="p-4 text-center"><p className="text-3xl font-bold text-blue-600">{total}</p><p className="text-xs text-gray-500 mt-1">Direct Applications</p></Card>
                        <Card className="p-4 text-center"><p className="text-3xl font-bold text-green-600">{enrolled}</p><p className="text-xs text-gray-500 mt-1">Enrolled</p></Card>
                        <Card className="p-4 text-center"><p className="text-3xl font-bold text-indigo-600">{calAdded}</p><p className="text-xs text-gray-500 mt-1">Added to Calendar</p></Card>
                        <Card className="p-4 text-center"><p className="text-3xl font-bold text-amber-600">{invoiced}</p><p className="text-xs text-gray-500 mt-1">Invoice Created</p></Card>
                    </div>
                );
            })()}

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
                            <button onClick={handleEnrolment} disabled={isEnrolling || selectedIds.size === 0} className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed">
                                {isEnrolling ? 'Enrolling...' : 'Enrol to SSG'}
                            </button>
                            <button onClick={handleAddToCalendar} disabled={isAddingToCal || selectedIds.size === 0} className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed">
                                {isAddingToCal ? 'Adding...' : 'Add to Calendar'}
                            </button>
                            <button onClick={handleGenerateInvoice} disabled={isGeneratingInv || selectedIds.size === 0} className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:bg-amber-400 disabled:cursor-not-allowed">
                                {isGeneratingInv ? 'Generating...' : 'Generate Invoice'}
                            </button>
                            <button onClick={() => { setShowSendEmailModal(true); setEmailSendResult(null); }} className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700">
                                Send Invoice Email
                            </button>
                            <span className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
                            <button onClick={handleSyncEnrolment} disabled={isSyncingEnrol} className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-green-500 text-green-700 dark:text-green-300 hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed">
                                {isSyncingEnrol ? 'Syncing...' : 'Sync Enrolment'}
                            </button>
                            <button onClick={handleSyncGrants} disabled={isSyncingGrants} className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-500 text-purple-700 dark:text-purple-300 hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed">
                                {isSyncingGrants ? 'Syncing...' : 'Sync Grants'}
                            </button>
                            <button onClick={handleSyncCalendar} disabled={isSyncingCal} className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-500 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed">
                                {isSyncingCal ? 'Syncing...' : 'Sync Calendar'}
                            </button>
                            <button onClick={handleSyncInvoice} disabled={isSyncingInv} className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed">
                                {isSyncingInv ? 'Syncing...' : 'Sync Invoice'}
                            </button>
                        </div>
                    </div>

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
                                <button onClick={clearFilter} className="ml-1.5 hover:text-red-600">×</button>
                            </div>
                        )}

                        <div className="flex-1" />

                        {selectedIds.size > 0 && (
                            <>
                                <span className="text-sm text-gray-600 dark:text-gray-300">{selectedIds.size} row(s) selected</span>
                                <button onClick={handleAutoEnrol} disabled={isAutoEnrolling || isCancelling || isDeleting || isEnrolling} className="inline-flex items-center px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-green-400">
                                    {isAutoEnrolling ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1.5" />Queuing...</> : 'Auto Enrol Selected'}
                                </button>
                                <button onClick={handleCancelEnrolment} disabled={isCancelling || isDeleting} className="inline-flex items-center px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-400">
                                    {isCancelling ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1.5" />Cancelling...</> : 'Cancel Enrolment'}
                                </button>
                                <button onClick={handleDeleteRows} disabled={isDeleting || isCancelling} className="inline-flex items-center px-3 py-1.5 text-sm bg-gray-700 text-white rounded hover:bg-gray-800 disabled:bg-gray-400">
                                    {isDeleting ? <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1.5" />Deleting...</> : 'Delete Row'}
                                </button>
                            </>
                        )}
                    </div>

                    {paginatedApplications.length > 0 ? (
                        <>
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-600 text-[11px]">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-2 py-2 w-8"><input type="checkbox" checked={paginatedApplications.length > 0 && paginatedApplications.every(app => selectedIds.has(app.application_id))} onChange={toggleSelectAll} className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300" /></th>
                                            <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="SSG Enrolment Done">Enrol</th>
                                            <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="Added to Google Calendar">Cal</th>
                                            <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase" title="Invoice Generated">Inv</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Application ID</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">DA Date</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">ID Type</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">NRIC <button onClick={() => setShowPii(v => !v)} className="ml-1 inline-flex align-middle text-gray-400 hover:text-blue-500"><Icon name={showPii ? IconName.EyeOff : IconName.Eye} className="w-3 h-3" /></button></th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">DOB <button onClick={() => setShowPii(v => !v)} className="ml-1 inline-flex align-middle text-gray-400 hover:text-blue-500"><Icon name={showPii ? IconName.EyeOff : IconName.Eye} className="w-3 h-3" /></button></th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Name</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Email</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Phone</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Course Title</th>
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Course Ref No.</th>
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
                                            <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">View Document</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-700 divide-y divide-gray-200 dark:divide-gray-600">
                                        {paginatedApplications.map((app, index) => (
                                            <tr key={app.id || index} className={`hover:bg-gray-50 dark:hover:bg-gray-600 ${selectedIds.has(app.application_id) ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}>
                                                <td className="px-2 py-1.5"><input type="checkbox" checked={selectedIds.has(app.application_id)} onChange={() => toggleSelect(app.application_id)} className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300" /></td>
                                                <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!(app.enrolment_id && String(app.enrolment_id).trim() !== '')} onChange={(e) => toggleDaField(app.id, 'enrol', e.target.checked)} className={`w-3.5 h-3.5 rounded border-gray-300 cursor-pointer ${app.enrolment_id ? 'text-green-600 accent-green-600' : ''}`} title={app.enrolment_id ? `Enrolled: ${app.enrolment_id}` : 'Click to mark as enrolled'} /></td>
                                                <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!app.calendar_added} onChange={(e) => toggleDaField(app.id, 'calendar', e.target.checked)} className={`w-3.5 h-3.5 rounded border-gray-300 cursor-pointer ${app.calendar_added ? 'text-blue-600 accent-blue-600' : ''}`} title={app.calendar_added ? 'Added to calendar' : 'Click to mark'} /></td>
                                                <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!(app.invoice_id && String(app.invoice_id).trim() !== '')} onChange={(e) => toggleDaField(app.id, 'invoice', e.target.checked)} className={`w-3.5 h-3.5 rounded border-gray-300 cursor-pointer ${app.invoice_id ? 'text-amber-600 accent-amber-600' : ''}`} title={app.invoice_id ? `Invoice: ${app.invoice_id} — click to uncheck` : 'Click to mark as invoiced'} /></td>
                                                <td className="px-2 py-1.5 whitespace-nowrap font-medium text-gray-900 dark:text-white">{app.application_id || 'N/A'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.application_date ? new Date(app.application_date).toLocaleDateString('en-GB') : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.trainee_id_type || 'N/A'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.trainee_id ? (showPii ? app.trainee_id : `${app.trainee_id.charAt(0)}****${app.trainee_id.slice(-3)}`) : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.date_of_birth ? (showPii ? new Date(app.date_of_birth).toLocaleDateString('en-GB') : `**/**/` + new Date(app.date_of_birth).getFullYear()) : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.trainee_name || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 max-w-[160px] truncate" title={app.trainee_email}>{app.trainee_email || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.trainee_phone_country_code && app.trainee_phone ? `+${app.trainee_phone_country_code} ${app.trainee_phone}` : app.trainee_phone || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 max-w-[180px] truncate" title={app.course_title}>{app.course_title || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.course_reference_number || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.course_start_date ? new Date(app.course_start_date).toLocaleDateString('en-GB') : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.course_run_id || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.sponsorship_type || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.full_course_fee != null ? `$${parseFloat(app.full_course_fee || 0).toFixed(2)}` : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.gst != null ? `$${parseFloat(app.gst || 0).toFixed(2)}` : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.bl_grant_id || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.bl_amount != null ? `$${parseFloat(app.bl_amount).toFixed(2)}` : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.other_grant_id || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.other_scheme_code || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.other_amount != null ? `$${parseFloat(app.other_amount).toFixed(2)}` : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.tg_amount != null ? `$${parseFloat(app.tg_amount).toFixed(2)}` : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.skillsfuture_credit_claim_id || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.skillsfuture_credit != null ? `$${parseFloat(app.skillsfuture_credit || 0).toFixed(2)}` : '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">${parseFloat(app.payable_fee || 0).toFixed(2)}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.highest_qualification || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.highest_relevant_certification || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${getStatusColor(app.application_status || 'Pending')}`}>{app.application_status || 'Pending'}</span></td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300">{app.application_cancelled_by || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap">
                                                    {app.enrolment_status && app.enrolment_status.trim() !== '' ? (
                                                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full ${app.enrolment_status === 'Confirmed' ? 'bg-green-100 text-green-800' : app.enrolment_status === 'Not Found' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}`}>{app.enrolment_status}</span>
                                                    ) : <span className="text-gray-400">—</span>}
                                                </td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.enrolment_id || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-300 font-mono">{app.invoice_id || '—'}</td>
                                                <td className="px-2 py-1.5 whitespace-nowrap">
                                                    {app.invoice_id
                                                        ? <a href={app.invoice_drive_file_id ? `https://drive.google.com/file/d/${app.invoice_drive_file_id}/view` : invDriveFolderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40 transition-colors"><Icon name={IconName.ExternalLink} className="w-3.5 h-3.5" />View</a>
                                                        : <span className="text-gray-400">—</span>}
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

            {/* ── Send Invoice Email Modal ── */}
            {showSendEmailModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70" style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
                    <div className="bg-surface rounded-2xl shadow-2xl max-w-5xl w-full border border-default overflow-hidden mx-4">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-default bg-surface-elevated">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-500/10"><Icon name={IconName.Mail} className="w-5 h-5 text-blue-500" /></div>
                                <div>
                                    <h3 className="text-base font-semibold text-on-surface">Send Invoice Emails</h3>
                                    <p className="text-xs text-on-surface-secondary mt-0.5">Filter applications with generated invoices, or leave empty to send to all</p>
                                </div>
                            </div>
                            <button onClick={() => setShowSendEmailModal(false)} className="p-1.5 rounded-lg text-on-surface-secondary hover:text-on-surface hover:bg-surface-hover transition-colors"><Icon name={IconName.Close} className="w-4 h-4" /></button>
                        </div>
                        <div className="px-6 py-5 space-y-4">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Course Run</label>
                                    <input type="text" value={emailFilterCourseRun} onChange={e => setEmailFilterCourseRun(e.target.value)} placeholder="e.g. CRS-RUN-001" className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface placeholder-gray-400 transition-shadow" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Course Code</label>
                                    <input type="text" value={emailFilterCourseCode} onChange={e => setEmailFilterCourseCode(e.target.value)} placeholder="e.g. TGS-2024-001234" className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface placeholder-gray-400 transition-shadow" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Course Title</label>
                                    <input type="text" value={emailFilterCourseTitle} onChange={e => setEmailFilterCourseTitle(e.target.value)} placeholder="Search by course title..." className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface placeholder-gray-400 transition-shadow" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Start Date</label>
                                    <input type="date" value={emailFilterStartDate} onChange={e => setEmailFilterStartDate(e.target.value)} className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface transition-shadow" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">End Date</label>
                                    <input type="date" value={emailFilterEndDate} onChange={e => setEmailFilterEndDate(e.target.value)} className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface transition-shadow" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-on-surface-secondary mb-1.5">Learner Name</label>
                                    <input type="text" value={emailFilterName} onChange={e => setEmailFilterName(e.target.value)} placeholder="Search by learner name..." className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary text-on-surface placeholder-gray-400 transition-shadow" />
                                </div>
                            </div>
                            <div className="border-t border-default" />
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-medium text-on-surface-secondary uppercase tracking-wider">
                                        Preview {hasEmailFilter && emailPreviewRows.length > 0 ? `· ${emailPreviewRows.length} record${emailPreviewRows.length !== 1 ? 's' : ''}` : ''}
                                    </span>
                                </div>
                                <div className="border border-default rounded-lg bg-surface-elevated overflow-hidden">
                                    <div className="max-h-44 overflow-y-auto overflow-x-auto">
                                        {!hasEmailFilter ? (
                                            <div className="flex flex-col items-center justify-center py-8 text-on-surface-secondary">
                                                <Icon name={IconName.Search} className="w-6 h-6 mb-2 opacity-40" />
                                                <span className="text-xs">Enter a filter above to preview matching records</span>
                                            </div>
                                        ) : emailPreviewRows.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-8 text-on-surface-secondary">
                                                <Icon name={IconName.Search} className="w-6 h-6 mb-2 opacity-40" />
                                                <span className="text-xs">No matching records found</span>
                                            </div>
                                        ) : (
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr>
                                                        <th className="px-3 py-2.5 w-8">
                                                            <input type="checkbox" checked={emailAllSelected} ref={el => { if (el) el.indeterminate = emailSomeSelected && !emailAllSelected; }} onChange={toggleEmailSelectAll} className="rounded border-gray-400 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                                                        </th>
                                                        {['Name', 'Email', 'Course Title', 'Course Run', 'Start Date', 'Invoice #'].map(h => (
                                                            <th key={h} className="px-3 py-2.5 text-left font-semibold text-white/90 dark:text-white/80">{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-default bg-surface">
                                                    {emailPreviewRows.map((app, i) => {
                                                        const checked = emailSelectedIds.has(app.id);
                                                        return (
                                                            <tr key={app.id || i} onClick={() => toggleEmailRow(app.id)} className={`cursor-pointer hover:bg-surface-hover transition-colors ${checked ? 'bg-blue-500/5' : i % 2 === 1 ? 'bg-surface-elevated/50' : ''}`}>
                                                                <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                                                                    <input type="checkbox" checked={checked} onChange={() => toggleEmailRow(app.id)} className="rounded border-gray-400 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                                                                </td>
                                                                <td className="px-3 py-2 text-on-surface whitespace-nowrap">{app.trainee_name || '—'}</td>
                                                                <td className="px-3 py-2 text-on-surface-secondary whitespace-nowrap">{app.trainee_email || '—'}</td>
                                                                <td className="px-3 py-2 text-on-surface truncate max-w-[220px]" title={app.course_title}>{app.course_title || '—'}</td>
                                                                <td className="px-3 py-2 text-on-surface-secondary font-mono whitespace-nowrap">{app.course_run_id || '—'}</td>
                                                                <td className="px-3 py-2 text-on-surface-secondary whitespace-nowrap">{app.course_start_date ? new Date(app.course_start_date).toLocaleDateString('en-GB') : '—'}</td>
                                                                <td className="px-3 py-2 text-on-surface-secondary font-mono whitespace-nowrap">{app.invoice_id}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            </div>
                            {emailSendResult && (
                                <div className={`rounded-lg px-4 py-3 text-sm border ${emailSendResult.failed > 0 ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800' : 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'}`}>
                                    {emailSendResult.sent} sent · {emailSendResult.failed} failed · {emailSendResult.skipped} skipped (no invoice or email)
                                </div>
                            )}
                        </div>
                        <div className="flex items-center justify-between px-6 py-4 border-t border-default bg-surface-elevated">
                            <span className="text-xs text-on-surface-secondary">
                                {emailSelectedIds.size > 0 ? `${emailSelectedIds.size} selected · email${emailSelectedIds.size !== 1 ? 's' : ''} will be sent` : 'No recipients selected'}
                            </span>
                            <div className="flex items-center gap-3">
                                <button onClick={() => setShowSendEmailModal(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-default bg-surface hover:bg-surface-hover text-on-surface transition-colors">Cancel</button>
                                <button onClick={handleSendInvoiceEmails} disabled={isSendingEmail || emailSelectedIds.size === 0} className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                    {isSendingEmail ? <><div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />Sending...</> : <><Icon name={IconName.Mail} className="w-4 h-4" />Send Emails</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Invoice Generation Progress Modal ── */}
            {showInvProgress && (() => {
                const elapsed = (Date.now() - invProgressStartTime) / 1000;
                const allFailed = invProgressDone && invProgressFailed === invProgressTotal;
                const color = invProgressDone ? (allFailed ? 'red' : 'emerald') : 'amber';
                return (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" style={{ backdropFilter: 'blur(8px)' }}>
                        <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-gray-800 shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
                            <div className={`h-1 ${invProgressDone ? (allFailed ? 'bg-red-500' : 'bg-emerald-500') : 'bg-amber-500'}`} />
                            <div className="flex flex-col items-center pt-7 pb-2 px-6">
                                <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${invProgressDone ? (allFailed ? 'bg-red-100 dark:bg-red-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30') : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                                    {invProgressDone ? (
                                        allFailed ? (
                                            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                        ) : (
                                            <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                        )
                                    ) : (
                                        <div className="animate-spin rounded-full h-7 w-7 border-[3px] border-amber-200 border-t-amber-500" />
                                    )}
                                </div>
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                    {invProgressDone ? (allFailed ? 'Generation Failed' : 'Invoices Generated!') : 'Generating Invoices...'}
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {invProgressDone ? `Completed in ${fmt(elapsed)}` : `Processing ${invProgressTotal} invoice(s), please wait...`}
                                </p>
                            </div>

                            <div className="px-6 pt-4 pb-2">
                                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    {invProgressDone ? (
                                        <div className={`h-full rounded-full w-full ${allFailed ? 'bg-red-500' : 'bg-emerald-500'}`} />
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

                            <div className="px-6 pt-4 pb-5">
                                {invProgressDone ? (
                                    <button onClick={() => setShowInvProgress(false)} className={`w-full py-2.5 rounded-lg text-white text-sm font-medium transition-colors ${allFailed ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
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

            {/* ── Toast ── */}
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
                    <li><strong>Windows:</strong> Open in Excel → Click "Enable Editing" → Save</li>
                    <li><strong>Mac:</strong> Open in Excel → Save (⌘+S)</li>
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
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-white border border-red-200 rounded-full flex items-center justify-center"><Icon name={IconName.Close} className="w-5 h-5 text-red-500" /></div>
                    <div className="flex-1"><h4 className="font-semibold text-gray-900">Something went wrong!</h4><p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{error}</p></div>
                    <button onClick={() => setError(null)} className="text-gray-400 hover:text-gray-600"><Icon name={IconName.Close} className="w-5 h-5" /></button>
                </div>
            )}
            <div className="flex justify-end mt-6">
                <Button onClick={handleUpload} disabled={!file || isUploading}>{isUploading ? <div className="flex items-center"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Updating...</div> : 'Upload & Update'}</Button>
            </div>
        </Card>
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
            <div className="p-4 border-t text-right"><Button onClick={resetView}>Start a New Update</Button></div>
        </Card>
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