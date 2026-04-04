import React, { useState, useEffect } from 'react';
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

interface AttendanceSummary {
  totalSessions: number;
  data: { nric: string; userId: string; attendedCount: number }[];
}

const PastAttendance: React.FC = () => {
  const { currentUser } = useLms();
  const [classes, setClasses] = useState<PastClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  // Fetch past classes
  useEffect(() => {
    if (!currentUser?.email) return;
    const controller = new AbortController();
    setLoadingClasses(true);
    fetch(`/api/trainer/past-classes?email=${encodeURIComponent(currentUser.email)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setClasses(data);
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch past classes:', err); })
      .finally(() => setLoadingClasses(false));
    return () => controller.abort();
  }, [currentUser?.email]);

  // Fetch students and attendance for selected class
  useEffect(() => {
    if (!selectedRunId) {
      setStudents([]);
      setAttendanceSummary(null);
      return;
    }
    const controller = new AbortController();
    setLoadingStudents(true);
    setLoadingAttendance(true);

    // Fetch students
    fetch(`/api/trainer/class-students?courseRunId=${selectedRunId}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setStudents(data);
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch students:', err); })
      .finally(() => setLoadingStudents(false));

    // Fetch attendance summary
    fetch(`/api/trainer/attendance-summary?courseRunId=${selectedRunId}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (data.success) setAttendanceSummary(data);
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch attendance:', err); })
      .finally(() => setLoadingAttendance(false));

    return () => controller.abort();
  }, [selectedRunId]);

  const selectedClass = classes.find(c => c.run_id === selectedRunId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">Past Attendance</h1>
      <p className="text-sm text-muted">View attendance records from your completed classes.</p>

      {/* Class Selection */}
      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800">
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
            ) : (
              <select
                value={selectedRunId}
                onChange={e => setSelectedRunId(e.target.value)}
                className="w-full pl-3 pr-10 py-2.5 text-base border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md dark:bg-gray-700 dark:text-white shadow-sm"
              >
                <option value="">— Choose a past class —</option>
                {classes.map(c => (
                  <option key={c.run_id} value={c.run_id}>
                    {c.course_title} | {c.run_code} ({new Date(c.start_date || '').toLocaleDateString('en-GB')} - {new Date(c.end_date || '').toLocaleDateString('en-GB')})
                  </option>
                ))}
              </select>
            )}
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
                  <div className="text-xs text-gray-400 mt-1">Average E-Attendance Score</div>
                </div>
                <div className="bg-surface rounded-lg border border-default shadow-sm p-5 text-center">
                  <div className={`text-3xl font-bold ${getAvgColor(avgScore)}`}>{avgScore}%</div>
                  <div className="text-xs text-gray-400 mt-1">Average Manual Attendance Score</div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Student Attendance List */}
      {selectedRunId && (
        <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Learner Attendance
            </h2>
            <div className="flex items-center gap-3">
              {attendanceSummary && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {attendanceSummary.totalSessions} Session{attendanceSummary.totalSessions !== 1 ? 's' : ''}
                </span>
              )}
              <div className="text-xs text-gray-500 bg-white dark:bg-gray-700 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-600">
                {students.length} Learners
              </div>
            </div>
          </div>

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
                      <th className="px-5 py-3 text-center font-medium text-gray-500 dark:text-gray-400">E-Attendance Score</th>
                      <th className="px-5 py-3 text-center font-medium text-gray-500 dark:text-gray-400">Manual Attendance Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {students.map((student, idx) => {
                      const totalSessions = attendanceSummary?.totalSessions ?? 0;
                      // Match by NRIC or user_id
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
                          <td className="px-5 py-3 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getScoreColor(scorePercent)}`}>
                              {scorePercent}%
                            </span>
                            <span className="ml-1 text-[10px] text-gray-400">({attendedCount}/{totalSessions})</span>
                          </td>
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
