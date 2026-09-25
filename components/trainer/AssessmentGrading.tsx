import React, { useState, useEffect } from 'react';
import { useLms } from '../../contexts/LmsContext';
import { Icon, IconName } from '../ui/Icon';
import { AssessorSignatureDialog, AssessorRecord } from './AssessorSignatureForm';

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
  submitted_assessments: string[];
  traqom_completed?: boolean;
  /** Files the learner uploaded for this run (all methods). */
  submission_count?: number;
  /** True when every uploaded file carries the assessor sign-off stamp. */
  assessor_signed?: boolean;
  /** Learner's "Assessment Records" folder in Google Drive, when they have uploaded. */
  assessment_folder_url?: string | null;
  // A learner with several enrolment rows in the run (manual + SSG-synced) is
  // merged server-side; grading actions must hit every row.
  enrolment_ids?: string[];
  emails?: string[];
}

const enrolmentIdsOf = (s: StudentData) =>
  s.enrolment_ids && s.enrolment_ids.length > 0 ? s.enrolment_ids : [s.enrolment_id];

// Abbreviations for each assessment method (WA = Written Exam, PP = Practical Exam, ...)
const METHOD_INFO: Record<string, { abbr: string; label: string }> = {
  writtenAssessment: { abbr: 'WA', label: 'Written Exam' },
  practicalExam: { abbr: 'PP', label: 'Practical Exam' },
  caseStudy: { abbr: 'CS', label: 'Case Study' },
  rolePlay: { abbr: 'RP', label: 'Role Play' },
  oralQuestioning: { abbr: 'OQ', label: 'Oral Questioning' },
  project: { abbr: 'PJ', label: 'Project' },
  assignment: { abbr: 'AS', label: 'Assignment' },
};

const AssessmentGrading: React.FC = () => {
  const { currentUser, pendingGradingCourseRunId, setPendingGradingCourseRunId, setSelectedCourse } = useLms();
  // Course the trainer navigated from (stashed by CourseDetail's Assessment Grading
  // link) — drives the "Back to Class" button, same pattern as E-Attendance.
  const [sourceCourse, setSourceCourse] = useState<any | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('gradingSourceCourse');
      if (raw) setSourceCourse(JSON.parse(raw));
    } catch {}
  }, []);
  const handleBackToClass = () => {
    if (!sourceCourse) return;
    if (typeof window !== 'undefined') {
      try { sessionStorage.removeItem('gradingSourceCourse'); } catch {}
    }
    setSelectedCourse(sourceCourse);
  };
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');

  const [students, setStudents] = useState<StudentData[]>([]);
  const [assessmentMethods, setAssessmentMethods] = useState<string[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [refreshingStudents, setRefreshingStudents] = useState(false);
  const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
  const [certVerification, setCertVerification] = useState<Record<string, { checking: boolean; exists?: boolean }>>({});

  // Mark All Competent state
  const [markingAllCompetent, setMarkingAllCompetent] = useState(false);

  // TRAQOM survey tick — manual, per learner (SSG gives no completion feed)
  const [savingTraqom, setSavingTraqom] = useState<Record<string, boolean>>({});

  // Assessor sign-off: the trainer's saved name/NRIC/date/signature, stamped onto
  // a learner's submitted files when the SIGN box is ticked.
  const [assessor, setAssessor] = useState<AssessorRecord | null>(null);
  const [assessorLoaded, setAssessorLoaded] = useState(false);
  const [showAssessorDialog, setShowAssessorDialog] = useState(false);
  const [signingStudent, setSigningStudent] = useState<Record<string, boolean>>({});
  // Learner whose SIGN tick was interrupted by the dialog; resumes once saved.
  const [pendingSign, setPendingSign] = useState<{ student: StudentData; index: number } | null>(null);
  const [signResult, setSignResult] = useState<{ name: string; lines: string[]; ok: boolean } | null>(null);
  const [showSignDemo, setShowSignDemo] = useState(false);

  useEffect(() => {
    if (!currentUser?.id) return;
    fetch('/api/trainer/assessor-signature')
      .then(r => r.json())
      .then(json => {
        if (json?.success && json.exists && json.data?.signature_png) setAssessor(json.data);
        else setAssessor(null);
      })
      .catch(() => setAssessor(null))
      .finally(() => setAssessorLoaded(true));
  }, [currentUser?.id]);

  // Send Certificate state
  const [selectedForCert, setSelectedForCert] = useState<Set<string>>(new Set());
  const [sendingCerts, setSendingCerts] = useState(false);
  const [certSendResult, setCertSendResult] = useState<{ message: string; results?: { name: string; status: string; error?: string }[] } | null>(null);

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

  const fetchStudents = (silent = false) => {
    if (!selectedCourseRunId) return;
    if (silent) {
      setRefreshingStudents(true);
    } else {
      setLoadingStudents(true);
      setCertSendResult(null);
    }
    fetch(`/api/trainer/class-students?courseRunId=${selectedCourseRunId}&withMeta=1`)
      .then(res => res.json())
      .then(data => {
        const list: StudentData[] = Array.isArray(data) ? data : data?.students;
        if (Array.isArray(list)) {
          setStudents(list);
          setAssessmentMethods(Array.isArray(data?.assessment_methods) ? data.assessment_methods : []);
          if (silent) {
            // Keep the trainer's cert selection, dropping enrolments no longer in the roster
            setSelectedForCert(prev => new Set(list.filter(s => prev.has(s.enrolment_id)).map(s => s.enrolment_id)));
          } else {
            // Default: select all learners for certificate sending
            setSelectedForCert(new Set(list.map((s: StudentData) => s.enrolment_id)));
          }
          // Verify certificates against Google Drive
          verifyCertificates(list);
        }
      })
      .finally(() => (silent ? setRefreshingStudents(false) : setLoadingStudents(false)));
  };

  useEffect(() => {
    if (!selectedCourseRunId) {
      setStudents([]);
      return;
    }
    fetchStudents();
  }, [selectedCourseRunId]);

  const verifyCertificates = async (studentList: StudentData[]) => {
    const studentsWithCerts = studentList.filter(s => s.is_competent && s.certificate);
    if (studentsWithCerts.length === 0) return;

    // Mark all as checking
    const initialState: Record<string, { checking: boolean; exists?: boolean }> = {};
    studentsWithCerts.forEach(s => {
      const sId = s.enrolment_id || s.student_name;
      initialState[sId] = { checking: true };
    });
    setCertVerification(initialState);

    // Verify each certificate in parallel
    await Promise.allSettled(
      studentsWithCerts.map(async (s) => {
        const sId = s.enrolment_id || s.student_name;
        try {
          const res = await fetch(`/api/certificates/verify-drive?url=${encodeURIComponent(s.certificate!)}`);
          const data = await res.json();
          setCertVerification(prev => ({
            ...prev,
            [sId]: { checking: false, exists: data.exists === true }
          }));
        } catch {
          setCertVerification(prev => ({
            ...prev,
            [sId]: { checking: false, exists: false }
          }));
        }
      })
    );
  };

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
          enrolmentIds: enrolmentIdsOf(student),
          source: student.source,
          isCompetent: newCompetentState
        })
      });
      if (!res.ok) throw new Error('Failed to update');

      // Note: competency toggle does NOT generate certificates. Certificates
      // are generated by the scheduler (auto-create-certificates) based on
      // attendance score. No re-fetch needed here for cert status.

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

  const handleToggleTraqom = async (student: StudentData, index: number) => {
    const newState = !student.traqom_completed;
    const studentId = student.enrolment_id || student.student_name;

    // Optimistic UI update — functional so rapid ticks down the roster don't
    // clobber each other via a stale `students` snapshot.
    setStudents(prev => prev.map((s, i) =>
      i === index ? { ...s, traqom_completed: newState } : s
    ));

    setSavingTraqom(prev => ({ ...prev, [studentId]: true }));

    try {
      const res = await fetch('/api/trainer/traqom-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrolmentIds: enrolmentIdsOf(student), completed: newState })
      });
      if (!res.ok) throw new Error('Failed to update');
    } catch (e) {
      console.error('Failed to save TRAQOM status', e);
      setStudents(prev => prev.map((s, i) =>
        i === index ? { ...s, traqom_completed: !newState } : s
      ));
      alert('Failed to save TRAQOM status. Please try again.');
    } finally {
      setSavingTraqom(prev => ({ ...prev, [studentId]: false }));
    }
  };

  const runSign = async (student: StudentData, index: number, signed: boolean) => {
    if (!student.user_id || !selectedCourseRunId) return;
    const studentId = student.enrolment_id || student.student_name;
    setSigningStudent(prev => ({ ...prev, [studentId]: true }));
    setSignResult(null);
    try {
      const res = await fetch('/api/trainer/sign-assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunId: selectedCourseRunId, learnerUserId: student.user_id, signed }),
      });
      const json = await res.json();
      if (res.status === 409 && (json?.code === 'NO_ASSESSOR_PROFILE' || json?.code === 'NO_SIGNATURE')) {
        setPendingSign({ student, index });
        setShowAssessorDialog(true);
        return;
      }
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to update assessor signature');

      const results: { fileName: string; status: string; reason?: string; filled?: string[] }[] = json.results || [];
      setStudents(prev => prev.map((s, i) => (i === index ? { ...s, assessor_signed: !!json.signed } : s)));

      const lines = results.map(r => {
        if (r.status === 'signed') return `✓ ${r.fileName}`;
        if (r.status === 'unsigned') return `↩ ${r.fileName} restored`;
        return `• ${r.fileName}: ${r.reason || r.status}`;
      });
      const ok = signed ? results.some(r => r.status === 'signed') : results.every(r => r.status !== 'error');
      if (!ok || results.some(r => r.status === 'skipped' || r.status === 'error')) {
        setSignResult({ name: student.student_name, lines, ok });
      }
    } catch (e: any) {
      console.error('Assessor sign failed', e);
      alert(e?.message || 'Failed to update assessor signature. Please try again.');
    } finally {
      setSigningStudent(prev => ({ ...prev, [studentId]: false }));
    }
  };

  const handleToggleAssessorSigned = (student: StudentData, index: number) => {
    const next = !student.assessor_signed;
    if (next && !assessor) {
      // No saved signature yet — collect it first, then sign.
      setPendingSign({ student, index });
      setShowAssessorDialog(true);
      return;
    }
    if (!next && !confirm(`Remove the assessor sign-off from ${student.student_name}'s submitted assessments? The original files will be restored.`)) {
      return;
    }
    runSign(student, index, next);
  };

  const handleAssessorSaved = (record: AssessorRecord) => {
    setAssessor(record.signature_png ? record : null);
    setShowAssessorDialog(false);
    if (pendingSign && record.signature_png) {
      const { student, index } = pendingSign;
      setPendingSign(null);
      runSign(student, index, true);
    }
  };

  const selectedClass = classes.find(c => c.run_id === selectedCourseRunId);
  const classEndDateIso = selectedClass?.end_date ? String(selectedClass.end_date).slice(0, 10) : undefined;

  const toggleCertSelection = (enrolmentId: string) => {
    setSelectedForCert(prev => {
      const next = new Set(prev);
      if (next.has(enrolmentId)) next.delete(enrolmentId);
      else next.add(enrolmentId);
      return next;
    });
  };

  const toggleAllCertSelection = () => {
    if (selectedForCert.size === students.length) {
      setSelectedForCert(new Set());
    } else {
      setSelectedForCert(new Set(students.map(s => s.enrolment_id)));
    }
  };

  const handleMarkAllCompetent = async () => {
    const notCompetent = students.filter(s => !s.is_competent);
    if (notCompetent.length === 0) return;

    const confirmed = window.confirm(
      `Mark all ${notCompetent.length} remaining learner(s) as COMPETENT?`
    );
    if (!confirmed) return;

    setMarkingAllCompetent(true);

    // Optimistic update
    const updatedStudents = students.map(s => ({
      ...s,
      is_competent: true,
      competent_status: 'Competent',
    }));
    setStudents(updatedStudents);

    try {
      await Promise.all(
        notCompetent.map(student =>
          fetch('/api/trainer/grade-student', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enrolmentIds: enrolmentIdsOf(student),
              source: student.source,
              isCompetent: true,
            }),
          })
        )
      );
    } catch (e) {
      console.error('Failed to mark all competent', e);
      alert('Some updates may have failed. Please check individual statuses.');
    } finally {
      setMarkingAllCompetent(false);
    }
  };

  const handleSendCertificates = async () => {
    if (selectedForCert.size === 0 || !selectedCourseRunId) return;

    const confirmed = window.confirm(
      `Send certificates to ${selectedForCert.size} selected learner(s)? This will generate and email certificates.`
    );
    if (!confirmed) return;

    setSendingCerts(true);
    setCertSendResult(null);

    try {
      const res = await fetch('/api/certificates/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseRunId: selectedCourseRunId,
          enrolmentIds: Array.from(selectedForCert)
        })
      });
      const data = await res.json();
      setCertSendResult({ message: data.message, results: data.results });

      // Refresh student list to show updated cert status
      if (data.success) {
        const refreshRes = await fetch(`/api/trainer/class-students?courseRunId=${selectedCourseRunId}&withMeta=1`);
        const refreshData = await refreshRes.json();
        const refreshList: StudentData[] = Array.isArray(refreshData) ? refreshData : refreshData?.students;
        if (Array.isArray(refreshList)) {
          setStudents(refreshList);
          verifyCertificates(refreshList);
        }
      }
    } catch (err: any) {
      setCertSendResult({ message: `Error: ${err.message}` });
    } finally {
      setSendingCerts(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold dark:text-white">Assessment Grading</h1>
        {sourceCourse && (
          <button
            type="button"
            onClick={handleBackToClass}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-default bg-surface hover:bg-surface-elevated text-on-surface transition-colors flex-shrink-0"
            title={`Back to ${sourceCourse?.title || 'class'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Class
          </button>
        )}
      </div>

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
          <div className="px-5 py-4 border-b border-default bg-gray-50 dark:bg-gray-800 flex flex-col gap-3">
            {/* Row 1 — title, refresh and the submission / TRAQOM / SIG counts */}
            <div className="flex justify-between items-center flex-wrap gap-y-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
              Student Grading Roster
            </h2>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              {/* Refresh assessment submission status */}
              <button
                onClick={() => fetchStudents(true)}
                disabled={loadingStudents || refreshingStudents}
                title="Refresh assessment submission status"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Icon name={IconName.Sync} className={`w-3.5 h-3.5 ${refreshingStudents ? 'animate-spin' : ''}`} />
                {refreshingStudents ? 'Refreshing...' : 'Refresh'}
              </button>
              {/* Per-method submission counts, e.g. WA 11/17 */}
              {students.length > 0 && assessmentMethods.map(m => {
                const info = METHOD_INFO[m] || { abbr: m, label: m };
                const count = students.filter(s => s.submitted_assessments?.includes(m)).length;
                return (
                  <div
                    key={m}
                    title={`${info.label}: ${count} of ${students.length} learners submitted`}
                    className={`text-xs px-3 py-1 rounded-full border ${
                      count === students.length
                        ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800'
                        : 'text-green-600 bg-white border-gray-200 dark:text-green-400 dark:bg-gray-700 dark:border-gray-600'
                    }`}
                  >
                    <span className="font-semibold">{info.abbr}</span>{' '}
                    <span className="font-semibold">{count}/{students.length}</span>
                  </div>
                );
              })}
              {/* TRAQOM completion count — manually ticked by the trainer */}
              {students.length > 0 && (() => {
                const traqomCount = students.filter(s => s.traqom_completed).length;
                return (
                  <div
                    title={`TRAQOM survey: ${traqomCount} of ${students.length} learners completed`}
                    className={`text-xs px-3 py-1 rounded-full border ${
                      traqomCount === students.length
                        ? 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-800'
                        : 'text-indigo-600 bg-white border-gray-200 dark:text-indigo-300 dark:bg-gray-700 dark:border-gray-600'
                    }`}
                  >
                    <span className="font-semibold">TRAQOM</span>{' '}
                    <span className="font-semibold">{traqomCount}/{students.length}</span>
                  </div>
                );
              })()}
              {/* Assessor sign-off count — learners whose uploaded files are stamped */}
              {students.length > 0 && (() => {
                const withFiles = students.filter(s => (s.submission_count || 0) > 0);
                const signedCount = withFiles.filter(s => s.assessor_signed).length;
                return (
                  <div
                    title={`Assessor signature: ${signedCount} of ${withFiles.length} learners with submissions signed`}
                    className={`text-xs px-3 py-1 rounded-full border ${
                      withFiles.length > 0 && signedCount === withFiles.length
                        ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800'
                        : 'text-amber-600 bg-white border-gray-200 dark:text-amber-300 dark:bg-gray-700 dark:border-gray-600'
                    }`}
                  >
                    <span className="font-semibold">Assessor SIG</span>{' '}
                    <span className="font-semibold">{signedCount}/{withFiles.length}</span>
                  </div>
                );
              })()}
              {/* Competent count */}
              {students.length > 0 && (() => {
                const competentCount = students.filter(s => s.is_competent).length;
                return (
                  <div
                    title={`Competent: ${competentCount} of ${students.length} learners`}
                    className={`text-xs px-3 py-1 rounded-full border ${
                      competentCount === students.length
                        ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-800'
                        : 'text-emerald-600 bg-white border-gray-200 dark:text-emerald-300 dark:bg-gray-700 dark:border-gray-600'
                    }`}
                  >
                    <span className="font-semibold">Competent</span>{' '}
                    <span className="font-semibold">{competentCount}/{students.length}</span>
                  </div>
                );
              })()}
              <div className="text-xs text-gray-500 bg-white dark:bg-gray-700 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-600">
                {students.length} Enrolments
              </div>
            </div>
            </div>

            {/* Row 2 — actions: demo video, assessor signature, mark all competent, send certificates */}
            <div className="flex items-center justify-end gap-3 flex-wrap">
              {/* How-to video for the assessor sign-off flow */}
              <button
                onClick={() => setShowSignDemo(true)}
                title="Watch a 1-minute demo of the assessor sign-off"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                <Icon name={IconName.Video} className="w-4 h-4" />
                Watch Demo
              </button>
              {/* Trainer's assessor block (name / NRIC / date / signature) */}
              <button
                onClick={() => { setPendingSign(null); setShowAssessorDialog(true); }}
                disabled={!assessorLoaded}
                title={assessor ? `Assessor: ${assessor.assessor_name} — click to edit` : 'Set up your assessor name, NRIC, date and signature'}
                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                  assessor
                    ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800 dark:hover:bg-amber-900/40'
                    : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'
                }`}
              >
                <Icon name={IconName.Edit} className="w-3.5 h-3.5" />
                {assessor ? 'Assessor Signature' : 'Set Up Signature'}
              </button>
              {students.length > 0 && (
                <button
                  onClick={handleMarkAllCompetent}
                  disabled={markingAllCompetent || students.every(s => s.is_competent)}
                  className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {markingAllCompetent ? (
                    <>
                      <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />
                      Marking...
                    </>
                  ) : (
                    <>
                      <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5" />
                      Mark All Competent
                    </>
                  )}
                </button>
              )}
              {students.length > 0 && (
                <button
                  onClick={handleSendCertificates}
                  disabled={sendingCerts || selectedForCert.size === 0}
                  className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sendingCerts ? (
                    <>
                      <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Icon name={IconName.Mail} className="w-3.5 h-3.5" />
                      Send Certificate ({selectedForCert.size})
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Certificate send result banner */}
          {certSendResult && (
            <div className={`mx-5 mt-3 p-3 rounded-lg text-sm ${
              certSendResult.results?.some(r => r.status === 'error')
                ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
            }`}>
              <div className="flex justify-between items-center">
                <span className="font-semibold">{certSendResult.message}</span>
                <button onClick={() => setCertSendResult(null)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                  <Icon name={IconName.Close} className="w-4 h-4" />
                </button>
              </div>
              {certSendResult.results && (
                <ul className="mt-2 space-y-1">
                  {certSendResult.results.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      {r.status === 'sent' && <Icon name={IconName.CheckCircle} className="w-3.5 h-3.5 text-green-500" />}
                      {r.status === 'generated' && <Icon name={IconName.Clock} className="w-3.5 h-3.5 text-amber-500" />}
                      {r.status === 'error' && <Icon name={IconName.Close} className="w-3.5 h-3.5 text-red-500" />}
                      <span>{r.name}: {r.status === 'sent' ? 'Certificate sent' : r.status === 'generated' ? r.error : r.error}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Assessor sign-off result — only shown when a file was skipped or failed */}
          {signResult && (
            <div className={`mx-5 mt-3 p-3 rounded-lg text-sm ${
              signResult.ok
                ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
            }`}>
              <div className="flex justify-between items-center">
                <span className="font-semibold">
                  Assessor signature — {signResult.name}{signResult.ok ? '' : ': nothing was signed'}
                </span>
                <button onClick={() => setSignResult(null)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                  <Icon name={IconName.Close} className="w-4 h-4" />
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {signResult.lines.map((line, i) => (
                  <li key={i} className="text-xs">{line}</li>
                ))}
              </ul>
            </div>
          )}

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
              <>
              {/* Select All row */}
              <div className="px-5 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center">
                <input
                  type="checkbox"
                  checked={selectedForCert.size === students.length && students.length > 0}
                  onChange={toggleAllCertSelection}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 mr-3 cursor-pointer"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedForCert.size === students.length ? 'Deselect All' : 'Select All'}
                </span>
                <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">
                  {assessmentMethods.length > 0 && (
                    <>Submission status: {assessmentMethods.map(m => `${(METHOD_INFO[m] || { abbr: m }).abbr} = ${(METHOD_INFO[m] || { label: m }).label}`).join(' · ')} · </>
                  )}
                  TQ = TRAQOM Survey (tick manually) · SIGN = Assessor signature stamped on submissions
                </span>
              </div>

              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {students.map((student, idx) => {
                  const sId = student.enrolment_id || student.student_name;
                  const isSaving = savingStatus[sId];
                  return (
                    <li key={sId} className="px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedForCert.has(student.enrolment_id)}
                          onChange={() => toggleCertSelection(student.enrolment_id)}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 mr-3 cursor-pointer flex-shrink-0"
                        />
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
                          {/* A merged learner lists every email they enrolled under; the first
                              line also links to their assessment-records folder in Drive */}
                          {(student.emails && student.emails.length > 0 ? student.emails : [student.email]).map((email, i) => (
                            <p key={email || i} className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                              <span>{email || 'No email provided'}</span>
                              {i === 0 && student.assessment_folder_url && (
                                <a
                                  href={student.assessment_folder_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open this learner's assessment records folder in Google Drive"
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  <Icon name={IconName.Folder} className="w-3.5 h-3.5" />
                                  Assessment Records
                                </a>
                              )}
                            </p>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center space-x-4">
                        {/* Assessment submission status — ticked when the learner has submitted
                            that method — plus the trainer-ticked TRAQOM survey box */}
                        <div className="flex items-center gap-3 pr-3 border-r border-gray-200 dark:border-gray-700">
                          {assessmentMethods.map(m => {
                            const info = METHOD_INFO[m] || { abbr: m, label: m };
                            const submitted = student.submitted_assessments?.includes(m);
                            return (
                              <label
                                key={m}
                                title={`${info.label}: ${submitted ? 'Submitted' : 'Not submitted'}`}
                                className="flex items-center gap-1 w-10 cursor-default select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={!!submitted}
                                  readOnly
                                  tabIndex={-1}
                                  className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 accent-green-600 pointer-events-none"
                                />
                                <span className={`text-[10px] font-semibold ${
                                  submitted ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'
                                }`}>
                                  {info.abbr}
                                </span>
                              </label>
                            );
                          })}
                          {/* TRAQOM survey — manual tick (SSG publishes no per-learner completion) */}
                          <label
                            title={`TRAQOM Survey: ${student.traqom_completed ? 'Completed' : 'Not completed'} — click to toggle`}
                            className={`flex items-center gap-1 w-10 select-none ${
                              savingTraqom[sId] ? 'opacity-50 cursor-wait' : 'cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={!!student.traqom_completed}
                              onChange={() => handleToggleTraqom(student, idx)}
                              disabled={savingTraqom[sId]}
                              className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 accent-indigo-600 cursor-pointer disabled:cursor-wait"
                            />
                            <span className={`text-[10px] font-semibold ${
                              student.traqom_completed ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500'
                            }`}>
                              TQ
                            </span>
                          </label>
                          {/* Assessor sign-off — stamps name/NRIC/date/signature onto the
                              learner's uploaded PDF/DOCX files (tick to sign, untick to restore) */}
                          {(() => {
                            const hasFiles = (student.submission_count || 0) > 0 && !!student.user_id;
                            const busy = !!signingStudent[sId];
                            const title = !hasFiles
                              ? 'Assessor signature: learner has not uploaded any assessment yet'
                              : student.assessor_signed
                                ? 'Assessor signature: stamped on all submitted files — untick to restore originals'
                                : `Assessor signature: tick to stamp your name, NRIC, date and signature on ${student.submission_count} file${student.submission_count === 1 ? '' : 's'}`;
                            return (
                              <label
                                title={title}
                                className={`flex items-center gap-1 w-12 select-none ${
                                  busy ? 'opacity-50 cursor-wait' : hasFiles ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                                }`}
                              >
                                {busy ? (
                                  <Icon name={IconName.Spinner} className="w-3.5 h-3.5 animate-spin text-amber-600" />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={!!student.assessor_signed}
                                    onChange={() => handleToggleAssessorSigned(student, idx)}
                                    disabled={!hasFiles}
                                    className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 accent-amber-600 cursor-pointer disabled:cursor-not-allowed"
                                  />
                                )}
                                <span className={`text-[10px] font-semibold ${
                                  student.assessor_signed ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'
                                }`}>
                                  SIGN
                                </span>
                              </label>
                            );
                          })()}
                        </div>

                        {/* Certificate Status Badge — verified against Google Drive.
                            Fixed-width column (always rendered) so the submission
                            checkboxes stay aligned across rows. */}
                        <div className="w-32 flex justify-start flex-shrink-0">
                        {student.is_competent && (() => {
                          const verification = certVerification[sId];
                          let badgeClass = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
                          let badgeIcon = IconName.Clock;
                          let badgeText = 'Cert Pending';

                          if (student.certificate) {
                            if (verification?.checking) {
                              badgeClass = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
                              badgeIcon = IconName.Spinner;
                              badgeText = 'Verifying...';
                            } else if (verification?.exists === true) {
                              badgeClass = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
                              badgeIcon = IconName.CheckCircle;
                              badgeText = 'Cert Issued';
                            } else if (verification?.exists === false) {
                              badgeClass = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                              badgeIcon = IconName.Close;
                              badgeText = 'Cert Missing';
                            } else {
                              // Verification not yet run (e.g. just toggled competent)
                              badgeClass = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
                              badgeIcon = IconName.Clock;
                              badgeText = 'Cert Generating';
                            }
                          }

                          const badgeContent = (
                            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${badgeClass}`}>
                              <Icon name={badgeIcon} className={`w-3.5 h-3.5 ${verification?.checking ? 'animate-spin' : ''}`} />
                              {badgeText}
                            </span>
                          );

                          // Make it clickable if there is a certificate URL
                          if (student.certificate && verification?.exists === true) {
                            return (
                              <a
                                href={student.certificate}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:opacity-80 transition-opacity"
                                title="Click to view file in Google Drive"
                              >
                                {badgeContent}
                              </a>
                            );
                          }
                          
                          return badgeContent;
                        })()}
                        </div>

                        <span className={`inline-block w-40 text-right whitespace-nowrap text-xs font-semibold uppercase tracking-wider ${
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
              </>
            )}
          </div>
        </div>
      )}

      {/* Assessor sign-off demo video */}
      {showSignDemo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSignDemo(false)}>
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-4 w-full max-w-4xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Demo: Assessor Sign-off</h3>
              <button
                onClick={() => setShowSignDemo(false)}
                className="p-1.5 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Close"
              >
                <Icon name={IconName.Close} className="w-5 h-5" />
              </button>
            </div>
            <video
              src="/videos/assessor-sign-off-demo.mp4"
              controls
              autoPlay
              playsInline
              className="w-full rounded-lg bg-black aspect-video"
            />
          </div>
        </div>
      )}

      <AssessorSignatureDialog
        open={showAssessorDialog}
        onClose={() => { setShowAssessorDialog(false); setPendingSign(null); }}
        onSaved={handleAssessorSaved}
        defaultSignDate={classEndDateIso}
      />
    </div>
  );
};

export default AssessmentGrading;
