import React, { useState, useEffect } from 'react';
import { useLms } from '../../contexts/LmsContext';
import { useTrainerCourses } from '../../hooks/useTrainerCourses';

interface Learner {
  user_id: string;
  full_name: string;
  email: string;
}

interface GradeEntry {
  grade: 'C' | 'NYC' | '';
  reason: string;
}

interface SubmissionRecord {
  learner_id: string;
  learner_name: string;
  learner_email: string;
  assessment_id: string;
  assessment_title: string;
  submission_file: string | null;
  file_url: string | null;
  submitted_at: string | null;
  grading: string | null;
}

interface LearnerWithSubmissions extends Learner {
  submissions: {
    assessment_title: string;
    submission_file: string | null;
    file_url: string | null;
    submitted_at: string | null;
  }[];
}

const AssessmentGrading: React.FC = () => {
  const { currentUser } = useLms();
  const { courses, loading: coursesLoading } = useTrainerCourses(currentUser?.id);

  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [learners, setLearners] = useState<LearnerWithSubmissions[]>([]);
  const [loadingLearners, setLoadingLearners] = useState(false);
  const [grades, setGrades] = useState<Record<string, GradeEntry>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadingGrades, setLoadingGrades] = useState(false);
  const [assessmentRecordLink, setAssessmentRecordLink] = useState<string | null>(null);
  const [expandedLearner, setExpandedLearner] = useState<string | null>(null);

  // Get selected course object for assessment record link
  const selectedCourseObj = courses.find(c => c.id === selectedCourseRunId);

  // Fetch learners + submissions + grades when course run is selected
  useEffect(() => {
    if (!selectedCourseRunId) {
      setLearners([]);
      setGrades({});
      setAssessmentRecordLink(null);
      setExpandedLearner(null);
      return;
    }

    // Fetch course detail for assessment record link
    const fetchCourseDetail = async () => {
      try {
        const course = courses.find(c => c.id === selectedCourseRunId);
        if (course?.courseRunId) {
          const res = await fetch(`/api/courses/trainer-detail?courseRunId=${course.courseRunId}`);
          const data = await res.json();
          if (data.assessmentRecordLink) {
            setAssessmentRecordLink(data.assessmentRecordLink);
          }
        }
      } catch {
        // Non-critical
      }
    };
    fetchCourseDetail();

    const fetchData = async () => {
      setLoadingLearners(true);
      setMsg(null);
      try {
        // Fetch enrollments and submissions in parallel
        const [enrollRes, subRes] = await Promise.all([
          fetch(`/api/admin/course-run-enrollments?courseRunId=${selectedCourseRunId}`),
          fetch(`/api/grading/learner-submissions?courseRunId=${selectedCourseRunId}`),
        ]);
        const enrollData = await enrollRes.json();
        const subData = await subRes.json();

        const enrolledLearners: Learner[] = enrollData.success ? enrollData.data : [];
        const allSubmissions: SubmissionRecord[] = subData.success ? subData.data : [];

        // Group submissions by learner
        const subsByLearner = new Map<string, SubmissionRecord[]>();
        allSubmissions.forEach(s => {
          const list = subsByLearner.get(s.learner_id) || [];
          list.push(s);
          subsByLearner.set(s.learner_id, list);
        });

        // Merge learners with their submissions
        const merged: LearnerWithSubmissions[] = enrolledLearners.map(l => ({
          ...l,
          submissions: (subsByLearner.get(l.user_id) || []).map(s => ({
            assessment_title: s.assessment_title,
            submission_file: s.submission_file,
            file_url: s.file_url,
            submitted_at: s.submitted_at,
          })),
        }));

        setLearners(merged);

        // Initialize grades
        const initial: Record<string, GradeEntry> = {};
        merged.forEach(l => {
          initial[l.user_id] = { grade: '', reason: '' };
        });
        setGrades(initial);

        // Fetch existing grades
        setLoadingGrades(true);
        try {
          const gradeRes = await fetch(`/api/trainer/assessment-grading?courseRunId=${selectedCourseRunId}`);
          const gradeData = await gradeRes.json();
          if (gradeData.success && Array.isArray(gradeData.data)) {
            const updated = { ...initial };
            gradeData.data.forEach((row: any) => {
              if (updated[row.learner_user_id]) {
                updated[row.learner_user_id] = {
                  grade: row.grade as 'C' | 'NYC',
                  reason: row.reason || '',
                };
              }
            });
            setGrades(updated);
          }
        } catch {
          // Non-critical
        } finally {
          setLoadingGrades(false);
        }
      } catch {
        setMsg({ type: 'error', text: 'Failed to load data' });
      } finally {
        setLoadingLearners(false);
      }
    };

    fetchData();
  }, [selectedCourseRunId]);

  const handleGradeChange = (userId: string, grade: 'C' | 'NYC') => {
    setGrades(prev => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        grade,
        reason: grade === 'C' ? '' : prev[userId]?.reason || '',
      },
    }));
  };

  const handleReasonChange = (userId: string, reason: string) => {
    setGrades(prev => ({
      ...prev,
      [userId]: { ...prev[userId], reason },
    }));
  };

  const handleSubmit = async () => {
    const ungraded = learners.filter(l => !grades[l.user_id]?.grade);
    if (ungraded.length > 0) {
      setMsg({ type: 'error', text: `Please grade all learners before submitting. ${ungraded.length} learner(s) not graded.` });
      return;
    }

    const nycNoReason = learners.filter(l => grades[l.user_id]?.grade === 'NYC' && !grades[l.user_id]?.reason?.trim());
    if (nycNoReason.length > 0) {
      setMsg({ type: 'error', text: `Please provide a reason for all Not-Yet-Competent learners. ${nycNoReason.length} missing.` });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/trainer/assessment-grading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseRunId: selectedCourseRunId,
          gradedBy: currentUser?.id,
          grades: learners.map(l => ({
            learnerUserId: l.user_id,
            grade: grades[l.user_id].grade,
            reason: grades[l.user_id].reason,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: 'Assessment grades saved successfully!' });
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to save grades' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error saving grades' });
    } finally {
      setSaving(false);
    }
  };

  const today = new Date(new Date().toDateString());
  const activeCourses = courses.filter(c => {
    const end = c.endDate ? new Date(c.endDate) : null;
    return !end || end >= today;
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold dark:text-white">Assessment Grading</h1>

      {/* Class Selection */}
      <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <h2 className="text-sm font-semibold text-on-surface">Select Class</h2>
        </div>
        <div className="p-4">
          {coursesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
              Loading classes...
            </div>
          ) : activeCourses.length === 0 ? (
            <p className="text-sm text-muted">No active classes found.</p>
          ) : (
            <select
              value={selectedCourseRunId}
              onChange={e => setSelectedCourseRunId(e.target.value)}
              className="w-full max-w-lg px-3 py-2 text-sm border border-default rounded-lg bg-surface text-on-surface focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            >
              <option value="">— Select a class —</option>
              {activeCourses.map(c => (
                <option key={c.courseRunId} value={c.id}>
                  {c.title} ({c.courseRunId})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Assessment Record Link (course-level) */}
      {selectedCourseRunId && assessmentRecordLink && (
        <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-default">
            <h2 className="text-sm font-semibold text-on-surface">Assessment Records</h2>
          </div>
          <div className="p-4">
            <a
              href={assessmentRecordLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors text-sm font-medium"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Open Assessment Records Folder
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      )}

      {/* Combined Grading Roster */}
      {selectedCourseRunId && (
        <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-default">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-on-surface">Grading Roster</h2>
              {learners.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                  {learners.length}
                </span>
              )}
              {(loadingLearners || loadingGrades) && (
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary" />
                  {loadingGrades ? 'Loading grades...' : 'Loading...'}
                </div>
              )}
            </div>
          </div>

          {loadingLearners ? (
            <div className="p-6 text-center text-sm text-muted">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
              Loading learners...
            </div>
          ) : learners.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">
              No learners enrolled in this class.
            </div>
          ) : (
            <>
              <div className="divide-y divide-default">
                {learners.map((learner, idx) => {
                  const entry = grades[learner.user_id] || { grade: '', reason: '' };
                  const isExpanded = expandedLearner === learner.user_id;
                  const submittedCount = learner.submissions.filter(s => s.file_url).length;
                  const totalCount = learner.submissions.length;

                  return (
                    <div key={learner.user_id}>
                      {/* Learner Row */}
                      <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
                        {/* # + Name + Submissions toggle */}
                        <div className="flex items-center gap-3 lg:w-[320px] flex-shrink-0">
                          <span className="text-xs text-muted w-6 text-right flex-shrink-0">{idx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-on-surface text-sm truncate">{learner.full_name}</p>
                            <p className="text-xs text-muted truncate">{learner.email}</p>
                          </div>
                          {/* Submissions toggle */}
                          {totalCount > 0 && (
                            <button
                              onClick={() => setExpandedLearner(isExpanded ? null : learner.user_id)}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-default text-xs font-medium text-on-surface-secondary hover:bg-surface-elevated transition-colors flex-shrink-0"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              {submittedCount}/{totalCount} files
                              <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {/* Grading controls */}
                        <div className="flex items-center gap-4 flex-1 lg:justify-end">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name={`grade-${learner.user_id}`}
                              checked={entry.grade === 'C'}
                              onChange={() => handleGradeChange(learner.user_id, 'C')}
                              className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                            />
                            <span className={`text-xs font-medium ${entry.grade === 'C' ? 'text-green-600 dark:text-green-400' : 'text-muted'}`}>Competent</span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name={`grade-${learner.user_id}`}
                              checked={entry.grade === 'NYC'}
                              onChange={() => handleGradeChange(learner.user_id, 'NYC')}
                              className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                            />
                            <span className={`text-xs font-medium ${entry.grade === 'NYC' ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}>NYC</span>
                          </label>
                          <input
                            type="text"
                            value={entry.reason}
                            onChange={e => handleReasonChange(learner.user_id, e.target.value)}
                            disabled={entry.grade !== 'NYC'}
                            placeholder={entry.grade === 'NYC' ? 'Reason for NYC...' : '—'}
                            className={`w-48 px-2.5 py-1.5 text-sm border rounded-md transition-colors ${
                              entry.grade === 'NYC'
                                ? 'border-default bg-surface text-on-surface focus:ring-2 focus:ring-primary/30 focus:border-primary'
                                : 'border-transparent bg-transparent text-muted cursor-not-allowed'
                            }`}
                          />
                        </div>
                      </div>

                      {/* Expanded submissions panel */}
                      {isExpanded && learner.submissions.length > 0 && (
                        <div className="px-4 pb-3 pl-14">
                          <div className="bg-surface-elevated rounded-lg border border-default overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-default">
                                  <th className="px-3 py-2 text-left font-semibold text-on-surface-secondary uppercase tracking-wider">Assessment</th>
                                  <th className="px-3 py-2 text-left font-semibold text-on-surface-secondary uppercase tracking-wider">File</th>
                                  <th className="px-3 py-2 text-left font-semibold text-on-surface-secondary uppercase tracking-wider">Submitted</th>
                                  <th className="px-3 py-2 text-center font-semibold text-on-surface-secondary uppercase tracking-wider">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-default">
                                {learner.submissions.map((sub, si) => (
                                  <tr key={si}>
                                    <td className="px-3 py-2 text-on-surface">{sub.assessment_title}</td>
                                    <td className="px-3 py-2">
                                      {sub.file_url ? (
                                        <a
                                          href={sub.file_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                                        >
                                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                          </svg>
                                          {sub.submission_file || 'View'}
                                        </a>
                                      ) : (
                                        <span className="text-muted">Not submitted</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-muted">
                                      {sub.submitted_at
                                        ? new Date(sub.submitted_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
                                        : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      {sub.file_url ? (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                          Submitted
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                                          Pending
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Message & Submit */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-default">
                <div>
                  {msg && (
                    <p className={`text-sm font-medium ${msg.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {msg.text}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={saving || loadingLearners || loadingGrades}
                  className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Submit Grades'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AssessmentGrading;
