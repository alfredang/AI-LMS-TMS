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

const PastAssessment: React.FC = () => {
  const { currentUser } = useLms();
  const [classes, setClasses] = useState<PastClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // Fetch past classes
  useEffect(() => {
    if (!currentUser?.email) return;
    setLoadingClasses(true);
    fetch(`/api/trainer/past-classes?email=${encodeURIComponent(currentUser.email)}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setClasses(data);
      })
      .catch(err => console.error('Failed to fetch past classes:', err))
      .finally(() => setLoadingClasses(false));
  }, [currentUser?.email]);

  // Fetch students for selected class
  useEffect(() => {
    if (!selectedRunId) {
      setStudents([]);
      return;
    }
    setLoadingStudents(true);
    fetch(`/api/trainer/class-students?courseRunId=${selectedRunId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setStudents(data);
      })
      .catch(err => console.error('Failed to fetch students:', err))
      .finally(() => setLoadingStudents(false));
  }, [selectedRunId]);

  const selectedClass = classes.find(c => c.run_id === selectedRunId);
  const competentCount = students.filter(s => s.is_competent).length;
  const notCompetentCount = students.length - competentCount;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">Past Assessments</h1>
      <p className="text-sm text-muted">View assessment grading records from your completed classes.</p>

      {/* Class Selection */}
      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-default bg-surface-elevated">
          <label className="block text-sm font-semibold text-on-surface-secondary mb-2">
            Select a Past Class
          </label>
          <div className="relative w-full">
            {loadingClasses ? (
              <div className="flex items-center gap-2 text-sm text-muted py-2">
                <Icon name={IconName.Spinner} className="w-5 h-5 animate-spin text-blue-500" />
                Loading your past classes...
              </div>
            ) : classes.length === 0 ? (
              <p className="text-sm text-muted py-2">No past classes found.</p>
            ) : (
              <select
                value={selectedRunId}
                onChange={e => setSelectedRunId(e.target.value)}
                className="w-full pl-3 pr-10 py-2.5 text-base border-strong focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md dark:bg-gray-700 dark:text-white shadow-sm"
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
          <div className="px-5 py-3 bg-info-bg text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-on-surface-secondary">
              <span><strong>Course:</strong> {selectedClass.course_title}</span>
              <span><strong>Run:</strong> {selectedClass.run_code}</span>
              <span><strong>Status:</strong> {selectedClass.class_status || 'Completed'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {selectedRunId && students.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-surface rounded-lg border border-default shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-on-surface">{students.length}</p>
            <p className="text-xs text-muted mt-1">Total Students</p>
          </div>
          <div className="bg-surface rounded-lg border border-default shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-success">{competentCount}</p>
            <p className="text-xs text-muted mt-1">Competent</p>
          </div>
          <div className="bg-surface rounded-lg border border-default shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-warning">{notCompetentCount}</p>
            <p className="text-xs text-muted mt-1">Not Yet Competent</p>
          </div>
        </div>
      )}

      {/* Student Assessment Records */}
      {selectedRunId && (
        <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-default bg-surface-elevated flex justify-between items-center">
            <h2 className="text-sm font-semibold text-on-surface-secondary">
              Assessment Grading Records
            </h2>
            <div className="text-xs text-muted bg-surface px-3 py-1 rounded-full border border-default">
              {students.length} Students
            </div>
          </div>

          <div className="p-0">
            {loadingStudents ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted">
                <Icon name={IconName.Spinner} className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                <p>Loading assessment records...</p>
              </div>
            ) : students.length === 0 ? (
              <div className="py-12 text-center text-muted">
                <Icon name={IconName.Users} className="w-12 h-12 mx-auto text-muted mb-3" />
                <p>No students found for this class.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-default bg-surface-elevated">
                      <th className="px-5 py-3 text-left font-medium text-muted">#</th>
                      <th className="px-5 py-3 text-left font-medium text-muted">Learner Name</th>
                      <th className="px-5 py-3 text-left font-medium text-muted">Learner NRIC</th>
                      <th className="px-5 py-3 text-left font-medium text-muted">Source</th>
                      <th className="px-5 py-3 text-left font-medium text-muted">Assessment Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {students.map((student, idx) => (
                      <tr key={student.enrolment_id || idx} className="hover:bg-surface-hover transition-colors">
                        <td className="px-5 py-3 text-muted font-mono">{idx + 1}</td>
                        <td className="px-5 py-3 font-medium text-on-surface">{student.student_name}</td>
                        <td className="px-5 py-3 text-muted font-mono text-xs">{student.nric ? '****' + student.nric.slice(4) : '—'}</td>
                        <td className="px-5 py-3">
                          {student.source === 'ssg' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                              SSG Sync
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-surface-elevated text-on-surface-secondary">
                              Manual
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            student.is_competent
                              ? 'bg-success-bg text-success'
                              : 'bg-warning-bg text-warning'
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

export default PastAssessment;
