import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

// PUBLIC page behind the class's Self-Register QR code (shown by the trainer from the Practice
// Exam section). The learner enters their name and email and is registered on Tertiary Exams for
// the course's practice exam; the exams site emails them the exam link.

interface CourseInfo { title: string; courseRunId: string; startDate: string | null; endDate: string | null }

const inputCls = (err?: string) =>
  `w-full px-3 py-2.5 rounded-lg border text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    err ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
  }`;

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export default function PracticeExamSelfRegisterPage() {
  const router = useRouter();
  const runId = typeof router.query.runId === 'string' ? router.query.runId : '';
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [examTitle, setExamTitle] = useState('');
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ emailSent: boolean } | null>(null);

  useEffect(() => {
    if (!runId) return;
    fetch(`/api/public/practice-exam-register?run=${encodeURIComponent(runId)}`)
      .then(r => r.json())
      .then(j => {
        if (!j.success) { setLoadError(j.error || 'This practice exam link is not valid.'); return; }
        setCourse(j.course);
        setExamTitle(j.examTitle || '');
        setAvailable(!!j.available);
      })
      .catch(() => setLoadError('Could not load this page. Please check your connection and try again.'));
  }, [runId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch('/api/public/practice-exam-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run: runId, name, email }),
      });
      const j = await res.json();
      if (j.success) setDone({ emailSent: !!j.emailSent });
      else { setError(j.error || 'Something went wrong. Please try again.'); setFieldErrors(j.fieldErrors || {}); }
    } catch {
      setError('Could not reach the server. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (loadError) {
    body = <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  } else if (!course) {
    body = <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>;
  } else if (!available) {
    body = <p className="text-sm text-gray-700 dark:text-gray-300">This class is not open for practice exam registration. Please ask your trainer.</p>;
  } else if (done) {
    body = (
      <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 space-y-2">
        <p className="font-semibold text-green-800 dark:text-green-300">You are registered, {name.trim()}.</p>
        <p className="text-sm text-green-900 dark:text-green-200">
          {done.emailSent
            ? <>We have emailed the practice exam link to <b>{email.trim().toLowerCase()}</b>. Open it and sign in with the one-time code sent to the same inbox, then start practising.</>
            : <>You were already registered for this practice exam with <b>{email.trim().toLowerCase()}</b>. Use the link in the email you received earlier, and sign in with the one-time code sent to that inbox.</>}
        </p>
        <p className="text-xs text-green-800 dark:text-green-300">No email after a few minutes? Check your spam folder, or ask your trainer.</p>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="pe-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full name</label>
          <input id="pe-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)}
            aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'pe-name-err' : undefined} className={inputCls(fieldErrors.name)} />
          {fieldErrors.name && <p id="pe-name-err" className="text-xs text-red-500 mt-1">{fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="pe-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
          <input id="pe-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'pe-email-err' : undefined} className={inputCls(fieldErrors.email)} />
          {fieldErrors.email && <p id="pe-email-err" className="text-xs text-red-500 mt-1">{fieldErrors.email}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Use an email you can open now: the exam link and your sign-in code are sent there.</p>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={busy || !name.trim() || !email.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg disabled:opacity-50">
          {busy ? 'Registering…' : 'Register for the practice exam'}
        </button>
      </form>
    );
  }

  return (
    <>
      <Head>
        <title>Practice Exam Registration</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-6 px-4">
        <div className="max-w-md mx-auto bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Practice Exam Registration</h1>
            {course && (
              <dl className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-4 py-3 text-sm grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
                <dt className="text-gray-500 dark:text-gray-400">Practice exam</dt>
                <dd className="font-medium text-gray-900 dark:text-white">{examTitle || '—'}</dd>
                <dt className="text-gray-500 dark:text-gray-400">Course</dt>
                <dd className="text-gray-700 dark:text-gray-200">{course.title}</dd>
                <dt className="text-gray-500 dark:text-gray-400">Course run</dt>
                <dd className="text-gray-700 dark:text-gray-200 font-mono">{course.courseRunId}</dd>
                {course.startDate && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">Class dates</dt>
                    <dd className="text-gray-700 dark:text-gray-200">
                      {fmtDay(course.startDate)}{course.endDate && course.endDate !== course.startDate ? ` to ${fmtDay(course.endDate)}` : ''}
                    </dd>
                  </>
                )}
              </dl>
            )}
          </div>
          {body}
        </div>
      </div>
    </>
  );
}
