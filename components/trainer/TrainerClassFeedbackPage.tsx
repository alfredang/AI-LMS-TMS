import React, { useEffect, useState } from 'react';
import { useLms } from '../../contexts/LmsContext';
import { ClassFeedbackView } from './ClassFeedbackView';

/**
 * Trainer layout → Post Course Feedback for one class (opened from the class page's "View all
 * feedback"). Same two-column page as E-Attendance: the trainer menu stays on the left and
 * Back to Class reloads the class page.
 */
const TrainerClassFeedbackPage: React.FC = () => {
  const { loadCourseData } = useLms();
  const [runId, setRunId] = useState('');
  const [sourceCourse, setSourceCourse] = useState<any | null>(null);

  useEffect(() => {
    try {
      setRunId(sessionStorage.getItem('feedbackCourseRunUuid') || '');
      const raw = sessionStorage.getItem('feedbackSourceCourse');
      if (raw) setSourceCourse(JSON.parse(raw));
    } catch { /* storage unavailable */ }
  }, []);

  const backToClass = () => {
    if (!sourceCourse) return;
    try { sessionStorage.removeItem('feedbackSourceCourse'); } catch {}
    void loadCourseData(sourceCourse).catch(err => console.error('Failed to reload class:', err));
  };

  if (!runId) return <p className="text-sm text-muted">Open a class and choose View all feedback.</p>;
  return (
    <ClassFeedbackView
      runId={runId}
      onBack={sourceCourse ? backToClass : undefined}
      backTitle={sourceCourse?.title ? `Back to ${sourceCourse.title}` : undefined}
    />
  );
};

export default TrainerClassFeedbackPage;
