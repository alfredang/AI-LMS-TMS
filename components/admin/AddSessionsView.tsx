import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLms } from '@contexts/LmsContext';
import { AdminPage } from '@app-types';

// ── Constants ─────────────────────────────────────────────────────────────────

const modeOfTrainingOptions = [
  { value: '1', label: '1 - Classroom Facilitated Training' },
  { value: '2', label: '2 - Asynchronous E-learning' },
  { value: '4', label: '4 - On the Job Training' },
  { value: '8', label: '8 - Assessment' },
  { value: '9', label: '9 - Synchronous E-learning' },
  { value: '10', label: '10 - Work-based/Workplace Learning' },
];

/** Normalise a raw mode-of-training value to its numeric code string.
 * Handles: '9', '9 - Synchronous E-learning', 'Synchronous E-learning', etc. */
const normalizeModeOfTraining = (raw: any): string => {
  if (!raw) return '';
  const s = String(raw).trim();
  if (['1','2','4','8','9','10'].includes(s)) return s;
  const leading = s.match(/^(\d+)/);
  if (leading) return leading[1];
  const l = s.toLowerCase();
  if (l.includes('assess'))                           return '8';
  if (l.includes('sync') || l.includes('synchronous')) return '9';
  if (l.includes('async') || l.includes('asynchronous')) return '2';
  if (l.includes('classroom'))                        return '1';
  if (l.includes('job') || l.includes('ojt'))         return '4';
  if (l.includes('work'))                             return '10';
  return '1';
};

const DAY_START = '09:00';
const DAY_END = '18:00';
const EVENING_START = '19:00';
const EVENING_END = '22:00';

type SessionType = 'day' | 'evening';

interface SessionEntry {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  modeOfTraining: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toDateInput = (val: any): string => {
  if (!val) return '';
  const s = String(val);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
};

const blankSession = (mode: string, type: SessionType): SessionEntry => ({
  startDate: '',
  endDate: '',
  startTime: type === 'evening' ? EVENING_START : DAY_START,
  endTime: type === 'evening' ? EVENING_END : DAY_END,
  modeOfTraining: mode,
});

/** Add N days to a YYYY-MM-DD string */
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

/**
 * Build sessions from course_session_timing template.
 * Date logic: sessions advance to the next day only when the next session's
 * start time is earlier than the previous session's end time (i.e. it can't
 * be on the same day without overlapping). The date is also clamped to endDate.
 */
const buildAutoSessions = (
  timing: Record<string, any> | null,
  type: SessionType,
  defaultMode: string,
  startDate: string,
  endDate: string,
): SessionEntry[] => {
  if (!timing) return [];
  const isOneDay = startDate && endDate && startDate === endDate;
  const max = type === 'evening' ? 3 : 11;
  const sessions: SessionEntry[] = [];

  let currentDate = startDate;
  let prevEndTime = '';

  for (let i = 1; i <= max; i++) {
    const prefix = type === 'evening' ? `session_${i}_evening` : `session_${i}`;
    const startTime = timing[`${prefix}_start_time`] || '';
    const endTime   = timing[`${prefix}_end_time`]   || '';
    if (!startTime && !endTime) break; // stop at first empty slot

    const mode = normalizeModeOfTraining(timing[`${prefix}_mode_of_training`]) || normalizeModeOfTraining(defaultMode) || '1';

    let date = '';
    if (startDate) {
      if (isOneDay) {
        date = startDate;
      } else {
        // Advance to next day if this session would start before the previous one ends
        if (prevEndTime && startTime && startTime < prevEndTime) {
          const next = addDays(currentDate, 1);
          currentDate = (endDate && next > endDate) ? endDate : next;
        }
        date = currentDate;
      }
    }

    prevEndTime = endTime;
    sessions.push({ startDate: date, endDate: date, startTime, endTime, modeOfTraining: mode });
  }
  return sessions;
};

// ── AddSessionsView ───────────────────────────────────────────────────────────

const AddSessionsView: React.FC = () => {
  const { setAdminPage, selectedCourseRunId, setSelectedCourseRunId } = useLms();

  const inputClasses = 'block w-full px-3 py-2 text-on-surface bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-500';
  const readonlyClasses = 'block w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded-md text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 cursor-not-allowed';

  // ── Course Run ID input ────────────────────────────────────────────────────
  const [courseRunId, setCourseRunId] = useState(selectedCourseRunId || '');
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // ── Read-only course run info ──────────────────────────────────────────────
  const [courseReferenceNumber, setCourseReferenceNumber] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [courseStartDate, setCourseStartDate] = useState('');
  const [courseEndDate, setCourseEndDate] = useState('');
  const [openingRegistrationDate, setOpeningRegistrationDate] = useState('');
  const [closingRegistrationDate, setClosingRegistrationDate] = useState('');
  const [defaultModeOfTraining, setDefaultModeOfTraining] = useState('1');
  const [venueInfo, setVenueInfo] = useState<any>({});
  const [courseAdminEmail, setCourseAdminEmail] = useState('');
  const [courseVacancy, setCourseVacancy] = useState<any>(null);

  // ── Day / Evening availability (derived from course_session_timing) ─────────
  const [hasDay, setHasDay] = useState(false);
  const [hasEveningClass, setHasEveningClass] = useState(false);
  const [sessionType, setSessionType] = useState<SessionType>('day');
  const [sessionTiming, setSessionTiming] = useState<Record<string, any> | null>(null);

  // ── Sessions array ─────────────────────────────────────────────────────────
  const [sessionCount, setSessionCount] = useState(0);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  // ── Submission ─────────────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{
    success: boolean;
    message?: string;
    error?: any;
  } | null>(null);

  // Auto-fetch if navigated with a course run ID set
  useEffect(() => {
    if (selectedCourseRunId) {
      setCourseRunId(selectedCourseRunId);
      handleFetch(selectedCourseRunId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch course run data ──────────────────────────────────────────────────
  const handleFetch = async (idOverride?: string) => {
    const id = (idOverride ?? courseRunId).trim();
    if (!id) {
      setFetchError('Please enter a Course Run ID');
      return;
    }

    setIsFetching(true);
    setFetchError(null);
    setIsDataLoaded(false);
    setSessions([]);
    setSessionCount(0);

    try {
      const res = await fetch(`/api/admin/add-sessions-info?courseRunId=${encodeURIComponent(id)}`);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || `API error ${res.status}`);

      const { courseData, run } = json;

      const startDate = toDateInput(run.courseStartDate ?? run.courseDates?.start);
      const endDate   = toDateInput(run.courseEndDate   ?? run.courseDates?.end);
      const modeDefault = normalizeModeOfTraining(run.modeOfTraining) || '1';

      setCourseReferenceNumber(courseData.referenceNumber ?? courseData.externalReferenceNumber ?? '');
      setCourseTitle(courseData.title ?? '');
      setCourseStartDate(startDate);
      setCourseEndDate(endDate);
      setOpeningRegistrationDate(toDateInput(run.registrationOpeningDate ?? run.registrationDates?.opening));
      setClosingRegistrationDate(toDateInput(run.registrationClosingDate ?? run.registrationDates?.closing));
      setDefaultModeOfTraining(modeDefault);
      setVenueInfo(run.venue ?? {});
      setCourseAdminEmail(run.courseAdminEmail ?? '');
      setCourseVacancy(run.courseVacancy ?? null);

      const timing = json.sessionTiming ?? null;
      setSessionTiming(timing);

      // If the course is a single day, evening sessions are not applicable
      const isOneDay = startDate && endDate && startDate === endDate;

      const dayAvailable     = !!(timing?.session_1_start_time);
      const eveningAvailable = !isOneDay && !!(timing?.session_1_evening_start_time);

      setHasDay(dayAvailable);
      setHasEveningClass(eveningAvailable);

      const defaultType: SessionType = !eveningAvailable || dayAvailable ? 'day' : 'evening';
      setSessionType(defaultType);

      // Auto-populate sessions from timing template
      const autoSessions = buildAutoSessions(timing, defaultType, modeDefault, startDate, endDate);
      setSessions(autoSessions);
      setSessionCount(autoSessions.length);

      setIsDataLoaded(true);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch course run data');
    } finally {
      setIsFetching(false);
    }
  };

  // ── Build a session from timing template (if available) ───────────────────
  const sessionFromTiming = (oneBasedIdx: number, type: SessionType): SessionEntry => {
    if (!sessionTiming) return blankSession(defaultModeOfTraining, type);

    const prefix = type === 'evening'
      ? `session_${oneBasedIdx}_evening`
      : `session_${oneBasedIdx}`;

    const startTime = sessionTiming[`${prefix}_start_time`] || (type === 'evening' ? EVENING_START : DAY_START);
    const endTime   = sessionTiming[`${prefix}_end_time`]   || (type === 'evening' ? EVENING_END   : DAY_END);
    const mode      = normalizeModeOfTraining(sessionTiming[`${prefix}_mode_of_training`]) || normalizeModeOfTraining(defaultModeOfTraining) || '1';

    return { startDate: '', endDate: '', startTime, endTime, modeOfTraining: mode };
  };

  // ── Session count change ───────────────────────────────────────────────────
  const updateSessionCount = (count: number) => {
    const newCount = Math.max(0, count);
    const newSessions = [...sessions];
    const isOneDay = courseStartDate && courseEndDate && courseStartDate === courseEndDate;

    if (newCount > sessions.length) {
      for (let i = sessions.length; i < newCount; i++) {
        const tmpl = sessionFromTiming(i + 1, sessionType);
        // Inherit mode from last session if template has none for this index
        const lastMode = newSessions.length > 0 ? newSessions[newSessions.length - 1].modeOfTraining : defaultModeOfTraining;
        const mode = tmpl.modeOfTraining || lastMode;
        let date = '';
        if (courseStartDate) {
          if (isOneDay) {
            date = courseStartDate;
          } else {
            const lastSession = newSessions.length > 0 ? newSessions[newSessions.length - 1] : null;
            const lastDate = lastSession?.startDate || courseStartDate;
            const lastEndTime = lastSession?.endTime || '';
            // New day if this session starts before the previous one ends
            if (lastEndTime && tmpl.startTime && tmpl.startTime < lastEndTime) {
              const next = addDays(lastDate, 1);
              date = (courseEndDate && next > courseEndDate) ? courseEndDate : next;
            } else {
              date = lastDate || courseStartDate;
            }
          }
        }
        newSessions.push({ ...tmpl, modeOfTraining: mode, startDate: date, endDate: date });
      }
    } else {
      newSessions.splice(newCount);
    }

    setSessions(newSessions);
    setSessionCount(newCount);
  };

  // When session type changes, rebuild sessions from template for the new type
  const handleSessionTypeChange = (type: SessionType) => {
    setSessionType(type);
    const rebuilt = buildAutoSessions(sessionTiming, type, defaultModeOfTraining, courseStartDate, courseEndDate);
    if (rebuilt.length > 0) {
      setSessions(rebuilt);
      setSessionCount(rebuilt.length);
    } else {
      // No template data for this type — re-derive times only
      setSessions(prev => prev.map((s, i) => {
        const tmpl = sessionFromTiming(i + 1, type);
        return { ...s, startTime: tmpl.startTime, endTime: tmpl.endTime, modeOfTraining: tmpl.modeOfTraining };
      }));
    }
  };

  const removeSession = (idx: number) => {
    setSessions(prev => prev.filter((_, i) => i !== idx));
    setSessionCount(prev => prev - 1);
  };

  const updateSession = (idx: number, field: keyof SessionEntry, value: string) => {
    setSessions(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      // Keep endDate in sync with startDate for classroom-type modes
      if (field === 'startDate' && updated[idx].modeOfTraining !== '2' && updated[idx].modeOfTraining !== '4') {
        updated[idx].endDate = value;
      }
      return updated;
    });
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (sessions.length === 0) {
      alert('Please add at least one session');
      return;
    }

    const missing: string[] = [];
    sessions.forEach((s, i) => {
      if (!s.startDate) missing.push(`Session ${i + 1}: Start Date`);
      if (!s.endDate) missing.push(`Session ${i + 1}: End Date`);
      if (!s.startTime) missing.push(`Session ${i + 1}: Start Time`);
      if (!s.endTime) missing.push(`Session ${i + 1}: End Time`);
    });
    if (missing.length > 0) {
      alert(`Please fill in:\n\n${missing.map(f => `• ${f}`).join('\n')}`);
      return;
    }

    try {
      setIsSubmitting(true);

      const scheduleInfo = courseStartDate === courseEndDate
        ? courseStartDate
        : `${courseStartDate} - ${courseEndDate}`;

      const body = {
        courseReferenceNumber,
        openingRegistrationDate,
        closingRegistrationDate,
        courseStartDate,
        courseEndDate,
        scheduleInfoTypeCode: '01',
        scheduleInfoTypeDescription: 'Description',
        scheduleInfo,
        block: venueInfo.block ?? '',
        street: venueInfo.street ?? '',
        floor: venueInfo.floor ?? '',
        unit: venueInfo.unit ?? '',
        building: venueInfo.building ?? '',
        postalCode: venueInfo.postalCode ?? '',
        room: venueInfo.room ?? '',
        wheelChairAccess: venueInfo.wheelChairAccess ?? true,
        modeOfTraining: defaultModeOfTraining,
        courseAdminEmail,
        courseVacancy: courseVacancy ?? { code: 'A', description: 'Available' },
        fileName: '',
        fileContent: '',
        sessions: sessions.map(s => ({
          startDate: s.startDate.replace(/-/g, ''),
          endDate: s.endDate.replace(/-/g, ''),
          startTime: s.startTime + ':00',
          endTime: s.endTime + ':00',
          modeOfTraining: s.modeOfTraining,
          venue: {
            block: venueInfo.block ?? '',
            street: venueInfo.street ?? '',
            floor: venueInfo.floor ?? '',
            unit: venueInfo.unit ?? '',
            building: venueInfo.building ?? '',
            postalCode: venueInfo.postalCode ?? '',
            room: venueInfo.room ?? '',
            wheelChairAccess: venueInfo.wheelChairAccess ?? true,
          },
        })),
      };

      const res = await fetch(
        `/api/ssg/courses/courseRuns/${encodeURIComponent(courseRunId.trim())}?action=add-sessions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      const data = await res.json();

      if (!res.ok) {
        const details: { field?: string; message?: string }[] = data?.details ?? [];
        let friendlyMessage: string;
        if (details.length > 0) {
          const lines = details.map(d => {
            const raw = d.message ?? '';
            // "There is already an existing session (TGS-xxx) in MySF"
            const existMatch = raw.match(/already an existing session \(([^)]+)\)/i);
            if (existMatch) {
              // Extract session number from field e.g. "Session_SeqNo_1:..."
              const seqMatch = (d.field ?? '').match(/Session_SeqNo_(\d+)/i);
              const seqNo = seqMatch ? ` ${seqMatch[1]}` : '';
              return `Session${seqNo} already exists in SSG (${existMatch[1]}). Sessions may have already been added for this course run.`;
            }
            return raw || JSON.stringify(d);
          });
          friendlyMessage = lines.join('\n');
        } else {
          friendlyMessage = data?.message || data?.error?.message || `SSG error ${res.status}`;
        }
        setSubmissionResult({ success: false, message: friendlyMessage, error: data });
      } else {
        setSubmissionResult({ success: true, message: `${sessions.length} session(s) added successfully.` });
        setSelectedCourseRunId(null);
      }
    } catch (err) {
      setSubmissionResult({
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error occurred',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Result screen ──────────────────────────────────────────────────────────
  if (submissionResult) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            {submissionResult.success ? (
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Add Sessions Result</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {submissionResult.success ? 'Sessions added successfully' : 'Failed to add sessions'}
              </p>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6 space-y-2 text-sm">
            <div><span className="font-medium text-gray-600 dark:text-gray-400">Course Run ID: </span><span className="font-mono text-gray-900 dark:text-white">{courseRunId}</span></div>
            <div><span className="font-medium text-gray-600 dark:text-gray-400">Course: </span><span className="text-gray-900 dark:text-white">{courseTitle}</span></div>
            <div><span className="font-medium text-gray-600 dark:text-gray-400">Status: </span>
              <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${submissionResult.success ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                {submissionResult.success ? 'Success' : 'Error'}
              </span>
            </div>
            {submissionResult.message && (
              <div className={`mt-2 ${submissionResult.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {submissionResult.message.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setSubmissionResult(null)} className="flex-1">
              {submissionResult.success ? 'Add More Sessions' : 'Try Again'}
            </Button>
            <Button onClick={() => { setSelectedCourseRunId(courseRunId.trim()); setAdminPage(AdminPage.CourseSessions); }} className="flex-1">
              View Sessions
            </Button>
            <Button variant="outline" onClick={() => setAdminPage(AdminPage.Dashboard)} className="flex-1">
              Dashboard
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Add Sessions</h2>

      {/* Step 1 — Course Run ID Lookup */}
      <Card className="p-6 mb-6">
        <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200 mb-4">Course Run Lookup</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
              * Course Run ID
            </label>
            <input
              type="text"
              value={courseRunId}
              onChange={e => { setCourseRunId(e.target.value); setIsDataLoaded(false); }}
              onKeyDown={e => e.key === 'Enter' && !isFetching && courseRunId.trim() && handleFetch()}
              placeholder="e.g. 1234567"
              className={inputClasses}
              disabled={isFetching}
            />
          </div>
          <Button onClick={() => handleFetch()} disabled={isFetching || !courseRunId.trim()} className="whitespace-nowrap">
            {isFetching ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Fetching...
              </div>
            ) : 'Fetch Data'}
          </Button>
        </div>
        {fetchError && <p className="text-red-500 text-sm mt-3">{fetchError}</p>}
        {isDataLoaded && (
          <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg text-sm text-green-800 dark:text-green-300">
            ✓ Data loaded for <strong>{courseTitle || courseReferenceNumber}</strong>
          </div>
        )}
      </Card>

      {isDataLoaded && (
        <div className="space-y-6">

          {/* Course Run Summary (read-only) */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 dark:text-white">Course Run Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Reference Number</label>
                <input type="text" value={courseReferenceNumber} readOnly className={readonlyClasses} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Title</label>
                <input type="text" value={courseTitle} readOnly className={readonlyClasses} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course Start Date</label>
                <input type="text" value={courseStartDate} readOnly className={readonlyClasses} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course End Date</label>
                <input type="text" value={courseEndDate} readOnly className={readonlyClasses} />
              </div>
            </div>
          </Card>

          {/* Session Type Selector */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 dark:text-white">Session Type</h3>

            {(() => {
              const dayStart = sessionTiming?.session_1_start_time || DAY_START;
              const dayEnd = sessionTiming?.session_1_end_time || DAY_END;
              const eveStart = sessionTiming?.session_1_evening_start_time || EVENING_START;
              const eveEnd = sessionTiming?.session_1_evening_end_time || EVENING_END;

              if (hasDay && hasEveningClass) {
                return (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleSessionTypeChange('day')}
                      className={`flex-1 py-3 px-4 rounded-lg border-2 font-semibold text-sm transition-colors ${
                        sessionType === 'day'
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-500'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      ☀️ Day ({dayStart} – {dayEnd})
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSessionTypeChange('evening')}
                      className={`flex-1 py-3 px-4 rounded-lg border-2 font-semibold text-sm transition-colors ${
                        sessionType === 'evening'
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-500'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      🌙 Evening ({eveStart} – {eveEnd})
                    </button>
                  </div>
                );
              }

              if (hasEveningClass && !hasDay) {
                return (
                  <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-700">
                    <span className="text-lg">🌙</span>
                    <div>
                      <p className="font-semibold text-indigo-800 dark:text-indigo-200">Evening ({eveStart} – {eveEnd})</p>
                      <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-0.5">This course only offers evening sessions</p>
                    </div>
                  </div>
                );
              }

              // Day only (or no timing configured — fall back to day defaults)
              return (
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <span className="text-lg">☀️</span>
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-gray-200">Day ({dayStart} – {dayEnd})</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">This course only offers day sessions</p>
                  </div>
                </div>
              );
            })()}
          </Card>

          {/* Timing template indicator */}
          {sessionTiming ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-sm text-blue-800 dark:text-blue-300">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Session timings are pre-filled from the course timing template. You can adjust them per session if needed.
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              No session timing template found for this course. Please configure it under <strong className="mx-1">Course Session Timing</strong> first, or add sessions manually using the <strong className="mx-1">+</strong> button below.
            </div>
          )}

          {/* Sessions Builder */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold dark:text-white">Sessions</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Count:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateSessionCount(sessionCount - 1)}
                    className="w-8 h-8 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-full text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 font-bold"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-semibold dark:text-white">{sessionCount}</span>
                  <button
                    type="button"
                    onClick={() => updateSessionCount(sessionCount + 1)}
                    className="w-8 h-8 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-full text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {sessionCount === 0 && (
              <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                Click <strong>+</strong> to add sessions
              </div>
            )}

            <div className="space-y-4">
              {sessions.map((session, idx) => (
                <Card key={idx} className="p-4 border dark:border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-gray-800 dark:text-white">Session {idx + 1}</h4>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                        sessionType === 'evening'
                          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      }`}>
                        {sessionType === 'evening' ? '🌙 Evening' : '☀️ Day'}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSession(idx)}
                        className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">* Date</label>
                      <input
                        type="date"
                        value={session.startDate}
                        onChange={e => updateSession(idx, 'startDate', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">* Start Time</label>
                      <input
                        type="time"
                        value={session.startTime}
                        onChange={e => updateSession(idx, 'startTime', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">* End Time</label>
                      <input
                        type="time"
                        value={session.endTime}
                        onChange={e => updateSession(idx, 'endTime', e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                    <div className="md:col-span-2 lg:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Mode of Training</label>
                      <select
                        value={session.modeOfTraining}
                        onChange={e => updateSession(idx, 'modeOfTraining', e.target.value)}
                        className={inputClasses}
                      >
                        {modeOfTrainingOptions.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </Card>

          {/* Action buttons */}
          <div className="flex gap-3 pb-6">
            <Button variant="outline" onClick={() => setAdminPage(AdminPage.CourseSessions)} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || sessionCount === 0}
              className="flex-1"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Submitting...
                </div>
              ) : `Add ${sessionCount} Session${sessionCount !== 1 ? 's' : ''}`}
            </Button>
          </div>

        </div>
      )}
    </div>
  );
};

export default AddSessionsView;
