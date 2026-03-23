import React, { useState, useEffect, useRef } from 'react';
import { useLms } from '../../contexts/LmsContext';
import { useTrainerCourses } from '../../hooks/useTrainerCourses';

interface Session {
  id: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  modeOfTraining: string;
}

const formatSessionLabel = (session: Session): string => {
  const d = session.startDate;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatted = d.length === 8
    ? `${d.slice(6, 8)} ${months[parseInt(d.slice(4, 6), 10) - 1]} ${d.slice(0, 4)}`
    : d;
  // Extract just the session suffix (e.g. "S1") from the full session ID
  const sessionSuffix = session.id.split('-').pop() || '';
  return `${sessionSuffix} · ${formatted} ${session.startTime}–${session.endTime}`;
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

const QrCodePanel: React.FC<{ title: string; description: string; imageSrc: string }> = ({ title, description, imageSrc }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="flex flex-col items-start gap-3">
        <p className="text-xs text-on-surface-secondary">{description}</p>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} />
            <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} />
            <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 14h.01M14 17h3M17 14v3M20 14h.01M20 17h.01" />
          </svg>
          Show QR Code
        </button>
      </div>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 max-w-sm w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center -mt-2">{description}</p>

            <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-inner">
              <img
                src={imageSrc}
                alt={`${title} QR Code`}
                className="w-64 h-64 object-contain"
              />
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500">Tap outside or press × to close</p>
          </div>
        </div>
      )}
    </>
  );
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

const SectionHeader: React.FC<{ title: string; count?: number; right?: React.ReactNode; loading?: boolean; info?: string; infoContent?: React.ReactNode }> = ({ title, count, right, loading, info, infoContent }) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-default">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-on-surface">{title}</h2>
      {count !== undefined && (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          {count}
        </span>
      )}
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

const TrainerAttendanceDashboard: React.FC<{ isAdminMode?: boolean }> = ({ isAdminMode = false }) => {
  const { currentUser, pendingAttendanceCourseRunId, setPendingAttendanceCourseRunId } = useLms();
  const { courses, loading: coursesLoading } = useTrainerCourses(isAdminMode ? undefined : currentUser?.id, false);

  // Admin-mode course run lookup
  const [adminInput, setAdminInput]             = useState('');
  const [isSearching, setIsSearching]           = useState(false);
  const [searchError, setSearchError]           = useState<string | null>(null);
  const [adminCourse, setAdminCourse]           = useState<any | null>(null);

  const [uen, setUen] = useState('');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [sessions, setSessions]                        = useState<Session[]>([]);
  const [selectedSession, setSelectedSession]          = useState('');
  const [isFetchingSessions, setIsFetchingSessions]    = useState(false);
  const [fetchError, setFetchError]                    = useState<string | null>(null);

  const [activeTab, setActiveTab]                      = useState<'qr' | 'elist' | 'traqom' | 'cert'>('qr');

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
  const [learnerAccountMap, setLearnerAccountMap]      = useState<Record<string, 'exists' | 'missing' | 'creating' | 'done' | 'error'>>({});
  const [attendanceSummary, setAttendanceSummary]      = useState<{ totalSessions: number; byNric: Record<string, number> } | null>(null);
  const [loadingAttendanceSummary, setLoadingAttendanceSummary] = useState(false);

  // Manual Attendance state
  const [manualSessions, setManualSessions]            = useState<any[]>([]);
  const [selectedManualSession, setSelectedManualSession] = useState('');
  const [manualAttendance, setManualAttendance]        = useState<any[]>([]);
  // Raw DB attendance map keyed by NRIC — merged with enrolmentRecords to build manualAttendance
  const [manualAttendanceDbMap, setManualAttendanceDbMap] = useState<Record<string, { isPresent: boolean; reasonOfAbsence: string }>>({});
  const [loadingManualSessions, setLoadingManualSessions] = useState(false);
  const [loadingManualAttendance, setLoadingManualAttendance] = useState(false);
  const [savingAttendance, setSavingAttendance]        = useState(false);
  const [manualAttendanceMsg, setManualAttendanceMsg]  = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showManualNric, setShowManualNric]             = useState(false);
  const [manualPage, setManualPage]                    = useState(1);
  const MANUAL_PAGE_SIZE = 5;
  const manualAttendanceFetchRef = useRef<AbortController | null>(null);
  // Manually added learners (not in SSG enrolments)
  const [extraAttendees, setExtraAttendees]            = useState<Array<{ nric: string; fullName: string; email: string; isPresent: boolean; reasonOfAbsence: string }>>([]);
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

  // API already filters to upcoming classes (today → today+7, not ended); just sort
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activeCourses = courses
    .filter(c => !c.endDate || new Date(c.endDate) >= today)
    .sort((a, b) => {
      const aTime = new Date(a.startDate ?? '').getTime();
      const bTime = new Date(b.startDate ?? '').getTime();
      return aTime - bTime;
    });

  const selectedCourse = isAdminMode
    ? adminCourse
    : (courses.find(c => c.courseRunId === selectedCourseRunId) ?? null);

  useEffect(() => {
    fetch('/api/training-provider/uen')
      .then(r => r.json())
      .then(d => { if (d.uen) setUen(d.uen); })
      .catch(() => {});
  }, []);

  const handleAdminSearch = async () => {
    const code = adminInput.trim();
    if (!code) return;
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
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setIsSearching(false);
    }
  };

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

  // Rebuild manualAttendance + re-filter extraAttendees whenever data changes
  useEffect(() => {
    if (!selectedManualSession || enrolmentRecords.length === 0) return;
    const ssgPresentNrics = new Set(
      attendanceRecords
        .filter(r => { const s = (r.status || '').toLowerCase(); return s === 'confirmed' || s === 'present' || s === 'attended'; })
        .map(r => r.nric || r.trainee?.id || '')
        .filter(Boolean)
    );
    const enrolNrics = new Set(
      enrolmentRecords.map((item: any) => {
        const enrol = item?.enrolment ?? item;
        const trainee = enrol?.trainee ?? {};
        return (trainee?.id || trainee?.nric || '').trim();
      }).filter(Boolean)
    );
    const seenNrics = new Set<string>();
    const merged = enrolmentRecords
      .filter((item: any) => {
        const enrol = item?.enrolment ?? item;
        const status = (enrol?.status || enrol?.enrolmentStatus || '').toLowerCase();
        return status !== 'cancelled';
      })
      .map((item: any) => {
        const enrol = item?.enrolment ?? item;
        const trainee = enrol?.trainee ?? {};
        const nric: string = trainee?.id || trainee?.nric || '';
        const name: string = trainee?.fullName || trainee?.name || '';
        const { isPresent, reasonOfAbsence } = resolveAttendance(nric, ssgPresentNrics, manualAttendanceDbMap);
        return { nric, fullName: name, isPresent, reasonOfAbsence };
      })
      .filter(r => {
        if (!r.nric || seenNrics.has(r.nric)) return false;
        seenNrics.add(r.nric);
        return true;
      });
    setManualAttendance(merged);
    // Keep only extras whose NRIC is not covered by enrolments
    setExtraAttendees(prev => prev.filter(e => !enrolNrics.has(e.nric)));
  }, [enrolmentRecords, manualAttendanceDbMap, selectedManualSession, attendanceRecords]);

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

  const fetchManualSessions = async (courseRunId: string) => {
    setLoadingManualSessions(true);
    setManualSessions([]);
    setSelectedManualSession('');
    setManualAttendance([]);
    setManualAttendanceDbMap({});
    setExtraAttendees([]);
    setManualAttendanceMsg(null);
    try {
      const res = await fetch(`/api/trainer/attendance-sessions?courseRunId=${courseRunId}`);
      const json = await res.json();
      if (json.success && json.data.length > 0) {
        setManualSessions(json.data);
        // selectedManualSession is driven by the top session dropdown via the useEffect above
      }
    } catch { /* silent */ }
    finally { setLoadingManualSessions(false); }
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
    try {
      const res = await fetch(`/api/trainer/attendance-records?sessionId=${sessionId}`, { signal: controller.signal });
      const json = await res.json();
      if (json.success) {
        // Build NRIC-keyed map from DB records
        const dbMap: Record<string, { isPresent: boolean; reasonOfAbsence: string }> = {};
        for (const rec of json.data) {
          if (rec.nric) dbMap[rec.nric] = { isPresent: rec.isPresent, reasonOfAbsence: rec.reasonOfAbsence };
        }
        setManualAttendanceDbMap(dbMap);
        // If enrolmentRecords already loaded, merge immediately (otherwise useEffect handles it)
        setEnrolmentRecords(prev => {
          const enrolNrics = new Set(
            prev.map((item: any) => {
              const enrol = item?.enrolment ?? item;
              const trainee = enrol?.trainee ?? {};
              return (trainee?.id || trainee?.nric || '').trim();
            }).filter(Boolean)
          );
          // Extract extra attendees: DB records with names not matching any enrolment NRIC
          const extras = json.data.filter((rec: any) =>
            rec.fullName && rec.nric && !enrolNrics.has(rec.nric)
          ).map((rec: any) => ({
            nric: rec.nric,
            fullName: rec.fullName,
            email: rec.email,
            isPresent: rec.isPresent,
            reasonOfAbsence: rec.reasonOfAbsence,
          }));
          setExtraAttendees(extras);

          if (prev.length > 0) {
            const ssgPresentNrics = new Set(
              attendanceRecords
                .filter(r => { const s = (r.status || '').toLowerCase(); return s === 'confirmed' || s === 'present' || s === 'attended'; })
                .map(r => r.nric || r.trainee?.id || '')
                .filter(Boolean)
            );
            const seenNrics = new Set<string>();
            const merged = prev
              .filter((item: any) => {
                const enrol = item?.enrolment ?? item;
                const status = (enrol?.status || enrol?.enrolmentStatus || '').toLowerCase();
                return status !== 'cancelled';
              })
              .map((item: any) => {
                const enrol = item?.enrolment ?? item;
                const trainee = enrol?.trainee ?? {};
                const nric: string = trainee?.id || trainee?.nric || '';
                const name: string = trainee?.fullName || trainee?.name || '';
                const { isPresent, reasonOfAbsence } = resolveAttendance(nric, ssgPresentNrics, dbMap);
                return { nric, fullName: name, isPresent, reasonOfAbsence };
              })
              .filter(r => {
                if (!r.nric || seenNrics.has(r.nric)) return false;
                seenNrics.add(r.nric);
                return true;
              });
            setManualAttendance(merged);
          }
          return prev;
        });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') console.error('fetchManualAttendance error:', err);
    } finally {
      setLoadingManualAttendance(false);
    }
  };

  const handleTogglePresent = (nric: string) => {
    if (manualAttendance.some(r => r.nric === nric)) {
      setManualAttendance(prev => prev.map(r =>
        r.nric === nric
          ? { ...r, isPresent: !r.isPresent, reasonOfAbsence: !r.isPresent ? '' : r.reasonOfAbsence }
          : r
      ));
    } else {
      setExtraAttendees(prev => prev.map(r =>
        r.nric === nric
          ? { ...r, isPresent: !r.isPresent, reasonOfAbsence: !r.isPresent ? '' : r.reasonOfAbsence }
          : r
      ));
    }
  };

  const handleReasonChange = (nric: string, value: string) => {
    if (manualAttendance.some(r => r.nric === nric)) {
      setManualAttendance(prev => prev.map(r => r.nric === nric ? { ...r, reasonOfAbsence: value } : r));
    } else {
      setExtraAttendees(prev => prev.map(r => r.nric === nric ? { ...r, reasonOfAbsence: value } : r));
    }
  };

  const handleSaveAttendance = async () => {
    if (!selectedManualSession || (manualAttendance.length === 0 && extraAttendees.length === 0)) return;
    setSavingAttendance(true);
    setManualAttendanceMsg(null);
    try {
      const combined = [
        ...manualAttendance.map(r => ({ nric: r.nric, isPresent: r.isPresent, reasonOfAbsence: r.reasonOfAbsence || '' })),
        ...extraAttendees.map(r => ({ nric: r.nric, isPresent: r.isPresent, reasonOfAbsence: r.reasonOfAbsence || '' })),
      ];
      const res = await fetch('/api/trainer/attendance-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: selectedManualSession, records: combined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setManualAttendanceMsg({ type: 'success', text: json.message || 'Attendance saved successfully.' });
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
        return [...prev, { nric: identifier, fullName: displayName, email: email.trim(), isPresent: false, reasonOfAbsence: '' }];
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
        setSelectedSession(fetched[0].id);
        handleFetchAttendance(fetched[0].id, courseObj);
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

  const fetchEnrolments = async (courseRunCode: string, courseOverride?: typeof selectedCourse) => {
    setIsLoadingEnrolments(true);
    setEnrolmentError(null);
    setEnrolmentRecords([]);
    try {
      const res = await fetch('https://n8n.srv1231536.hstgr.cloud/webhook/246caa5e-bd7e-42e8-82b1-cde2e05e5013', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseRunId: courseRunCode,
          timestamp: new Date().toISOString(),
          source: 'admin-search-enrolment',
        }),
      });
      if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
      const raw = await res.json();
      let records: any[] = [];
      if (Array.isArray(raw)) {
        records = raw;
      } else if (Array.isArray(raw?.result?.data)) {
        records = raw.result.data;
      } else if (Array.isArray(raw?.data)) {
        records = raw.data;
      } else if (Array.isArray(raw?.data?.enrolments)) {
        records = raw.data.enrolments;
      } else if (Array.isArray(raw?.enrolments)) {
        records = raw.enrolments;
      }
      setEnrolmentRecords(records);
      if (records.length > 0) checkLearnerAccounts(records, courseOverride ?? selectedCourse);
    } catch (err) {
      setEnrolmentError(err instanceof Error ? err.message : 'Failed to fetch enrolments.');
    } finally {
      setIsLoadingEnrolments(false);
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
          // For both missing AND existing accounts — create-learner-account handles both:
          // - missing: creates account + enrolls
          // - existing: skips creation, runs ensureEnrollment to assign course run if not yet assigned
          await handleCreateLearnerAccount(email, trainee?.fullName || trainee?.name || '', nric, enrolRef, course);
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

  const handleCreateLearnerAccount = async (email: string, fullName: string, nric?: string, enrolmentId?: string, courseOverride?: typeof selectedCourse) => {
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
        }),
      });
      const json = await res.json();
      setLearnerAccountMap(prev => ({ ...prev, [key]: json.success ? 'done' : 'error' }));
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
      const response = await fetch(
        'https://n8n.srv1231536.hstgr.cloud/webhook/c0d24850-9317-4ccc-b4b8-111e4c114ed8',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uen: uen || '',
            courseCode: course.courseCode,
            sessionId,
            courseRunId: course.courseRunCode || '',
          }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Webhook returned ${response.status}: ${text}`);
      }
      const raw = await response.json();
      const parsed = typeof raw.result === 'string' ? JSON.parse(raw.result) : raw.result ?? raw;
      const courseRun = parsed?.data?.courseRun ?? null;
      setAttendanceCourseRun(courseRun);
      const matchedSession = courseRun?.sessions?.find((s: any) => s.id === sessionId)
        ?? courseRun?.sessions?.[0]
        ?? null;
      setAttendanceRecords(matchedSession?.attendance ?? []);
      setAttendanceSuccess('Attendance data fetched successfully.');
    } catch (err) {
      setAttendanceError(err instanceof Error ? err.message : 'Failed to fetch attendance.');
    } finally {
      setIsLoadingAttendance(false);
    }
  };

  const attendanceLinkUrl = (type: 'qr' | 'elist' | 'traqom' | 'cert') =>
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
      }
      setPendingAttendanceCourseRunId(null);
    }
  }, [pendingAttendanceCourseRunId, courses, coursesLoading]);

  return (
    <div className="space-y-5">

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-on-surface">E-Attendance</h1>
        <p className="text-sm text-on-surface-secondary mt-0.5">
          {isAdminMode ? 'Enter a Course Run ID to look up attendance.' : 'Select an assigned class to manage sessions and view enrolments.'}
        </p>
      </div>

      {/* ── Class & Session Selection ── */}
      <div className="bg-surface rounded-lg border border-default shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <h2 className="text-sm font-semibold text-on-surface">Class Selection</h2>
          {selectedCourse?.assignedTrainerName && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-on-surface-secondary font-medium">Trainer</span>
              <span className="text-on-surface-secondary">·</span>
              <span className="font-semibold text-on-surface">{selectedCourse.assignedTrainerName}</span>
            </div>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Class selection row — admin gets a text input, trainer gets a dropdown */}
          <div>
            <label className="block text-xs font-medium text-on-surface-secondary mb-1">
              {isAdminMode ? 'Course Run ID' : 'Assigned Class'} <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {isAdminMode ? (
                <>
                  <div className="flex-1 min-w-[260px]">
                    <input
                      type="text"
                      value={adminInput}
                      onChange={e => { setAdminInput(e.target.value); setSearchError(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') handleAdminSearch(); }}
                      placeholder="e.g. 1069549"
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
                    onClick={handleAdminSearch}
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
                </>
              ) : coursesLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 border border-default rounded text-sm text-muted flex-1 min-w-[260px]">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                  Loading classes...
                </div>
              ) : (
                <div className="relative flex-1 min-w-[260px]">
                  <select
                    value={selectedCourseRunId}
                    onChange={e => {
                      const val = e.target.value;
                      const course = courses.find(c => c.courseRunId === val);
                      setSelectedCourseRunId(val);
                      setSessions([]);
                      setSelectedSession('');
                      setFetchError(null);
                      setAttendanceRecords([]);
                      setAttendanceCourseRun(null);
                      setEnrolmentRecords([]);
                      setEnrolmentError(null);
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
                      if (val) fetchManualSessions(val);
                    }}
                    className="input-themed w-full border rounded px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    disabled={isFetchingSessions}
                  >
                    <option value="" disabled>— Select a class —</option>
                    {activeCourses.map(c => (
                      <option key={c.courseRunId} value={c.courseRunId}>
                        {c.title}{c.courseRunCode ? ` (Run: ${c.courseRunCode})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none text-xs">▼</span>
                </div>
              )}
              {!isAdminMode && selectedCourse && (
                <button
                  onClick={() => handleFetchSessions(selectedCourse.courseRunCode!, selectedCourse.courseCode)}
                  disabled={!canFetch}
                  className="flex items-center gap-2 px-3 py-2 bg-surface-elevated border border-default text-on-surface-secondary rounded text-sm font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isFetchingSessions ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <RefreshIcon />
                      Refresh Sessions
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Course Run ID + Course Code + Start/End Date pills — appear right after class is selected */}
          {selectedCourse && (
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-default text-sm">
                <span className="font-medium text-on-surface-secondary">Course Run ID</span>
                <span className="font-bold text-primary">{selectedCourse.courseRunCode}</span>
              </span>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-default text-sm">
                <span className="font-medium text-on-surface-secondary">Course Code</span>
                <span className="font-bold text-on-surface">{selectedCourse.courseCode}</span>
              </span>
              {selectedCourse.startDate && (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-default text-sm">
                  <span className="font-medium text-on-surface-secondary">Start Date</span>
                  <span className="font-bold text-on-surface">
                    {new Date(selectedCourse.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </span>
              )}
              {selectedCourse.endDate && (
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-default text-sm">
                  <span className="font-medium text-on-surface-secondary">End Date</span>
                  <span className="font-bold text-on-surface">
                    {new Date(selectedCourse.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Session dropdown — shown after sessions load */}
          {sessions.length > 0 && (
            <div className="relative">
              <label className="block text-xs font-medium text-on-surface-secondary mb-1">Session</label>
              <select
                value={selectedSession}
                onChange={e => { setSelectedSession(e.target.value); handleFetchAttendance(e.target.value); }}
                className="input-themed w-full border rounded px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>{formatSessionLabel(s)}</option>
                ))}
              </select>
              <span className="absolute right-2 bottom-2.5 text-muted pointer-events-none text-xs">▼</span>
            </div>
          )}

          {/* Total Sessions pill — appears below session dropdown once sessions are loaded */}
          {sessions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-default text-sm">
                <span className="font-medium text-on-surface-secondary">Total Sessions</span>
                <span className="font-bold text-on-surface">{sessions.length}</span>
              </span>
            </div>
          )}

          {/* Feedback messages */}
          {fetchError && (
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {fetchError}
            </p>
          )}
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
      </div>

      {/* ── Attendance Links ── */}
      <div className="bg-surface rounded-lg border border-default shadow-sm">
        <SectionHeader title="Attendance / TRAQOM / Cert QR Codes" />
        <div className="p-4">
          {/* Tab bar */}
          <div className="flex border-b border-default mb-4">
            {(['qr', 'elist', 'traqom', 'cert'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-secondary hover:text-on-surface'
                }`}
              >
                {tab === 'qr' ? 'QR Attendance' : tab === 'elist' ? 'E-Attendance List' : tab === 'traqom' ? 'TRAQOM QR Code' : 'Cert QR Code'}
              </button>
            ))}
          </div>

          {/* TRAQOM tab — QR code */}
          {activeTab === 'traqom' ? (
            <QrCodePanel
              title="TRAQOM Survey"
              description="Show this QR code to learners to complete the TRAQOM survey."
              imageSrc="/qr_codes/traqom_survey_qr_code.png"
            />
          ) : activeTab === 'cert' ? (
            <QrCodePanel
              title="Certificate Survey"
              description="Show this QR code to learners to complete the certificate delivery survey."
              imageSrc="/qr_codes/cert_delivery_qr_code.png"
            />
          ) : isFetchingDigitalId ? (
            <div className="flex items-center gap-2 text-sm text-muted py-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
              Loading attendance link...
            </div>
          ) : digitalAttendanceId ? (
            <div>
              <p className="text-xs text-on-surface-secondary mb-1.5">
                {activeTab === 'qr' ? 'QR Attendance Link' : 'E-Attendance List Link'}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={attendanceLinkUrl(activeTab)}
                  className="input-themed flex-1 border rounded px-3 py-2 text-sm bg-surface-elevated text-on-surface-secondary focus:outline-none"
                />
                <a
                  href={attendanceLinkUrl(activeTab)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors whitespace-nowrap"
                >
                  <ExternalLinkIcon />
                  Open
                </a>
              </div>
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
      </div>

      {/* ── Course Session Attendance ── */}
      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-x-auto">
        <SectionHeader
          title="Course Session Attendance"
          count={attendanceRecords.length > 0 ? attendanceRecords.length : undefined}
          loading={isLoadingAttendance}
          right={
            selectedSession ? (
              <button
                onClick={() => handleFetchAttendance(selectedSession)}
                disabled={isLoadingAttendance}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated border border-default text-on-surface-secondary rounded text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshIcon className="w-3.5 h-3.5" />
                Refetch Attendance
              </button>
            ) : undefined
          }
        />
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
                  {Array.from({ length: 7 }).map((__, col) => (
                    <td key={col} className="px-3 py-3">
                      <div className="h-3 rounded bg-surface-elevated animate-pulse" style={{ width: col === 1 ? '70%' : '50%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : attendanceRecords.length > 0 ? (
              attendanceRecords.map((record: any, idx: number) => {
                const nric: string = record.nric || record.trainee?.id || '';
                return (
                  <tr key={idx} className="border-b border-default hover:bg-surface-elevated transition-colors">
                    <td className="px-3 py-3 text-center text-on-surface-secondary">{idx + 1}</td>
                    <td className="px-3 py-3 font-medium text-on-surface whitespace-nowrap">{record.trainee?.name || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary font-mono whitespace-nowrap">
                      {nric
                        ? (showNric ? nric : (nric.length >= 5 ? `${nric[0]}XXXX${nric.slice(-4)}` : nric))
                        : '—'}
                    </td>
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

      {/* ── Class Enrolments ── */}
      <div className="bg-surface rounded-lg border border-default shadow-sm">
        <SectionHeader
          title="Class Enrolments"
          count={enrolmentRecords.length > 0 ? enrolmentRecords.length : undefined}
          loading={isLoadingEnrolments}
          right={
            selectedCourse?.courseRunCode ? (
              <button
                onClick={() => fetchEnrolments(selectedCourse.courseRunCode!)}
                disabled={isLoadingEnrolments}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated border border-default text-on-surface-secondary rounded text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshIcon className="w-3.5 h-3.5" />
                Refetch Enrolments
              </button>
            ) : undefined
          }
        />
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
            ) : enrolmentRecords.length > 0 ? (
              enrolmentRecords.map((item: any, idx: number) => {
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
                    <td className="px-3 py-3 whitespace-nowrap">{(() => {
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
      </div>

      {/* ── Manual Attendance Taking ── */}
      {!isAdminMode && <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-on-surface">Manual Attendance Taking</h2>
            {(loadingManualSessions || loadingManualAttendance || isLoadingEnrolments || isLoadingAttendance) && (
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-primary" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {extraAttendees.length > 0 && (
            <button
              onClick={() => { setShowDeleteLearnerModal(true); setDeleteLearnerNric(''); setDeleteLearnerError(null); }}
              disabled={!selectedManualSession || loadingManualAttendance || isLoadingEnrolments || isLoadingAttendance}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove Learner
            </button>
            )}
            <button
              onClick={() => { setShowAddLearnerModal(true); setAddLearnerError(null); setAddLearnerForm({ fullName: '', email: '', nric: '' }); }}
              disabled={!selectedManualSession || loadingManualAttendance || isLoadingEnrolments || isLoadingAttendance}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded text-xs font-medium hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Learner
            </button>
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

        {/* Feedback banner */}
        {manualAttendanceMsg && (
          <div className={`px-4 py-2 text-xs border-b border-default ${manualAttendanceMsg.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
            {manualAttendanceMsg.text}
          </div>
        )}

        {/* Attendance table */}
        <table className="w-full text-sm">
          <thead className="bg-surface-elevated border-b border-default">
            <tr>
              <th className="px-3 py-3 text-center font-semibold text-on-surface-secondary w-10 whitespace-nowrap">No.</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Name</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">
                <div className="flex items-center gap-2">
                  NRIC
                  {isAdminMode && (
                    <button onClick={() => setShowManualNric(v => !v)} className="text-xs font-normal text-primary hover:underline">
                      {showManualNric ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              </th>
              <th className="px-3 py-3 text-center font-semibold text-on-surface-secondary whitespace-nowrap">Attendance Marking</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Reason of Absence</th>
              <th className="px-3 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {!selectedCourseRunId ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted italic">Select a class to take attendance.</td></tr>
            ) : !selectedManualSession ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted italic">{manualSessions.length === 0 ? 'No sessions found for this class.' : 'Select a session in the Class Selection above.'}</td></tr>
            ) : loadingManualAttendance || isLoadingEnrolments || isLoadingAttendance ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <tr key={idx} className="border-b border-default">
                  {Array.from({ length: 6 }).map((__, col) => (
                    <td key={col} className="px-3 py-3">
                      <div className="h-3 rounded bg-surface-elevated animate-pulse" style={{ width: col === 1 ? '60%' : '40%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : manualAttendance.length === 0 && extraAttendees.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted italic">No enrolment records found. Use "Add Learner" to add someone manually.</td></tr>
            ) : (
              (() => {
                // All enrolled NRICs (including cancelled) — extras must not overlap with these
                const allEnrolNrics = new Set(
                  enrolmentRecords.map((item: any) => {
                    const enrol = item?.enrolment ?? item;
                    const trainee = enrol?.trainee ?? {};
                    return (trainee?.id || trainee?.nric || '').trim();
                  }).filter(Boolean)
                );
                const combined = [
                  ...manualAttendance,
                  ...extraAttendees.filter(e => !allEnrolNrics.has(e.nric)),
                ];
                return combined.slice((manualPage - 1) * MANUAL_PAGE_SIZE, manualPage * MANUAL_PAGE_SIZE).map((record, idx) => {
                  const globalIdx = (manualPage - 1) * MANUAL_PAGE_SIZE + idx;
                  const nric: string = record.nric || '';
                  const isExtra = !manualAttendance.some(r => r.nric === nric);
                  const isUidKey = nric.startsWith('_uid_');
                  const maskedNric = isUidKey ? '—' : (nric.length >= 5 ? `${nric[0]}XXXX${nric.slice(-4)}` : nric || '—');
                  return (
                    <tr key={nric || globalIdx} className={`border-b border-default hover:bg-surface-elevated transition-colors ${isExtra ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''}`}>
                      <td className="px-3 py-3 text-center text-on-surface-secondary">{globalIdx + 1}</td>
                      <td className="px-3 py-3 font-medium text-on-surface whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {record.fullName || '—'}
                          {isExtra && <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium">Manual</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-on-surface-secondary font-mono whitespace-nowrap">{isUidKey ? '—' : (showManualNric ? (nric || '—') : maskedNric)}</td>
                      <td className="px-3 py-3 text-center">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={record.isPresent}
                            onChange={() => handleTogglePresent(nric)}
                            className="w-4 h-4 rounded border-default accent-primary cursor-pointer"
                          />
                          <span className={`text-xs font-medium ${record.isPresent ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                            {record.isPresent ? 'Present' : 'Absent'}
                          </span>
                        </label>
                      </td>
                      <td className="px-3 py-3">
                        {!record.isPresent && (
                          <input
                            type="text"
                            value={record.reasonOfAbsence}
                            onChange={e => handleReasonChange(nric, e.target.value)}
                            placeholder="Enter reason..."
                            className="input-themed w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                          />
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
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
                });
              })()
            )}
          </tbody>
        </table>

        {/* Pagination + Save button */}
        {(manualAttendance.length > 0 || extraAttendees.length > 0) && selectedManualSession && (
          <div className="px-4 py-3 border-t border-default flex items-center justify-between gap-4">
            {/* Pagination — bottom left */}
            {(() => {
              const allEnrolNricsForCount = new Set(
                enrolmentRecords.map((item: any) => {
                  const enrol = item?.enrolment ?? item;
                  const trainee = enrol?.trainee ?? {};
                  return (trainee?.id || trainee?.nric || '').trim();
                }).filter(Boolean)
              );
              const combinedTotal = manualAttendance.length + extraAttendees.filter(e => !allEnrolNricsForCount.has(e.nric)).length;
              const totalPages = Math.ceil(combinedTotal / MANUAL_PAGE_SIZE);
              const start = (manualPage - 1) * MANUAL_PAGE_SIZE + 1;
              const end = Math.min(manualPage * MANUAL_PAGE_SIZE, combinedTotal);
              return (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">{start}–{end} of {combinedTotal}</span>
                  <button
                    onClick={() => setManualPage(p => Math.max(1, p - 1))}
                    disabled={manualPage === 1}
                    className="px-2 py-1 text-xs border border-default rounded text-on-surface-secondary hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ‹ Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      onClick={() => setManualPage(p)}
                      className={`px-2.5 py-1 text-xs border rounded transition-colors ${p === manualPage ? 'bg-primary text-white border-primary' : 'border-default text-on-surface-secondary hover:bg-surface-elevated'}`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    onClick={() => setManualPage(p => Math.min(totalPages, p + 1))}
                    disabled={manualPage === totalPages}
                    className="px-2 py-1 text-xs border border-default rounded text-on-surface-secondary hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next ›
                  </button>
                </div>
              );
            })()}
            {/* Save button — bottom right */}
            <button
              onClick={handleSaveAttendance}
              disabled={savingAttendance || loadingManualAttendance || isLoadingEnrolments || isLoadingAttendance}
              className="px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingAttendance ? 'Saving...' : 'Save Attendance'}
            </button>
          </div>
        )}
      </div>}

    </div>
  );
};

export default TrainerAttendanceDashboard;
