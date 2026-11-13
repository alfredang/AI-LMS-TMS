import React, { useCallback, useEffect, useState } from 'react';

interface EnrolmentRequest {
  id: string;
  traineeName: string;
  nric: string;
  contactNumber: string;
  email: string;
  dateOfBirth: string;
  sponsorshipType: 'Individual' | 'Employer';
  employerName: string | null;
  employerUen: string | null;
  employerContactName: string | null;
  employerContactEmail: string | null;
  employerContactNumber: string | null;
  status: 'submitted' | 'enrolled' | 'failed' | 'dismissed';
  enrolmentRef: string | null;
  lastError: string | null;
  submittedAt: string;
  updatedAt: string;
}

const STATUS_STYLE: Record<EnrolmentRequest['status'], { label: string; cls: string }> = {
  submitted: { label: 'Pending', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  failed:    { label: 'Failed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  enrolled:  { label: 'Enrolled', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  dismissed: { label: 'Dismissed', cls: 'bg-surface-elevated text-on-surface-secondary' },
};

const fmtDateTime = (iso: string) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }) : '—';
const mask = (v: string, keep = 4) => (v && v.length > keep ? `${'•'.repeat(v.length - keep)}${v.slice(-keep)}` : v || '—');
const btn = 'px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

const qrSrc = (url: string, size: number) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;

/**
 * E-Attendance page → Enrolment Requests. Shows the class's enrolment QR code for the trainer
 * to flash: learners scan it, and those with no SSG enrolment submit their details. Staff then
 * enrol them on TPGateway (or record a ref obtained elsewhere).
 */
export const EnrolmentRequestsPanel: React.FC<{
  courseRunUuid: string;
  isAdminMode: boolean;
  onEnrolled?: () => void;
}> = ({ courseRunUuid, isAdminMode, onEnrolled }) => {
  const [requests, setRequests] = useState<EnrolmentRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default: the header still shows how many requests are pending.
  const [open, setOpen] = useState(false);
  const [showNric, setShowNric] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [refEditId, setRefEditId] = useState<string | null>(null);
  const [refInput, setRefInput] = useState('');
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [qrAvailable, setQrAvailable] = useState(false);
  const [qrZoomed, setQrZoomed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!courseRunUuid) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/enrolments/detail-requests?courseRunUuid=${encodeURIComponent(courseRunUuid)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load enrolment requests');
      setRequests(json.data || []);
      setQrAvailable(!!json.qrAvailable);
    } catch (e) {
      if (quiet) return;
      setError(e instanceof Error ? e.message : 'Failed to load enrolment requests');
    } finally {
      setLoading(false);
    }
  }, [courseRunUuid]);

  useEffect(() => {
    setRequests([]);
    setRowMsg({});
    setConfirmId(null);
    setRefEditId(null);
    setQrAvailable(false);
    setQrZoomed(false);
    setConfirmAll(false);
    load();
  }, [load]);

  // New submissions arrive while the trainer is showing the QR code: refresh quietly.
  useEffect(() => {
    if (!open || !qrAvailable) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !busyId && !bulk && !refEditId && !confirmId) load(true);
    }, 20000);
    return () => clearInterval(t);
  }, [open, qrAvailable, busyId, bulk, refEditId, confirmId, load]);

  useEffect(() => {
    if (!qrZoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setQrZoomed(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrZoomed]);

  const enrolUrl = typeof window !== 'undefined' ? `${window.location.origin}/enrol/${courseRunUuid}` : '';
  const copyLink = () => {
    navigator.clipboard?.writeText(enrolUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  const act = async (id: string, action: 'enrol' | 'set_ref' | 'dismiss' | 'reopen', enrolmentRef?: string) => {
    setBusyId(id);
    setRowMsg(m => { const n = { ...m }; delete n[id]; return n; });
    try {
      const res = await fetch('/api/enrolments/detail-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, enrolmentRef }),
      });
      const json = await res.json();
      if (json.request) setRequests(rs => rs.map(r => (r.id === id ? json.request : r)));
      const ok = res.ok && json.success;
      if (action === 'enrol' || action === 'set_ref' || !ok) {
        setRowMsg(m => ({ ...m, [id]: { ok, text: json.message || json.error || (ok ? 'Done' : 'Failed') } }));
      }
      if (ok && (action === 'enrol' || action === 'set_ref')) {
        setRefEditId(null);
        onEnrolled?.();
      }
    } catch {
      setRowMsg(m => ({ ...m, [id]: { ok: false, text: 'Request failed. Please try again.' } }));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  // Enrol every pending request on TPGateway, one at a time (SSG rate-limits bursts).
  const enrolAll = async () => {
    setConfirmAll(false);
    const todo = requests.filter(r => r.status === 'submitted' || r.status === 'failed');
    setBulk({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      await act(todo[i].id, 'enrol');
      setBulk({ done: i + 1, total: todo.length });
      if (i < todo.length - 1) await new Promise(r => setTimeout(r, 1500));
    }
    setBulk(null);
  };

  const pending = requests.filter(r => r.status === 'submitted' || r.status === 'failed').length;
  const dismissed = requests.filter(r => r.status === 'dismissed').length;
  const visible = showDismissed ? requests : requests.filter(r => r.status !== 'dismissed');

  const th = 'px-3 py-3 text-left font-semibold text-on-surface-secondary whitespace-nowrap';
  const td = 'px-3 py-3 text-on-surface-secondary whitespace-nowrap';

  return (
    <div className="bg-surface rounded-lg border border-default shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-default">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-on-surface">Enrolment Requests</h2>
          {pending > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs font-semibold">
              {pending} pending
            </span>
          )}
          <span className="text-xs text-muted hidden md:inline">Learners scan the QR code; those not enrolled yet submit their details here</span>
          {loading && <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary ml-1" />}
        </div>
        <div className="flex items-center gap-2">
          {dismissed > 0 && (
            <button onClick={() => setShowDismissed(v => !v)} className="text-xs text-primary hover:underline">
              {showDismissed ? 'Hide' : 'Show'} dismissed ({dismissed})
            </button>
          )}
          <button
            onClick={() => load()}
            disabled={loading}
            className="px-3 py-1.5 bg-surface-elevated border border-default text-on-surface-secondary rounded text-xs font-medium hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="px-3 py-1.5 bg-surface-elevated border border-default text-on-surface-secondary rounded text-xs font-medium hover:bg-surface-hover transition-colors"
          >
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {open && (
        <>
          {error && <p className="px-4 py-2 text-xs text-red-500 border-b border-default">{error}</p>}

          {/* Enrolment QR code for the trainer to show the class */}
          {qrAvailable && enrolUrl && (
            <div className="flex flex-col sm:flex-row gap-4 px-4 py-4 border-b border-default">
              <button
                type="button"
                onClick={() => setQrZoomed(true)}
                title="Show the QR code full screen"
                className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm cursor-zoom-in self-start"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc(enrolUrl, 300)} alt="Enrolment request QR code" width={132} height={132} />
              </button>
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-sm font-medium text-on-surface">
                  Enrolment QR code <span className="font-normal text-on-surface-secondary">(not the SSG attendance QR code)</span>
                </p>
                <p className="text-xs text-on-surface-secondary">
                  Show this QR code to the class. Each learner scans it and enters their NRIC/FIN. Learners already enrolled see
                  their enrolment ID and submit nothing. Learners not enrolled fill in their details, which appear below as
                  Pending for you to enrol on TPGateway. This code is for enrolment details only. It does not take attendance and does
                  not change the SSG attendance QR code above: learners still scan that one for e-attendance, enrolled or not.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={enrolUrl}
                    aria-label="Enrolment form link"
                    className="input-themed flex-1 min-w-0 border rounded px-3 py-2 text-sm bg-surface-elevated text-on-surface-secondary focus:outline-none"
                  />
                  <button onClick={copyLink} className="px-3 py-2 bg-surface-elevated border border-default text-on-surface-secondary rounded text-sm font-medium hover:bg-surface-hover transition-colors whitespace-nowrap">
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button onClick={() => setQrZoomed(true)} className="px-3 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary-hover transition-colors whitespace-nowrap">
                    Show full screen
                  </button>
                </div>
              </div>
            </div>
          )}

          {pending > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-default">
              {bulk ? (
                <span className="text-xs text-on-surface-secondary inline-flex items-center gap-2">
                  <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary" />
                  Enrolling on TPGateway… {bulk.done} of {bulk.total}
                </span>
              ) : confirmAll ? (
                <>
                  <span className="text-xs text-on-surface-secondary">Create live TPGateway enrolments for all {pending} pending learners?</span>
                  <button onClick={enrolAll} className={`${btn} bg-primary text-white hover:bg-primary-hover`}>Confirm</button>
                  <button onClick={() => setConfirmAll(false)} className={`${btn} bg-surface-elevated border border-default text-on-surface-secondary`}>Cancel</button>
                </>
              ) : (
                <button disabled={!!busyId} onClick={() => setConfirmAll(true)} className={`${btn} bg-primary text-white hover:bg-primary-hover`}>
                  Enrol all pending on TPGateway ({pending})
                </button>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-elevated border-b border-default">
                <tr>
                  <th className={`${th} text-center w-10`}>No.</th>
                  <th className={th}>Trainee Name</th>
                  <th className={th}>
                    <div className="flex items-center gap-2">
                      NRIC
                      {isAdminMode && (
                        <button onClick={() => setShowNric(v => !v)} className="text-xs font-normal text-primary hover:underline">
                          {showNric ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </div>
                  </th>
                  <th className={th}>
                    <div className="flex items-center gap-2">
                      Contact Number
                      <button onClick={() => setShowContact(v => !v)} className="text-xs font-normal text-primary hover:underline">
                        {showContact ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </th>
                  <th className={th}>Email</th>
                  <th className={th}>Date of Birth</th>
                  <th className={th}>Sponsorship</th>
                  <th className={th}>Employer</th>
                  <th className={th}>Submitted</th>
                  <th className={th}>Status</th>
                  <th className={th}>Enrolment Ref</th>
                  <th className={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-sm text-muted italic">
                      {loading ? 'Loading…' : 'No enrolment requests yet for this class.'}
                    </td>
                  </tr>
                ) : visible.map((r, idx) => {
                  const st = STATUS_STYLE[r.status];
                  const busy = busyId === r.id || !!bulk;
                  const msg = rowMsg[r.id];
                  const actionable = r.status === 'submitted' || r.status === 'failed';
                  return (
                    <tr key={r.id} className="border-b border-default align-top hover:bg-surface-elevated transition-colors">
                      <td className="px-3 py-3 text-center text-on-surface-secondary">{idx + 1}</td>
                      <td className="px-3 py-3 font-medium text-on-surface whitespace-nowrap">{r.traineeName}</td>
                      <td className={`${td} font-mono`}>{showNric ? r.nric : `${r.nric[0]}XXXX${r.nric.slice(-4)}`}</td>
                      <td className={td}>{showContact ? r.contactNumber : mask(r.contactNumber)}</td>
                      <td className="px-3 py-3 text-on-surface-secondary">{r.email}</td>
                      <td className={td}>{r.dateOfBirth}</td>
                      <td className={td}>{r.sponsorshipType === 'Employer' ? 'Company Sponsored' : 'Self Sponsored'}</td>
                      <td className="px-3 py-3 text-on-surface-secondary min-w-[12rem]">
                        {r.sponsorshipType === 'Employer' ? (
                          <div className="text-xs space-y-0.5">
                            <div className="font-medium text-on-surface">{r.employerName}</div>
                            <div>UEN {r.employerUen}</div>
                            <div>{r.employerContactName}</div>
                            <div>{r.employerContactEmail}</div>
                            <div>{showContact ? r.employerContactNumber : mask(r.employerContactNumber || '')}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td className={`${td} text-xs`}>{fmtDateTime(r.updatedAt || r.submittedAt)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className={`${td} font-mono`}>{r.enrolmentRef || '—'}</td>
                      <td className="px-3 py-3 min-w-[15rem]">
                        {actionable && confirmId !== r.id && refEditId !== r.id && (
                          <div className="flex flex-wrap gap-1.5">
                            <button disabled={busy} onClick={() => setConfirmId(r.id)} className={`${btn} bg-primary text-white hover:bg-primary-hover`}>
                              Enrol on TPGateway
                            </button>
                            <button disabled={busy} onClick={() => { setRefEditId(r.id); setRefInput(''); }} className={`${btn} bg-surface-elevated border border-default text-on-surface-secondary hover:bg-surface-hover`}>
                              Enter Ref
                            </button>
                            <button disabled={busy} onClick={() => act(r.id, 'dismiss')} className={`${btn} text-red-500 hover:underline`}>
                              Dismiss
                            </button>
                          </div>
                        )}
                        {confirmId === r.id && (
                          <div className="space-y-1.5">
                            <p className="text-xs text-on-surface-secondary whitespace-normal">
                              Create a live TPGateway enrolment for <b>{r.traineeName}</b>?
                            </p>
                            <div className="flex gap-1.5">
                              <button disabled={busy} onClick={() => act(r.id, 'enrol')} className={`${btn} bg-primary text-white hover:bg-primary-hover inline-flex items-center gap-1`}>
                                {busy && <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />}
                                {busy ? 'Enrolling…' : 'Confirm'}
                              </button>
                              <button disabled={busy} onClick={() => setConfirmId(null)} className={`${btn} bg-surface-elevated border border-default text-on-surface-secondary`}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                        {refEditId === r.id && (
                          <div className="flex gap-1.5 items-center">
                            <input
                              value={refInput}
                              onChange={e => setRefInput(e.target.value.toUpperCase())}
                              placeholder="ENR-2411-123456"
                              className="w-40 px-2 py-1 text-xs rounded border border-default bg-surface text-on-surface font-mono"
                            />
                            <button disabled={busy || !refInput.trim()} onClick={() => act(r.id, 'set_ref', refInput)} className={`${btn} bg-primary text-white hover:bg-primary-hover`}>
                              Save
                            </button>
                            <button disabled={busy} onClick={() => setRefEditId(null)} className={`${btn} bg-surface-elevated border border-default text-on-surface-secondary`}>
                              Cancel
                            </button>
                          </div>
                        )}
                        {r.status === 'dismissed' && (
                          <button disabled={busy} onClick={() => act(r.id, 'reopen')} className={`${btn} text-primary hover:underline`}>
                            Reopen
                          </button>
                        )}
                        {r.status === 'failed' && r.lastError && !msg && (
                          <p className="mt-1.5 text-xs text-red-500 whitespace-normal">{r.lastError}</p>
                        )}
                        {msg && (
                          <p className={`mt-1.5 text-xs whitespace-normal ${msg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{msg.text}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {qrZoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enrolment QR code full screen"
          onClick={() => setQrZoomed(false)}
          className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center gap-4 p-6 cursor-zoom-out"
        >
          <p className="text-3xl font-bold text-gray-900 text-center">Scan to check or complete your enrolment</p>
          <p className="text-base font-medium text-amber-700 text-center">This is not the attendance QR code. Take your attendance with the SSG QR code as usual.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc(enrolUrl, 1000)} alt="Enrolment request QR code" style={{ width: 'min(64vh, 88vw)', height: 'min(64vh, 88vw)' }} />
          <p className="text-sm text-gray-500 break-all text-center">{enrolUrl}</p>
          <p className="text-xs text-gray-400">Click anywhere or press Esc to close</p>
        </div>
      )}
    </div>
  );
};

export default EnrolmentRequestsPanel;
