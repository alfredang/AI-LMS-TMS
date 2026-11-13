import React, { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from '../ui/Icon';
import Spinner from '../ui/Spinner';

/** Matches the formidable limit in pages/api/upload/google-drive.ts. */
export const MAX_ASSESSMENT_FILE_MB = 100;

export type AssessmentUploadState =
    | { status: 'uploading'; current: number; total: number; fileName: string }
    | { status: 'success'; fileNames: string[] }
    /** `failedFiles` are offered back to the learner as a one-click Retry. */
    | { status: 'error'; message: string; failedFiles?: File[]; uploadedCount?: number };

/** Returns an error message if any file is over the size limit or empty, otherwise null. */
export const checkAssessmentFiles = (files: File[]): string | null => {
    const empty = files.filter(f => f.size === 0);
    if (empty.length > 0) {
        return `${empty.map(f => `"${f.name}"`).join(', ')} ${empty.length > 1 ? 'are' : 'is'} empty. Please check the file and try again.`;
    }
    const tooBig = files.filter(f => f.size > MAX_ASSESSMENT_FILE_MB * 1024 * 1024);
    if (tooBig.length > 0) {
        return `${tooBig.map(f => `"${f.name}"`).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} larger than ${MAX_ASSESSMENT_FILE_MB} MB. Please compress or split the file and try again.`;
    }
    return null;
};

/**
 * Uploads `files` one by one with `uploadOne`, retrying each once on failure, and
 * reports progress through `setState`. Stops at the first file that still fails and
 * returns an error state carrying the remaining files so the learner can Retry just those.
 */
export const runAssessmentUpload = async (
    files: File[],
    uploadOne: (file: File) => Promise<void>,
    setState: (state: AssessmentUploadState) => void,
): Promise<AssessmentUploadState> => {
    const invalid = checkAssessmentFiles(files);
    if (invalid) return { status: 'error', message: invalid };

    const done: string[] = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setState({ status: 'uploading', current: i + 1, total: files.length, fileName: file.name });
        try {
            try {
                await uploadOne(file);
            } catch {
                // One automatic retry covers brief network drops / Drive hiccups.
                await new Promise(r => setTimeout(r, 1500));
                await uploadOne(file);
            }
            done.push(file.name);
        } catch (err: any) {
            const message = `${err?.message || `"${file.name}" could not be uploaded.`}${done.length > 0 ? ` (${done.length} file${done.length > 1 ? 's were' : ' was'} uploaded before this.)` : ''}`;
            return { status: 'error', message, failedFiles: files.slice(i), uploadedCount: done.length };
        }
    }
    return { status: 'success', fileNames: done };
};

export const UploadSuccessAlert: React.FC<{ fileNames: string[]; onDismiss?: () => void }> = ({ fileNames, onDismiss }) => (
    <div role="status" className="flex items-start gap-3 p-3 rounded-lg border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/30">
        <Icon name={IconName.CheckCircle} className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                {fileNames.length > 1 ? `${fileNames.length} files uploaded successfully` : 'File uploaded successfully'}
            </p>
            <p className="text-xs text-green-700 dark:text-green-300 break-words">{fileNames.join(', ')}</p>
        </div>
        {onDismiss && (
            <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-green-700 hover:text-green-900 dark:text-green-300 dark:hover:text-green-100">
                <Icon name={IconName.X} className="w-4 h-4" />
            </button>
        )}
    </div>
);

/** Clipboard images arrive as "image.png" — give them a unique, readable name. */
const renamePasted = (file: File, index: number): File => {
    if (file.name && file.name !== 'image.png') return file;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return new File([file], `pasted-${stamp}${index ? `-${index + 1}` : ''}.${ext}`, { type: file.type });
};

interface AssessmentUploadZoneProps {
    inputId: string;
    label: string;
    multiple?: boolean;
    state?: AssessmentUploadState;
    /** Called as soon as the learner picks, drops, pastes or photographs files — the upload starts immediately. */
    onFiles: (files: File[]) => void;
    onDismiss?: () => void;
}

/**
 * Learner assessment upload box. Every input path uploads immediately (no separate
 * "Upload" button): click / Choose files, drag-and-drop, paste (Ctrl/Cmd+V) and, on
 * phones, Take photo. Shows per-file progress, a green success alert, and an error
 * alert with Retry for the files that didn't make it.
 */
export const AssessmentUploadZone: React.FC<AssessmentUploadZoneProps> = ({ inputId, label, multiple = false, state, onFiles, onDismiss }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isTouch, setIsTouch] = useState(false);
    const isUploading = state?.status === 'uploading';
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setIsTouch(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
    }, []);

    const accept = (incoming: File[]) => {
        if (isUploading || incoming.length === 0) return;
        onFiles(multiple ? incoming : incoming.slice(0, 1));
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const pasted = Array.from(e.clipboardData?.files || []);
        if (pasted.length === 0) return;
        e.preventDefault();
        accept(pasted.map(renamePasted));
    };

    return (
        <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>

            {isUploading ? (
                <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20" aria-live="polite">
                    <div className="flex items-center gap-3">
                        <Spinner size="sm" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                                {state.total > 1 ? `Uploading file ${state.current} of ${state.total}…` : 'Uploading your file…'}
                            </p>
                            <p className="text-xs text-blue-600 dark:text-blue-400 truncate">{state.fileName}</p>
                        </div>
                    </div>
                    <div className="mt-3 h-1.5 w-full rounded-full bg-blue-100 dark:bg-blue-900/40 overflow-hidden">
                        <div
                            className="h-full bg-blue-600 transition-all duration-300"
                            style={{ width: `${Math.round(((state.current - 0.5) / state.total) * 100)}%` }}
                        />
                    </div>
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">Please keep this page open until the upload finishes.</p>
                </div>
            ) : (
                <div
                    tabIndex={0}
                    role="button"
                    aria-label={`${label}. Press Enter to choose files, or paste a file.`}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                    onPaste={handlePaste}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); accept(Array.from(e.dataTransfer.files || [])); }}
                    className={`flex flex-col items-center justify-center gap-2 p-5 rounded-lg border-2 border-dashed cursor-pointer text-center transition-colors outline-none focus:ring-2 focus:ring-blue-500
                        ${isDragging
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-gray-700'}`}
                >
                    <Icon name={IconName.Upload} className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        {isDragging
                            ? 'Drop to upload'
                            : <>Drag {multiple ? 'files' : 'a file'} here{!isTouch && ', or click and paste (Ctrl/Cmd+V)'}</>}
                    </span>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                            <Icon name={IconName.Folder} className="w-4 h-4" />
                            Choose {multiple ? 'files' : 'file'}
                        </span>
                        {isTouch && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-blue-600 text-blue-700 dark:text-blue-300 text-sm font-semibold hover:bg-blue-50 dark:hover:bg-blue-900/30"
                            >
                                <Icon name={IconName.Video} className="w-4 h-4" />
                                Take photo
                            </button>
                        )}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                        Uploads start automatically. Max {MAX_ASSESSMENT_FILE_MB} MB per file.
                    </span>
                    <input
                        ref={fileInputRef}
                        id={inputId}
                        type="file"
                        multiple={multiple}
                        className="sr-only"
                        tabIndex={-1}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { accept(Array.from(e.target.files || [])); e.target.value = ''; }}
                    />
                    <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        tabIndex={-1}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { accept(Array.from(e.target.files || [])); e.target.value = ''; }}
                    />
                </div>
            )}

            {state?.status === 'success' && <UploadSuccessAlert fileNames={state.fileNames} onDismiss={onDismiss} />}

            {state?.status === 'error' && (
                <div role="alert" className="flex items-start gap-3 p-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/30">
                    <Icon name={IconName.Warning} className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-red-800 dark:text-red-200">Upload failed</p>
                        <p className="text-xs text-red-700 dark:text-red-300 break-words">{state.message}</p>
                        {state.failedFiles && state.failedFiles.length > 0 && (
                            <button
                                type="button"
                                onClick={() => onFiles(state.failedFiles!)}
                                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
                            >
                                <Icon name={IconName.Sync} className="w-3.5 h-3.5" />
                                Retry {state.failedFiles.length > 1 ? `${state.failedFiles.length} files` : 'upload'}
                            </button>
                        )}
                    </div>
                    {onDismiss && (
                        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100">
                            <Icon name={IconName.X} className="w-4 h-4" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
