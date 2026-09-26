import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';
import { UserRole } from '@app-types';
import { useLms } from '@contexts/LmsContext';
import { AssessorSignatureDialog, LearnerSignatureDialog, AssessorRecord } from './AssessorSignatureForm';

/**
 * Assessment Summary Record (ASR) card on the course page.
 *
 * Learner view : sign the Candidate block (name / NRIC / signature / date).
 * Trainer view : per-learner roster — see who has signed, sign the Assessor
 *                block for each learner (or all at once).
 * Each signature regenerates the PDF from the course's ASR template with every
 * block signed so far, so once both have signed the file in the learner's
 * Assessment Records folder carries both names, NRICs, signatures and dates.
 * A manually signed copy can still be uploaded as a fallback.
 */

interface Course {
    id: string;
    title: string;
    courseCode: string;
    courseRunId: string;
    assessmentSummaryRecordUrl?: string;
}

interface AssessmentSummarySectionProps {
    course: Course;
    userRole: UserRole;
    courseRunUuid: string;
}

interface PartyState {
    name: string | null;
    nric: string | null;
    signDate: string | null;
    signedAt: string | null;
}

interface RecordView {
    id: string;
    learnerUserId: string;
    learner: PartyState | null;
    trainer: (PartyState & { userId: string | null }) | null;
    file: { id: string; url: string; name: string | null; generatedAt: string | null } | null;
}

interface LearnerStatus {
    learnerUserId: string;
    learnerName: string;
    email: string | null;
    record: RecordView | null;
}

interface RunInfo {
    startDate: string | null;
    endDate: string | null;
    templateUrl: string | null;
    hasTemplate: boolean;
}

const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Class end date when it has passed, else today. */
const defaultSignDate = (run: RunInfo | null) => {
    const today = todayIso();
    return run?.endDate && run.endDate <= today ? run.endDate : today;
};

const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const dateInputClass =
    'border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30';

const ContentSection: React.FC<{ title?: string; children: React.ReactNode; className?: string; collapsible?: boolean; defaultOpen?: boolean }> = ({ title, children, className, collapsible = false, defaultOpen = true }) => {
    const [open, setOpen] = useState(defaultOpen);
    if (collapsible && title) {
        return (
            <Card className={`p-6 ${className}`}>
                <button
                    type="button"
                    onClick={() => setOpen(prev => !prev)}
                    className="w-full flex items-center justify-between text-left"
                    aria-expanded={open}
                >
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h3>
                    <Icon
                        name={IconName.ChevronDown}
                        className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
                    />
                </button>
                {open && <div className="mt-4">{children}</div>}
            </Card>
        );
    }
    return (
        <Card className={`p-6 ${className}`}>
            {title && <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">{title}</h3>}
            {children}
        </Card>
    );
};

const SignedBadge: React.FC<{ party: PartyState | null; label: string }> = ({ party, label }) => (
    party ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400" title={`${party.name || ''} · signed ${fmtDate(party.signDate)}`}>
            <Icon name={IconName.CheckCircle} className="w-4 h-4" />
            {label} signed {fmtDate(party.signDate)}
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
            <span className="inline-block w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-gray-600" />
            {label} pending
        </span>
    )
);

const PdfLink: React.FC<{ file: RecordView['file'] }> = ({ file }) => (
    file ? (
        <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            title={file.name || 'Signed Assessment Summary Record'}
        >
            <Icon name={IconName.ExternalLink} className="w-3.5 h-3.5" /> Signed PDF
        </a>
    ) : (
        <span className="text-xs text-gray-400">—</span>
    )
);

export const AssessmentSummarySection: React.FC<AssessmentSummarySectionProps> = ({
    course,
    userRole,
    courseRunUuid
}) => {
    const { currentUser } = useLms();
    const isLearner = userRole === UserRole.Learner;
    const isTrainerSide = userRole === UserRole.Trainer || userRole === UserRole.Admin || userRole === UserRole.Developer || userRole === UserRole.TrainingProvider;

    // Signing state
    const [run, setRun] = useState<RunInfo | null>(null);
    const [myRecord, setMyRecord] = useState<RecordView | null>(null);
    const [hasLearnerSignature, setHasLearnerSignature] = useState(false);
    const [learners, setLearners] = useState<LearnerStatus[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [signDate, setSignDate] = useState(todayIso());
    const [signing, setSigning] = useState<Set<string>>(new Set());
    const [signError, setSignError] = useState<string | null>(null);
    const [signNotice, setSignNotice] = useState<string | null>(null);

    // Dialogs
    const [showLearnerDialog, setShowLearnerDialog] = useState(false);
    const [showAssessorDialog, setShowAssessorDialog] = useState(false);
    const [showSignDemo, setShowSignDemo] = useState(false);
    const [assessor, setAssessor] = useState<AssessorRecord | null>(null);
    const [assessorLoaded, setAssessorLoaded] = useState(false);
    const [pendingSign, setPendingSign] = useState<'self' | string[] | null>(null);

    // Manual upload fallback
    const [selectedLearner, setSelectedLearner] = useState<string>('');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadSuccess, setUploadSuccess] = useState(false);

    const loadStatus = useCallback(async () => {
        if (!courseRunUuid) return;
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch(`/api/assessments/summary-record?courseRunId=${encodeURIComponent(courseRunUuid)}${isLearner ? '&view=learner' : ''}`);
            const json = await res.json();
            if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to load signing status');
            setRun(json.run || null);
            setSignDate(prev => (prev === todayIso() ? defaultSignDate(json.run) : prev));
            if (Array.isArray(json.learners)) setLearners(json.learners);
            if (json.record !== undefined) setMyRecord(json.record);
            if (typeof json.hasSignature === 'boolean') setHasLearnerSignature(json.hasSignature);
        } catch (e: any) {
            setLoadError(e.message || 'Failed to load signing status');
        } finally {
            setLoading(false);
        }
    }, [courseRunUuid, isLearner]);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    // Trainer side: the caller's assessor block (drives the button label).
    useEffect(() => {
        if (!isTrainerSide) return;
        let cancelled = false;
        fetch('/api/trainer/assessor-signature')
            .then(r => r.json())
            .then(json => {
                if (cancelled) return;
                setAssessor(json?.success && json.exists && json.data?.signature_png ? json.data : null);
            })
            .catch(() => !cancelled && setAssessor(null))
            .finally(() => !cancelled && setAssessorLoaded(true));
        return () => { cancelled = true; };
    }, [isTrainerSide]);

    if (!isTrainerSide && !isLearner) return null;

    // ── Signing ────────────────────────────────────────────────────────────

    const withSigning = (key: string, on: boolean) =>
        setSigning(prev => { const n = new Set(prev); on ? n.add(key) : n.delete(key); return n; });

    const postSign = async (body: Record<string, unknown>) => {
        const res = await fetch('/api/assessments/summary-record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseRunId: courseRunUuid, signDate, ...body }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
            const err = new Error(json?.error || 'Signing failed') as Error & { code?: string };
            err.code = json?.code;
            throw err;
        }
        return json;
    };

    const signAsLearner = async (signed = true) => {
        setSignError(null);
        setSignNotice(null);
        withSigning('self', true);
        try {
            const json = await postSign({ party: 'learner', signed });
            setMyRecord(json.record || null);
            setSignNotice(signed ? 'Your signature has been added to the Assessment Summary Record.' : 'Your signature has been removed.');
        } catch (e: any) {
            if (e.code === 'NO_LEARNER_SIGNATURE' || e.code === 'NO_SIGNATURE') {
                setPendingSign('self');
                setShowLearnerDialog(true);
            } else {
                setSignError(e.message || 'Signing failed');
            }
        } finally {
            withSigning('self', false);
        }
    };

    const signAsTrainer = async (learnerUserIds: string[], signed = true) => {
        if (learnerUserIds.length === 0) return;
        setSignError(null);
        setSignNotice(null);
        if (signed && assessorLoaded && !assessor) {
            setPendingSign(learnerUserIds);
            setShowAssessorDialog(true);
            return;
        }
        learnerUserIds.forEach(id => withSigning(id, true));
        const failures: string[] = [];
        let done = 0;
        for (const learnerUserId of learnerUserIds) {
            try {
                const json = await postSign({ party: 'trainer', learnerUserId, signed });
                setLearners(prev => prev.map(l => (l.learnerUserId === learnerUserId ? { ...l, record: json.record || null } : l)));
                done++;
            } catch (e: any) {
                if (e.code === 'NO_ASSESSOR_PROFILE' || e.code === 'NO_SIGNATURE') {
                    learnerUserIds.forEach(id => withSigning(id, false));
                    setPendingSign(learnerUserIds);
                    setShowAssessorDialog(true);
                    return;
                }
                const name = learners.find(l => l.learnerUserId === learnerUserId)?.learnerName || learnerUserId;
                failures.push(`${name}: ${e.message || 'failed'}`);
            } finally {
                withSigning(learnerUserId, false);
            }
        }
        if (failures.length) setSignError(failures.join(' · '));
        if (done > 0) setSignNotice(signed ? `Assessor signature added for ${done} learner${done === 1 ? '' : 's'}.` : `Assessor signature removed for ${done} learner${done === 1 ? '' : 's'}.`);
    };

    const handleLearnerSaved = (rec: AssessorRecord) => {
        setShowLearnerDialog(false);
        setHasLearnerSignature(!!rec.signature_png);
        if (pendingSign === 'self' && rec.signature_png) {
            setPendingSign(null);
            signAsLearner(true);
        } else {
            setPendingSign(null);
        }
    };

    const handleAssessorSaved = (rec: AssessorRecord) => {
        setShowAssessorDialog(false);
        setAssessor(rec.signature_png ? rec : null);
        if (Array.isArray(pendingSign) && rec.signature_png) {
            const ids = pendingSign;
            setPendingSign(null);
            // The record is saved server-side; sign straight away.
            (async () => {
                ids.forEach(id => withSigning(id, true));
                let done = 0;
                const failures: string[] = [];
                for (const learnerUserId of ids) {
                    try {
                        const json = await postSign({ party: 'trainer', learnerUserId, signed: true });
                        setLearners(prev => prev.map(l => (l.learnerUserId === learnerUserId ? { ...l, record: json.record || null } : l)));
                        done++;
                    } catch (e: any) {
                        failures.push(e.message || 'failed');
                    } finally {
                        withSigning(learnerUserId, false);
                    }
                }
                if (failures.length) setSignError(failures.join(' · '));
                if (done > 0) setSignNotice(`Assessor signature added for ${done} learner${done === 1 ? '' : 's'}.`);
            })();
        } else {
            setPendingSign(null);
        }
    };

    // ── Manual upload fallback ─────────────────────────────────────────────

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        let studentName: string | undefined;
        if (isLearner) {
            studentName = currentUser?.fullName;
            if (!studentName) {
                setUploadError('Unable to identify your name; please refresh and try again.');
                return;
            }
        } else {
            if (!selectedLearner) return;
            const learner = learners.find(l => l.learnerUserId === selectedLearner);
            if (!learner) return;
            studentName = learner.learnerName;
        }

        setIsUploading(true);
        setUploadError(null);
        setUploadSuccess(false);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('studentName', studentName);
        formData.append('courseRunId', courseRunUuid);

        try {
            const res = await fetch('/api/trainer/upload-summary-record', { method: 'POST', body: formData });
            const result = await res.json();
            if (result.success) setUploadSuccess(true);
            else setUploadError(result.error || 'Upload failed');
        } catch {
            setUploadError('An error occurred during upload');
        } finally {
            setIsUploading(false);
            if (e.target) e.target.value = '';
        }
    };

    const templateUrl = course.assessmentSummaryRecordUrl || run?.templateUrl || '';
    const noTemplate = run !== null && !run.hasTemplate && !course.assessmentSummaryRecordUrl;

    const unsignedLearners = learners.filter(l => !l.record?.trainer).map(l => l.learnerUserId);
    const bothSignedCount = learners.filter(l => l.record?.learner && l.record?.trainer).length;
    const learnerSignedCount = learners.filter(l => l.record?.learner).length;
    const trainerSignedCount = learners.filter(l => l.record?.trainer).length;

    return (
        <ContentSection title="Assessment Summary Record (Virtual Class)" collapsible defaultOpen={userRole !== UserRole.Trainer}>
            <div className="space-y-4">
                {templateUrl && (
                    <a
                        href={templateUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                        <Icon name={IconName.ExternalLink} className="w-6 h-6 text-blue-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 dark:text-white">Assessment Summary Record Template</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Click to open template</p>
                        </div>
                    </a>
                )}

                {noTemplate && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                        This course has no Assessment Summary Record template link yet, so e-signing is unavailable. Set it under the course details, or upload a manually signed copy below.
                    </p>
                )}

                {/* ── Learner: sign the Candidate block ─────────────────────── */}
                {isLearner && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 space-y-3">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100 uppercase tracking-wider">Sign your Assessment Summary Record</h4>
                                <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                                    Your name, NRIC (last 3 digits and letter), signature and the date are placed in the Candidate block of the record. Your trainer signs the Assessor block; the PDF carries both once you have both signed.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setPendingSign(null); setShowLearnerDialog(true); }}
                                title={hasLearnerSignature ? 'Edit your saved name, NRIC and signature' : 'Set up your name, NRIC and signature'}
                                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors ${
                                    hasLearnerSignature
                                        ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800 dark:hover:bg-amber-900/40'
                                        : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'
                                }`}
                            >
                                <Icon name={IconName.Edit} className="w-3.5 h-3.5" />
                                {hasLearnerSignature ? 'Learner Signature' : 'Set Up Signature'}
                            </button>
                        </div>

                        <div className="flex items-center gap-4 flex-wrap">
                            <SignedBadge party={myRecord?.learner || null} label="Learner" />
                            <SignedBadge party={myRecord?.trainer || null} label="Trainer" />
                            <PdfLink file={myRecord?.file || null} />
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                            {!myRecord?.learner && (
                                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                    Date
                                    <input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} className={dateInputClass} />
                                </label>
                            )}
                            {myRecord?.learner ? (
                                <button
                                    type="button"
                                    onClick={() => signAsLearner(false)}
                                    disabled={signing.has('self')}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                                >
                                    {signing.has('self') && <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />}
                                    Remove my signature
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => signAsLearner(true)}
                                    disabled={signing.has('self') || noTemplate || loading}
                                    className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {signing.has('self') ? <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" /> : <Icon name={IconName.Edit} className="w-3.5 h-3.5" />}
                                    {signing.has('self') ? 'Signing…' : 'Sign Assessment Summary Record'}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Trainer side: roster + Assessor block ─────────────────── */}
                {isTrainerSide && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800 space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div>
                                <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100 uppercase tracking-wider">Sign the Assessment Summary Records</h4>
                                <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                                    Your assessor name, NRIC (last 3 digits and letter), signature and the date go into the Assessor block of each learner&apos;s record. Learners sign their own Candidate block from their course page.
                                </p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                    Learner {learnerSignedCount}/{learners.length} · Trainer {trainerSignedCount}/{learners.length} · Both {bothSignedCount}/{learners.length}
                                </span>
                                {/* How-to video for signing the ASR online (virtual classes) */}
                                <button
                                    type="button"
                                    onClick={() => setShowSignDemo(true)}
                                    title="Watch a short demo of signing the Assessment Summary Record online"
                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    <Icon name={IconName.Video} className="w-4 h-4" />
                                    Watch Demo
                                </button>
                                <button
                                    type="button"
                                    onClick={loadStatus}
                                    disabled={loading}
                                    title="Refresh signing status"
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Icon name={IconName.Sync} className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                                    {loading ? 'Refreshing...' : 'Refresh'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setPendingSign(null); setShowAssessorDialog(true); }}
                                    disabled={!assessorLoaded}
                                    title={assessor ? `Assessor: ${assessor.assessor_name} — click to edit` : 'Set up your assessor name, NRIC, date and signature'}
                                    className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                                        assessor
                                            ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800 dark:hover:bg-amber-900/40'
                                            : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'
                                    }`}
                                >
                                    <Icon name={IconName.Edit} className="w-3.5 h-3.5" />
                                    {assessor ? 'Trainer Signature' : 'Set Up Signature'}
                                </button>
                                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                    Date
                                    <input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} className={dateInputClass} />
                                </label>
                                <button
                                    type="button"
                                    onClick={() => signAsTrainer(unsignedLearners, true)}
                                    disabled={unsignedLearners.length === 0 || signing.size > 0 || noTemplate}
                                    className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {signing.size > 0 ? <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" /> : <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5" />}
                                    Sign All ({unsignedLearners.length})
                                </button>
                            </div>
                        </div>

                        {loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}

                        {learners.length === 0 && !loading && !loadError && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">No enrolled learners in this class.</p>
                        )}

                        {learners.length > 0 && (
                            <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-700/60 text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-semibold">Learner</th>
                                            <th className="text-left px-3 py-2 font-semibold">Learner Sign</th>
                                            <th className="text-left px-3 py-2 font-semibold">Trainer Sign</th>
                                            <th className="text-left px-3 py-2 font-semibold">PDF</th>
                                            <th className="text-right px-3 py-2 font-semibold">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {learners.map(l => {
                                            const busy = signing.has(l.learnerUserId);
                                            const trainerSigned = !!l.record?.trainer;
                                            return (
                                                <tr key={l.learnerUserId}>
                                                    <td className="px-3 py-2">
                                                        <div className="font-medium text-gray-900 dark:text-white">{l.learnerName}</div>
                                                        {l.email && <div className="text-[11px] text-gray-500 dark:text-gray-400">{l.email}</div>}
                                                    </td>
                                                    <td className="px-3 py-2"><SignedBadge party={l.record?.learner || null} label="Learner" /></td>
                                                    <td className="px-3 py-2"><SignedBadge party={l.record?.trainer || null} label="Trainer" /></td>
                                                    <td className="px-3 py-2"><PdfLink file={l.record?.file || null} /></td>
                                                    <td className="px-3 py-2 text-right">
                                                        {trainerSigned ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => signAsTrainer([l.learnerUserId], false)}
                                                                disabled={busy}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                                                            >
                                                                {busy && <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />}
                                                                Unsign
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => signAsTrainer([l.learnerUserId], true)}
                                                                disabled={busy || noTemplate}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {busy ? <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" /> : <Icon name={IconName.Edit} className="w-3.5 h-3.5" />}
                                                                {busy ? 'Signing…' : 'Sign'}
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {signNotice && (
                    <p className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center gap-2">
                        <Icon name={IconName.CheckCircle} className="w-4 h-4" /> {signNotice}
                    </p>
                )}
                {signError && (
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium">Error: {signError}</p>
                )}
                {isLearner && loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}

                {/* ── Manual upload fallback ────────────────────────────────── */}
                <details className="group rounded-lg border border-gray-200 dark:border-gray-700">
                    <summary className="cursor-pointer select-none px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                        Or upload a manually signed copy
                    </summary>
                    <div className="px-4 pb-4 pt-1">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
                            {isLearner
                                ? 'Print the template, fill in the learner block, sign it and upload the scan.'
                                : 'Upload a scanned copy signed outside the LMS to the learner\'s Assessment Records folder.'}
                        </p>
                        <div className={`grid grid-cols-1 ${isLearner ? '' : 'md:grid-cols-2'} gap-4`}>
                            {!isLearner && (
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Select Learner</label>
                                    <select
                                        className="w-full p-2 text-sm border rounded-md dark:bg-gray-800 dark:border-gray-700 font-sans"
                                        value={selectedLearner}
                                        onChange={(e) => setSelectedLearner(e.target.value)}
                                    >
                                        <option value="">Choose a learner...</option>
                                        {learners.map(l => (
                                            <option key={l.learnerUserId} value={l.learnerUserId}>{l.learnerName}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Upload File</label>
                                <input
                                    type="file"
                                    onChange={handleUpload}
                                    disabled={(!isLearner && !selectedLearner) || isUploading}
                                    className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
                                />
                            </div>
                        </div>
                        {isUploading && (
                            <div className="flex items-center gap-2 mt-3 text-blue-600 dark:text-blue-400 text-sm italic">
                                <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin" />
                                <span>Uploading to learner&apos;s specific folder...</span>
                            </div>
                        )}
                        {uploadSuccess && (
                            <div className="mt-3 text-green-600 dark:text-green-400 text-sm font-medium flex items-center gap-2">
                                <Icon name={IconName.CheckCircle} className="w-4 h-4" />
                                <span>Successfully uploaded to learner&apos;s Assessment Record folder.</span>
                            </div>
                        )}
                        {uploadError && (
                            <div className="mt-3 text-red-600 dark:text-red-400 text-sm font-medium">Error: {uploadError}</div>
                        )}
                    </div>
                </details>
            </div>

            {/* Trainer demo: signing the Assessment Summary Record online (virtual classes only) */}
            {showSignDemo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSignDemo(false)}>
                    <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-4 w-full max-w-4xl mx-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3 px-1">
                            <div>
                                <h3 className="text-base font-bold text-gray-900 dark:text-white">Demo: Sign the Assessment Summary Record online</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Virtual classes only — physical classes keep the printed record.</p>
                            </div>
                            <button
                                onClick={() => setShowSignDemo(false)}
                                className="p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                aria-label="Close"
                            >
                                <Icon name={IconName.Close} className="w-5 h-5" />
                            </button>
                        </div>
                        <video
                            src="/videos/asr-sign-off-demo.mp4"
                            controls
                            autoPlay
                            playsInline
                            className="w-full rounded-lg bg-black aspect-video"
                        >
                            <track kind="captions" src="/videos/asr-sign-off-demo.vtt" srcLang="en" label="English" />
                        </video>
                    </div>
                </div>
            )}

            <LearnerSignatureDialog
                open={showLearnerDialog}
                onClose={() => { setShowLearnerDialog(false); setPendingSign(null); }}
                onSaved={handleLearnerSaved}
            />
            <AssessorSignatureDialog
                open={showAssessorDialog}
                onClose={() => { setShowAssessorDialog(false); setPendingSign(null); }}
                onSaved={handleAssessorSaved}
                defaultSignDate={run?.endDate || undefined}
            />
        </ContentSection>
    );
};
