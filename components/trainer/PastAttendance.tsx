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
  competent_status: string;
  source: 'manual' | 'ssg';
  is_competent: boolean;
}

const PastAttendance: React.FC = () => {
  const { currentUser } = useLms();
  const [classes, setClasses] = useState<PastClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

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

  // Fetch students for selected class
  useEffect(() => {
    if (!selectedRunId) {
      setStudents([]);
      return;
    }
    const controller = new AbortController();
    setLoadingStudents(true);
    fetch(`/api/trainer/class-students?courseRunId=${selectedRunId}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setStudents(data);
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch students:', err); })
      .finally(() => setLoadingStudents(false));
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

      {/* Student List */}
      {selectedRunId && (
        <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Enrolled Students
            </h2>
            <div className="text-xs text-gray-500 bg-white dark:bg-gray-700 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-600">
              {students.length} Students
            </div>
          </div>

          <div className="p-0">
            {loadingStudents ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Icon name={IconName.Spinner} className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                <p>Loading student records...</p>
              </div>
            ) : students.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <Icon name={IconName.Users} className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p>No students found for this class.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-default bg-gray-50 dark:bg-gray-800">
                      <th className="px-5 py-3 text-left font-medium text-gray-500 dark:text-gray-400">#</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Student Name</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Email</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Source</th>
                      <th className="px-5 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Assessment Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {students.map((student, idx) => (
                      <tr key={student.enrolment_id || student.email} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="px-5 py-3 text-gray-400 font-mono">{idx + 1}</td>
                        <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{student.student_name}</td>
                        <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{student.email || '—'}</td>
                        <td className="px-5 py-3">
                          {student.source === 'ssg' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                              SSG Sync
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                              Manual
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            student.is_competent
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                          }`}>
                            {student.is_competent ? 'Competent' : 'Not Yet Competent'}
                          </span>
                        </td>
                      </tr>
                    ))}
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
