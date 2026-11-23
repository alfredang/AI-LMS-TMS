import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { NATIONALITY_OPTIONS } from '../../lib/learner/nationality';

// PUBLIC page behind the class's SWDA Enrolment QR code (class page → SWDA Enrolment).
// One page, in the same format as the class check-in page (white, ai-mms style): the learner fills
// in every enrolment detail, and the class details the QR already knows are shown read-only.
// On submit the server checks the class's SWDA enrolments by NRIC/FIN or exact name: a learner
// already enrolled is told so and nothing is stored; anyone else's details go to staff for
// enrolment on TPGateway. Either way they are registered on the class, and the result screen sends
// them to sign in with the exact email that opens it (or lets them correct that email).

type Sponsorship = 'Individual' | 'Employer';

interface FormState {
  traineeName: string;
  nric: string;
  dateOfBirth: string;
  nationality: string;
  email: string;
  contactNumber: string;
  sponsorshipType: Sponsorship;
  employerName: string;
  employerUen: string;
  employerContactName: string;
  employerContactEmail: string;
  employerContactNumber: string;
}

/** How the learner signs in to the class after submitting. */
interface SignIn {
  registered: boolean;
  /** True: the email they typed opens the class. False: another email (shown masked) does. */
  withThisEmail: boolean;
  email: string | null;
  issue: string | null;
}

interface CourseInfo { title: string; code: string | null; courseRunId: string; startDate: string | null; endDate: string | null }

const EMPTY: FormState = {
  traineeName: '', nric: '', dateOfBirth: '', nationality: '', email: '', contactNumber: '', sponsorshipType: 'Individual',
  employerName: '', employerUen: '', employerContactName: '', employerContactEmail: '', employerContactNumber: '',
};


const inputCls = (err?: string) =>
  `w-full px-3 py-2.5 rounded-lg border text-base bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    err ? 'border-red-500' : 'border-slate-400'
  }`;
const roCls = 'w-full min-h-[2.875rem] px-3 py-2.5 rounded-lg border border-slate-300 text-base bg-slate-100 text-slate-700 break-words';
const labelCls = 'block text-sm font-semibold text-gray-900 mb-1.5';
const hintCls = 'text-xs text-gray-600'; // design-tokens-allow (this public form is always white)

const Field: React.FC<{ id: string; label: string; error?: string; children: React.ReactNode }> = ({ id, label, error, children }) => (
  <div>
    <label htmlFor={id} className={labelCls}>{label}</label>
    {children}
    {error && <p id={`${id}-err`} className="text-xs text-red-600 mt-1">{error}</p>}
  </div>
);

/** A pre-filled, read-only field (class info the QR code already knows). */
const ReadOnly: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0">
    <p className={labelCls}>{label}</p>
    <div className={roCls} aria-label={label}>{value || '—'}</div>
  </div>
);

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export default function EnrolmentRequestPage() {
  const router = useRouter();
  const runId = typeof router.query.runId === 'string' ? router.query.runId : '';
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [result, setResult] = useState<
    | null
    | ({ kind: 'enrolled'; ref: string } & SignIn)
    | ({ kind: 'submitted' } & SignIn)
  >(null);
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

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setFieldErrors({});
    try {
      const res = await fetch('/api/public/enrolment-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run: runId, action: 'submit', ...form }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFieldErrors(json.fieldErrors || {});
        setError(json.error || 'Could not submit your details.');
        return;
      }
      const signIn: SignIn = {
        registered: !!json.registered, withThisEmail: !!json.signInWithThisEmail,
        email: json.email || null, issue: json.registrationIssue || null,
      };
      setResult(json.enrolled ? { kind: 'enrolled', ref: json.enrolmentRef || '', ...signIn } : { kind: 'submitted', ...signIn });
    } catch {
      setError('Could not submit your details. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => { setForm(EMPTY); setFieldErrors({}); setError(null); setResult(null); };
  // Back to the form with everything still filled in, to correct the email and submit again.
  const changeEmail = () => {
    setError(null); setResult(null);
    setTimeout(() => { const el = document.getElementById('enr-email') as HTMLInputElement | null; el?.focus(); el?.select(); }, 100);
  };

  // What the learner does next: sign in with the email that opens the class.
  const signInBlock = (r: SignIn) => (
    <>
      {r.registered && r.withThisEmail && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 space-y-3">
          <p className="text-sm text-green-800">You are registered for this class. Sign in with this email to see your class and course materials:</p>
          <p className="text-base font-semibold text-green-900 break-all">{r.email}</p>
          <a
            href={`/?signin=${encodeURIComponent(r.email || '')}`}
            className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg"
          >
            Sign in to my class
          </a>
          <p className="text-xs text-green-800">
            We email a one-time code to this address. Always sign in with this same email.{' '}
            <button type="button" onClick={changeEmail} className="font-semibold underline">Wrong email? Change it</button>
          </p>
        </div>
      )}
      {r.registered && !r.withThisEmail && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2">
          <p className="text-sm text-amber-800">
            You are already registered for this class with another email{r.email ? <>: <strong className="break-all">{r.email}</strong></> : ''}.
            Sign in with that email to see your class. To use a different email, ask your trainer.
          </p>
          <a href="/" className="inline-block text-sm font-medium text-amber-800 underline">Open the learning portal</a>
        </div>
      )}
      {!r.registered && r.issue && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-1">
          <p className="text-sm text-amber-800">{r.issue}</p>
          <button type="button" onClick={changeEmail} className="text-sm font-semibold text-amber-800 underline">Use a different email</button>
        </div>
      )}
    </>
  );
  const employer = form.sponsorshipType === 'Employer';
  const dates = course
    ? [fmtDay(course.startDate), fmtDay(course.endDate)].filter(Boolean).filter((d, i, a) => a.indexOf(d) === i).join(' – ')
    : '';

  let body: React.ReactNode;
  if (loadError) {
    body = <p className="text-red-600 text-sm">{loadError}</p>;
  } else if (!course) {
    body = <p className="text-gray-500 text-sm">Loading…</p>;
  } else if (!available) {
    body = <p className="text-gray-700 text-sm">This class is not open for SWDA enrolment. Please speak to your trainer.</p>;
  } else if (result?.kind === 'enrolled') {
    body = (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="font-semibold text-green-800">You are already enrolled in this class.</p>
          <p className="text-sm text-green-800 mt-1">There is nothing more to submit for your SWDA enrolment.</p>
        </div>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="text-gray-500">Name</dt><dd className="font-medium text-gray-900">{form.traineeName}</dd>
          <dt className="text-gray-500">NRIC/FIN</dt><dd className="text-gray-900">{form.nric ? `${form.nric[0]}XXXX${form.nric.slice(-4)}` : ''}</dd>
          {result.ref && (<><dt className="text-gray-500">Enrolment ID</dt><dd className="font-mono text-gray-900">{result.ref}</dd></>)}
        </dl>
        {signInBlock(result)}
        <button type="button" onClick={startOver} className="text-sm text-blue-700 hover:underline">Enrol someone else on this phone</button>
      </div>
    );
  } else if (result?.kind === 'submitted') {
    body = (
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-4">
          <p className="font-semibold text-blue-800">Thank you, {form.traineeName}. Your enrolment details are submitted.</p>
          <p className="text-sm text-blue-800 mt-1">
            Your trainer or our admin team will complete your SWDA enrolment for this class. You do not need to do anything else for it.
          </p>
        </div>
        {signInBlock(result)}
        <button type="button" onClick={startOver} className="text-sm text-blue-700 hover:underline">Enrol someone else on this phone</button>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="enr-traineeName" label="Trainee Name (as in NRIC/FIN)" error={fieldErrors.traineeName}>
          <input {...inp('traineeName')} autoComplete="name" maxLength={200} />
        </Field>
        <Field id="enr-nric" label="NRIC/FIN" error={fieldErrors.nric}>
          <input {...inp('nric')} placeholder="S1234567A" maxLength={9} autoComplete="off" autoCapitalize="characters" />
        </Field>
        <Field id="enr-dateOfBirth" label="Date of Birth" error={fieldErrors.dateOfBirth}>
          <input type="date" {...inp('dateOfBirth')} className={`${inputCls(fieldErrors.dateOfBirth)} h-[2.875rem] appearance-none`} max={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field id="enr-nationality" label="Nationality" error={fieldErrors.nationality}>
          <select
            id="enr-nationality"
            value={form.nationality}
            onChange={e => {
              setForm(f => ({ ...f, nationality: e.target.value }));
              if (fieldErrors.nationality) setFieldErrors(fe => { const n = { ...fe }; delete n.nationality; return n; });
            }}
            aria-invalid={!!fieldErrors.nationality || undefined}
            aria-describedby={fieldErrors.nationality ? 'enr-nationality-err' : undefined}
            className={`${inputCls(fieldErrors.nationality)} h-[2.875rem] ${form.nationality ? '' : 'text-gray-400'}`}
          >
            <option value="" disabled>Select…</option>
            {NATIONALITY_OPTIONS.map(n => <option key={n} value={n} className="text-gray-900">{n}</option>)}
          </select>
        </Field>
        <Field id="enr-email" label="Email" error={fieldErrors.email}>
          <input type="email" {...inp('email')} autoComplete="email" maxLength={255} />
          <p className={`${hintCls} mt-1`}>Use an email you can open now. You sign in to your class with this same email.</p>
        </Field>
        <Field id="enr-contactNumber" label="Contact Number" error={fieldErrors.contactNumber}>
          <input type="tel" {...inp('contactNumber')} placeholder="91234567" inputMode="tel" autoComplete="tel" maxLength={20} />
        </Field>

        <fieldset>
          <legend className={labelCls}>Sponsorship</legend>
          <div className="grid grid-cols-2 gap-3">
            {([['Individual', 'Self Sponsored'], ['Employer', 'Company Sponsored']] as const).map(([value, label]) => (
              <label
                key={value}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer text-sm ${
                  form.sponsorshipType === value ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-400 text-gray-800'
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
          <div className="space-y-4 p-4 rounded-lg bg-slate-50 border border-slate-200">
            <Field id="enr-employerName" label="Company Name" error={fieldErrors.employerName}>
              <input {...inp('employerName')} autoComplete="organization" />
            </Field>
            <p className={hintCls}>
              Only the company name is needed. Leave the UEN and contact details blank if you do not know them: our team will get them.
            </p>
            <Field id="enr-employerUen" label="Company UEN (optional)" error={fieldErrors.employerUen}>
              <input {...inp('employerUen')} placeholder="201200696W" maxLength={10} autoCapitalize="characters" />
            </Field>
            <Field id="enr-employerContactName" label="Company Contact Person, e.g. HR (optional)" error={fieldErrors.employerContactName}>
              <input {...inp('employerContactName')} />
            </Field>
            <Field id="enr-employerContactEmail" label="Company Contact Email (optional)" error={fieldErrors.employerContactEmail}>
              <input type="email" {...inp('employerContactEmail')} />
            </Field>
            <Field id="enr-employerContactNumber" label="Company Contact Number (optional)" error={fieldErrors.employerContactNumber}>
              <input {...inp('employerContactNumber')} inputMode="tel" />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-3"><ReadOnly label="Course Code" value={course.code || ''} /></div>
          <div className="col-span-2"><ReadOnly label="Course Run ID" value={course.courseRunId} /></div>
        </div>
        <ReadOnly label="Date" value={dates} />

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg disabled:opacity-50">
          {busy ? 'Submitting…' : 'Submit Enrolment'}
        </button>
        <p className="text-xs text-gray-500">
          Enter your name and date of birth exactly as on your NRIC/FIN card. If you are already enrolled in this class, we tell you
          and nothing more is submitted. Either way you are registered for the class and can sign in with an email code.
        </p>
      </form>
    );
  }

  return (
    <>
      <Head>
        <title>SWDA Enrolment</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-slate-50 py-6 px-4">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">SWDA Enrolment</h1>
            {course && <p className="text-sm text-gray-500 mt-1">{course.title}</p>}
          </div>
          {body}
        </div>
      </div>
    </>
  );
}
