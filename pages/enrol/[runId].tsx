import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

// PUBLIC page behind the class's SWDA Enrolment QR code (class page → SWDA Enrolment, and the
// E-Attendance page). The learner enters their name (as in NRIC) and NRIC/FIN: if either is
// already on the class's SWDA enrolments the page says so and nothing needs submitting; otherwise
// they fill in the details staff need to enrol them on TPGateway. Submitting also registers them
// on the class, so they can sign in to the portal with an email code.

type Sponsorship = 'Individual' | 'Employer';

interface FormState {
  traineeName: string;
  nric: string;
  contactNumber: string;
  email: string;
  dateOfBirth: string;
  nationality: string;
  sponsorshipType: Sponsorship;
  employerName: string;
  employerUen: string;
  employerContactName: string;
  employerContactEmail: string;
  employerContactNumber: string;
}

interface CourseInfo { title: string; code: string | null; courseRunId: string; startDate: string | null; endDate: string | null }

const EMPTY: FormState = {
  traineeName: '', nric: '', contactNumber: '', email: '', dateOfBirth: '', nationality: '', sponsorshipType: 'Individual',
  employerName: '', employerUen: '', employerContactName: '', employerContactEmail: '', employerContactNumber: '',
};

const inputCls = (err?: string) =>
  `w-full px-3 py-2.5 rounded-lg border text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    err ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
  }`;
const primaryBtn = 'w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg disabled:opacity-50';

const Field: React.FC<{ id: string; label: string; error?: string; children: React.ReactNode }> = ({ id, label, error, children }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
    {children}
    {error && <p id={`${id}-err`} className="text-xs text-red-500 mt-1">{error}</p>}
  </div>
);

const NATIONALITIES = [
  'Singaporean', 'Malaysian', 'Chinese', 'Indian', 'Filipino', 'Indonesian', 'Vietnamese', 'Thai', 'Myanmar',
  'Bangladeshi', 'Sri Lankan', 'Pakistani', 'Korean', 'Japanese', 'Taiwanese', 'Hong Konger', 'Australian',
  'British', 'American', 'Canadian', 'French', 'German',
];

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export default function EnrolmentRequestPage() {
  const router = useRouter();
  const runId = typeof router.query.runId === 'string' ? router.query.runId : '';
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<'nric' | 'form' | 'enrolled' | 'submitted'>('nric');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [enrolmentRef, setEnrolmentRef] = useState('');
  const [registered, setRegistered] = useState<{ ok: boolean; email: string | null; issue: string | null }>({ ok: false, email: null, issue: null });
  const [resubmit, setResubmit] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!runId) return;
    fetch(`/api/public/enrolment-request?run=${encodeURIComponent(runId)}`)
      .then(r => r.json())
      .then(j => {
        if (!j.success) { setLoadError(j.error || 'This enrolment link is not valid.'); return; }
        setCourse(j.course);
        setAvailable(!!j.available);
      })
      .catch(() => setLoadError('Could not load this page. Please check your connection and try again.'));
  }, [runId]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/public/enrolment-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run: runId, ...body }),
    });
    return { res, json: await res.json() };
  };

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = k === 'nric' || k === 'employerUen' ? e.target.value.toUpperCase().trim() : e.target.value;
    setForm(f => ({ ...f, [k]: value }));
    if (fieldErrors[k]) setFieldErrors(fe => { const n = { ...fe }; delete n[k]; return n; });
  };
  const inp = (k: keyof FormState) => ({
    id: `enr-${k}`,
    className: inputCls(fieldErrors[k]),
    value: form[k],
    onChange: set(k),
    'aria-invalid': !!fieldErrors[k] || undefined,
    'aria-describedby': fieldErrors[k] ? `enr-${k}-err` : undefined,
  });

  const checkNric = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setFieldErrors({});
    try {
      const { res, json } = await post({ action: 'check', nric: form.nric, traineeName: form.traineeName });
      if (!res.ok || !json.success) { setFieldErrors({ nric: json.error || 'Could not check your NRIC/FIN.' }); return; }
      if (json.enrolled) { setEnrolmentRef(json.enrolmentRef || ''); setStep('enrolled'); return; }
      setResubmit(!!json.pending);
      setStep('form');
    } catch {
      setError('Could not check your NRIC/FIN. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setFieldErrors({});
    try {
      const { res, json } = await post({ action: 'submit', ...form });
      if (!res.ok || !json.success) {
        setFieldErrors(json.fieldErrors || {});
        setError(json.error || 'Could not submit your details.');
        return;
      }
      if (json.enrolled) { setEnrolmentRef(json.enrolmentRef || ''); setStep('enrolled'); return; }
      setRegistered({ ok: !!json.registered, email: json.email || null, issue: json.registrationIssue || null });
      setStep('submitted');
    } catch {
      setError('Could not submit your details. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setForm(EMPTY); setEnrolmentRef(''); setFieldErrors({}); setError(null); setResubmit(false);
    setRegistered({ ok: false, email: null, issue: null }); setStep('nric');
  };
  const employer = form.sponsorshipType === 'Employer';

  let body: React.ReactNode;
  if (loadError) {
    body = <p className="text-red-600 text-sm">{loadError}</p>;
  } else if (!course) {
    body = <p className="text-gray-500 text-sm">Loading…</p>;
  } else if (!available) {
    body = <p className="text-gray-700 dark:text-gray-300 text-sm">This class is not open for enrolment requests. Please speak to your trainer.</p>;
  } else if (step === 'nric') {
    body = (
      <form onSubmit={checkNric} noValidate className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Enter your name and NRIC/FIN so we can check whether you are already enrolled in this class.
        </p>
        <Field id="enr-traineeName" label="Trainee Name (as in NRIC/FIN)" error={fieldErrors.traineeName}>
          <input {...inp('traineeName')} autoComplete="name" autoFocus />
        </Field>
        <Field id="enr-nric" label="NRIC/FIN" error={fieldErrors.nric}>
          <input {...inp('nric')} placeholder="S1234567A" maxLength={9} autoComplete="off" autoCapitalize="characters" />
        </Field>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={busy || !form.nric || form.traineeName.trim().length < 2} className={primaryBtn}>{busy ? 'Checking…' : 'Continue'}</button>
      </form>
    );
  } else if (step === 'enrolled') {
    body = (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-700 p-4">
          <p className="font-semibold text-green-800 dark:text-green-300">You are already enrolled in this class.</p>
          <p className="text-sm text-green-800 dark:text-green-300 mt-1">There is nothing to submit.</p>
        </div>
        <Field id="enr-name-ro" label="Trainee Name">
          <input id="enr-name-ro" readOnly value={form.traineeName} className={`${inputCls()} bg-gray-100 dark:bg-gray-700`} />
        </Field>
        <Field id="enr-nric-ro" label="NRIC/FIN">
          <input id="enr-nric-ro" readOnly value={form.nric ? `${form.nric[0]}XXXX${form.nric.slice(-4)}` : ''} className={`${inputCls()} bg-gray-100 dark:bg-gray-700`} />
        </Field>
        {enrolmentRef && (
          <Field id="enr-ref" label="Enrolment ID">
            <input id="enr-ref" readOnly value={enrolmentRef} className={`${inputCls()} bg-gray-100 dark:bg-gray-700 font-mono`} />
          </Field>
        )}
        <button type="button" onClick={startOver} className="text-sm text-blue-600 hover:underline">Not you? Check another learner</button>
      </div>
    );
  } else if (step === 'submitted') {
    body = (
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700 p-4">
          <p className="font-semibold text-blue-800 dark:text-blue-300">Thank you, {form.traineeName}. Your details are submitted.</p>
          <p className="text-sm text-blue-800 dark:text-blue-300 mt-1">
            Your trainer or our admin team will complete your SWDA enrolment for this class. You do not need to do anything else for it.
          </p>
        </div>
        {registered.ok && (
          <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-700 p-4 space-y-2">
            <p className="text-sm text-green-800 dark:text-green-300">
              You are registered for this class. Sign in to the learning portal with
              {registered.email ? <> <strong>{registered.email}</strong></> : ' your email'} and the one-time code we email you.
            </p>
            <a href="/" className="inline-block text-sm font-medium text-green-800 dark:text-green-300 underline">Open the learning portal</a>
          </div>
        )}
        {!registered.ok && registered.issue && (
          <p className="text-sm text-amber-600 dark:text-amber-400">{registered.issue}</p>
        )}
        <button type="button" onClick={startOver} className="text-sm text-blue-600 hover:underline">Submit for another learner</button>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {resubmit
            ? 'We already have details for this NRIC/FIN. Submit again only if you need to correct them.'
            : 'You are not enrolled in this class yet. Fill in your details so your trainer or our admin team can enrol you.'}
          {' '}Enter your name and date of birth exactly as on your NRIC/FIN card.
        </p>
        <Field id="enr-nric" label="NRIC/FIN" error={fieldErrors.nric}>
          <div className="flex gap-2">
            <input id="enr-nric" readOnly value={form.nric} className={`${inputCls(fieldErrors.nric)} bg-gray-100 dark:bg-gray-700`} />
            <button type="button" onClick={startOver} className="px-3 text-sm text-blue-600 hover:underline whitespace-nowrap">Change</button>
          </div>
        </Field>
        <Field id="enr-traineeName" label="Trainee Name (as in NRIC/FIN)" error={fieldErrors.traineeName}>
          <input {...inp('traineeName')} autoComplete="name" />
        </Field>
        <Field id="enr-contactNumber" label="Contact Number" error={fieldErrors.contactNumber}>
          <input {...inp('contactNumber')} placeholder="91234567" inputMode="tel" autoComplete="tel" />
        </Field>
        <Field id="enr-email" label="Email" error={fieldErrors.email}>
          <input type="email" {...inp('email')} autoComplete="email" />
        </Field>
        <Field id="enr-dateOfBirth" label="Date of Birth" error={fieldErrors.dateOfBirth}>
          <input type="date" {...inp('dateOfBirth')} max={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field id="enr-nationality" label="Nationality" error={fieldErrors.nationality}>
          <input {...inp('nationality')} list="enr-nationalities" placeholder="e.g. Singaporean" autoComplete="country-name" maxLength={60} />
          <datalist id="enr-nationalities">{NATIONALITIES.map(n => <option key={n} value={n} />)}</datalist>
        </Field>

        <fieldset>
          <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sponsorship</legend>
          <div className="grid grid-cols-2 gap-3">
            {([['Individual', 'Self Sponsored'], ['Employer', 'Company Sponsored']] as const).map(([value, label]) => (
              <label
                key={value}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer text-sm ${
                  form.sponsorshipType === value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="sponsorshipType"
                  value={value}
                  checked={form.sponsorshipType === value}
                  onChange={() => setForm(f => ({ ...f, sponsorshipType: value }))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {employer && (
          <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
            <Field id="enr-employerName" label="Company Name" error={fieldErrors.employerName}>
              <input {...inp('employerName')} autoComplete="organization" />
            </Field>
            <Field id="enr-employerUen" label="Company UEN" error={fieldErrors.employerUen}>
              <input {...inp('employerUen')} placeholder="201200696W" maxLength={10} autoCapitalize="characters" />
            </Field>
            <Field id="enr-employerContactName" label="Company Contact Person (e.g. HR)" error={fieldErrors.employerContactName}>
              <input {...inp('employerContactName')} />
            </Field>
            <Field id="enr-employerContactEmail" label="Company Contact Email" error={fieldErrors.employerContactEmail}>
              <input type="email" {...inp('employerContactEmail')} />
            </Field>
            <Field id="enr-employerContactNumber" label="Company Contact Number" error={fieldErrors.employerContactNumber}>
              <input {...inp('employerContactNumber')} inputMode="tel" />
            </Field>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Submitting…' : 'Submit enrolment details'}</button>
      </form>
    );
  }

  return (
    <>
      <Head>
        <title>SWDA Enrolment</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-6 px-4">
        <div className="max-w-md mx-auto bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">SWDA Enrolment</h1>
            {course && (
              <dl className="mt-3 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-sm rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 p-3">
                <dt className="text-gray-500 dark:text-gray-400">Course Title</dt>
                <dd className="font-medium text-gray-900 dark:text-white">{course.title}</dd>
                {course.code && (<>
                  <dt className="text-gray-500 dark:text-gray-400">Course Code</dt>
                  <dd className="text-gray-900 dark:text-white">{course.code}</dd>
                </>)}
                <dt className="text-gray-500 dark:text-gray-400">Course Run ID</dt>
                <dd className="text-gray-900 dark:text-white">{course.courseRunId}</dd>
                {course.startDate && (<>
                  <dt className="text-gray-500 dark:text-gray-400">Date</dt>
                  <dd className="text-gray-900 dark:text-white">
                    {fmtDay(course.startDate)}{course.endDate && course.endDate !== course.startDate ? ` – ${fmtDay(course.endDate)}` : ''}
                  </dd>
                </>)}
              </dl>
            )}
          </div>
          {body}
        </div>
      </div>
    </>
  );
}
