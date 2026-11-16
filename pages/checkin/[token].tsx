import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

// PUBLIC page behind the trainer's Take Attendance QR (E-Attendance page, one QR per session).
// No login. A returning learner enters their phone number alone; anyone else enters name + email
// (+ phone). A learner not yet on the class is registered on their first check-in and can then
// sign in to the portal with an email code. This marks the class's attendance in the LMS only;
// SSG e-attendance is still taken with the SSG QR.
// The phone's browser remembers the details it checked in with (localStorage, never sent
// anywhere else) to pre-fill the next session.

interface Ctx {
  status: 'open' | 'not_yet' | 'closed';
  course: { title: string; code: string | null; courseRunId: string };
  session: { label: string; date: string };
}
interface Done { name: string; message: string; registered: boolean; already: boolean; email: string; session: string; at: string }
interface Profile { name: string; email: string; phone: string }

const STORE = 'lmsCheckinProfiles';
const loadProfiles = (): Profile[] => {
  try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v.slice(0, 5) : []; } catch { return []; }
};
const saveProfile = (p: Profile) => {
  try {
    const rest = loadProfiles().filter(x => (p.email ? x.email !== p.email : x.phone !== p.phone));
    localStorage.setItem(STORE, JSON.stringify([p, ...rest].slice(0, 5)));
  } catch { /* private mode */ }
};

const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-slate-400 text-base bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
// Read-only boxes are divs, not inputs, so a long session name wraps instead of being cut off.
const roCls = 'w-full min-h-[2.875rem] px-3 py-2.5 rounded-lg border border-slate-300 text-base bg-slate-100 text-slate-700 break-words';
const nowSgt = () => new Date().toLocaleString('en-GB', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const sgtDate = () => new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' });
const sgtTime = () => new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Singapore', hour: 'numeric', minute: '2-digit', hour12: true });

/** A pre-filled, read-only field (class info the QR code already knows). */
const ReadOnly: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0">
    <p className="block text-sm font-semibold text-gray-900 mb-1.5">{label}</p>
    <div className={roCls} aria-label={label}>{value || '—'}</div>
  </div>
);

export default function CheckinPage() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [known, setKnown] = useState<{ name: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [clock, setClock] = useState<{ date: string; time: string }>({ date: '', time: '' });
  const honeypot = useRef<HTMLInputElement>(null);
  const lastLookup = useRef('');

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/attendance-checkin?t=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(j => { if (!j.success) setLoadError(j.error || 'This check-in link is not valid.'); else setCtx(j); })
      .catch(() => setLoadError('Could not load this page. Please check your connection and try again.'));
  }, [token]);

  useEffect(() => {
    const tick = () => setClock({ date: sgtDate(), time: sgtTime() });
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);

  const fill = (p: Profile) => { setName(p.name); setEmail(p.email); setPhone(p.phone || ''); };
  useEffect(() => {
    const p = loadProfiles();
    setProfiles(p);
    if (!router.query.new && p.length) fill(p[0]);
  }, [router.query.new]);

  // Returning learner: the phone number finds them on this class. The email comes back masked.
  const lookup = useCallback(async (value: string) => {
    const d = value.replace(/\D+/g, '');
    if (d === lastLookup.current) return;
    lastLookup.current = d;
    if (d.length < 8) { setKnown(null); return; }
    try {
      const res = await fetch('/api/public/attendance-checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, action: 'lookup', phone: value }),
      });
      const j = await res.json();
      setKnown(j.found ? { name: j.name, email: j.email } : null);
    } catch { setKnown(null); }
  }, [token]);

  useEffect(() => {
    if (!ctx || !phone) return;
    const t = setTimeout(() => lookup(phone), 600);
    return () => clearTimeout(t);
  }, [phone, ctx, lookup]);

  const onNameInput = (v: string) => {
    setName(v);
    const hit = profiles.find(p => p.name.toLowerCase() === v.trim().toLowerCase());
    if (hit) fill(hit);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const usePhoneOnly = !!known && !email.trim();
      const res = await fetch('/api/public/attendance-checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          t: token, action: 'checkin', phone,
          name: usePhoneOnly ? '' : name, email: usePhoneOnly ? '' : email,
          website: honeypot.current?.value || '',
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) { setError(j.error || 'Check-in failed. Please try again.'); return; }
      // Found by phone alone: the email was never typed here, so it is not stored on the phone.
      saveProfile({ name: j.name || name, email: j.byPhone ? '' : email.trim().toLowerCase(), phone });
      setDone({ name: j.name || name, message: j.message, registered: !!j.registered, already: !!j.already, email: j.email || '', session: j.session || ctx?.session.label || '', at: nowSgt() });
    } catch {
      setError('Check-in failed. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setDone(null); setName(''); setEmail(''); setPhone(''); setKnown(null); setError(null); lastLookup.current = '';
  };

  let body: React.ReactNode;
  if (loadError) {
    body = <p className="text-red-600 text-sm">{loadError}</p>;
  } else if (!ctx) {
    body = <p className="text-gray-500 text-sm">Loading…</p>;
  } else if (done) {
    body = (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="font-semibold text-green-800">{done.message}</p>
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
          <dt className="text-gray-500">Name</dt><dd className="font-medium text-gray-900">{done.name}</dd>
          <dt className="text-gray-500">Session</dt><dd className="text-gray-900">{done.session}</dd>
          <dt className="text-gray-500">Time</dt><dd className="text-gray-900">{done.at}</dd>
        </dl>
        {done.registered && (
          <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 space-y-2">
            <p className="text-sm text-blue-800">
              You are now registered for this class. To get the course material, sign in to the learning portal with
              {done.email ? <> <strong>{done.email}</strong></> : ' your email'} and the one-time code we email you.
            </p>
            <a href="/" className="inline-block text-sm font-medium text-blue-700 underline">Open the learning portal</a>
          </div>
        )}
        <button type="button" onClick={again} className="text-sm text-blue-600 hover:underline">Check in someone else on this phone</button>
      </div>
    );
  } else if (ctx.status !== 'open') {
    body = (
      <p className="text-gray-700 text-sm">
        {ctx.status === 'not_yet' ? 'Check-in for this session is not open yet.' : 'Check-in for this class has closed.'} Please speak to your trainer.
      </p>
    );
  } else {
    body = (
      <form onSubmit={submit} className="space-y-4" autoComplete="on">
        <div>
          <label htmlFor="ci-phone" className="block text-sm font-semibold text-gray-900 mb-1.5">Phone</label>
          <input id="ci-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} className={inputCls}
            value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => lookup(phone)} />
          <p className="text-xs text-gray-500 mt-1" role="status">
            {known ? `Welcome back, ${known.name}. Tap Check In.` : 'Checked in before? Enter your phone number and we fill in the rest.'}
          </p>
        </div>
        <div>
          <label htmlFor="ci-name" className="block text-sm font-semibold text-gray-900 mb-1.5">Name</label>
          <input id="ci-name" type="text" autoComplete="name" maxLength={200} list="ci-saved" className={inputCls}
            required={!known} placeholder={known?.name || ''} value={name} onChange={e => onNameInput(e.target.value)} />
          <datalist id="ci-saved">{profiles.map(p => <option key={`${p.name}|${p.email}`} value={p.name} />)}</datalist>
        </div>
        <div>
          <label htmlFor="ci-email" className="block text-sm font-semibold text-gray-900 mb-1.5">Email</label>
          <input id="ci-email" type="email" autoComplete="email" maxLength={255} className={inputCls}
            required={!known} placeholder={known?.email || ''} value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ReadOnly label="Class Code" value={ctx.course.courseRunId} />
          <ReadOnly label="Session" value={ctx.session.label} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ReadOnly label="Date" value={clock.date} />
          <ReadOnly label="Time" value={clock.time} />
        </div>
        <input ref={honeypot} name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} />
        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg disabled:opacity-50">
          {busy ? 'Checking in…' : 'Check In'}
        </button>
        <p className="text-xs text-gray-500">
          First time? You are registered for this class when you check in. Next session, your phone number is enough.
          This does not replace the SSG e-attendance: scan the SSG QR code too if your trainer shows it.
        </p>
      </form>
    );
  }

  return (
    <>
      <Head>
        <title>Class Check-in</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="min-h-screen bg-gray-50 py-6 px-4">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6 space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Class Check-in</h1>
            {ctx && (
              <p className="text-sm text-gray-500 mt-1">
                {ctx.course.title}
                {ctx.course.code && <><br />Course Code {ctx.course.code}</>}
              </p>
            )}
          </div>
          {body}
        </div>
      </div>
    </>
  );
}
