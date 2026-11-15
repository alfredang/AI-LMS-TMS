import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

interface Learner {
  name: string;
  email: string;
  registeredAt: string | null;
  signedIn: boolean;
  isTrainer?: boolean;
  selfRegistered?: boolean;
}

interface CatalogItem {
  slug: string;
  code: string;
  title: string;
  vendor: string;
}

interface PanelData {
  configured: boolean;
  isStaff?: boolean;
  courseRunId?: string;
  examCode?: string | null;
  examTitle?: string | null;
  warning?: string | null;
  catalog?: CatalogItem[];
  learners?: Learner[];
}

interface RowResult { ok: boolean; error?: string; accountCreated?: boolean }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const btn = 'px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
const qrSrc = (url: string, size: number) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' }) : '—';

/**
 * Class page (after Lesson) and E-Attendance page → Practice Exam. For courses linked to a practice exam on
 * exams.tertiaryinfotech.com (e.g. CCAR-F), the trainer registers the class's
 * learners and its trainer (name + email) there in one click; the Exams account records the
 * course run ID, register date and "Registered from TMS". Staff link the course
 * to its exam here. Hidden when the integration isn't configured, and for
 * trainers when the course has no practice exam.
 */
export function PracticeExamPanel({ courseRunUuid, variant = 'compact', id }: {
  courseRunUuid: string;
  /** 'section' = full-width class-page card (matches the Lesson section); 'compact' = E-Attendance panel. */
  variant?: 'compact' | 'section';
  id?: string;
}) {
  const section = variant === 'section';
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Collapsed until the user expands it; the header still shows the exam and the registered count.
  const [open, setOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // 'all' | email | 'exam'
  const [rowResult, setRowResult] = useState<Record<string, RowResult>>({});
  const [summary, setSummary] = useState<{ ok: boolean; text: string } | null>(null);
  const [examPick, setExamPick] = useState('');

  const validRun = UUID_RE.test(courseRunUuid);

  const load = useCallback(async () => {
    if (!UUID_RE.test(courseRunUuid)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/practice-exam/course-run?courseRunUuid=${encodeURIComponent(courseRunUuid)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json);
      const hit = (json.catalog || []).find((c: CatalogItem) => c.slug === json.examCode || c.code.toUpperCase() === String(json.examCode || '').toUpperCase());
      setExamPick(hit ? hit.slug : json.examCode || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load practice exam');
    } finally {
      setLoading(false);
    }
  }, [courseRunUuid]);

  // Self-Register QR: Esc closes it; new sign-ups arrive while it is on screen, so reload on close.
  const closeQr = useCallback(() => { setQrOpen(false); load(); }, [load]);
  useEffect(() => {
    if (!qrOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeQr(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrOpen, closeQr]);

  useEffect(() => {
    setData(null);
    setRowResult({});
    setSummary(null);
    load();
  }, [load]);

  const register = async (emails?: string[]) => {
    setOpen(true); // show the per-person result of the registration
    setBusy(emails?.length === 1 ? emails[0] : 'all');
    setSummary(null);
    try {
      const res = await fetch('/api/practice-exam/course-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunUuid, action: 'register', emails }),
      });
      const json = await res.json();
      if (Array.isArray(json.results)) {
        setRowResult(prev => {
          const next = { ...prev };
          for (const r of json.results) next[r.email] = { ok: r.ok, error: r.error, accountCreated: r.accountCreated };
          return next;
        });
        setSummary({
          ok: json.failed === 0,
          text: `${json.registered} registered${json.emailed ? ` (${json.emailed} emailed the exam link)` : ''}${json.failed ? `, ${json.failed} failed` : ''}.`,
        });
        await load();
      } else {
        setSummary({ ok: false, text: json.error || 'Registration failed' });
      }
    } catch {
      setSummary({ ok: false, text: 'Request failed. Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  const saveExam = async () => {
    setBusy('exam');
    setSummary(null);
    try {
      const res = await fetch('/api/practice-exam/course-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseRunUuid, action: 'set_exam', examCode: examPick || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) setSummary({ ok: false, text: json.error || 'Could not save' });
      else await load();
    } finally {
      setBusy(null);
    }
  };

  if (!validRun || (!data && !error)) return null;
  if (data && !data.configured) return null;
  if (data && !data.examCode && !data.isStaff) return null;
  // Class page: only when the course has a practice exam (set under Course Settings in the course editor).
  if (section && !data?.examCode) return null;

  const learners = data?.learners || [];
  const pending = learners.filter(l => !l.registeredAt).length;
  const pendingTrainers = learners.filter(l => l.isTrainer && !l.registeredAt).length;
  const pendingLearners = pending - pendingTrainers;
  const registerLabel = pending === 0
    ? 'Re-register all'
    : pendingLearners === 0
      ? `Register ${pendingTrainers === 1 ? 'trainer' : `${pendingTrainers} trainers`}`
      : `Register ${pendingLearners} learner${pendingLearners === 1 ? '' : 's'}${pendingTrainers ? ' + trainer' : ''}`;
  const known = !examPick || !!data?.catalog?.some(c => c.slug === examPick);
  const savedSlug = data?.catalog?.find(c => c.slug === data.examCode || c.code.toUpperCase() === String(data.examCode || '').toUpperCase())?.slug ?? data?.examCode ?? '';

  const selfRegisterUrl = typeof window !== 'undefined' ? `${window.location.origin}/practice-exam/${courseRunUuid}` : '';
  const copyLink = () => {
    navigator.clipboard?.writeText(selfRegisterUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  const body = (
    <>
      <div className={section
        ? 'flex flex-wrap items-center justify-between gap-3 p-6'
        : 'flex items-center justify-between px-4 py-3 border-b border-default'}>
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left" aria-expanded={open}>
          {section
            ? <h3 className="text-xl font-bold text-gray-900 dark:text-white">Practice Exam</h3>
            : <h2 className="text-sm font-semibold text-on-surface">Practice Exam</h2>}
          {data?.examCode && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {data.examCode}
            </span>
          )}
          {data?.examCode && learners.length > 0 && (
            <span className="text-xs text-on-surface-secondary">
              {learners.length - pending}/{learners.length} registered
            </span>
          )}
          {!section && <span className="text-xs text-on-surface-secondary">{open ? '▾' : '▸'}</span>}
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} disabled={loading} className={`${btn} border border-default text-on-surface-secondary hover:bg-surface-elevated`}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {data?.examCode && data.courseRunId && (
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className={`${btn} border border-default text-on-surface hover:bg-surface-elevated`}
              title="Show a QR code the class scans to register themselves for the practice exam"
            >
              Self-Register
            </button>
          )}
          {data?.examCode && learners.length > 0 && (
            <button
              type="button"
              onClick={() => register()}
              disabled={!!busy || !data.courseRunId}
              className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}
              title="Create Tertiary Exams accounts (name + email) and assign the practice exam to every learner and trainer in this class"
            >
              {busy === 'all' ? 'Registering…' : registerLabel}
            </button>
          )}
          {section && (
            <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? 'Collapse' : 'Expand'} className="p-1">
              <Icon name={IconName.ChevronDown} className={`w-5 h-5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className={section ? 'px-6 pb-6 pt-4 space-y-3 border-t' : 'px-4 py-3 space-y-3'}>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {data?.warning && <p className="text-xs text-amber-600 dark:text-amber-400">{data.warning}</p>}

          {data?.isStaff && !section && (
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-on-surface-secondary">Practice exam for this course (all classes)</span>
                <select
                  value={examPick}
                  onChange={e => setExamPick(e.target.value)}
                  className="min-w-[18rem] rounded border border-default bg-surface px-2 py-1 text-on-surface"
                >
                  <option value="">— None —</option>
                  {!known && <option value={examPick}>{examPick} (not found)</option>}
                  {(data.catalog || []).map(c => (
                    <option key={c.slug} value={c.slug}>{c.code} — {c.title}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={saveExam}
                disabled={busy === 'exam' || examPick === savedSlug}
                className={`${btn} border border-default text-on-surface hover:bg-surface-elevated`}
              >
                {busy === 'exam' ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}

          {data?.examCode && (
            <p className="text-xs text-on-surface-secondary">
              {data.examTitle || data.examCode} on exams.tertiaryinfotech.com · Course Run ID{' '}
              <span className="font-mono text-on-surface">{data.courseRunId || '—'}</span>. The class&apos;s trainer is registered too. Each
              person is emailed the exam link once, when first registered for this class; they sign in with an email code (OTP) or Google.
            </p>
          )}

          {summary && <p className={`text-xs ${summary.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{summary.text}</p>}

          {data?.examCode && (
            learners.length === 0 ? (
              <p className="text-xs text-on-surface-secondary">No learners or trainers are on this class yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-on-surface-secondary border-b border-default">
                      <th className="py-1.5 pr-3 font-medium">Name</th>
                      <th className="py-1.5 pr-3 font-medium">Email</th>
                      <th className="py-1.5 pr-3 font-medium">Register Date</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {learners.map(l => {
                      const r = rowResult[l.email];
                      return (
                        <tr key={l.email} className="border-b border-default last:border-0">
                          <td className="py-1.5 pr-3 text-on-surface">
                            {l.name || '—'}
                            {l.isTrainer && (
                              <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">Trainer</span>
                            )}
                            {l.selfRegistered && (
                              <span
                                className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                title="Registered from the Self-Register QR code with an email that is not on this class's list"
                              >
                                Self-registered
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 text-on-surface-secondary">{l.email}</td>
                          <td className="py-1.5 pr-3 text-on-surface-secondary">{fmtDate(l.registeredAt)}</td>
                          <td className="py-1.5 pr-3">
                            {r && !r.ok ? (
                              <span className="text-red-500" title={r.error}>Failed: {r.error}</span>
                            ) : l.registeredAt ? (
                              <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                {l.signedIn ? 'Registered · signed in' : 'Registered'}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Not registered</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right">
                            {!l.registeredAt && (
                              <button
                                type="button"
                                onClick={() => register([l.email])}
                                disabled={!!busy}
                                className={`${btn} border border-default text-on-surface hover:bg-surface-elevated`}
                              >
                                {busy === l.email ? 'Registering…' : 'Register'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {qrOpen && selfRegisterUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Practice exam self-registration QR code"
          onClick={closeQr}
          className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center gap-4 p-6"
        >
          <p className="text-3xl font-bold text-gray-900 text-center">Scan to register for the practice exam</p>
          <p className="text-lg font-medium text-blue-700 text-center">{data?.examTitle || data?.examCode}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc(selfRegisterUrl, 1000)} alt="Practice exam self-registration QR code" style={{ width: 'min(58vh, 88vw)', height: 'min(58vh, 88vw)' }} />
          <p className="text-base text-gray-700 text-center max-w-2xl">
            Enter your name and email. You will get an email with the practice exam link; sign in with the one-time code sent to the same inbox.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3" onClick={e => e.stopPropagation()}>
            <span className="text-sm text-gray-500 break-all text-center">{selfRegisterUrl}</span>
            <button type="button" onClick={copyLink} className="px-3 py-1.5 text-sm font-medium rounded border border-gray-300 text-gray-700 hover:bg-gray-100">
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" onClick={closeQr} className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700">
              Close
            </button>
          </div>
          <p className="text-xs text-gray-400">Click anywhere or press Esc to close</p>
        </div>
      )}
    </>
  );

  return section
    ? <div id={id}><Card className="p-0 overflow-hidden">{body}</Card></div>
    : <div id={id} className="bg-surface rounded-lg border border-default shadow-sm">{body}</div>;
}
