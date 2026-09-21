import React, { useEffect, useRef, useState } from 'react';
import TpgRenewalSetup from './TpgRenewalSetup';

interface PlanRow {
  id: string;
  courseTitle: string;
  operation: string;
  sourceTab: string | null;
  rawStatus: string | null;
  before: { renewalApplicationNo: string | null; actualRenewDate: string | null; renewedStatus: string | null };
  desired: { renewalApplicationNo: string | null; actualRenewDate: string | null; renewedStatus: string | null };
  changed: boolean;
}

interface TrialPlan {
  planHash: string;
  scope: { asOfDate: string; throughDate: string };
  captures: {
    submissions: { rows: number; scrapedAt: string };
    rejectedApplications: { rows: number; scrapedAt: string };
  };
  summary: { selectedCourses: number; wouldUpdate: number; alreadyCorrect: number; notFound: number; statusUnset: number };
  rows: PlanRow[];
}

async function postTrial<T>(endpoint: string, body: unknown): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.message || `Request failed (${response.status}).`);
  return payload as T;
}

const display = (value: string | null | undefined) => value || 'Not set';
const MIN_EXTENSION_VERSION = '0.1.6';

const extensionIsCurrent = (version: string): boolean => {
  const parts = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!parts) return false;
  const installed = parts.slice(1).map(Number);
  const minimum = MIN_EXTENSION_VERSION.split('.').map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (installed[index] !== minimum[index]) return installed[index] > minimum[index];
  }
  return true;
};

const TpgRenewalTrial: React.FC<{ onApplied: () => Promise<void> | void }> = ({ onApplied }) => {
  const [isLocal, setIsLocal] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'ready' | 'capture' | 'planning' | 'review' | 'applying' | 'done'>('ready');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<TrialPlan | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; alreadyCorrect: number } | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIsLocal(window.location.origin === 'http://localhost:3000');
    let disposed = false;
    fetch('/api/admin/tpg-renewal-trial/configuration')
      .then(response => response.ok ? response.json() : null)
      .then(config => { if (!disposed) setEnabled(Boolean(config?.enabled && config.origin === window.location.origin)); })
      .catch(() => { if (!disposed) setEnabled(false); });
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === 'TIA_TPG_RENEWAL_READY') {
        setExtensionVersion(String(data.version || 'installed'));
        return;
      }
      if (data?.type !== 'TIA_TPG_RENEWAL_EVENT' || data.requestId !== requestIdRef.current) return;
      if (data.event === 'progress') setMessage(String(data.message || 'Capturing TPG…'));
      if (data.event === 'error') {
        if (timerRef.current) clearTimeout(timerRef.current);
        requestIdRef.current = null;
        setMessage('');
        setError(String(data.message || 'TPG capture failed.'));
        setStage('ready');
      }
      if (data.event === 'complete') {
        if (timerRef.current) clearTimeout(timerRef.current);
        requestIdRef.current = null;
        setStage('planning');
        setMessage('Building read-only renewal plan…');
        postTrial<{ jobId: string; plan: TrialPlan }>('/api/admin/tpg-renewal-trial/plan', { captures: data.captures })
          .then((preview) => { setJobId(preview.jobId); setPlan(preview.plan); setStage('review'); setMessage(''); })
          .catch((cause) => { setError(cause.message); setStage('ready'); });
      }
    };
    window.addEventListener('message', receive);
    window.postMessage({ type: 'TIA_TPG_RENEWAL_PING' }, window.location.origin);
    return () => {
      disposed = true;
      window.removeEventListener('message', receive);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stage !== 'capture' && stage !== 'planning' && stage !== 'applying') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, stage]);

  if (!enabled) return null;

  const startCapture = () => {
    setOpen(true);
    setError('');
    setMessage('');
    setPlan(null);
    setJobId(null);
    setResult(null);
    if (!extensionVersion) {
      setStage('ready');
      setError('TIA TPG Renewal Sync extension was not detected. Install it with Load unpacked, then refresh this page.');
      return;
    }
    if (!extensionIsCurrent(extensionVersion)) {
      setStage('ready');
      setError(`TIA TPG Renewal Sync v${extensionVersion} is outdated. In chrome://extensions, reload the TIA TPG Renewal Sync (Local Trial) extension loaded from this repository, then refresh this TIA page. Version ${MIN_EXTENSION_VERSION} or newer is required.`);
      return;
    }
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    setStage('capture');
    setMessage('Connecting to TPG…');
    timerRef.current = setTimeout(() => {
      requestIdRef.current = null;
      setMessage('');
      setError('The TPG capture timed out. Check the TPG tab, then retry.');
      setStage('ready');
    }, 10 * 60 * 1000);
    window.postMessage({ type: 'TIA_TPG_RENEWAL_START', requestId }, window.location.origin);
  };

  const apply = async () => {
    if (!plan || !jobId) return;
    if (!window.confirm(`Apply ${plan.summary.wouldUpdate} renewal changes to the live TIA database?`)) return;
    setError('');
    setStage('applying');
    try {
      const response = await postTrial<{ audit: { summary: { updated: number; alreadyCorrect: number } }; auditWarning?: string }>(
        '/api/admin/tpg-renewal-trial/apply', { jobId, confirmPlanHash: plan.planHash },
      );
      setResult(response.audit.summary);
      setStage('done');
      if (response.auditWarning) setError(response.auditWarning);
      try {
        await onApplied();
      } catch {
        setError('Update committed, but the page could not refresh. Reload this page to view the new values.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('review');
    }
  };

  const busy = stage === 'capture' || stage === 'planning' || stage === 'applying';
  const changedRows = plan?.rows.filter((row) => row.changed) || [];

  return (
    <>
      <div role="group" aria-label="TPG renewal tools"
        className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-purple-300 bg-purple-50/60 p-2 dark:border-purple-500/60 dark:bg-purple-950/30">
      <button onClick={startCapture} className="px-3 py-1.5 text-xs font-medium rounded bg-purple-700 text-white hover:bg-purple-800"
        title="Local trial: capture TPG in Chrome, review a plan, then optionally update TIA">
        {isLocal ? 'Refresh from TPG (Trial)' : 'Refresh from TPG'}
      </button>
      <TpgRenewalSetup version={extensionVersion} local={isLocal} />
      </div>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="TPG renewal refresh trial">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-xl bg-white dark:bg-gray-900 p-6 shadow-2xl text-gray-900 dark:text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">TPG Renewal Refresh{isLocal ? ' — Local Trial' : ''}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">Capture both TPG application tabs, preview exact renewal changes, then confirm the database update.</p>
              </div>
              <button ref={closeRef} onClick={() => setOpen(false)} disabled={busy}
                className="h-10 w-10 rounded text-xl hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-600 disabled:opacity-40"
                aria-label="Close renewal refresh dialog">×</button>
            </div>
            <div className="mt-4 text-sm">
              <p>Extension: {extensionVersion ? `Connected (v${extensionVersion})` : 'Not detected'}</p>
              <p>TPG: sign in normally in the same Chrome profile. No passwords or cookies are sent to TIA.</p>
              <p className="font-medium text-amber-700 dark:text-amber-300">Preview is read-only; Apply updates the live TIA database.</p>
            </div>
            {message && <p className="mt-4 text-sm text-blue-700 dark:text-blue-300" role="status">{message}</p>}
            {error && <p className="mt-4 rounded bg-red-50 dark:bg-red-900/30 p-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
            {stage === 'review' && plan && (
              <div className="mt-5">
                <p className="text-sm font-semibold">Scope: WSQ validity end dates {plan.scope.asOfDate} through {plan.scope.throughDate}, inclusive.</p>
                <p className="mt-1 text-sm">TPG: {plan.captures.submissions.rows} Submissions; {plan.captures.rejectedApplications.rows} Rejected Applications.</p>
                <p className="mt-1 text-sm">{plan.summary.selectedCourses} courses checked · {plan.summary.wouldUpdate} to update · {plan.summary.alreadyCorrect} already correct · {plan.summary.notFound} NOT Found · {plan.summary.statusUnset} statuses not set.</p>
                <p className="mt-1 break-all text-xs text-gray-500">Plan hash: {plan.planHash}</p>
                {changedRows.length > 0 ? (
                  <div className="mt-4 max-h-[46vh] overflow-auto border border-gray-200 dark:border-gray-700 rounded">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800"><tr className="text-left">
                        <th className="p-2">Course</th><th className="p-2">Current app / status</th><th className="p-2">Proposed app / status</th><th className="p-2">Date / source</th>
                      </tr></thead>
                      <tbody>{changedRows.map((row) => <tr key={row.id} className="border-t border-gray-200 dark:border-gray-700">
                        <td className="p-2 font-medium">{row.courseTitle}<div className="text-gray-500">{row.operation}</div></td>
                        <td className="p-2">{display(row.before.renewalApplicationNo)}<br />{display(row.before.renewedStatus)}</td>
                        <td className="p-2">{display(row.desired.renewalApplicationNo)}<br />{display(row.desired.renewedStatus)}</td>
                        <td className="p-2">{display(row.desired.actualRenewDate)}<br />{display(row.sourceTab)}{row.rawStatus ? ` · ${row.rawStatus}` : ''}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                ) : <p className="mt-4 text-sm text-green-700 dark:text-green-300">All selected renewal fields already match TPG.</p>}
              </div>
            )}
            {stage === 'done' && result && <p className="mt-5 text-sm font-semibold text-green-700 dark:text-green-300">Update committed and verified: {result.updated} updated, {result.alreadyCorrect} already correct. Audit saved on the server.</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              {!busy && stage !== 'done' && <button onClick={startCapture} className="px-4 py-2 rounded border border-gray-300 dark:border-gray-600 text-sm">{stage === 'review' ? 'Capture Again' : 'Retry Capture'}</button>}
              {stage === 'review' && <button onClick={apply} className="px-4 py-2 rounded bg-purple-700 text-white text-sm font-semibold">Confirm &amp; Apply {plan?.summary.wouldUpdate ?? 0} Changes</button>}
              {stage === 'done' && <button onClick={() => setOpen(false)} className="px-4 py-2 rounded bg-purple-700 text-white text-sm">Close</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TpgRenewalTrial;
