import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useLms } from '../../contexts/LmsContext';
import { useTrainerCourses } from '../../hooks/useTrainerCourses';
import { labelSessions, pickCurrentSession } from '../../lib/attendance/sessionLabel';

interface Session {
  id: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  modeOfTraining: string;
}

/** One row of Manual Attendance Taking (an enrolled learner or a manually added one). */
interface ManualRow {
  nric: string;
  fullName: string;
  email: string;
  phone: string;
  isPresent: boolean;
  reasonOfAbsence: string;
}

type DbAttendance = Record<string, { isPresent: boolean; reasonOfAbsence: string }>;

const qrSrc = (url: string, size: number) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;

const fmtDay = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const isPresentStatus = (st: unknown) => ['confirmed', 'present', 'attended'].includes(String(st ?? '').toLowerCase());

// SSG's "trainee" schema varies by endpoint — email can be a string or { full },
// and phone shows up under different keys with a `mobile` or `phoneNumber` sub-field.
const extractContact = (trainee: any): { email: string; phone: string } => {
  const email: string = trainee?.email?.full || trainee?.email || '';

  const raw = trainee?.contactNumber || trainee?.phone || trainee?.mobileNumber || trainee?.mobile;
  let phone = '';
  if (raw) {
    if (typeof raw === 'object') {
      const country = raw.countryCode ? `+${String(raw.countryCode).replace(/^\+/, '')}` : '';
      const areaCode = raw.areaCode && Number(raw.areaCode) !== 0 ? raw.areaCode : '';
      phone = [country, areaCode, raw.phoneNumber || raw.mobile].filter(Boolean).join(' ');
    } else {
      phone = String(raw);
    }
  }
  return { email, phone };
};

const StatusBadge: React.FC<{ value: string }> = ({ value }) => {
  if (!value || value === '—') return <span className="text-muted">—</span>;
  const v = value.toLowerCase();
  let cls = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ';
  if (v === 'confirmed' || v === 'present' || v === 'attended') {
    cls += 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  } else if (v === 'absent') {
    cls += 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  } else if (v.includes('pending')) {
    cls += 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
  } else if (v === 'cancelled' || v === 'withdrawn') {
    cls += 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  } else {
    cls += 'bg-surface-elevated text-on-surface-secondary';
  }
  return <span className={cls}>{value}</span>;
};


const RefreshIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const ExternalLinkIcon: React.FC = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const Tooltip: React.FC<{ text: string; children: React.ReactNode; width?: string }> = ({ text, children, width = 'w-56' }) => (
  <div className="relative inline-flex group/tip">
    {children}
    <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tip:block z-50 ${width} px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-xl pointer-events-none leading-relaxed`}>
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
    </div>
  </div>
);

const SectionHeader: React.FC<{ title: string; count?: number; badges?: React.ReactNode; right?: React.ReactNode; loading?: boolean; info?: string; infoContent?: React.ReactNode }> = ({ title, count, badges, right, loading, info, infoContent }) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-default">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-on-surface">{title}</h2>
      {count !== undefined && (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          {count}
        </span>
      )}
      {badges}
      {infoContent ? (
        <div className="relative inline-flex items-center group/sinfo">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-surface-elevated border border-default text-on-surface-secondary text-xs cursor-help hover:bg-surface-hover transition-colors select-none">?</span>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/sinfo:block z-50 pointer-events-none" style={{ width: '268px' }}>
            {infoContent}
            <div className="flex justify-center"><div className="border-[5px] border-transparent border-t-gray-900 dark:border-t-gray-800" /></div>
          </div>
        </div>
      ) : info ? (
        <Tooltip text={info} width="w-72">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-surface-elevated border border-default text-on-surface-secondary text-xs cursor-help hover:bg-surface-hover transition-colors select-none">?</span>
        </Tooltip>
      ) : null}
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-muted ml-1">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary" />
          Loading...
        </div>
      )}
    </div>
    {right && <div className="flex items-center gap-2">{right}</div>}
  </div>
);

/** Show/Hide toggle for a collapsible section header. */
const CollapseToggle: React.FC<{ open: boolean; onToggle: () => void }> = ({ open, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    className="flex items-center gap-1 px-3 py-1.5 bg-surface-elevated border border-default text-on-surface-secondary rounded text-xs font-medium hover:bg-surface-hover transition-colors"
  >
    {open ? 'Hide' : 'Show'}
    <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  </button>
);

interface SessionKpiData {
  eAttendance: number;
  enrolments: number;
  manual: number;
  missingEAttendance: string[];
  missingManual: string[];
  loading: boolean;
}

/** Three per-session numbers a trainer reconciles: they should all be equal. */
const SessionKpis: React.FC<{ kpis: SessionKpiData }> = ({ kpis }) => {
  const { eAttendance, enrolments, manual, missingEAttendance, missingManual, loading } = kpis;
  const allMatch = !loading && enrolments > 0 && eAttendance === enrolments && manual === enrolments;
  const tiles: Array<{ label: string; value: number; hint: string }> = [
    { label: 'E-Attendance Taken', value: eAttendance, hint: 'Trainees signed in on SSG for this session' },
    { label: 'Confirmed Enrolments', value: enrolments, hint: 'Confirmed SSG enrolments for this class (pending enrolment-form submissions are not counted)' },
    { label: 'Manual Attendance', value: manual, hint: 'Marked present in Manual Attendance Taking' },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiles.map(t => {
          const off = !loading && enrolments > 0 && t.value !== enrolments;
          return (
            <div
              key={t.label}
              title={t.hint}
              className={`rounded-lg border px-4 py-3 bg-surface-elevated ${off ? 'border-amber-500/60' : allMatch ? 'border-green-500/60' : 'border-default'}`}
            >
              <div className="text-xs font-medium text-on-surface-secondary">{t.label}</div>
              <div className={`text-2xl font-bold mt-0.5 ${off ? 'text-amber-400' : 'text-on-surface'}`}>
                {loading ? <span className="inline-block h-6 w-8 rounded bg-surface animate-pulse align-middle" /> : t.value}
              </div>
            </div>
          );
        })}
      </div>
      {!loading && enrolments > 0 && (
        allMatch ? (
          <p className="text-sm text-green-500 flex items-center gap-1.5">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            All three numbers match.
          </p>
        ) : (
          <div className="text-sm text-amber-400 space-y-1">
            {missingEAttendance.length > 0 && (
              <p><span className="font-semibold">No e-attendance yet ({missingEAttendance.length}):</span> {missingEAttendance.join(', ')}</p>
            )}
            {missingManual.length > 0 && (
              <p><span className="font-semibold">Not marked present manually ({missingManual.length}):</span> {missingManual.join(', ')}</p>
            )}
            {eAttendance > enrolments && (
              <p>More e-attendance than confirmed enrolments: someone signed in without a confirmed SSG enrolment (check SWDA Enrolment).</p>
            )}
            {missingEAttendance.length === 0 && missingManual.length === 0 && manual > enrolments && (
              <p>Manual attendance includes learners added by hand who are not in the SSG enrolments.</p>
            )}
          </div>
        )
      )}
    </div>
  );
};

const TrainerAttendanceDashboard: React.FC<{ isAdminMode?: boolean }> = ({ isAdminMode = false }) => {
  const router = useRouter();
  const { currentUser, pendingAttendanceCourseRunId, setPendingAttendanceCourseRunId, loadCourseData } = useLms();
  const [sourceCourse, setSourceCourse] = useState<any | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('attendanceSourceCourse');
      if (raw) setSourceCourse(JSON.parse(raw));
    } catch {}
  }, []);
  const handleBackToClass = () => {
    if (!sourceCourse) return;
    if (typeof window !== 'undefined') {
      try { sessionStorage.removeItem('attendanceSourceCourse'); } catch {}
    }
    // Reload the full class (selectedCourse + courseDetail together). A bare
    // setSelectedCourse left the previously loaded courseDetail in place, so the
    // class page could show one class's title while its QR codes pointed at another.
    void loadCourseData(sourceCourse).catch(err => console.error('Failed to reload class:', err));
  };
  const { courses, loading: coursesLoading } = // All of the trainer's classes, past ones included: enrolments and manual attendance
  // must stay viewable after a class ends (they are the record for checking/claims).
  useTrainerCourses(isAdminMode ? undefined : currentUser?.id, false, false);

  // Admin-mode course run lookup
  const [adminInput, setAdminInput]             = useState('');
  const [isSearching, setIsSearching]           = useState(false);
  const [searchError, setSearchError]           = useState<string | null>(null);
  const [adminCourse, setAdminCourse]           = useState<any | null>(null);

  // Admin-mode: list of ongoing classes for the dropdown
  const [adminOngoingClasses, setAdminOngoingClasses] = useState<Array<{
    id: string; courseRunId: string; courseTitle: string; courseCode: string;
    trainerName: string; startDate: string; endDate: string;
  }>>([]);
  const [adminOngoingLoading, setAdminOngoingLoading] = useState(false);
  const [adminDropdownValue, setAdminDropdownValue] = useState('');

  const [uen, setUen] = useState('');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [sessions, setSessions]                        = useState<Session[]>([]);
  const [selectedSession, setSelectedSession]          = useState('');
  const [isFetchingSessions, setIsFetchingSessions]    = useState(false);
  const [fetchError, setFetchError]                    = useState<string | null>(null);

  const [isLoadingAttendance, setIsLoadingAttendance]  = useState(false);
  const [showNric, setShowNric]                        = useState(false);
  const [attendanceError, setAttendanceError]          = useState<string | null>(null);
  const [attendanceSuccess, setAttendanceSuccess]      = useState<string | null>(null);
  const [attendanceRecords, setAttendanceRecords]      = useState<any[]>([]);
  const [attendanceCourseRun, setAttendanceCourseRun]  = useState<any | null>(null);

  const [digitalAttendanceId, setDigitalAttendanceId]  = useState('');
  const [isFetchingDigitalId, setIsFetchingDigitalId]  = useState(false);
  const [digitalIdError, setDigitalIdError]            = useState<string | null>(null);
  const [manualDaIdInput, setManualDaIdInput]          = useState('');
  const [isSavingManualDaId, setIsSavingManualDaId]    = useState(false);
  const [manualDaIdError, setManualDaIdError]          = useState<string | null>(null);

  const [enrolmentRecords, setEnrolmentRecords]        = useState<any[]>([]);
  const [isLoadingEnrolments, setIsLoadingEnrolments]  = useState(false);
  const [enrolmentError, setEnrolmentError]            = useState<string | null>(null);
  const [showEnrolNric, setShowEnrolNric]              = useState(false);
  const [showEnrolContact, setShowEnrolContact]        = useState(false);
  const [enrolmentsOpen, setEnrolmentsOpen]            = useState(true);
  // SWDA Enrolment form submissions for this class (public /enrol QR): shown as Pending rows
  const [enrolmentRequests, setEnrolmentRequests]      = useState<any[]>([]);
  const [sessionAttendanceOpen, setSessionAttendanceOpen] = useState(true);

  // Local admin manual assignments
  const [localAssignments, setLocalAssignments]        = useState<any[]>([]);
  const [isLoadingLocalAssignments, setIsLoadingLocalAssignments] = useState(false);
  const [showAssignedNric, setShowAssignedNric]        = useState(false);

  const [learnerAccountMap, setLearnerAccountMap]      = useState<Record<string, 'exists' | 'missing' | 'creating' | 'done' | 'error'>>({});
  const [attendanceSummary, setAttendanceSummary]      = useState<{ totalSessions: number; byNric: Record<string, number> } | null>(null);
  const [loadingAttendanceSummary, setLoadingAttendanceSummary] = useState(false);

  // Manual Attendance state
  const [manualSessions, setManualSessions]            = useState<any[]>([]);
  // Present count per session (course_session.id) for the session tabs
  const [sessionCounts, setSessionCounts]              = useState<Record<string, number>>({});
  const [selectedManualSession, setSelectedManualSession] = useState('');
  const [manualAttendance, setManualAttendance]        = useState<ManualRow[]>([]);
  // Raw DB attendance map keyed by NRIC — merged with enrolmentRecords to build manualAttendance
  const [manualAttendanceDbMap, setManualAttendanceDbMap] = useState<DbAttendance>({});
  // Rows the trainer changed and has not saved yet. Only these are saved, so a Save never
  // overwrites a learner's QR check-in with a stale "Absent"; background refreshes keep them.
  const [dirty, setDirty]                              = useState<Record<string, true>>({});
  const dirtyRef = useRef<Record<string, true>>({});
  dirtyRef.current = dirty;
  const [selectedRows, setSelectedRows]                = useState<Record<string, true>>({});
  // Take Attendance QR (per session)
  const [checkinOpen, setCheckinOpen]                  = useState(false);
  const [checkinUrl, setCheckinUrl]                    = useState('');
  const [checkinLoading, setCheckinLoading]            = useState(false);
  const [checkinError, setCheckinError]                = useState<string | null>(null);
  const [checkinZoom, setCheckinZoom]                  = useState(false);
  const [checkinCopied, setCheckinCopied]              = useState(false);
  const [loadingManualSessions, setLoadingManualSessions] = useState(false);
  const [loadingManualAttendance, setLoadingManualAttendance] = useState(false);
  const [savingAttendance, setSavingAttendance]        = useState(false);
  const [manualAttendanceMsg, setManualAttendanceMsg]  = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showManualNric, setShowManualNric]             = useState(false);
  const [manualPage, setManualPage]                    = useState(1);
  const MANUAL_PAGE_SIZE = 20;
  const manualAttendanceFetchRef = useRef<AbortController | null>(null);
  // Manually added learners (not in SSG enrolments)
  const [extraAttendees, setExtraAttendees]            = useState<ManualRow[]>([]);
  const [showAddLearnerModal, setShowAddLearnerModal]  = useState(false);
  const [addLearnerForm, setAddLearnerForm]            = useState({ fullName: '', email: '', nric: '' });
  const [isAddingLearner, setIsAddingLearner]          = useState(false);
  const [addLearnerError, setAddLearnerError]          = useState<string | null>(null);
  const [confirmRemoveNric, setConfirmRemoveNric]      = useState<string | null>(null);
  const [removingNric, setRemovingNric]                = useState<string | null>(null);
  const [showDeleteLearnerModal, setShowDeleteLearnerModal] = useState(false);
  const [deleteLearnerNric, setDeleteLearnerNric]      = useState('');
  const [isDeletingFromClass, setIsDeletingFromClass]  = useState(false);
  const [deleteLearnerError, setDeleteLearnerError]    = useState<string | null>(null);

  // Current & upcoming classes first (soonest first), then past classes (most recent first).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startTime = (c: { startDate?: string | null }) => new Date(c.startDate ?? '').getTime() || 0;
  const isPastCourse = (c: { endDate?: string | null }) => !!c.endDate && new Date(c.endDate) < today;
  const activeCourses = courses
    .filter(c => !isPastCourse(c))
    .sort((a, b) => startTime(a) - startTime(b));
  const pastCourses = courses
    .filter(c => isPastCourse(c))
    .sort((a, b) => startTime(b) - startTime(a));
  const fmtClassDate = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  const selectedCourse = isAdminMode
    ? adminCourse
    : (courses.find(c => c.courseRunId === selectedCourseRunId) ?? null);

  useEffect(() => {
    fetch('/api/training-provider/uen')
      .then(r => r.json())
      .then(d => { if (d.uen) setUen(d.uen); })
      .catch(() => {});
  }, []);

  const handleAdminSearch = async (codeOverride?: string) => {
    const code = (codeOverride ?? adminInput).trim();
    if (!code) return;
    if (codeOverride && codeOverride !== adminInput) setAdminInput(codeOverride);
    setIsSearching(true);
    setSearchError(null);
    setAdminCourse(null);
    // Reset all dependent state
    setSessions([]);
    setSelectedSession('');
    setFetchError(null);
    setAttendanceRecords([]);
    setAttendanceCourseRun(null);
    setEnrolmentRecords([]);
    setEnrolmentError(null);
    setLocalAssignments([]);
    setAttendanceSuccess(null);
    setAttendanceError(null);
    setDigitalAttendanceId('');
    setDigitalIdError(null);
    setManualSessions([]);
    setSelectedManualSession('');
    setManualAttendance([]);
    setManualAttendanceDbMap({});
    setExtraAttendees([]);
    setManualAttendanceMsg(null);
    setLearnerAccountMap({});
    setAttendanceSummary(null);
    try {
      const res = await fetch(`/api/admin/lookup-course-run?courseRunCode=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Course run not found');
      const course = json.data;
      setAdminCourse(course);
      setSelectedCourseRunId(course.courseRunId);
      if (course.digitalAttendanceId) {
        setDigitalAttendanceId(course.digitalAttendanceId);
      } else if (course.courseRunId && course.courseRunCode) {
        fetchDigitalAttendanceId(course.courseRunId, course.courseRunCode);
      }
      if (course.courseRunCode && course.courseCode) {
        handleFetchSessions(course.courseRunCode, course.courseCode, course);
        fetchEnrolments(course.courseRunCode, course);
      }
      if (course.courseRunId) {
        fetchManualSessions(course.courseRunId);
        fetchAttendanceSummary(course.courseRunId);
        fetchLocalAssignments(course.courseRunId);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setIsSearching(false);
    }
  };

  /** Trainer mode: open one of the trainer's classes ('' = back to the class picker). */
  const selectTrainerClass = (val: string) => {
    const course = courses.find(c => c.courseRunId === val);
    setSelectedCourseRunId(val);
    setSessions([]);
    setSelectedSession('');
    setFetchError(null);
    setAttendanceRecords([]);
    setAttendanceCourseRun(null);
    setEnrolmentRecords([]);
    setEnrolmentError(null);
    setLocalAssignments([]);
    setAttendanceSuccess(null);
    setAttendanceError(null);
    setDigitalIdError(null);
    setManualSessions([]);
    setSessionCounts({});
    setSelectedManualSession('');
    setManualAttendance([]);
    setManualAttendanceDbMap({});
    setExtraAttendees([]);
    setManualAttendanceMsg(null);
    setLearnerAccountMap({});
    setDirty({});
    setSelectedRows({});
    if (course?.digitalAttendanceId) {
      setDigitalAttendanceId(course.digitalAttendanceId);
    } else {
      setDigitalAttendanceId('');
      if (course?.courseRunId && course?.courseRunCode) {
        fetchDigitalAttendanceId(course.courseRunId, course.courseRunCode);
      }
    }
    if (course?.courseRunCode && course?.courseCode) {
      handleFetchSessions(course.courseRunCode, course.courseCode, course);
      fetchEnrolments(course.courseRunCode, course);
    }
    if (val) {
      fetchManualSessions(val);
      fetchLocalAssignments(val);
    }
  };

  useEffect(() => {
    if (!checkinZoom && !checkinOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (checkinZoom) setCheckinZoom(false); else setCheckinOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkinZoom, checkinOpen]);

  // Admin: fetch ongoing classes once for the dropdown
  useEffect(() => {
    if (!isAdminMode) return;
    const controller = new AbortController();
    setAdminOngoingLoading(true);
    fetch('/api/admin/ongoing-classes?page=0&limit=500&classStatus=ActiveOnly', { signal: controller.signal })
      .then(res => res.json())
      .then(json => {
        if (json?.success && Array.isArray(json.data?.classes)) {
          setAdminOngoingClasses(json.data.classes);
        }
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch ongoing classes:', err); })
      .finally(() => setAdminOngoingLoading(false));
    return () => controller.abort();
  }, [isAdminMode]);

  // Auto-populate from URL query param (e.g. ctrl+click from calendar)
  const urlCourseRunIdHandled = useRef(false);
  useEffect(() => {
    if (!isAdminMode || urlCourseRunIdHandled.current) return;
    const urlCourseRunId = router.query.courseRunId;
    if (urlCourseRunId && typeof urlCourseRunId === 'string') {
      urlCourseRunIdHandled.current = true;
      setAdminInput(urlCourseRunId);
      // Trigger search after state update
      setTimeout(async () => {
        setIsSearching(true);
        setSearchError(null);
        try {
          const res = await fetch(`/api/admin/lookup-course-run?courseRunCode=${encodeURIComponent(urlCourseRunId)}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Course run not found');
          const course = json.data;
          setAdminCourse(course);
          setSelectedCourseRunId(course.courseRunId);
          if (course.digitalAttendanceId) {
            setDigitalAttendanceId(course.digitalAttendanceId);
          } else if (course.courseRunId && course.courseRunCode) {
            fetchDigitalAttendanceId(course.courseRunId, course.courseRunCode);
          }
          if (course.courseRunCode && course.courseCode) {
            setUen(course.uen || '');
            handleFetchSessions(course.courseRunCode, course.courseCode, course);
            fetchEnrolments(course.courseRunCode, course);
          }
          if (course.courseRunId) {
            fetchManualSessions(course.courseRunId);
            fetchAttendanceSummary(course.courseRunId);
            fetchLocalAssignments(course.courseRunId);
          }
        } catch (err: any) {
          setSearchError(err.message || 'Failed to look up course run');
        } finally {
          setIsSearching(false);
        }
      }, 0);
    }
  }, [isAdminMode, router.query.courseRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual Attendance handlers ──

  // Helper: resolve a single trainee's attendance from SSG + DB sources
  const resolveAttendance = (nric: string, ssgPresentNrics: Set<string>, dbMap: Record<string, { isPresent: boolean; reasonOfAbsence: string }>) => {
    const ssgPresent = ssgPresentNrics.has(nric);
    const db = dbMap[nric];
    if (ssgPresent) {
      // SSG is source of truth — present; preserve DB reason only if manually absent
      return { isPresent: true, reasonOfAbsence: '' };
    }
    if (db?.reasonOfAbsence && !db?.isPresent) {
      // Manual absence with reason — respect over SSG absent
      return { isPresent: false, reasonOfAbsence: db.reasonOfAbsence };
    }
    if (db?.isPresent) {
      // Manually marked present in DB
      return { isPresent: true, reasonOfAbsence: '' };
    }
    if (db) {
      // DB has a record but no special flags — use it
      return { isPresent: db.isPresent, reasonOfAbsence: db.reasonOfAbsence || '' };
    }
    // No data at all — default absent
    return { isPresent: false, reasonOfAbsence: '' };
  };

  // Auto-save SSG-confirmed trainees to DB whenever SSG attendance loads
  useEffect(() => {
    if (!selectedManualSession || attendanceRecords.length === 0) return;
    const records = attendanceRecords
      // Trainees only: the trainer's own SSG sign-in is not a learner's attendance
      .filter(r => !/trainer|assessor/i.test(String(r?.trainee?.attendeeType || '')))
      .map(r => ({ nric: r.nric || r.trainee?.id || '', isPresent: (() => { const s = (r.status || '').toLowerCase(); return s === 'confirmed' || s === 'present' || s === 'attended'; })(), reasonOfAbsence: '' }))
      .filter(r => r.nric && r.isPresent);
    if (records.length === 0) return;
    fetch('/api/trainer/attendance-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: selectedManualSession, records }),
    })
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          // Update DB map so display reflects auto-saved values
          setManualAttendanceDbMap(prev => {
            const updated = { ...prev };
            for (const r of records) updated[r.nric] = { isPresent: true, reasonOfAbsence: '' };
            return updated;
          });
        }
      })
      .catch(() => {});
  }, [attendanceRecords, selectedManualSession]);

  // Enrolled rows for Manual Attendance: one per NRIC (cancelled excluded), SSG "present" wins.
  const buildEnrolledRows = (records: any[], ssgRecords: any[], dbMap: DbAttendance): ManualRow[] => {
    const ssgPresentNrics = new Set(
      ssgRecords
        .filter(r => isPresentStatus(r.status))
        .map(r => r.nric || r.trainee?.id || '')
        .filter(Boolean)
    );
    const seen = new Set<string>();
    const rows: ManualRow[] = [];
    for (const item of records) {
      const enrol = item?.enrolment ?? item;
      const status = (enrol?.status || enrol?.enrolmentStatus || '').toLowerCase();
      if (status === 'cancelled') continue;
      const trainee = enrol?.trainee ?? {};
      const nric: string = trainee?.id || trainee?.nric || '';
      if (!nric || seen.has(nric)) continue;
      seen.add(nric);
      const { email, phone } = extractContact(trainee);
      const { isPresent, reasonOfAbsence } = resolveAttendance(nric, ssgPresentNrics, dbMap);
      rows.push({ nric, fullName: trainee?.fullName || trainee?.name || '', email, phone, isPresent, reasonOfAbsence });
    }
    return rows;
  };

  const enrolNricSet = (records: any[]) => new Set(
    records.map((item: any) => {
      const enrol = item?.enrolment ?? item;
      const trainee = enrol?.trainee ?? {};
      return (trainee?.id || trainee?.nric || '').trim();
    }).filter(Boolean)
  );

  // Keep the trainer's unsaved changes when rows are rebuilt from fresh data.
  const keepDirty = (fresh: ManualRow[], prev: ManualRow[]): ManualRow[] => {
    const d = dirtyRef.current;
    if (Object.keys(d).length === 0) return fresh;
    return fresh.map(r => (d[r.nric] ? (prev.find(p => p.nric === r.nric) ?? r) : r));
  };

  // Rebuild manualAttendance + re-filter extraAttendees whenever data changes
  useEffect(() => {
    if (!selectedManualSession || enrolmentRecords.length === 0) return;
    const merged = buildEnrolledRows(enrolmentRecords, attendanceRecords, manualAttendanceDbMap);
    setManualAttendance(prev => keepDirty(merged, prev));
    // Keep only extras whose NRIC is not covered by enrolments
    const enrolNrics = enrolNricSet(enrolmentRecords);
    setExtraAttendees(prev => prev.filter(e => !enrolNrics.has(e.nric)));
  }, [enrolmentRecords, manualAttendanceDbMap, selectedManualSession, attendanceRecords]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync selectedManualSession whenever the top SSG session or manualSessions list changes
  useEffect(() => {
    if (!selectedSession || manualSessions.length === 0) return;
    const matched = manualSessions.find(s => s.ssg_session_id === selectedSession);
    if (matched && matched.id !== selectedManualSession) {
      setSelectedManualSession(matched.id);
      setManualAttendanceMsg(null);
      setManualPage(1);
      fetchManualAttendance(matched.id);
    }
  }, [selectedSession, manualSessions]);

  // No SSG sessions (e.g. the SSG call failed): open the current session from the local list.
  useEffect(() => {
    if (selectedManualSession || isFetchingSessions || sessions.length > 0 || manualSessions.length === 0) return;
    const current = pickCurrentSession(labelSessions(manualSessions.filter(s => !s.deleted)));
    if (current) selectSessionTab(current);
  }, [manualSessions, sessions.length, isFetchingSessions, selectedManualSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const countsFrom = (rows: any[]) => {
    const counts: Record<string, number> = {};
    for (const s of rows) counts[s.id] = Number(s.present_count) || 0;
    return counts;
  };

  const fetchManualSessions = async (courseRunId: string) => {
    setLoadingManualSessions(true);
    setManualSessions([]);
    setSessionCounts({});
    setSelectedManualSession('');
    setManualAttendance([]);
    setManualAttendanceDbMap({});
    setExtraAttendees([]);
    setManualAttendanceMsg(null);
    setDirty({});
    setSelectedRows({});
    try {
      const res = await fetch(`/api/trainer/attendance-sessions?courseRunId=${courseRunId}`);
      const json = await res.json();
      if (json.success && json.data.length > 0) {
        setManualSessions(json.data);
        setSessionCounts(countsFrom(json.data));
        // selectedManualSession is driven by the session tabs via the useEffects above
      }
    } catch { /* silent */ }
    finally { setLoadingManualSessions(false); }
  };

  /** Refresh only the present counts on the session tabs. */
  const refreshSessionCounts = async (courseRunId?: string) => {
    if (!courseRunId) return;
    try {
      const res = await fetch(`/api/trainer/attendance-sessions?courseRunId=${courseRunId}`);
      const json = await res.json();
      if (json.success) setSessionCounts(countsFrom(json.data));
    } catch { /* silent */ }
  };

  const extrasFrom = (dbRecords: any[], enrolNrics: Set<string>): ManualRow[] =>
    dbRecords
      .filter((rec: any) => rec.fullName && rec.nric && !enrolNrics.has(rec.nric))
      .map((rec: any) => ({
        nric: rec.nric, fullName: rec.fullName, email: rec.email || '', phone: '',
        isPresent: rec.isPresent, reasonOfAbsence: rec.reasonOfAbsence || '',
      }));

  const dbMapFrom = (dbRecords: any[]): DbAttendance => {
    const dbMap: DbAttendance = {};
    for (const rec of dbRecords) {
      if (rec.nric) dbMap[rec.nric] = { isPresent: rec.isPresent, reasonOfAbsence: rec.reasonOfAbsence };
    }
    return dbMap;
  };

  const fetchManualAttendance = async (sessionId: string) => {
    // Cancel any in-flight request from a previous class/session
    if (manualAttendanceFetchRef.current) {
      manualAttendanceFetchRef.current.abort();
    }
    const controller = new AbortController();
    manualAttendanceFetchRef.current = controller;

    setLoadingManualAttendance(true);
    setManualAttendanceDbMap({});
    setManualAttendance([]);
    setExtraAttendees([]);
    setDirty({});
    dirtyRef.current = {};
    setSelectedRows({});
    try {
      const res = await fetch(`/api/trainer/attendance-records?sessionId=${sessionId}`, { signal: controller.signal });
      const json = await res.json();
      if (json.success) {
        const dbMap = dbMapFrom(json.data);
        setManualAttendanceDbMap(dbMap);
        // Read the latest enrolments through the setter (this runs from stale closures too)
        setEnrolmentRecords(prev => {
          setExtraAttendees(extrasFrom(json.data, enrolNricSet(prev)));
          if (prev.length > 0) setManualAttendance(buildEnrolledRows(prev, attendanceRecords, dbMap));
          return prev;
        });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') console.error('fetchManualAttendance error:', err);
    } finally {
      setLoadingManualAttendance(false);
    }
  };

  // Learners check in from the Take Attendance QR while the trainer has this page open:
  // pick up new check-ins quietly, keeping any unsaved changes.
  const refreshManualQuiet = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/trainer/attendance-records?sessionId=${sessionId}`);
      const json = await res.json();
      if (!json.success || sessionId !== selectedManualSessionRef.current) return;
      setManualAttendanceDbMap(dbMapFrom(json.data));
      setEnrolmentRecords(prev => {
        const fresh = extrasFrom(json.data, enrolNricSet(prev));
        setExtraAttendees(old => keepDirty(fresh, old));
        return prev;
      });
    } catch { /* silent */ }
  };
  const selectedManualSessionRef = useRef('');
  selectedManualSessionRef.current = selectedManualSession;

  useEffect(() => {
    if (!selectedManualSession) return;
    const runId = selectedCourse?.courseRunId;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible' || savingAttendance) return;
      refreshManualQuiet(selectedManualSession);
      refreshSessionCounts(runId);
    }, checkinOpen ? 8000 : 20000);
    return () => clearInterval(t);
  }, [selectedManualSession, checkinOpen, savingAttendance, selectedCourse?.courseRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDirty = (nrics: string[]) => setDirty(prev => {
    const next = { ...prev };
    for (const n of nrics) if (n) next[n] = true;
    return next;
  });

  /** Set present/absent for some learners (all when nrics is null). */
  const setPresence = (nrics: string[] | null, isPresent: boolean) => {
    const hit = (n: string) => nrics === null || nrics.includes(n);
    const apply = (r: ManualRow) => (hit(r.nric) ? { ...r, isPresent, reasonOfAbsence: isPresent ? '' : r.reasonOfAbsence } : r);
    setManualAttendance(prev => prev.map(apply));
    setExtraAttendees(prev => prev.map(apply));
    markDirty(nrics ?? [...manualAttendance, ...extraAttendees].map(r => r.nric));
  };

  const handleTogglePresent = (nric: string) => {
    const row = [...manualAttendance, ...extraAttendees].find(r => r.nric === nric);
    if (row) setPresence([nric], !row.isPresent);
  };

  const handleReasonChange = (nric: string, value: string) => {
    if (manualAttendance.some(r => r.nric === nric)) {
      setManualAttendance(prev => prev.map(r => r.nric === nric ? { ...r, reasonOfAbsence: value } : r));
    } else {
      setExtraAttendees(prev => prev.map(r => r.nric === nric ? { ...r, reasonOfAbsence: value } : r));
    }
    markDirty([nric]);
  };

  const handleSaveAttendance = async () => {
    if (!selectedManualSession) return;
    const changed = [...manualAttendance, ...extraAttendees].filter(r => dirty[r.nric]);
    if (changed.length === 0) {
      setManualAttendanceMsg({ type: 'success', text: 'No changes to save.' });
      return;
    }
    setSavingAttendance(true);
    setManualAttendanceMsg(null);
    try {
      const records = changed.map(r => ({ nric: r.nric, isPresent: r.isPresent, reasonOfAbsence: r.reasonOfAbsence || '' }));
      const res = await fetch('/api/trainer/attendance-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: selectedManualSession, records }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setManualAttendanceDbMap(prev => {
        const next = { ...prev };
        for (const r of records) next[r.nric] = { isPresent: r.isPresent, reasonOfAbsence: r.isPresent ? '' : r.reasonOfAbsence };
        return next;
      });
      setDirty({});
      dirtyRef.current = {};
      setManualAttendanceMsg({ type: 'success', text: json.message || 'Attendance saved successfully.' });
      refreshSessionCounts(selectedCourse?.courseRunId);
    } catch (err) {
      setManualAttendanceMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save attendance' });
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleAddManualLearner = async () => {
    const { fullName, email, nric } = addLearnerForm;
    if (!fullName.trim() || !email.trim()) {
      setAddLearnerError('Name and email are required.');
      return;
    }
    if (!email.trim().includes('@')) {
      setAddLearnerError('Please enter a valid email address.');
      return;
    }
    // Check for duplicate in current session before doing anything
    const emailLower = email.trim().toLowerCase();
    const alreadyAdded = extraAttendees.some(r => r.email.toLowerCase() === emailLower);
    if (alreadyAdded) {
      setAddLearnerError('This learner has already been added to this session.');
      return;
    }
    setIsAddingLearner(true);
    setAddLearnerError(null);
    const course = selectedCourse;
    try {
      // 1. Create or ensure learner account (handles both new and existing — no duplicate created)
      const accountRes = await fetch('/api/admin/create-learner-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          fullName: fullName.trim(),
          nric: nric.trim() || undefined,
          courseRunId: course?.courseRunId,
          courseId: course?.id,
        }),
      });
      const accountJson = await accountRes.json();
      if (!accountRes.ok) throw new Error(accountJson.message || 'Failed to create account');

      // Use NRIC if provided; otherwise use _uid_ prefix with userId as unique attendance key
      const identifier = nric.trim() || `_uid_${accountJson.userId}`;

      // 2. Add to ALL sessions for this course run (default absent)
      for (const session of manualSessions) {
        await fetch('/api/trainer/attendance-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.id,
            records: [{ nric: identifier, isPresent: false, reasonOfAbsence: '' }],
          }),
        });
      }

      // 3. Add to extraAttendees — use DB name if account already existed
      const displayName = accountJson.fullName || fullName.trim();
      setExtraAttendees(prev => {
        if (prev.some(r => r.nric === identifier)) return prev;
        return [...prev, { nric: identifier, fullName: displayName, email: email.trim(), phone: '', isPresent: false, reasonOfAbsence: '' }];
      });

      setShowAddLearnerModal(false);
      setAddLearnerForm({ fullName: '', email: '', nric: '' });
      setManualPage(1);
    } catch (err) {
      setAddLearnerError(err instanceof Error ? err.message : 'Failed to add learner.');
    } finally {
      setIsAddingLearner(false);
    }
  };

  const handleRemoveLearner = async (nric: string) => {
    if (!selectedManualSession) return;
    setRemovingNric(nric);
    setConfirmRemoveNric(null);
    try {
      const res = await fetch('/api/trainer/manual-learner', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nric, sessionId: selectedManualSession }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove learner');
      // Remove from current session view only
      setExtraAttendees(prev => prev.filter(r => r.nric !== nric));
      setManualAttendance(prev => prev.filter(r => r.nric !== nric));
    } catch (err) {
      setManualAttendanceMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove.' });
    } finally {
      setRemovingNric(null);
    }
  };

  const handleDeleteLearnerFromClass = async () => {
    const course = selectedCourse;
    if (!deleteLearnerNric || !course?.courseRunId) return;
    setIsDeletingFromClass(true);
    setDeleteLearnerError(null);
    try {
      const res = await fetch('/api/trainer/remove-learner-from-class', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nric: deleteLearnerNric, courseRunId: course.courseRunId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove learner');
      setExtraAttendees(prev => prev.filter(r => r.nric !== deleteLearnerNric));
      setManualAttendance(prev => prev.filter(r => r.nric !== deleteLearnerNric));
      setShowDeleteLearnerModal(false);
      setDeleteLearnerNric('');
      setManualPage(1);
    } catch (err) {
      setDeleteLearnerError(err instanceof Error ? err.message : 'Failed to remove learner from class.');
    } finally {
      setIsDeletingFromClass(false);
    }
  };

  const handleFetchSessions = async (ssgRunId: string, courseRefNumber: string, courseObj?: typeof selectedCourse) => {
    setIsFetchingSessions(true);
    setFetchError(null);
    setSessions([]);
    setSelectedSession('');
    try {
      const params = new URLSearchParams({ courseCode: courseRefNumber, courseRunId: ssgRunId });
      if (uen) params.set('uen', uen);
      const response = await fetch(`/api/ssg/courses/runs/${ssgRunId}/sessions?${params}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `Request failed with status ${response.status}`);
      const fetched: Session[] = json.data?.result?.sessions ?? [];
      if (fetched.length === 0) {
        setFetchError('No sessions found for this course run.');
      } else {
        setSessions(fetched);
        // Open the session running now (else the next one; the last one for a past class)
        const current = pickCurrentSession(labelSessions(fetched.map(f => ({
          id: f.id, start_date: f.startDate, start_time: f.startTime, end_time: f.endTime,
        })))) ?? { id: fetched[0].id };
        setSelectedSession(current.id);
        handleFetchAttendance(current.id, courseObj);
        // Sync SSG sessions into course_session table
        const courseRunUuid = courseObj?.courseRunId;
        if (courseRunUuid) {
          fetch('/api/trainer/attendance-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseRunId: courseRunUuid, ssgSessions: fetched }),
          })
            .then(r => r.json())
            .then(result => {
              if (result.success) fetchManualSessions(courseRunUuid);
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch sessions.');
    } finally {
      setIsFetchingSessions(false);
    }
  };

  const canFetch = !!selectedCourse?.courseRunCode && !!selectedCourse?.courseCode && !isFetchingSessions;

  /** Open one session tab: SSG e-attendance (when it is an SSG session) + Manual Attendance. */
  const selectSessionTab = (ms: { id: string; ssg_session_id?: string | null }) => {
    if (ms.id === selectedManualSession) return;
    if (Object.keys(dirtyRef.current).length > 0
      && !window.confirm('You have unsaved attendance changes for this session. Discard them?')) return;
    setManualAttendanceMsg(null);
    setManualPage(1);
    if (ms.ssg_session_id) {
      setSelectedSession(ms.ssg_session_id);
      handleFetchAttendance(ms.ssg_session_id);
      // Set directly too, so the SSG → local session sync effect has nothing to refetch
      setSelectedManualSession(ms.id);
      fetchManualAttendance(ms.id);
    } else {
      setSelectedSession('');
      setAttendanceRecords([]);
      setAttendanceCourseRun(null);
      setSelectedManualSession(ms.id);
      fetchManualAttendance(ms.id);
    }
  };

  const openTakeAttendance = async () => {
    if (!selectedManualSession) return;
    setCheckinOpen(true);
    setCheckinUrl('');
    setCheckinError(null);
    setCheckinCopied(false);
    setCheckinLoading(true);
    try {
      const res = await fetch(`/api/trainer/session-checkin-link?sessionId=${encodeURIComponent(selectedManualSession)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load the check-in QR');
      setCheckinUrl(`${window.location.origin}${json.path}`);
    } catch (err) {
      setCheckinError(err instanceof Error ? err.message : 'Could not load the check-in QR');
    } finally {
      setCheckinLoading(false);
    }
  };

  const fetchDigitalAttendanceId = async (courseRunUuid: string, courseRunCode: string) => {
    setIsFetchingDigitalId(true);
    setDigitalIdError(null);
    try {
      const res = await fetch('/api/trainer/digital-attendance-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunUuid, courseRunCode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch attendance ID');
      setDigitalAttendanceId(json.digitalAttendanceId || '');
    } catch (err) {
      setDigitalIdError(err instanceof Error ? err.message : 'Failed to load links');
    } finally {
      setIsFetchingDigitalId(false);
    }
  };

  const saveManualDaId = async () => {
    if (!selectedCourse?.courseRunId || !manualDaIdInput.trim()) return;
    setIsSavingManualDaId(true);
    setManualDaIdError(null);
    try {
      const res = await fetch('/api/trainer/digital-attendance-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunUuid: selectedCourse.courseRunId, digitalAttendanceId: manualDaIdInput.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setDigitalAttendanceId(json.digitalAttendanceId);
      setDigitalIdError(null);
      setManualDaIdInput('');
    } catch (err) {
      setManualDaIdError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingManualDaId(false);
    }
  };

  const fetchEnrolmentRequests = async (courseRunUuid?: string) => {
    if (!courseRunUuid) { setEnrolmentRequests([]); return; }
    try {
      const res = await fetch(`/api/enrolments/detail-requests?courseRunUuid=${encodeURIComponent(courseRunUuid)}`);
      const json = await res.json();
      if (json.success && courseRunUuid === selectedCourseRunIdRef.current) setEnrolmentRequests(json.data || []);
    } catch { /* silent */ }
  };
  const selectedCourseRunIdRef = useRef('');
  selectedCourseRunIdRef.current = selectedCourseRunId;

  // New SWDA Enrolment submissions arrive while the trainer has the page open
  useEffect(() => {
    setEnrolmentRequests([]);
    if (!selectedCourseRunId) return;
    fetchEnrolmentRequests(selectedCourseRunId);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') fetchEnrolmentRequests(selectedCourseRunId);
    }, 30000);
    return () => clearInterval(t);
  }, [selectedCourseRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchEnrolments = async (courseRunCode: string, courseOverride?: typeof selectedCourse) => {
    fetchEnrolmentRequests((courseOverride ?? selectedCourse)?.courseRunId);
    setIsLoadingEnrolments(true);
    setEnrolmentError(null);
    setEnrolmentRecords([]);
    try {
      const res = await fetch(`/api/enrolments/by-run?courseRunId=${encodeURIComponent(courseRunCode)}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed with status ${res.status}`);
      }
      const json = await res.json();
      const records: any[] = Array.isArray(json.data) ? json.data : [];
      setEnrolmentRecords(records);
      if (records.length > 0) checkLearnerAccounts(records, courseOverride ?? selectedCourse);
    } catch (err) {
      setEnrolmentError(err instanceof Error ? err.message : 'Failed to fetch enrolments.');
    } finally {
      setIsLoadingEnrolments(false);
    }
  };

  const fetchLocalAssignments = async (courseRunId: string) => {
    setIsLoadingLocalAssignments(true);
    setLocalAssignments([]);
    try {
      const res = await fetch(`/api/admin/course-run-enrollments?courseRunId=${encodeURIComponent(courseRunId)}`);
      const json = await res.json();
      if (json.success) {
        setLocalAssignments(json.data);
      }
    } catch { /* silent */ }
    finally {
      setIsLoadingLocalAssignments(false);
    }
  };

  const checkLearnerAccounts = async (records: any[], courseOverride?: typeof selectedCourse) => {
    const emails: string[] = records
      .filter((item: any) => {
        const enrol = item?.enrolment ?? item;
        const status = (enrol?.status || enrol?.enrolmentStatus || '').toLowerCase();
        return status !== 'cancelled';
      })
      .map((item: any) => {
        const enrol = item?.enrolment ?? item;
        const trainee = enrol?.trainee ?? {};
        return trainee?.email?.full || trainee?.email || '';
      })
      .filter(Boolean);
    if (emails.length === 0) return;
    try {
      const res = await fetch('/api/admin/check-learner-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });
      const json = await res.json();
      if (json.success) {
        const map: Record<string, 'exists' | 'missing' | 'creating' | 'done' | 'error'> = {};
        for (const item of json.data) {
          map[item.email.toLowerCase()] = item.exists ? 'exists' : 'missing';
        }
        setLearnerAccountMap(map);

        // Process all enrolments based on status
        const course = courseOverride ?? selectedCourse;
        for (const item of records) {
          const enrol = item?.enrolment ?? item;
          const trainee = enrol?.trainee ?? {};
          const email: string = trainee?.email?.full || trainee?.email || '';
          if (!email) continue;
          const enrolStatus: string = (enrol?.status || enrol?.enrolmentStatus || '').toLowerCase();

          if (enrolStatus === 'cancelled') {
            // Remove learner from the course run if they have an account and enrollment
            if (course?.courseRunId) {
              fetch('/api/admin/remove-enrollment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, courseRunId: course.courseRunId }),
              }).catch(() => { /* silent */ });
            }
            continue;
          }

          // Only process confirmed enrolments for account creation / assignment
          if (enrolStatus !== 'confirmed') continue;
          const accountStatus = map[email.toLowerCase()];
          if (accountStatus === 'creating' || accountStatus === 'done') continue;
          const nric: string = trainee?.id || trainee?.nric || enrol?.nric || '';
          const enrolRef: string = enrol?.referenceNumber || enrol?.enrolmentReferenceNumber || '';
          const enrolmentStatus: string = enrol?.status || '';
          const sponsorshipType: string = trainee?.sponsorshipType || '';
          const enrolmentDate: string = trainee?.enrolmentDate || '';
          const courseReference: string = enrol?.course?.referenceNumber || '';
          const tpCode: string = enrol?.trainingPartner?.code || '';
          const paymentCollectionStatus: string = trainee?.fees?.collectionStatus || '';
          // For both missing AND existing accounts — create-learner-account handles both:
          // - missing: creates account + enrolls
          // - existing: skips creation, runs ensureEnrollment to assign course run if not yet assigned
          await handleCreateLearnerAccount(
            email, trainee?.fullName || trainee?.name || '', nric, enrolRef, course,
            { enrolmentStatus, sponsorshipType, enrolmentDate, courseReference, tpCode, paymentCollectionStatus, rawData: enrol }
          );
        }
      }
    } catch { /* silent */ }
  };

  const fetchAttendanceSummary = async (courseRunId: string) => {
    setLoadingAttendanceSummary(true);
    setAttendanceSummary(null);
    try {
      const res = await fetch(`/api/trainer/attendance-summary?courseRunId=${encodeURIComponent(courseRunId)}`);
      const json = await res.json();
      if (json.success) {
        const byNric: Record<string, number> = {};
        for (const row of json.data) {
          if (row.nric) byNric[row.nric] = row.attendedCount;
        }
        setAttendanceSummary({ totalSessions: json.totalSessions, byNric });
      }
    } catch { /* silent */ }
    finally { setLoadingAttendanceSummary(false); }
  };

  const handleCreateLearnerAccount = async (
    email: string, fullName: string, nric?: string, enrolmentId?: string,
    courseOverride?: typeof selectedCourse,
    extra?: {
      enrolmentStatus?: string; sponsorshipType?: string; enrolmentDate?: string;
      courseReference?: string; tpCode?: string; paymentCollectionStatus?: string; rawData?: any;
    }
  ) => {
    const course = courseOverride ?? selectedCourse;
    const key = email.toLowerCase();
    setLearnerAccountMap(prev => ({ ...prev, [key]: 'creating' }));
    try {
      const res = await fetch('/api/admin/create-learner-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          fullName,
          nric,
          courseRunId: course?.courseRunId,
          courseId: course?.id,
          enrolmentId,
          enrolmentStatus:          extra?.enrolmentStatus || null,
          sponsorshipType:          extra?.sponsorshipType || null,
          enrolmentDate:            extra?.enrolmentDate || null,
          courseReference:          extra?.courseReference || null,
          tpCode:                   extra?.tpCode || null,
          paymentCollectionStatus:  extra?.paymentCollectionStatus || null,
          rawData:                  extra?.rawData || null,
        }),
      });
      const json = await res.json();
      // 'done' = freshly created, 'exists' = account already existed
      setLearnerAccountMap(prev => ({ ...prev, [key]: json.success ? (json.created ? 'done' : 'exists') : 'error' }));
    } catch {
      setLearnerAccountMap(prev => ({ ...prev, [key]: 'error' }));
    }
  };

  const handleFetchAttendance = async (sessionId: string, courseOverride?: typeof selectedCourse) => {
    const course = courseOverride ?? selectedCourse;
    if (!course || !sessionId) return;
    setIsLoadingAttendance(true);
    setAttendanceError(null);
    setAttendanceSuccess(null);
    setAttendanceRecords([]);
    setAttendanceCourseRun(null);
    try {
      const params = new URLSearchParams({
        uen: uen || '',
        courseCode: course.courseCode || '',
        courseRunId: course.courseRunCode || '',
        sessionId,
      });
      // SSG e-attendance changes minute to minute while learners sign in: never serve a cached copy
      params.set('_ts', String(Date.now()));
      const response = await fetch(`/api/ssg/session-attendance?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed ${response.status}: ${text}`);
      }
      const json = await response.json();
      if (!json.success) throw new Error(json.error || 'Failed to fetch attendance');
      const courseRun = json.data?.data?.courseRun ?? json.data?.courseRun ?? null;
      setAttendanceCourseRun(courseRun);
      const matchedSession = courseRun?.sessions?.find((s: any) => s.id === sessionId)
        ?? courseRun?.sessions?.[0]
        ?? null;
      setAttendanceRecords(matchedSession?.attendance ?? []);
      const at = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      setAttendanceSuccess(`E-attendance updated from SSG at ${at}.`);
    } catch (err) {
      setAttendanceError(err instanceof Error ? err.message : 'Failed to fetch attendance.');
    } finally {
      setIsLoadingAttendance(false);
    }
  };

  const attendanceLinkUrl = (type: 'qr' | 'elist') =>
    type === 'qr'
      ? `https://www.myskillsfuture.gov.sg/spface/splogin/select-session?course-run-code=${digitalAttendanceId}`
      : `https://www.myskillsfuture.gov.sg/api/take-attendance/${digitalAttendanceId}`;

  // Auto-select course run when navigating from CourseDetail E-Attendance link
  useEffect(() => {
    if (!pendingAttendanceCourseRunId || coursesLoading || isAdminMode) return;
    // Wait for courses to actually load before trying to match
    if (courses.length === 0) return;
    // Match by courseRunId (UUID) or courseRunCode (display code)
    const course = courses.find(c => c.courseRunId === pendingAttendanceCourseRunId || c.courseRunCode === pendingAttendanceCourseRunId);
    if (course && course.courseRunId) {
      setSelectedCourseRunId(course.courseRunId);
      setSessions([]);
      setSelectedSession('');
      setFetchError(null);
      setAttendanceRecords([]);
      setAttendanceCourseRun(null);
      setEnrolmentRecords([]);
      setEnrolmentError(null);
      setLocalAssignments([]);
      setAttendanceSuccess(null);
      setAttendanceError(null);
      setDigitalIdError(null);
      setManualSessions([]);
      setSelectedManualSession('');
      setManualAttendance([]);
      setManualAttendanceDbMap({});
      setExtraAttendees([]);
      setManualAttendanceMsg(null);
      setLearnerAccountMap({});
      if (course.digitalAttendanceId) {
        setDigitalAttendanceId(course.digitalAttendanceId);
      } else {
        setDigitalAttendanceId('');
        if (course.courseRunId && course.courseRunCode) {
          fetchDigitalAttendanceId(course.courseRunId, course.courseRunCode);
        }
      }
      if (course.courseRunCode && course.courseCode) {
        handleFetchSessions(course.courseRunCode, course.courseCode, course);
        fetchEnrolments(course.courseRunCode, course);
      }
      if (course.courseRunId) {
        fetchManualSessions(course.courseRunId);
        fetchAttendanceSummary(course.courseRunId);
        fetchLocalAssignments(course.courseRunId);
      }
      setPendingAttendanceCourseRunId(null);
    }
  }, [pendingAttendanceCourseRunId, courses, coursesLoading]);

  const assignedLearners = React.useMemo(() => {
    const list: Array<{ nric: string, fullName: string, email: string, source: string }> = [];
    const seen = new Set<string>();

    // 1. Add SSG Confirmed
    for (const item of enrolmentRecords) {
      const enrol = item?.enrolment ?? item;
      const status = (enrol?.status || enrol?.enrolmentStatus || '').toLowerCase();
      if (status !== 'confirmed') continue;

      const trainee = enrol?.trainee ?? {};
      const nric = (trainee?.id || trainee?.nric || enrol?.nric || '').trim();
      const fullName = (trainee?.fullName || trainee?.name || '').trim();
      const email = (trainee?.email?.full || trainee?.email || '').trim();

      const key = (nric || email).toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push({ nric, fullName, email, source: 'SSG (Confirmed)' });
      }
    }

    // 2. Add Local Admin Assignments
    for (const loc of localAssignments) {
      const nric = (loc.nric || '').trim();
      const fullName = (loc.full_name || '').trim();
      const email = (loc.email || '').trim();

      const key = (nric || email).toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push({ nric, fullName, email, source: 'Admin Assignment' });
      }
    }

    return list.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [enrolmentRecords, localAssignments]);

  // Per-session KPIs: SSG e-attendance taken vs active enrolments vs manual "present".
  // All three should be equal once every learner has signed in; the gaps name who is missing.
  const sessionKpis = React.useMemo((): SessionKpiData => {
    const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
    const isPresentStatus = (st: unknown) => ['confirmed', 'present', 'attended'].includes(String(st ?? '').toLowerCase());

    // Confirmed SSG enrolments, one per NRIC (the "Confirmed Enrolments" tile)
    const enrolled = new Map<string, string>();
    for (const item of enrolmentRecords) {
      const enrol = item?.enrolment ?? item;
      const status = String(enrol?.status || enrol?.enrolmentStatus || '').toLowerCase();
      if (status !== 'confirmed') continue;
      const trainee = enrol?.trainee ?? {};
      const nric = norm(trainee?.id || trainee?.nric);
      if (nric && !enrolled.has(nric)) enrolled.set(nric, trainee?.fullName || trainee?.name || nric);
    }

    // SSG e-attendance for the selected session (trainees only)
    const eAttendance = new Set<string>();
    for (const r of attendanceRecords) {
      if (/trainer|assessor/i.test(String(r?.trainee?.attendeeType || ''))) continue;
      if (!isPresentStatus(r?.status)) continue;
      const nric = norm(r?.nric || r?.trainee?.id);
      if (nric) eAttendance.add(nric);
    }

    // Manual attendance "present" for the session (enrolled rows + manually added learners)
    const manualRows = [...manualAttendance, ...extraAttendees];
    const manualPresent = new Set<string>(manualRows.filter(r => r.isPresent).map(r => norm(r.nric)).filter(Boolean));

    const missingEAttendance = [...enrolled].filter(([n]) => !eAttendance.has(n)).map(([, name]) => name).sort();
    const missingManual = [...enrolled].filter(([n]) => !manualPresent.has(n)).map(([, name]) => name).sort();
    return {
      eAttendance: eAttendance.size,
      enrolments: enrolled.size,
      manual: manualPresent.size,
      missingEAttendance,
      missingManual,
      loading: isLoadingAttendance || isLoadingEnrolments || loadingManualAttendance,
    };
  }, [enrolmentRecords, attendanceRecords, manualAttendance, extraAttendees, isLoadingAttendance, isLoadingEnrolments, loadingManualAttendance]);

  // SWDA Enrolment table: SSG enrolments + enrolment-form submissions not on SSG yet (Pending).
  // Display only — Manual Attendance, KPIs and account creation keep using the SSG list.
  const enrolmentTableRows: any[] = (() => {
    const ssgNrics = new Set(enrolmentRecords.map((item: any) => {
      const t = (item?.enrolment ?? item)?.trainee ?? {};
      return String(t?.id || t?.nric || '').trim().toUpperCase();
    }).filter(Boolean));
    // Singapore calendar date: class dates and submit times arrive as UTC timestamps
    const toYmd = (d?: string | null) => {
      if (!d) return '';
      const v = String(d);
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      const dt = new Date(v);
      return isNaN(dt.getTime()) ? v.slice(0, 10) : dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    };
    const fromRequests = enrolmentRequests
      .filter(r => r.status !== 'dismissed' && !ssgNrics.has(String(r.nric || '').toUpperCase()))
      .map(r => ({
        _request: { userId: r.userId },
        enrolment: {
          referenceNumber: r.enrolmentRef || '',
          status: r.status === 'enrolled' ? 'Confirmed' : 'Pending',
          course: { run: { id: selectedCourse?.courseRunCode || '', startDate: toYmd(selectedCourse?.startDate), endDate: toYmd(selectedCourse?.endDate) } },
          trainee: {
            id: r.nric, fullName: r.traineeName, email: { full: r.email }, contactNumber: r.contactNumber,
            sponsorshipType: r.sponsorshipType, employer: r.employerName ? { name: r.employerName } : undefined,
            enrolmentDate: toYmd(r.submittedAt),
          },
        },
      }));
    return [...enrolmentRecords, ...fromRequests];
  })();
  const enrolmentCounts = enrolmentTableRows.reduce((acc, item: any) => {
    const st = String((item?.enrolment ?? item)?.status || (item?.enrolment ?? item)?.enrolmentStatus || '').toLowerCase();
    if (st === 'confirmed') acc.confirmed++;
    else if (st.includes('pending')) acc.pending++;
    else if (st === 'cancelled' || st === 'withdrawn') acc.cancelled++;
    return acc;
  }, { confirmed: 0, pending: 0, cancelled: 0 });

  /** Download the SWDA Enrolment table (SSG enrolments + pending form submissions) as Excel. */
  const downloadEnrolmentsExcel = async () => {
    const XLSX = await import('xlsx');
    const rows = enrolmentTableRows.map((item: any, idx: number) => {
      const enrol = item?.enrolment ?? item;
      const trainee = enrol?.trainee ?? {};
      const run = enrol?.course?.run ?? {};
      const nric: string = trainee?.id || trainee?.nric || enrol?.nric || '';
      return {
        'No.': idx + 1,
        'Course Run ID': run?.id || selectedCourse?.courseRunCode || '',
        'Start Date': run?.startDate || '',
        'End Date': run?.endDate || '',
        'Enrolment Ref': enrol?.referenceNumber || enrol?.enrolmentReferenceNumber || '',
        'Trainee Name': trainee?.fullName || trainee?.name || '',
        // Full NRIC for staff only, as on screen
        'NRIC': isAdminMode ? nric : (nric.length >= 5 ? `${nric[0]}XXXX${nric.slice(-4)}` : nric),
        'Contact Number': extractContact(trainee).phone,
        'Email': trainee?.email?.full || (typeof trainee?.email === 'string' ? trainee.email : '') || '',
        'Sponsorship': trainee?.sponsorshipType || '',
        'Employer': trainee?.employer?.name || '',
        'Enrolment Status': enrol?.status || enrol?.enrolmentStatus || '',
        'Enrolment Date': trainee?.enrolmentDate || '',
        'Source': item?._request ? 'SWDA Enrolment form' : 'SSG',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [5, 14, 12, 12, 20, 32, 12, 16, 32, 13, 28, 16, 14, 20].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SWDA Enrolment');
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    XLSX.writeFile(wb, `SWDA-Enrolment-${selectedCourse?.courseRunCode || 'class'}-${stamp}.xlsx`);
  };

  const labelledSessions = labelSessions(manualSessions.filter(s => !s.deleted));
  // Manual Attendance rows: enrolled learners + manually added / checked-in learners
  const manualEnrolNrics = enrolNricSet(enrolmentRecords);
  const manualRows: ManualRow[] = [...manualAttendance, ...extraAttendees.filter(e => !manualEnrolNrics.has(e.nric))];
  const manualPresent = manualRows.filter(r => r.isPresent).length;
  const manualTotalPages = Math.max(1, Math.ceil(manualRows.length / MANUAL_PAGE_SIZE));
  const pageRows = manualRows.slice((manualPage - 1) * MANUAL_PAGE_SIZE, manualPage * MANUAL_PAGE_SIZE);
  const selectedCount = Object.keys(selectedRows).length;
  const dirtyCount = Object.keys(dirty).length;
  const manualBusy = !selectedManualSession || loadingManualAttendance || isLoadingEnrolments || isLoadingAttendance;
  const selectedSessionLabel = labelledSessions.find(s => s.id === selectedManualSession)?.label || '';

  return (
    <div className="space-y-5">

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-on-surface">E-Attendance</h1>
        <p className="text-sm text-on-surface-secondary mt-0.5">
          {isAdminMode
            ? 'Enter a Course Run ID to look up attendance.'
            : selectedCourse
              ? 'Take attendance session by session and check the class enrolments.'
              : 'Select one of your classes.'}
        </p>
      </div>

      {/* ── Admin: look up a class by Course Run ID ── */}
      {isAdminMode && (
        <div className="bg-surface rounded-lg border border-default shadow-sm">
          <div className="px-4 py-3 border-b border-default">
            <h2 className="text-sm font-semibold text-on-surface">Class Lookup</h2>
          </div>
          <div className="p-4">
            <label className="block text-xs font-medium text-on-surface-secondary mb-1">
              Course Run ID <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[260px] space-y-2">
                <div className="relative">
                  <select
                    value={adminDropdownValue}
                    onChange={e => {
                      const code = e.target.value;
                      setAdminDropdownValue(code);
                      if (code) handleAdminSearch(code);
                    }}
                    disabled={adminOngoingLoading || isSearching}
                    className="input-themed w-full border rounded px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">
                      {adminOngoingLoading
                        ? 'Loading ongoing classes…'
                        : adminOngoingClasses.length === 0
                          ? 'No ongoing classes'
                          : `— Select from ${adminOngoingClasses.length} ongoing class${adminOngoingClasses.length === 1 ? '' : 'es'} —`}
                    </option>
                    {adminOngoingClasses.map(c => (
                      <option key={c.id} value={c.courseRunId}>
                        {c.courseTitle} | {c.courseRunId} ({c.trainerName})
                      </option>
                    ))}
                  </select>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none text-xs">▼</span>
                </div>
                <input
                  type="text"
                  value={adminInput}
                  onChange={e => { setAdminInput(e.target.value); setSearchError(null); setAdminDropdownValue(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdminSearch(); }}
                  placeholder="…or enter a Course Run ID, e.g. 1069549"
                  className="input-themed w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  disabled={isSearching}
                />
                {searchError && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {searchError}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleAdminSearch()}
                disabled={isSearching || !adminInput.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSearching ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Searching...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Search
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Trainer: pick a class (only when none is open, e.g. opened from the sidebar) ── */}
      {!isAdminMode && !selectedCourse && (
        <div className="bg-surface rounded-lg border border-default shadow-sm p-4">
          <label className="block text-xs font-medium text-on-surface-secondary mb-1">
            Class <span className="text-red-500">*</span>
          </label>
          {coursesLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-default rounded text-sm text-muted">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
              Loading classes...
            </div>
          ) : (
            <div className="relative">
              <select
                value={selectedCourseRunId}
                onChange={e => selectTrainerClass(e.target.value)}
                className="input-themed w-full border rounded px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                disabled={isFetchingSessions}
              >
                <option value="" disabled>— Select a class —</option>
                {activeCourses.length > 0 && (
                  <optgroup label="Current & upcoming classes">
                    {activeCourses.map(c => (
                      <option key={c.courseRunId} value={c.courseRunId}>
                        {c.title}{c.courseRunCode ? ` (Run: ${c.courseRunCode})` : ''}{c.startDate ? ` — ${fmtClassDate(c.startDate)}` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {pastCourses.length > 0 && (
                  <optgroup label="Past classes">
                    {pastCourses.map(c => (
                      <option key={c.courseRunId} value={c.courseRunId}>
                        {c.title}{c.courseRunCode ? ` (Run: ${c.courseRunCode})` : ''}{c.startDate ? ` — ${fmtClassDate(c.startDate)}` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none text-xs">▼</span>
            </div>
          )}
        </div>
      )}

      {/* ── Class: fixed header for the open class, with the SSG attendance links ── */}
      {selectedCourse && (
        <div className="bg-surface rounded-xl border border-default shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="text-xs font-semibold text-on-surface-secondary">Class</p>
                <h2 className="text-lg font-semibold text-on-surface mt-0.5">{selectedCourse.title}</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  ['Course Run ID', selectedCourse.courseRunCode],
                  ['Code', selectedCourse.courseCode],
                  ['Start', fmtDay(selectedCourse.startDate)],
                  ['End', fmtDay(selectedCourse.endDate)],
                  ['Trainer', selectedCourse.assignedTrainerName],
                ] as Array<[string, string | null | undefined]>).filter(([, v]) => !!v).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-default bg-surface-elevated text-sm">
                    <span className="text-on-surface-secondary">{k}</span>
                    <span className="font-semibold text-on-surface">{v}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 flex-shrink-0">
              {sourceCourse && !isAdminMode && (
                <button
                  type="button"
                  onClick={handleBackToClass}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-default text-primary hover:bg-surface-elevated transition-colors"
                  title={`Back to ${sourceCourse?.title || 'class'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to Class
                </button>
              )}
              {!sourceCourse && !isAdminMode && (
                <button
                  type="button"
                  onClick={() => selectTrainerClass('')}
                  className="px-3 py-2 text-sm font-medium rounded-lg border border-default text-on-surface-secondary hover:bg-surface-elevated transition-colors"
                >
                  Change class
                </button>
              )}
              {!isAdminMode && (
                <button
                  onClick={() => handleFetchSessions(selectedCourse.courseRunCode!, selectedCourse.courseCode, selectedCourse)}
                  disabled={!canFetch}
                  title="Reload the sessions from SSG"
                  className="flex items-center gap-2 px-3 py-2 border border-default text-on-surface-secondary rounded-lg text-sm font-medium hover:bg-surface-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshIcon className={`w-4 h-4 ${isFetchingSessions ? 'animate-spin' : ''}`} />
                  {isFetchingSessions ? 'Fetching...' : 'Refresh Sessions'}
                </button>
              )}
            </div>
          </div>

          {/* SSG attendance links — per class (digital attendance ID), not per session */}
          <div className="border-t border-default pt-4">
            {isFetchingDigitalId ? (
              <div className="flex items-center gap-2 text-sm text-muted py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                Loading attendance link...
              </div>
            ) : digitalAttendanceId ? (
              <div className="grid gap-3 md:grid-cols-2">
                {(['qr', 'elist'] as const).map(type => (
                  <div key={type}>
                    <p className="text-xs font-medium text-on-surface-secondary mb-1">
                      {type === 'qr' ? 'SSG QR Attendance' : 'SSG E-Attendance List'}
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={attendanceLinkUrl(type)}
                        className="input-themed flex-1 min-w-0 border rounded px-3 py-2 text-sm bg-surface-elevated text-on-surface-secondary focus:outline-none"
                      />
                      <a
                        href={attendanceLinkUrl(type)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors whitespace-nowrap"
                      >
                        <ExternalLinkIcon />
                        Open
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {digitalIdError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {digitalIdError}
                  </p>
                )}
                <button
                  onClick={() => selectedCourse?.courseRunId && selectedCourse?.courseRunCode
                    && fetchDigitalAttendanceId(selectedCourse.courseRunId, selectedCourse.courseRunCode)}
                  disabled={!selectedCourse?.courseRunCode}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-default rounded text-sm text-on-surface-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                >
                  <RefreshIcon className="w-3.5 h-3.5" />
                  Load Attendance Link
                </button>
                {digitalIdError && (
                  <div className="border-t border-default pt-3">
                    <p className="text-xs text-on-surface-secondary mb-2">Or enter the RA code manually:</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={manualDaIdInput}
                        onChange={e => { setManualDaIdInput(e.target.value); setManualDaIdError(null); }}
                        placeholder="e.g. RA740761"
                        className="input-themed flex-1 border rounded px-3 py-1.5 text-sm bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        onClick={saveManualDaId}
                        disabled={isSavingManualDaId || !manualDaIdInput.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
                      >
                        {isSavingManualDaId ? (
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                        ) : null}
                        Save
                      </button>
                    </div>
                    {manualDaIdError && (
                      <p className="text-xs text-red-500 mt-1">{manualDaIdError}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {fetchError && (
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {fetchError}
            </p>
          )}
        </div>
      )}

      {/* ── SWDA Enrolment: SSG enrolments + enrolment-form submissions (Pending), per class — collapsible ── */}
      <div className="bg-surface rounded-lg border border-default shadow-sm">
        <SectionHeader
          title="SWDA Enrolment"
          count={enrolmentTableRows.length > 0 ? enrolmentTableRows.length : undefined}
          badges={enrolmentTableRows.length > 0 ? (
            <div className="flex items-center gap-1.5 text-xs ml-1">
              <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 font-semibold">{enrolmentCounts.confirmed} Confirmed</span>
              <span className="px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500 font-semibold">{enrolmentCounts.pending} Pending</span>
              <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">{enrolmentCounts.cancelled} Cancelled</span>
            </div>
          ) : undefined}
          loading={isLoadingEnrolments}
          right={
            <>
              {enrolmentTableRows.length > 0 && (
                <button
                  onClick={() => { downloadEnrolmentsExcel().catch(err => console.error('Excel download failed:', err)); }}
                  title="Download all enrolments in this table as an Excel file"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated border border-default text-on-surface-secondary rounded text-xs font-medium hover:bg-surface-hover transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Download Excel
                </button>
              )}
              {selectedCourse?.courseRunCode && (
                <button
                  onClick={() => fetchEnrolments(selectedCourse.courseRunCode!)}
                  disabled={isLoadingEnrolments}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated border border-default text-on-surface-secondary rounded text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshIcon className="w-3.5 h-3.5" />
                  Refetch Enrolments
                </button>
              )}
              <CollapseToggle open={enrolmentsOpen} onToggle={() => setEnrolmentsOpen(v => !v)} />
            </>
          }
        />
        {enrolmentsOpen && (<>
        {enrolmentError && (
          <p className="px-4 py-2 text-xs text-red-500 flex items-center gap-1.5 border-b border-default">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {enrolmentError}
          </p>
        )}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-elevated border-b border-default">
            <tr>
              <th className="px-3 py-3 text-center font-semibold text-on-surface-secondary w-10 whitespace-nowrap">No.</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Course Run ID</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Start Date</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">End Date</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Enrolment Ref</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Trainee Name</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">
                <div className="flex items-center gap-2">
                  NRIC
                  {isAdminMode && (
                    <button onClick={() => setShowEnrolNric(v => !v)} className="text-xs font-normal text-primary hover:underline">
                      {showEnrolNric ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              </th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">
                <div className="flex items-center gap-2">
                  Contact Number
                  <button onClick={() => setShowEnrolContact(v => !v)} className="text-xs font-normal text-primary hover:underline">
                    {showEnrolContact ? 'Hide' : 'Show'}
                  </button>
                </div>
              </th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Email</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Sponsorship</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Employer</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Enrolment Status</th>
              {/* <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Payment</th> */}
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Enrolment Date</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Account</th>
              {/* <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Total Attendance Taken</th> */}
            </tr>
          </thead>
          <tbody>
            {isLoadingEnrolments ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="border-b border-default">
                  {Array.from({ length: 15 }).map((__, col) => (
                    <td key={col} className="px-3 py-3">
                      <div className="h-3 rounded bg-surface-elevated animate-pulse" style={{ width: col === 5 ? '70%' : '50%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : enrolmentTableRows.length > 0 ? (
              enrolmentTableRows.map((item: any, idx: number) => {
                const enrol = item?.enrolment ?? item;
                const trainee = enrol?.trainee ?? {};
                const run = enrol?.course?.run ?? {};
                const nric: string = trainee?.id || trainee?.nric || enrol?.nric || '';
                const maskedNric = nric.length >= 5 ? `${nric[0]}XXXX${nric.slice(-4)}` : nric;
                return (
                  <tr key={idx} className="border-b border-default hover:bg-surface-elevated transition-colors">
                    <td className="px-3 py-3 text-center text-on-surface-secondary">{idx + 1}</td>
                    <td className="px-3 py-3 text-on-surface-secondary font-mono whitespace-nowrap">{run?.id || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{run?.startDate || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{run?.endDate || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{enrol?.referenceNumber || enrol?.enrolmentReferenceNumber || '—'}</td>
                    <td className="px-3 py-3 font-medium text-on-surface whitespace-nowrap">{trainee?.fullName || trainee?.name || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary font-mono whitespace-nowrap">{nric ? (showEnrolNric ? nric : maskedNric) : '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{(() => {
                      const c = trainee?.contactNumber || trainee?.phone || trainee?.mobileNumber || trainee?.mobile;
                      if (!c) return '—';
                      let full: string;
                      if (typeof c === 'object') {
                        const parts = [c.countryCode, c.areaCode, c.phoneNumber].filter(Boolean);
                        full = parts.join(' ') || '—';
                      } else {
                        full = String(c);
                      }
                      if (!showEnrolContact) {
                        return full.length > 4 ? `${'•'.repeat(full.length - 4)}${full.slice(-4)}` : '••••';
                      }
                      return full;
                    })()}</td>
                    <td className="px-3 py-3 text-on-surface-secondary">{trainee?.email?.full || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{trainee?.sponsorshipType || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{trainee?.employer?.name || '—'}</td>
                    <td className="px-3 py-3"><StatusBadge value={enrol?.status || enrol?.enrolmentStatus || '—'} /></td>
                    {/* <td className="px-3 py-3"><StatusBadge value={trainee?.fees?.collectionStatus || '—'} /></td> */}
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{trainee?.enrolmentDate || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{item?._request ? (
                      item._request.userId ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400" title="Registered on the class from the SWDA Enrolment form">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          Registered
                        </span>
                      ) : <span className="text-muted text-xs">—</span>
                    ) : (() => {
                      const email: string = trainee?.email?.full || trainee?.email || '';
                      if (!email) return <span className="text-muted text-xs">—</span>;
                      const enrolStatus: string = (enrol?.status || enrol?.enrolmentStatus || '').toLowerCase();
                      if (enrolStatus === 'cancelled') return <span className="text-muted text-xs">—</span>;
                      const status = learnerAccountMap[email.toLowerCase()];
                      if (status === 'exists') return (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          Active
                        </span>
                      );
                      if (status === 'done') return (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          Created
                        </span>
                      );
                      if (status === 'creating') return (
                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary" />
                          Creating...
                        </span>
                      );
                      const enrolRef: string = enrol?.referenceNumber || enrol?.enrolmentReferenceNumber || '';
                      if (status === 'error') return (
                        <button onClick={() => handleCreateLearnerAccount(email, trainee?.fullName || trainee?.name || '', nric, enrolRef)} className="text-xs text-red-500 hover:underline">
                          Retry
                        </button>
                      );
                      if (status === 'missing') return (
                        <button onClick={() => handleCreateLearnerAccount(email, trainee?.fullName || trainee?.name || '', nric, enrolRef)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-primary text-white rounded hover:bg-primary-hover transition-colors">
                          Create Account
                        </button>
                      );
                      return <div className="h-3 w-20 rounded bg-surface-elevated animate-pulse" />;
                    })()}</td>
                    {/* Total Attendance Taken column hidden */}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={15} className="px-3 py-10 text-center text-sm text-muted italic">
                  {selectedCourseRunId ? 'No enrolment records found.' : 'Select a class to load enrolments.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>{/* end overflow-x-auto */}
        </>)}
      </div>

      {/* Take Attendance: the check-in QR of the selected session */}
      {checkinOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setCheckinOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="take-attendance-title"
            className="relative w-full max-w-md rounded-2xl border border-default bg-surface shadow-2xl p-6 text-center space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="take-attendance-title" className="text-2xl font-bold text-on-surface">Take Attendance</h3>
            <p className="text-lg font-semibold text-blue-400">{selectedSessionLabel}</p>
            <p className="text-sm text-on-surface-secondary">
              Learners scan this to check in for this session — no login. A learner not yet in this class is registered
              automatically on their first check-in. From the next session their phone number alone fills in their details.
            </p>
            <p className="text-xs text-amber-500">This marks Manual Attendance in the LMS. Learners still take SSG e-attendance with the SSG QR code.</p>
            <div className="flex justify-center">
              {checkinLoading ? (
                <div className="w-64 h-64 rounded-xl bg-white flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
              ) : checkinError ? (
                <p className="text-sm text-red-500 py-10">{checkinError}</p>
              ) : checkinUrl ? (
                <button type="button" onClick={() => setCheckinZoom(true)} title="Show full screen" className="bg-white p-4 rounded-xl cursor-zoom-in">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrSrc(checkinUrl, 600)} alt={`Check-in QR code for ${selectedSessionLabel}`} width={240} height={240} />
                </button>
              ) : null}
            </div>
            {checkinUrl && (
              <input
                type="text"
                readOnly
                value={checkinUrl}
                aria-label="Check-in link"
                onFocus={e => e.target.select()}
                className="input-themed w-full border rounded-lg px-3 py-2 text-sm bg-surface-elevated text-on-surface-secondary focus:outline-none"
              />
            )}
            <div className="flex justify-center gap-3">
              <button
                type="button"
                disabled={!checkinUrl}
                onClick={() => navigator.clipboard?.writeText(checkinUrl).then(() => { setCheckinCopied(true); setTimeout(() => setCheckinCopied(false), 2000); }).catch(() => {})}
                className="px-4 py-2 rounded-lg border border-default text-sm font-medium text-on-surface hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                {checkinCopied ? 'Copied' : 'Copy link'}
              </button>
              <button
                type="button"
                disabled={!checkinUrl}
                onClick={() => setCheckinZoom(true)}
                className="px-4 py-2 rounded-lg border border-default text-sm font-medium text-on-surface hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                Full screen
              </button>
              <button
                type="button"
                onClick={() => setCheckinOpen(false)}
                className="px-4 py-2 rounded-lg border border-blue-500 text-sm font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {checkinZoom && checkinUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Check-in QR code full screen"
          onClick={() => setCheckinZoom(false)}
          className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center gap-4 p-6 cursor-zoom-out"
        >
          <button
            type="button"
            onClick={() => setCheckinZoom(false)}
            className="absolute top-4 right-4 p-2 rounded-full text-white bg-white/10 hover:bg-white/25 transition-colors"
            aria-label="Close full screen QR code"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <h2 className="text-2xl md:text-4xl font-bold text-white text-center">Take Attendance</h2>
          <p className="text-lg md:text-2xl font-semibold text-blue-300 text-center">{selectedSessionLabel}</p>
          <div className="bg-white p-4 md:p-6 rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc(checkinUrl, 1000)} alt={`Check-in QR code for ${selectedSessionLabel}`} style={{ width: 'min(68vh, 86vw)', height: 'min(68vh, 86vw)', imageRendering: 'pixelated' }} />
          </div>
          {selectedCourse?.courseRunCode && <p className="text-base md:text-xl text-white font-medium">Class {selectedCourse.courseRunCode}</p>}
          <p className="text-xs md:text-sm text-gray-300 break-all text-center">{checkinUrl}</p>
        </div>
      )}

      {/* ── Manual Attendance Taking: session tabs + Take Attendance QR, then the selected session's roster
           (QR check-ins and SSG e-attendance land here too) ── */}
      <div className="bg-surface rounded-xl border border-default shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-2 flex-1 min-w-0">
            {labelledSessions.length > 0 ? labelledSessions.map(s => {
              const active = s.id === selectedManualSession;
              const count = sessionCounts[s.id] || 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSessionTab(s)}
                  aria-pressed={active}
                  className={`px-4 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-default text-on-surface-secondary hover:bg-surface-elevated'
                  }`}
                >
                  {s.label}
                  {count > 0 && (
                    <span className={`ml-2 ${active ? 'text-blue-100' : 'text-blue-400'}`}>({count}✓)</span>
                  )}
                </button>
              );
            }) : (
              <p className="text-sm text-muted italic py-2">
                {!selectedCourse
                  ? 'Select a class to see its sessions.'
                  : isFetchingSessions || loadingManualSessions ? 'Loading sessions…' : 'No sessions found for this class.'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={openTakeAttendance}
            disabled={!selectedManualSession}
            title="Show the check-in QR code for this session"
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2z" />
            </svg>
            Take Attendance
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="px-3 py-1 rounded-full bg-green-500/15 text-green-500 font-semibold">Present: {manualPresent}</span>
            <span className="px-3 py-1 rounded-full bg-red-500/15 text-red-400 font-semibold">Absent: {manualRows.length - manualPresent}</span>
            <span className="px-3 py-1 rounded-full bg-gray-500/15 text-on-surface-secondary font-semibold">Total: {manualRows.length}</span>
            {(loadingManualSessions || loadingManualAttendance || isLoadingEnrolments || isLoadingAttendance) && (
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-primary ml-1" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdminMode && (
              <button onClick={() => setShowManualNric(v => !v)} className="text-xs text-primary hover:underline px-1">
                {showManualNric ? 'Hide NRIC' : 'Show NRIC'}
              </button>
            )}
            {extraAttendees.length > 0 && (
              <button
                onClick={() => { setShowDeleteLearnerModal(true); setDeleteLearnerNric(''); setDeleteLearnerError(null); }}
                disabled={manualBusy}
                className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-red-500/60 text-red-400 hover:bg-red-500/10"
              >
                Remove Learner
              </button>
            )}
            <button
              onClick={() => { setPresence(Object.keys(selectedRows), true); setSelectedRows({}); }}
              disabled={manualBusy || selectedCount === 0}
              title="Mark the ticked learners present"
              className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
            >
              Mark Present
            </button>
            <button
              onClick={() => { setPresence(Object.keys(selectedRows), false); setSelectedRows({}); }}
              disabled={manualBusy || selectedCount === 0}
              title="Mark the ticked learners absent"
              className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
            >
              Mark Absent
            </button>
            <button
              onClick={() => setPresence(null, true)}
              disabled={manualBusy || manualRows.length === 0}
              title="Mark all learners present"
              className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-blue-500 text-blue-400 font-semibold hover:bg-blue-500/10"
            >
              All Present
            </button>
            <button
              onClick={() => { setShowAddLearnerModal(true); setAddLearnerError(null); setAddLearnerForm({ fullName: '', email: '', nric: '' }); }}
              disabled={manualBusy}
              className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-default text-on-surface hover:bg-surface-elevated"
            >
              + Add Learner
            </button>
          </div>
        </div>
        </div>

        {/* Add Learner Modal */}
        {showAddLearnerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddLearnerModal(false)}>
            <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <button onClick={() => setShowAddLearnerModal(false)} className="absolute top-3 right-3 p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">Add Learner Manually</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">For learners who are <span className="font-semibold text-gray-700 dark:text-gray-300">not enrolled</span> in this class but are physically present.</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">An account will be created (if needed) and the learner will be added to all sessions for manual attendance tracking.</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={addLearnerForm.fullName}
                    onChange={e => setAddLearnerForm(f => ({ ...f, fullName: e.target.value }))}
                    placeholder="e.g. John Tan"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Email Address <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    value={addLearnerForm.email}
                    onChange={e => setAddLearnerForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="e.g. john@example.com"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">NRIC <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={addLearnerForm.nric}
                    onChange={e => setAddLearnerForm(f => ({ ...f, nric: e.target.value }))}
                    placeholder="e.g. S1234567A"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">Leave blank if NRIC is not available.</p>
                </div>
                {addLearnerError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    {addLearnerError}
                  </p>
                )}
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowAddLearnerModal(false)} className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleAddManualLearner}
                  disabled={isAddingLearner}
                  className="flex-1 px-3 py-2 text-sm bg-primary text-white rounded font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                  {isAddingLearner ? 'Adding...' : 'Add Learner'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Remove Learner from Class Modal */}
        {showDeleteLearnerModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteLearnerModal(false)}>
            <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <button onClick={() => setShowDeleteLearnerModal(false)} className="absolute top-3 right-3 p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">Remove Learner from Class</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Removes the learner's attendance across <span className="font-semibold text-gray-700 dark:text-gray-300">all sessions</span> and their enrolment for this class. Their account will not be deleted.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Select Learner <span className="text-red-500">*</span></label>
                  <select
                    value={deleteLearnerNric}
                    onChange={e => setDeleteLearnerNric(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-400/30 focus:border-red-400"
                  >
                    <option value="">— Select a learner —</option>
                    {extraAttendees.map(r => (
                      <option key={r.nric} value={r.nric}>
                        {r.fullName || r.nric}
                      </option>
                    ))}
                    {extraAttendees.length === 0 && (
                      <option disabled value="">No manually added learners</option>
                    )}
                  </select>
                </div>
                {deleteLearnerError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    {deleteLearnerError}
                  </p>
                )}
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowDeleteLearnerModal(false)} className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleDeleteLearnerFromClass}
                  disabled={!deleteLearnerNric || isDeletingFromClass}
                  className="flex-1 px-3 py-2 text-sm bg-red-500 text-white rounded font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeletingFromClass ? 'Removing...' : 'Remove from Class'}
                </button>
              </div>
            </div>
          </div>
        )}

        {(<>
        {/* Feedback banner */}
        {manualAttendanceMsg && (
          <div className={`px-4 py-2 text-xs border-b border-default ${manualAttendanceMsg.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
            {manualAttendanceMsg.text}
          </div>
        )}

        {/* Attendance table */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-default">
            <tr className="text-xs uppercase tracking-wider">
              <th className="px-5 py-2.5 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all learners on this page"
                  checked={pageRows.length > 0 && pageRows.every(r => selectedRows[r.nric])}
                  onChange={e => setSelectedRows(prev => {
                    const next = { ...prev };
                    for (const r of pageRows) { if (e.target.checked) next[r.nric] = true; else delete next[r.nric]; }
                    return next;
                  })}
                  disabled={pageRows.length === 0}
                  className="w-4 h-4 rounded border-default accent-primary cursor-pointer"
                />
              </th>
              <th className="px-3 py-2.5 text-left font-semibold text-on-surface-secondary w-10">#</th>
              <th className="px-3 py-2.5 text-left font-semibold text-on-surface-secondary">Learner</th>
              <th className="px-3 py-2.5 text-left font-semibold text-on-surface-secondary">Email</th>
              <th className="px-3 py-2.5 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Attendance</th>
              <th className="px-3 py-2.5 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Reason of Absence</th>
              <th className="px-3 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {!selectedCourseRunId ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted italic">Select a class to take attendance.</td></tr>
            ) : !selectedManualSession ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted italic">{manualSessions.length === 0 ? 'No sessions found for this class.' : 'Select a session above.'}</td></tr>
            ) : loadingManualAttendance || isLoadingEnrolments || isLoadingAttendance ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <tr key={idx} className="border-b border-default">
                  {Array.from({ length: 7 }).map((__, col) => (
                    <td key={col} className="px-3 py-3">
                      <div className="h-3 rounded bg-surface-elevated animate-pulse" style={{ width: col === 2 ? '60%' : '40%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : manualRows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted italic">No learners yet. Learners appear here when they enrol or check in with the Take Attendance QR, or use &quot;Add Learner&quot;.</td></tr>
            ) : (
              pageRows.map((record, idx) => {
                const globalIdx = (manualPage - 1) * MANUAL_PAGE_SIZE + idx;
                const nric: string = record.nric || '';
                const isExtra = !manualAttendance.some(r => r.nric === nric);
                const isUidKey = nric.startsWith('_uid_');
                const shownNric = isUidKey ? '' : (showManualNric ? nric : (nric.length >= 5 ? `${nric[0]}XXXX${nric.slice(-4)}` : nric));
                return (
                  <tr key={nric || globalIdx} className={`border-b border-default hover:bg-surface-elevated transition-colors ${selectedRows[nric] ? 'bg-blue-500/5' : ''}`}>
                    <td className="px-5 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${record.fullName || 'learner'}`}
                        checked={!!selectedRows[nric]}
                        onChange={() => setSelectedRows(prev => {
                          const next = { ...prev };
                          if (next[nric]) delete next[nric]; else next[nric] = true;
                          return next;
                        })}
                        className="w-4 h-4 rounded border-default accent-primary cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 text-on-surface-secondary">{globalIdx + 1}</td>
                    <td className="px-3 py-2 text-on-surface">
                      <div className="flex items-center gap-1.5 font-medium">
                        {record.fullName || '—'}
                        {isExtra && <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium">Manual</span>}
                        {dirty[nric] && <span className="text-xs text-amber-500" title="Not saved yet">•</span>}
                      </div>
                      {showManualNric && shownNric && <div className="text-xs text-muted font-mono">{shownNric}</div>}
                    </td>
                    <td className="px-3 py-2 text-on-surface-secondary">
                      <div>{record.email || '—'}</div>
                      {record.phone && <div className="text-xs text-muted">{record.phone}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={record.isPresent}
                          onChange={() => handleTogglePresent(nric)}
                          className="w-4 h-4 rounded border-default accent-primary cursor-pointer"
                        />
                        <span className={`text-sm font-medium ${record.isPresent ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                          {record.isPresent ? 'Present' : 'Absent'}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      {!record.isPresent && (
                        <input
                          type="text"
                          value={record.reasonOfAbsence}
                          onChange={e => handleReasonChange(nric, e.target.value)}
                          placeholder="Enter reason..."
                          className="input-themed w-full min-w-[12rem] max-w-sm border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isExtra && (
                        confirmRemoveNric === nric ? (
                          <div className="flex items-center gap-1 justify-center">
                            <button
                              onClick={() => handleRemoveLearner(nric)}
                              disabled={removingNric === nric}
                              className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                              {removingNric === nric ? '...' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmRemoveNric(null)}
                              className="text-xs px-2 py-1 border border-default rounded text-on-surface-secondary hover:bg-surface-elevated transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRemoveNric(nric)}
                            title="Remove from this session"
                            aria-label={`Remove ${record.fullName || 'learner'} from this session`}
                            className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>

        {/* Pagination + Save button */}
        {manualRows.length > 0 && selectedManualSession && (
          <div className="px-4 py-3 border-t border-default flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">
                {(manualPage - 1) * MANUAL_PAGE_SIZE + 1}–{Math.min(manualPage * MANUAL_PAGE_SIZE, manualRows.length)} of {manualRows.length}
              </span>
              <button
                onClick={() => setManualPage(p => Math.max(1, p - 1))}
                disabled={manualPage === 1}
                className="px-2 py-1 text-xs border border-default rounded text-on-surface-secondary hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ‹ Prev
              </button>
              {Array.from({ length: manualTotalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setManualPage(p)}
                  className={`px-2.5 py-1 text-xs border rounded transition-colors ${p === manualPage ? 'bg-primary text-white border-primary' : 'border-default text-on-surface-secondary hover:bg-surface-elevated'}`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setManualPage(p => Math.min(manualTotalPages, p + 1))}
                disabled={manualPage === manualTotalPages}
                className="px-2 py-1 text-xs border border-default rounded text-on-surface-secondary hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next ›
              </button>
            </div>
            <div className="flex items-center gap-3">
              {dirtyCount > 0 && <span className="text-xs text-amber-500">{dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}</span>}
              <button
                onClick={handleSaveAttendance}
                disabled={savingAttendance || manualBusy || dirtyCount === 0}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingAttendance ? 'Saving...' : 'Save Attendance'}
              </button>
            </div>
          </div>
        )}
        </>)}
      </div>

      {/* ── SSG e-attendance check for the selected session: three KPIs that should match ── */}
      {selectedSession && (
      <div className="bg-surface rounded-xl border border-default shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-on-surface">
            SSG E-Attendance Check{selectedSessionLabel && <span className="font-normal text-on-surface-secondary"> · {selectedSessionLabel}</span>}
          </h2>
          <button
            type="button"
            onClick={() => handleFetchAttendance(selectedSession)}
            disabled={isLoadingAttendance}
            title="Fetch the latest e-attendance for this session from SSG"
            className="flex items-center gap-1.5 px-3 py-2 border border-default text-on-surface-secondary rounded-lg text-sm font-medium hover:bg-surface-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshIcon className={`w-4 h-4 ${isLoadingAttendance ? 'animate-spin' : ''}`} />
            {isLoadingAttendance ? 'Refreshing...' : 'Refresh E-Attendance'}
          </button>
        </div>
        {/* Per-session KPIs — the three numbers should match */}
        <SessionKpis kpis={sessionKpis} />

        {attendanceError && (
          <p className="text-sm text-red-500 flex items-center gap-1.5">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {attendanceError}
          </p>
        )}
        {attendanceSuccess && !attendanceError && (
          <p className="text-sm text-green-600 flex items-center gap-1.5">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {attendanceSuccess}
          </p>
        )}
      </div>
      )}

      {/* ── Course Session Attendance (SSG QR / e-attendance records) ── */}
      <div className="bg-surface rounded-lg border border-default shadow-sm">
        <SectionHeader
          title="Course Session Attendance"
          count={attendanceRecords.length > 0 ? attendanceRecords.length : undefined}
          loading={isLoadingAttendance}
          right={
            <>
              {selectedSession && (
                <button
                  onClick={() => handleFetchAttendance(selectedSession)}
                  disabled={isLoadingAttendance}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated border border-default text-on-surface-secondary rounded text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshIcon className="w-3.5 h-3.5" />
                  Refetch Attendance
                </button>
              )}
              <CollapseToggle open={sessionAttendanceOpen} onToggle={() => setSessionAttendanceOpen(v => !v)} />
            </>
          }
        />
        {sessionAttendanceOpen && (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-elevated border-b border-default">
            <tr>
              <th className="px-3 py-3 text-center font-semibold text-on-surface-secondary w-10 whitespace-nowrap">No.</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Name</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">
                <div className="flex items-center gap-2">
                  NRIC
                  {isAdminMode && (
                    <button onClick={() => setShowNric(v => !v)} className="text-xs font-normal text-primary hover:underline">
                      {showNric ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              </th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Email</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Phone</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Type</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Status</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Entry Mode</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">TRAQOM</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingAttendance ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="border-b border-default">
                  {Array.from({ length: 9 }).map((__, col) => (
                    <td key={col} className="px-3 py-3">
                      <div className="h-3 rounded bg-surface-elevated animate-pulse" style={{ width: col === 1 ? '70%' : '50%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : attendanceRecords.length > 0 ? (
              attendanceRecords.map((record: any, idx: number) => {
                const nric: string = record.nric || record.trainee?.id || '';
                const enrolMatch = enrolmentRecords.find((item: any) => {
                  const t = (item?.enrolment ?? item)?.trainee ?? {};
                  return (t?.id || t?.nric) === nric;
                });
                const enrolTrainee = enrolMatch ? ((enrolMatch?.enrolment ?? enrolMatch)?.trainee ?? {}) : {};
                const inline = extractContact(record.trainee);
                const looked = extractContact(enrolTrainee);
                const email = inline.email || looked.email || '—';
                const phone = inline.phone || looked.phone || '—';
                return (
                  <tr key={idx} className="border-b border-default hover:bg-surface-elevated transition-colors">
                    <td className="px-3 py-3 text-center text-on-surface-secondary">{idx + 1}</td>
                    <td className="px-3 py-3 font-medium text-on-surface whitespace-nowrap">{record.trainee?.name || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary font-mono whitespace-nowrap">
                      {nric
                        ? (showNric ? nric : (nric.length >= 5 ? `${nric[0]}XXXX${nric.slice(-4)}` : nric))
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{email}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{phone}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{record.trainee?.attendeeType || '—'}</td>
                    <td className="px-3 py-3"><StatusBadge value={record.status || '—'} /></td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{record.entryMode || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{record.sentToTraqom || '—'}</td>
                  </tr>
                );
              })
            ) : attendanceCourseRun ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted italic">
                  No attendance records found for this session.
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted italic">
                  Select a class and session to load attendance.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        )}
      </div>

    </div>
  );
};

export default TrainerAttendanceDashboard;
