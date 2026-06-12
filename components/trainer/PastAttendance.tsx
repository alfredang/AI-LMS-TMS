import React, { useState, useEffect, useMemo } from 'react';
import { useLms } from '../../contexts/LmsContext';
import { Icon, IconName } from '../ui/Icon';

interface PastClass {
  course_id: string;
  course_title: string;
  course_code: string;
  run_id: string;
  run_code: string;
  start_date: string;
  end_date: string;
  class_status: string;
  assigned_trainer_name: string;
}

interface StudentRecord {
  enrolment_id: string;
  user_id: string | null;
  student_name: string;
  email: string;
  nric?: string;
  competent_status: string;
  source: 'manual' | 'ssg';
  is_competent: boolean;
}

interface SessionMeta {
  id: string;
  sessionNumber: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  ssgSessionId: string | null;
}

interface AttendanceSummary {
  totalSessions: number;
  sessions?: SessionMeta[];
  data: { nric: string; userId: string; attendedCount: number; sessions?: Record<string, boolean> }[];
}

interface PastAttendanceProps {
  isAdminMode?: boolean;
}

const PastAttendance: React.FC<PastAttendanceProps> = ({ isAdminMode = false }) => {
  const { currentUser } = useLms();
  const [classes, setClasses] = useState<PastClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [startDateFrom, setStartDateFrom] = useState('');
  const [startDateTo, setStartDateTo] = useState('');
  const [endDateFrom, setEndDateFrom] = useState('');
  const [endDateTo, setEndDateTo] = useState('');

  const filteredClasses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // Compare as YYYY-MM-DD strings in Asia/Singapore so timestamps stored at
    // T16:00:00Z (which is the next calendar day in SGT) line up with what
    // the user sees in the UI.
    const toSgDate = (iso: string | null | undefined): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(d);
      const y = parts.find(p => p.type === 'year')?.value;
      const m = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      return y && m && day ? `${y}-${m}-${day}` : null;
    };

    return classes.filter(c => {
      if (q) {
        const haystack = `${c.run_id} ${c.run_code} ${c.course_title} ${c.course_code}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      const start = toSgDate(c.start_date);
      const end = toSgDate(c.end_date);
      if (startDateFrom && (!start || start < startDateFrom)) return false;
      if (startDateTo && (!start || start > startDateTo)) return false;
      if (endDateFrom && (!end || end < endDateFrom)) return false;
      if (endDateTo && (!end || end > endDateTo)) return false;
      return true;
    });
  }, [classes, searchQuery, startDateFrom, startDateTo, endDateFrom, endDateTo]);

  // Clear selection if it falls outside the filtered set
  useEffect(() => {
    if (selectedRunId && !filteredClasses.some(c => c.run_id === selectedRunId)) {
      setSelectedRunId('');
    }
  }, [filteredClasses, selectedRunId]);

  const hasActiveFilters = !!(searchQuery || startDateFrom || startDateTo || endDateFrom || endDateTo);
  const clearFilters = () => {
    setSearchQuery('');
    setStartDateFrom('');
    setStartDateTo('');
    setEndDateFrom('');
    setEndDateTo('');
  };

  // Fetch past classes
  useEffect(() => {
    const url = isAdminMode
      ? '/api/admin/past-classes'
      : currentUser?.email
        ? `/api/trainer/past-classes?email=${encodeURIComponent(currentUser.email)}`
        : null;
    if (!url) return;
    const controller = new AbortController();
    setLoadingClasses(true);
    fetch(url, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setClasses(data);
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch past classes:', err); })
      .finally(() => setLoadingClasses(false));
    return () => controller.abort();
  }, [currentUser?.email, isAdminMode]);

  // Fetch students and attendance for selected class
  const loadClassData = (runId: string, signal?: AbortSignal) => {
    setLoadingStudents(true);
    setLoadingAttendance(true);

    fetch(`/api/trainer/class-students?courseRunId=${runId}`, { signal })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setStudents(data);
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch students:', err); })
      .finally(() => setLoadingStudents(false));

    fetch(`/api/trainer/attendance-summary?courseRunId=${runId}`, { signal })
      .then(res => res.json())
      .then(data => {
        if (data.success) setAttendanceSummary(data);
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch attendance:', err); })
      .finally(() => setLoadingAttendance(false));
  };

  useEffect(() => {
    if (!selectedRunId) {
      setStudents([]);
      setAttendanceSummary(null);
      setSyncMessage(null);
      return;
    }
    setSyncMessage(null);
    const controller = new AbortController();
    loadClassData(selectedRunId, controller.signal);
    return () => controller.abort();
  }, [selectedRunId]);

  const handleRefreshFromSSG = async () => {
    if (!selectedRunId || syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/trainer/sync-attendance-from-ssg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunId: selectedRunId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setSyncMessage({ kind: 'error', text: json.error || `Sync failed (HTTP ${res.status})` });
      } else {
        const errorNote = Array.isArray(json.errors) && json.errors.length > 0
          ? ` (${json.errors.length} session error${json.errors.length === 1 ? '' : 's'})`
          : '';
        setSyncMessage({
          kind: 'success',
          text: `Synced ${json.sessionsSynced}/${json.sessionsFetched} sessions, ${json.attendanceUpserted} attendance records updated${errorNote}.`,
        });
        loadClassData(selectedRunId);
      }
    } catch (err) {
      setSyncMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      setSyncing(false);
    }
  };

  const selectedClass = classes.find(c => c.run_id === selectedRunId);

  const filterInputClass = "w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500";

  // Parse SSG/local date strings: handles YYYYMMDD (SSG raw), YYYY-MM-DD,
  // and full ISO. Returns null if unparseable.
  const parseSessionDate = (raw: string | null | undefined): Date | null => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (/^\d{8}$/.test(s)) {
      const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  const formatSessionDate = (raw: string | null | undefined, opts?: Intl.DateTimeFormatOptions) => {
    const d = parseSessionDate(raw);
    return d ? d.toLocaleDateString('en-GB', opts) : null;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">Past Attendance</h1>
      <p className="text-sm text-muted">View attendance records from your completed classes.</p>

      {/* Class Selection */}
      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800 space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Search</label>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Run ID, code, course title…"
                className={filterInputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Date From</label>
              <input type="date" value={startDateFrom} onChange={e => setStartDateFrom(e.target.value)} className={filterInputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Date To</label>
              <input type="date" value={startDateTo} onChange={e => setStartDateTo(e.target.value)} className={filterInputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End Date From</label>
              <input type="date" value={endDateFrom} onChange={e => setEndDateFrom(e.target.value)} className={filterInputClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End Date To</label>
              <input type="date" value={endDateTo} onChange={e => setEndDateTo(e.target.value)} className={filterInputClass} />
            </div>
          </div>
          {hasActiveFilters && (
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{filteredClasses.length} of {classes.length} classes match</span>
              <button onClick={clearFilters} className="text-blue-600 hover:text-blue-700 font-medium">Clear filters</button>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Select a Past Class
            </label>
            <div className="relative w-full">
              {loadingClasses ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <Icon name={IconName.Spinner} className="w-5 h-5 animate-spin text-blue-500" />
                  Loading your past classes...
                </div>
              ) : classes.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No past classes found.</p>
              ) : filteredClasses.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No classes match the current filters.</p>
              ) : (
                <select
                  value={selectedRunId}
                  onChange={e => setSelectedRunId(e.target.value)}
                  className="w-full pl-3 pr-10 py-2.5 text-base border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md dark:bg-gray-700 dark:text-white shadow-sm"
                >
                  <option value="">— Choose a past class —</option>
                  {filteredClasses.map(c => (
                    <option key={c.run_id} value={c.run_id}>
                      {c.course_title} | {c.run_code} ({new Date(c.start_date || '').toLocaleDateString('en-GB')} - {new Date(c.end_date || '').toLocaleDateString('en-GB')})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Class Info */}
        {selectedClass && (
          <div className="px-5 py-3 bg-blue-50 dark:bg-blue-900/20 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600 dark:text-gray-400">
              <span><strong>Course:</strong> {selectedClass.course_title}</span>
              <span><strong>Run:</strong> {selectedClass.run_code}</span>
              <span><strong>Status:</strong> {selectedClass.class_status || 'Completed'}</span>
            </div>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      {selectedRunId && !loadingStudents && !loadingAttendance && students.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(() => {
            const totalSessions = attendanceSummary?.totalSessions ?? 0;
            const scores = students.map(s => {
              const row = attendanceSummary?.data?.find(
                (r) => (s.nric && r.nric === s.nric) || (s.user_id && r.userId === s.user_id)
              );
              const attended = row?.attendedCount ?? 0;
              return totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
            });
            const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
            const fullyAttended = scores.filter(s => s === 100).length;
            const getAvgColor = (pct: number) => {
              if (pct >= 75) return 'text-green-500';
              if (pct >= 50) return 'text-yellow-500';
              return 'text-red-500';
            };
            return (
              <>
                <div className="bg-surface rounded-lg border border-default shadow-sm p-5 text-center">
                  <div className="text-3xl font-bold text-white">{students.length}</div>
                  <div className="text-xs text-gray-400 mt-1">No. of Learners</div>
                </div>
                <div className="bg-surface rounded-lg border border-default shadow-sm p-5 text-center">
                  <div className={`text-3xl font-bold ${getAvgColor(avgScore)}`}>{avgScore}%</div>
                  <div className="text-xs text-gray-400 mt-1">Average Overall Attendance ({totalSessions} session{totalSessions === 1 ? '' : 's'})</div>
                </div>
                <div className="bg-surface rounded-lg border border-default shadow-sm p-5 text-center">
                  <div className="text-3xl font-bold text-white">{fullyAttended}<span className="text-base text-gray-400 font-normal"> / {students.length}</span></div>
                  <div className="text-xs text-gray-400 mt-1">Fully Attended (100%)</div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Student Attendance List */}
      {selectedRunId && (
        <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800 flex justify-between items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Learner Attendance
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              {attendanceSummary && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {attendanceSummary.totalSessions} Session{attendanceSummary.totalSessions !== 1 ? 's' : ''}
                </span>
              )}
              <div className="text-xs text-gray-500 bg-white dark:bg-gray-700 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-600">
                {students.length} Learners
              </div>
              <button
                onClick={handleRefreshFromSSG}
                disabled={syncing || loadingStudents || loadingAttendance}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-60 disabled:cursor-not-allowed"
                title="Pull the latest sessions and attendance from SSG"
              >
                <Icon name={syncing ? IconName.Spinner : IconName.Sync} className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Refreshing…' : 'Refresh from SSG'}
              </button>
            </div>
          </div>
          {syncMessage && (
            <div className={`px-5 py-2 text-xs ${syncMessage.kind === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
              {syncMessage.text}
            </div>
          )}

          <div className="p-0">
            {(loadingStudents || loadingAttendance) ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Icon name={IconName.Spinner} className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                <p>Loading attendance records...</p>
              </div>
            ) : students.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <Icon name={IconName.Users} className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p>No learners found for this class.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-default bg-gray-50 dark:bg-gray-800">
                      <th className="px-5 py-3 text-left font-medium text-gray-500 dark:text-gray-400">#</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Learner Name</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Learner NRIC</th>
                      {(attendanceSummary?.sessions || []).map((s, sIdx) => {
                        const fullDate = formatSessionDate(s.startDate);
                        const shortDate = formatSessionDate(s.startDate, { day: '2-digit', month: 'short' });
                        return (
                          <th
                            key={s.id}
                            className="px-3 py-3 text-center font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap"
                            title={[s.title, fullDate].filter(Boolean).join(' · ')}
                          >
                            {s.sessionNumber || `S${sIdx + 1}`}
                            {shortDate && (
                              <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500 mt-0.5">
                                {shortDate}
                              </div>
                            )}
                          </th>
                        );
                      })}
                      <th className="px-5 py-3 text-center font-medium text-gray-500 dark:text-gray-400">Overall</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {students.map((student, idx) => {
                      const totalSessions = attendanceSummary?.totalSessions ?? 0;
                      const sessionsList = attendanceSummary?.sessions || [];
                      const attendanceRow = attendanceSummary?.data?.find(
                        (r) => (student.nric && r.nric === student.nric) || (student.user_id && r.userId === student.user_id)
                      );
                      const attendedCount = attendanceRow?.attendedCount ?? 0;
                      const scorePercent = totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 100) : 0;

                      const getScoreColor = (pct: number) => {
                        if (pct >= 75) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
                        if (pct >= 50) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
                        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                      };

                      return (
                        <tr key={student.enrolment_id || student.email} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                          <td className="px-5 py-3 text-gray-400 font-mono">{idx + 1}</td>
                          <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{student.student_name}</td>
                          <td className="px-5 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">{student.nric ? '****' + student.nric.slice(4) : '—'}</td>
                          {sessionsList.map(s => {
                            const sessionMap = attendanceRow?.sessions || {};
                            const recorded = Object.prototype.hasOwnProperty.call(sessionMap, s.id);
                            const present = sessionMap[s.id] === true;
                            return (
                              <td key={s.id} className="px-3 py-3 text-center">
                                {recorded ? (
                                  present ? (
                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs font-bold" title="Present">✓</span>
                                  ) : (
                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs font-bold" title="Absent">✗</span>
                                  )
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600 text-xs" title="No record">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-5 py-3 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getScoreColor(scorePercent)}`}>
                              {scorePercent}%
                            </span>
                            <span className="ml-1 text-[10px] text-gray-400">({attendedCount}/{totalSessions})</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PastAttendance;
