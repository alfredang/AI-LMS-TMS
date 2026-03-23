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

const AssessmentGrading: React.FC = () => {
  const { currentUser } = useLms();
  const { courses, loading: coursesLoading } = useTrainerCourses(currentUser?.id);

  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [learners, setLearners] = useState<Learner[]>([]);
  const [loadingLearners, setLoadingLearners] = useState(false);
  const [grades, setGrades] = useState<Record<string, GradeEntry>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadingGrades, setLoadingGrades] = useState(false);

  // Fetch learners when course run is selected
  useEffect(() => {
    if (!selectedCourseRunId) {
      setLearners([]);
      setGrades({});
      return;
    }

    const fetchLearners = async () => {
      setLoadingLearners(true);
      setMsg(null);
      try {
        const res = await fetch(`/api/admin/course-run-enrollments?courseRunId=${selectedCourseRunId}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setLearners(data.data);
          // Initialize grades for each learner
          const initial: Record<string, GradeEntry> = {};
          data.data.forEach((l: Learner) => {
            initial[l.user_id] = { grade: '', reason: '' };
          });
          setGrades(initial);
          // Now fetch existing grades
          fetchExistingGrades(initial, data.data);
        }
      } catch (err) {
        setMsg({ type: 'error', text: 'Failed to load learners' });
      } finally {
        setLoadingLearners(false);
      }
    };

    const fetchExistingGrades = async (initial: Record<string, GradeEntry>, learnersList: Learner[]) => {
      setLoadingGrades(true);
      try {
        const res = await fetch(`/api/trainer/assessment-grading?courseRunId=${selectedCourseRunId}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          const merged = { ...initial };
          data.data.forEach((row: any) => {
            if (merged[row.learner_user_id]) {
              merged[row.learner_user_id] = {
                grade: row.grade as 'C' | 'NYC',
                reason: row.reason || '',
              };
            }
          });
          setGrades(merged);
        }
      } catch {
        // Grades not loaded — not critical, user can still grade
      } finally {
        setLoadingGrades(false);
      }
    };

    fetchLearners();
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
    // Validate: all learners must have a grade selected
    const ungraded = learners.filter(l => !grades[l.user_id]?.grade);
    if (ungraded.length > 0) {
      setMsg({ type: 'error', text: `Please grade all learners before submitting. ${ungraded.length} learner(s) not graded.` });
      return;
    }

    // Validate: NYC learners must have a reason
    const nycNoReason = learners.filter(l => grades[l.user_id]?.grade === 'NYC' && !grades[l.user_id]?.reason?.trim());
    if (nycNoReason.length > 0) {
      setMsg({ type: 'error', text: `Please provide a reason for all Not-Yet-Competent learners. ${nycNoReason.length} missing.` });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        courseRunId: selectedCourseRunId,
        gradedBy: currentUser?.id,
        grades: learners.map(l => ({
          learnerUserId: l.user_id,
          grade: grades[l.user_id].grade,
          reason: grades[l.user_id].reason,
        })),
      };

      const res = await fetch('/api/trainer/assessment-grading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ type: 'success', text: 'Assessment grades saved successfully!' });
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to save grades' });
      }
    } catch (err) {
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

      {/* Grading Table */}
      {selectedCourseRunId && (
        <div className="bg-surface rounded-lg border border-default shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-default">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-on-surface">Learner Grades</h2>
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
              Loading enrolled learners...
            </div>
          ) : learners.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">
              No learners enrolled in this class.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-elevated">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-on-surface-secondary uppercase tracking-wider w-8">#</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-on-surface-secondary uppercase tracking-wider">Learner Name</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-on-surface-secondary uppercase tracking-wider">Email</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-on-surface-secondary uppercase tracking-wider">Competent (C)</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-on-surface-secondary uppercase tracking-wider">Not-Yet-Competent (NYC)</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-on-surface-secondary uppercase tracking-wider">Reason for NYC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {learners.map((learner, idx) => {
                      const entry = grades[learner.user_id] || { grade: '', reason: '' };
                      return (
                        <tr key={learner.user_id} className="hover:bg-surface-elevated/50 transition-colors">
                          <td className="px-4 py-3 text-muted">{idx + 1}</td>
                          <td className="px-4 py-3 font-medium text-on-surface">{learner.full_name}</td>
                          <td className="px-4 py-3 text-on-surface-secondary">{learner.email}</td>
                          <td className="px-4 py-3 text-center">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name={`grade-${learner.user_id}`}
                                checked={entry.grade === 'C'}
                                onChange={() => handleGradeChange(learner.user_id, 'C')}
                                className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                              />
                              <span className={`text-xs font-medium ${entry.grade === 'C' ? 'text-green-600 dark:text-green-400' : 'text-muted'}`}>C</span>
                            </label>
                          </td>
                          <td className="px-4 py-3 text-center">
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
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={entry.reason}
                              onChange={e => handleReasonChange(learner.user_id, e.target.value)}
                              disabled={entry.grade !== 'NYC'}
                              placeholder={entry.grade === 'NYC' ? 'Enter reason...' : '—'}
                              className={`w-full px-2.5 py-1.5 text-sm border rounded-md transition-colors ${
                                entry.grade === 'NYC'
                                  ? 'border-default bg-surface text-on-surface focus:ring-2 focus:ring-primary/30 focus:border-primary'
                                  : 'border-transparent bg-transparent text-muted cursor-not-allowed'
                              }`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
