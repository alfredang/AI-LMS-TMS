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
  // startDate is "YYYYMMDD", format to "DD MMM YYYY"
  const d = session.startDate;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatted = d.length === 8
    ? `${d.slice(6, 8)} ${months[parseInt(d.slice(4, 6), 10) - 1]} ${d.slice(0, 4)}`
    : d;
  return `${session.id} — ${formatted} ${session.startTime}–${session.endTime}`;
};

const TrainerAttendanceDashboard: React.FC = () => {
  const { currentUser } = useLms();
  const { courses, loading: coursesLoading } = useTrainerCourses(currentUser?.id);

  const [uen, setUen] = useState('');
  const [selectedCourseRunId, setSelectedCourseRunId]   = useState(''); // UUID (course_run.id)
  const [sessions, setSessions]                         = useState<Session[]>([]);
  const [selectedSession, setSelectedSession]           = useState('');
  const [isFetchingSessions, setIsFetchingSessions]     = useState(false);
  const [fetchError, setFetchError]                     = useState<string | null>(null);

const [activeTab, setActiveTab]                       = useState<'qr' | 'elist'>('qr');

  const [isLoadingAttendance, setIsLoadingAttendance]   = useState(false);
  const [showNric, setShowNric]                         = useState(false);
  const [attendanceError, setAttendanceError]           = useState<string | null>(null);
  const [attendanceSuccess, setAttendanceSuccess]       = useState<string | null>(null);
  const [attendanceRecords, setAttendanceRecords]       = useState<any[]>([]);
  const [attendanceCourseRun, setAttendanceCourseRun]   = useState<any | null>(null);

  const [digitalAttendanceId, setDigitalAttendanceId]   = useState('');
  const [isFetchingDigitalId, setIsFetchingDigitalId]   = useState(false);
  const [digitalIdError, setDigitalIdError]             = useState<string | null>(null);

  const [enrolmentRecords, setEnrolmentRecords]         = useState<any[]>([]);
  const [isLoadingEnrolments, setIsLoadingEnrolments]   = useState(false);
  const [enrolmentError, setEnrolmentError]             = useState<string | null>(null);
  const [showEnrolNric, setShowEnrolNric]               = useState(false);

const selectedCourse = courses.find(c => c.courseRunId === selectedCourseRunId) ?? null;

  // Fetch UEN for the training provider once on mount
  useEffect(() => {
    fetch('/api/training-provider/uen')
      .then(r => r.json())
      .then(d => { if (d.uen) setUen(d.uen); })
      .catch(() => {/* UEN unavailable */});
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

      if (!response.ok) {
        throw new Error(json.error || `Request failed with status ${response.status}`);
      }

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
      // Response shape: { result: { status, data: [{enrolment:{...}, meta:{...}},...], meta, error } }
      // Fallback to other common shapes for resilience
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

  return (
    <div className="space-y-4">

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface">Attendance Taking / Checking</h1>
        </div>
      </div>

      {/* Select Class Card */}
      <div className="bg-surface rounded-lg border border-default p-4 shadow-sm">
        <h2 className="text-base font-semibold text-on-surface mb-3">Attendance Taking / Checking</h2>

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
                    // Set digital attendance ID from DB, or fetch it if missing
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
                  <option value="">— Select a class —</option>
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

          {/* Manual re-fetch button */}
          {selectedCourse && (
            <button
              onClick={() => handleFetchSessions(selectedCourse.courseRunCode!, selectedCourse.courseCode)}
              disabled={!canFetch}
              className="flex items-center gap-2 px-4 py-2 bg-surface-elevated border border-default text-on-surface-secondary rounded text-sm font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFetchingSessions ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                  Fetching...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </>
              )}
            </button>
          )}
        </div>

        {/* Error message */}
        {fetchError && (
          <p className="mt-2 text-sm text-red-500">{fetchError}</p>
        )}

        {/* Session dropdown + actions — shown only after sessions are loaded */}
        {sessions.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-default">
            <div className="relative flex-1 min-w-[260px]">
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

          </div>
        )}

        {/* Attendance fetch feedback */}
        {attendanceSuccess && (
          <p className="mt-2 text-sm text-green-600">{attendanceSuccess}</p>
        )}
        {attendanceError && (
          <p className="mt-2 text-sm text-red-500">{attendanceError}</p>
        )}

        {/* Course info row */}
        {selectedCourse && sessions.length > 0 && (
          <p className="mt-3 text-sm text-on-surface-secondary">
            <span className="font-medium text-on-surface">Course Run ID:</span>{' '}
            <span className="text-primary font-semibold">{selectedCourse.courseRunCode}</span>
            <span className="mx-2 text-muted">|</span>
            <span className="font-medium text-on-surface">Reference:</span>{' '}
            <span>{selectedCourse.courseCode}</span>
            <span className="mx-2 text-muted">|</span>
            <span className="font-medium text-on-surface">Sessions found:</span>{' '}
            <span>{sessions.length}</span>
          </p>
        )}
      </div>

      {/* Main attendance section — two columns */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Left column (2/3 width) */}
        <div className="xl:col-span-2 space-y-4">

          {/* Trainer */}
          <div className="bg-surface rounded-lg border border-default shadow-sm px-4 py-3 flex items-center gap-2 text-sm">
            <span className="font-medium text-on-surface-secondary">Trainer:</span>
            <span className="font-semibold text-on-surface">
              {selectedCourse?.assignedTrainerName || '—'}
            </span>
          </div>

          {/* QR / E-Attendance Tabs */}
          <div className="bg-surface rounded-lg border border-default shadow-sm p-4">
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveTab('qr')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  activeTab === 'qr'
                    ? 'bg-primary text-white'
                    : 'bg-surface-elevated text-on-surface-secondary hover:text-on-surface'
                }`}
              >
                QR Attendance
              </button>
              <button
                onClick={() => setActiveTab('elist')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  activeTab === 'elist'
                    ? 'bg-primary text-white'
                    : 'bg-surface-elevated text-on-surface-secondary hover:text-on-surface'
                }`}
              >
                E-Attendance List
              </button>
            </div>

            {activeTab === 'qr' && (
              <div className="space-y-4">
                {/* QR Attendance Link */}
                {isFetchingDigitalId ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                    Loading attendance link...
                  </div>
                ) : digitalAttendanceId ? (
                  <div>
                    <p className="text-xs font-medium text-on-surface-secondary mb-1">QR Attendance Link</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`https://www.myskillsfuture.gov.sg/spface/splogin/select-session?course-run-code=${digitalAttendanceId}`}
                        className="input-themed flex-1 border rounded px-3 py-2 text-sm bg-surface-elevated text-on-surface-secondary focus:outline-none"
                      />
                      <a
                        href={`https://www.myskillsfuture.gov.sg/spface/splogin/select-session?course-run-code=${digitalAttendanceId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors whitespace-nowrap"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open
                      </a>
                    </div>
                  </div>
                ) : (
                  <div>
                    {digitalIdError && <p className="text-xs text-red-500 mb-2">{digitalIdError}</p>}
                    <button
                      onClick={() => selectedCourse?.courseRunId && selectedCourse?.courseRunCode && fetchDigitalAttendanceId(selectedCourse.courseRunId, selectedCourse.courseRunCode)}
                      disabled={!selectedCourse?.courseRunCode}
                      className="px-3 py-1.5 border border-default rounded text-sm text-on-surface-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                    >
                      Load Attendance Link
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'elist' && (
              <div>
                {isFetchingDigitalId ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                    Loading attendance link...
                  </div>
                ) : digitalAttendanceId ? (
                  <div>
                    <p className="text-xs font-medium text-on-surface-secondary mb-1">E-Attendance List Link</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`https://www.myskillsfuture.gov.sg/api/take-attendance/${digitalAttendanceId}`}
                        className="input-themed flex-1 border rounded px-3 py-2 text-sm bg-surface-elevated text-on-surface-secondary focus:outline-none"
                      />
                      <a
                        href={`https://www.myskillsfuture.gov.sg/api/take-attendance/${digitalAttendanceId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors whitespace-nowrap"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open
                      </a>
                    </div>
                  </div>
                ) : (
                  <div>
                    {digitalIdError && <p className="text-xs text-red-500 mb-2">{digitalIdError}</p>}
                    <button
                      onClick={() => selectedCourse?.courseRunId && selectedCourse?.courseRunCode && fetchDigitalAttendanceId(selectedCourse.courseRunId, selectedCourse.courseRunCode)}
                      disabled={!selectedCourse?.courseRunCode}
                      className="px-3 py-1.5 border border-default rounded text-sm text-on-surface-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                    >
                      Load Attendance Link
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>


          {/* Attendance Table */}
          <div className="bg-surface rounded-lg border border-default shadow-sm overflow-x-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-default">
              <h2 className="text-sm font-semibold text-on-surface">Course Session Attendance</h2>
              {isLoadingAttendance && (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-primary" />
                  Loading...
                </div>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface-elevated border-b border-default">
                <tr>
                  <th className="px-3 py-3 text-center font-semibold text-on-surface-secondary w-10">No.</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">Name</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">
                    <div className="flex items-center gap-2">
                      NRIC
                      <button
                        onClick={() => setShowNric(v => !v)}
                        className="text-xs font-normal text-primary hover:underline"
                      >
                        {showNric ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">Type</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">Status</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">Entry Mode</th>
                  <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary">TRAQOM</th>
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
                  attendanceRecords.map((record: any, idx: number) => (
                    <tr key={idx} className="border-b border-default hover:bg-surface-elevated transition-colors">
                      <td className="px-3 py-3 text-center text-on-surface-secondary">{idx + 1}</td>
                      <td className="px-3 py-3 font-medium text-on-surface">
                        {record.trainee?.name || '—'}
                      </td>
                      <td className="px-3 py-3 text-on-surface-secondary font-mono">
                        {(() => {
                          const nric: string = record.nric || record.trainee?.id || '';
                          if (!nric) return '—';
                          if (showNric) return nric;
                          return nric.length >= 5 ? `${nric[0]}XXXX${nric.slice(-4)}` : nric;
                        })()}
                      </td>
                      <td className="px-3 py-3 text-on-surface-secondary">{record.trainee?.attendeeType || '—'}</td>
                      <td className="px-3 py-3 text-on-surface-secondary">{record.status || '—'}</td>
                      <td className="px-3 py-3 text-on-surface-secondary">{record.entryMode || '—'}</td>
                      <td className="px-3 py-3 text-on-surface-secondary">{record.sentToTraqom || '—'}</td>
                    </tr>
                  ))
                ) : attendanceCourseRun ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted italic">
                      No attendance records found for this session.
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted italic">
                      Select a class to load attendance.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Class Enrolments */}
      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <h2 className="text-sm font-semibold text-on-surface">Class Enrolments</h2>
          {isLoadingEnrolments && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-primary" />
              Loading...
            </div>
          )}
        </div>
        {enrolmentError && (
          <p className="px-4 py-2 text-xs text-red-500">{enrolmentError}</p>
        )}
        <table className="w-full text-sm">
          <thead className="bg-surface-elevated border-b border-default">
            <tr>
              <th className="px-3 py-3 text-center font-semibold text-on-surface-secondary w-10">No.</th>
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
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Status</th>
              <th className="px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap">Payment</th>
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
                // Shape: { enrolment: {...}, meta: {...} } OR flat enrolment object
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
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{enrol?.status || enrol?.enrolmentStatus || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{trainee?.fees?.collectionStatus || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-secondary whitespace-nowrap">{trainee?.enrolmentDate || '—'}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-sm text-muted italic">
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
