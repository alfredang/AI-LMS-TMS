import React, { useState, useEffect } from 'react';
import { useLms } from '../../contexts/LmsContext';
import { Icon, IconName } from '../ui/Icon';

interface ClassData {
  course_id: string;
  course_title: string;
  course_code: string;
  run_id: string;
  run_code: string;
  start_date: string;
  end_date: string;
  class_status: string;
}

interface StudentData {
  enrolment_id: string;
  user_id: string | null;
  student_name: string;
  email: string;
  competent_status: string;
  certificate: string | null;
  source: 'manual' | 'ssg';
  is_competent: boolean;
}

const AssessmentGrading: React.FC = () => {
  const { currentUser, pendingGradingCourseRunId, setPendingGradingCourseRunId } = useLms();
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (currentUser?.email) {
      setLoadingClasses(true);
      Promise.all([
        fetch(`/api/trainer/classes?email=${encodeURIComponent(currentUser.email)}`).then(res => res.json()),
        fetch(`/api/trainer/past-classes?email=${encodeURIComponent(currentUser.email)}`).then(res => res.json())
      ])
        .then(([active, past]) => {
          const merged = [];
          if (Array.isArray(active)) merged.push(...active);
          if (Array.isArray(past)) merged.push(...past);
          setClasses(merged);
        })
        .finally(() => setLoadingClasses(false));
    }
  }, [currentUser?.email]);

  // Auto-select course run when navigating from CourseDetail Assessment Grading link
  useEffect(() => {
    if (!pendingGradingCourseRunId || loadingClasses) return;
    if (classes.length === 0) return;
    const match = classes.find(c => c.run_id === pendingGradingCourseRunId || c.run_code === pendingGradingCourseRunId);
    if (match) {
      setSelectedCourseRunId(match.run_id);
      setPendingGradingCourseRunId(null);
    }
  }, [pendingGradingCourseRunId, classes, loadingClasses]);

  useEffect(() => {
    if (!selectedCourseRunId) {
      setStudents([]);
      return;
    }
    setLoadingStudents(true);
    fetch(`/api/trainer/class-students?courseRunId=${selectedCourseRunId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setStudents(data);
      })
      .finally(() => setLoadingStudents(false));
  }, [selectedCourseRunId]);

  const handleToggleCompetency = async (student: StudentData, index: number) => {
    const newCompetentState = !student.is_competent;
    const studentId = student.enrolment_id || student.student_name;
    
    // Optimistic UI update
    const updatedStudents = [...students];
    updatedStudents[index].is_competent = newCompetentState;
    updatedStudents[index].competent_status = newCompetentState ? 'Competent' : 'Not Yet Competent';
    if (!newCompetentState) {
      updatedStudents[index].certificate = null; // Clear certificate when marking incompetent
    }
    setStudents(updatedStudents);

    setSavingStatus(prev => ({ ...prev, [studentId]: true }));

    try {
      const res = await fetch('/api/trainer/grade-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrolmentId: student.enrolment_id,
          source: student.source,
          isCompetent: newCompetentState
        })
      });
      if (!res.ok) throw new Error('Failed to update');

      // If marking competent, re-fetch to pick up the generated certificate URL
      if (newCompetentState) {
        const refreshRes = await fetch(`/api/trainer/class-students?courseRunId=${selectedCourseRunId}`);
        const refreshData = await refreshRes.json();
        if (Array.isArray(refreshData)) setStudents(refreshData);
      }

    } catch (e) {
      console.error('Failed to save competency status', e);
      // Revert optimism on failure
      const reverted = [...students];
      reverted[index].is_competent = !newCompetentState;
      reverted[index].competent_status = student.competent_status;
      setStudents(reverted);
      alert('Failed to save assessment status. Please try again.');
    } finally {
      setSavingStatus(prev => ({ ...prev, [studentId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">Assessment Grading</h1>

      {/* Class Selection */}
      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Select a Class You Teach
          </label>
          <div className="relative w-full">
            {loadingClasses ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Icon name={IconName.Spinner} className="w-5 h-5 animate-spin text-blue-500" />
                Loading your assigned classes...
              </div>
            ) : (
              <select
                value={selectedCourseRunId}
                onChange={e => setSelectedCourseRunId(e.target.value)}
                className="w-full pl-3 pr-10 py-2.5 text-base border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md dark:bg-gray-700 dark:text-white shadow-sm"
              >
                <option value="">— Choose a class —</option>
                {classes.map(c => (
                  <option key={c.run_id} value={c.run_id}>
                    {c.course_title} | {c.run_code} ({new Date(c.start_date || '').toLocaleDateString('en-GB')} - {new Date(c.end_date || '').toLocaleDateString('en-GB')})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Student List */}
      {selectedCourseRunId && (
        <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Student Grading Roster
            </h2>
            <div className="text-xs text-gray-500 bg-white dark:bg-gray-700 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-600">
              {students.length} Enrolments
            </div>
          </div>
          
          <div className="p-0">
            {loadingStudents ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Icon name={IconName.Spinner} className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                <p>Loading students across manual and synced enrolments...</p>
              </div>
            ) : students.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <Icon name={IconName.Users} className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p>No students enrolled in this class.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {students.map((student, idx) => {
                  const sId = student.enrolment_id || student.student_name;
                  const isSaving = savingStatus[sId];
                  return (
                    <li key={sId} className="px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 mr-4 text-gray-400 font-mono text-sm w-6 text-right">
                          {idx + 1}.
                        </div>
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-lg border border-blue-200 dark:border-blue-800 mr-4 select-none">
                          {student.student_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {student.student_name}
                            {student.source === 'ssg' && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                                SSG Sync
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {student.email || 'No email provided'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-4">
                        {/* Certificate Status Badge */}
                        {student.is_competent && (
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                            student.certificate
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          }`}>
                            <Icon name={student.certificate ? IconName.CheckCircle : IconName.Clock} className="w-3.5 h-3.5" />
                            {student.certificate ? 'Cert Issued' : 'Cert Pending'}
                          </span>
                        )}

                        <span className={`text-xs font-semibold uppercase tracking-wider ${
                            student.is_competent ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-500'
                          }`}>
                            {student.is_competent ? 'Competent' : 'Not Yet Competent'}
                        </span>
                        
                        {/* iOS-style toggle switch */}
                        <div className="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                          <input
                            type="checkbox"
                            id={`toggle-${sId}`}
                            checked={student.is_competent}
                            onChange={() => handleToggleCompetency(student, idx)}
                            disabled={isSaving}
                            className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                            style={{
                              borderColor: student.is_competent ? '#10B981' : '#D1D5DB',
                              transform: student.is_competent ? 'translateX(100%)' : 'translateX(0)',
                              transition: 'all 0.2s ease-in-out',
                              zIndex: 10
                            }}
                          />
                          <label
                            htmlFor={`toggle-${sId}`}
                            className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${
                              student.is_competent ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                            style={{ transition: 'background-color 0.2s ease-in-out' }}
                          ></label>
                        </div>
                        
                        {isSaving && (
                          <div className="absolute right-[6.5rem]">
                            <Icon name={IconName.Spinner} className="w-4 h-4 animate-spin text-blue-500" />
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AssessmentGrading;
