import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

// PUBLIC page behind the class's Self-Register QR code (shown by the trainer from the Practice
// Exam section). The learner enters their name and email and is registered on Tertiary Exams for
// the course's practice exam; the exams site emails them the exam link.

interface CourseInfo { title: string; courseRunId: string; startDate: string | null; endDate: string | null }

const inputCls = (err?: string) =>
  `w-full px-3 py-2.5 rounded-lg border text-base bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    err ? 'border-red-500' : 'border-strong'
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
    body = <p className="text-sm text-danger">{loadError}</p>;
  } else if (!course) {
    body = <p className="text-sm text-muted">Loading…</p>;
  } else if (!available) {
    body = <p className="text-sm text-on-surface-secondary">This class is not open for practice exam registration. Please ask your trainer.</p>;
  } else if (done) {
    body = (
      <div className="rounded-lg bg-success-bg border border-green-200 dark:border-green-800 p-4 space-y-2">
        <p className="font-semibold text-success">You are registered, {name.trim()}.</p>
        <p className="text-sm text-green-900 dark:text-green-200">
          {done.emailSent
            ? <>We have emailed the practice exam link to <b>{email.trim().toLowerCase()}</b>. Open it and sign in with the one-time code sent to the same inbox, then start practising.</>
            : <>You were already registered for this practice exam with <b>{email.trim().toLowerCase()}</b>. Use the link in the email you received earlier, and sign in with the one-time code sent to that inbox.</>}
        </p>
        <p className="text-xs text-success">No email after a few minutes? Check your spam folder, or ask your trainer.</p>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="pe-name" className="block text-sm font-medium text-on-surface-secondary mb-1">Full name</label>
          <input id="pe-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)}
            aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'pe-name-err' : undefined} className={inputCls(fieldErrors.name)} />
          {fieldErrors.name && <p id="pe-name-err" className="text-xs text-danger mt-1">{fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="pe-email" className="block text-sm font-medium text-on-surface-secondary mb-1">Email</label>
          <input id="pe-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'pe-email-err' : undefined} className={inputCls(fieldErrors.email)} />
          {fieldErrors.email && <p id="pe-email-err" className="text-xs text-danger mt-1">{fieldErrors.email}</p>}
          <p className="text-xs text-muted mt-1">Use an email you can open now: the exam link and your sign-in code are sent there.</p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
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
      <div className="min-h-screen bg-surface-elevated py-6 px-4">
        <div className="max-w-md mx-auto bg-surface rounded-xl shadow p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-on-surface">Practice Exam Registration</h1>
            {course && (
              <dl className="mt-3 rounded-lg border border-default bg-surface-elevated px-4 py-3 text-sm grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
                <dt className="text-muted">Practice exam</dt>
                <dd className="font-medium text-on-surface">{examTitle || '—'}</dd>
                <dt className="text-muted">Course</dt>
                <dd className="text-on-surface-secondary">{course.title}</dd>
                <dt className="text-muted">Course run</dt>
                <dd className="text-on-surface-secondary font-mono">{course.courseRunId}</dd>
                {course.startDate && (
                  <>
                    <dt className="text-muted">Class dates</dt>
                    <dd className="text-on-surface-secondary">
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
