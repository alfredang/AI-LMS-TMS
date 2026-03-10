import React, { useState, useEffect } from 'react';
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
  return `${session.id} — ${formatted} ${session.startTime}–${session.endTime}`;
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

const SectionHeader: React.FC<{ title: string; count?: number; right?: React.ReactNode; loading?: boolean }> = ({ title, count, right, loading }) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-default">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-on-surface">{title}</h2>
      {count !== undefined && (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          {count}
        </span>
      )}
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

const TrainerAttendanceDashboard: React.FC = () => {
  const { currentUser } = useLms();
  const { courses, loading: coursesLoading } = useTrainerCourses(currentUser?.id);

  const [uen, setUen] = useState('');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [sessions, setSessions]                        = useState<Session[]>([]);
  const [selectedSession, setSelectedSession]          = useState('');
  const [isFetchingSessions, setIsFetchingSessions]    = useState(false);
  const [fetchError, setFetchError]                    = useState<string | null>(null);

  const [activeTab, setActiveTab]                      = useState<'qr' | 'elist' | 'traqom'>('qr');

  const [isLoadingAttendance, setIsLoadingAttendance]  = useState(false);
  const [showNric, setShowNric]                        = useState(false);
  const [attendanceError, setAttendanceError]          = useState<string | null>(null);
  const [attendanceSuccess, setAttendanceSuccess]      = useState<string | null>(null);
  const [attendanceRecords, setAttendanceRecords]      = useState<any[]>([]);
  const [attendanceCourseRun, setAttendanceCourseRun]  = useState<any | null>(null);

  const [digitalAttendanceId, setDigitalAttendanceId]  = useState('');
  const [isFetchingDigitalId, setIsFetchingDigitalId]  = useState(false);
  const [digitalIdError, setDigitalIdError]            = useState<string | null>(null);

  const [enrolmentRecords, setEnrolmentRecords]        = useState<any[]>([]);
  const [isLoadingEnrolments, setIsLoadingEnrolments]  = useState(false);
  const [enrolmentError, setEnrolmentError]            = useState<string | null>(null);
  const [showEnrolNric, setShowEnrolNric]              = useState(false);

  const selectedCourse = courses.find(c => c.courseRunId === selectedCourseRunId) ?? null;

  useEffect(() => {
    fetch('/api/training-provider/uen')
      .then(r => r.json())
      .then(d => { if (d.uen) setUen(d.uen); })
      .catch(() => {});
  }, []);

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

  const fetchEnrolments = async (courseRunCode: string) => {
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
    } catch (err) {
      setEnrolmentError(err instanceof Error ? err.message : 'Failed to fetch enrolments.');
    } finally {
      setIsLoadingEnrolments(false);
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

  const attendanceLinkUrl = (type: 'qr' | 'elist' | 'traqom') =>
    type === 'qr'
      ? `https://www.myskillsfuture.gov.sg/spface/splogin/select-session?course-run-code=${digitalAttendanceId}`
      : `https://www.myskillsfuture.gov.sg/api/take-attendance/${digitalAttendanceId}`;

  return (
    <div className="space-y-5">

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Attendance Taking / Checking</h1>
        <p className="text-sm text-on-surface-secondary mt-0.5">Select an assigned class to manage sessions and view enrolments.</p>
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
          {/* Class dropdown row */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <label className="block text-xs font-medium text-on-surface-secondary mb-1">
                Assigned Class <span className="text-red-500">*</span>
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
                        fetchEnrolments(course.courseRunCode);
                      }
                    }}
                    className="input-themed w-full border rounded px-3 py-2 text-sm pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    disabled={isFetchingSessions}
                  >
                    <option value="" disabled>— Select a class —</option>
                    {courses.map(c => (
                      <option key={c.courseRunId} value={c.courseRunId}>
                        {c.title} | Run: {c.courseRunCode} | {c.courseCode}
                      </option>
                    ))}
                  </select>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none text-xs">▼</span>
                </div>
              )}
            </div>

            {selectedCourse && (
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

          {/* Course run info chips */}
          {selectedCourse && sessions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-elevated border border-default text-xs">
                <span className="font-medium text-on-surface">Course Run ID</span>
                <span className="font-semibold text-primary">{selectedCourse.courseRunCode}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-elevated border border-default text-xs">
                <span className="font-medium text-on-surface">Course Reference Code</span>
                <span className="font-semibold text-on-surface">{selectedCourse.courseCode}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-elevated border border-default text-xs">
                <span className="font-medium text-on-surface">Total Sessions</span>
                <span className="font-semibold text-on-surface">{sessions.length}</span>
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
        <SectionHeader title="Attendance / TRAQOM Links" />
        <div className="p-4">
          {/* Tab bar */}
          <div className="flex border-b border-default mb-4">
            {(['qr', 'elist', 'traqom'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-secondary hover:text-on-surface'
                }`}
              >
                {tab === 'qr' ? 'QR Attendance' : tab === 'elist' ? 'E-Attendance List' : 'TRAQOM Link'}
              </button>
            ))}
          </div>

          {/* TRAQOM tab — static link, no loading required */}
          {activeTab === 'traqom' ? (
            <div>
              <p className="text-xs text-on-surface-secondary mb-1.5">TRAQOM Link</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value="https://ssgtraqom.qualtrics.com/jfe/form/SV_3K9i7rTJ9OLsauW?Q_CHL=qr"
                  className="input-themed flex-1 border rounded px-3 py-2 text-sm bg-surface-elevated text-on-surface-secondary focus:outline-none"
                />
                <a
                  href="https://ssgtraqom.qualtrics.com/jfe/form/SV_3K9i7rTJ9OLsauW?Q_CHL=qr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors whitespace-nowrap"
                >
                  <ExternalLinkIcon />
                  Open
                </a>
              </div>
            </div>
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
            <div className="space-y-2">
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
                  <button onClick={() => setShowNric(v => !v)} className="text-xs font-normal text-primary hover:underline">
                    {showNric ? 'Hide' : 'Show'}
                  </button>
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
      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-x-auto">
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
                  <button onClick={() => setShowEnrolNric(v => !v)} className="text-xs font-normal text-primary hover:underline">
                    {showEnrolNric ? 'Hide' : 'Show'}
                  </button>
                </div>
              </th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Email</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Sponsorship</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Employer</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Enrolment Status</th>
              {/* <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Payment</th> */}
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Enrolment Date</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingEnrolments ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="border-b border-default">
                  {Array.from({ length: 13 }).map((__, col) => (
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
                    <td className="px-3 py-3 text-on-surface-secondary">{trainee?.email?.full || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{trainee?.sponsorshipType || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary">{trainee?.employer?.name || '—'}</td>
                    <td className="px-3 py-3"><StatusBadge value={enrol?.status || enrol?.enrolmentStatus || '—'} /></td>
                    {/* <td className="px-3 py-3"><StatusBadge value={trainee?.fees?.collectionStatus || '—'} /></td> */}
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{trainee?.enrolmentDate || '—'}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={13} className="px-3 py-10 text-center text-sm text-muted italic">
                  {selectedCourseRunId ? 'No enrolment records found.' : 'Select a class to load enrolments.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default TrainerAttendanceDashboard;
