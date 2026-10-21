import React, { useState, useEffect, useCallback } from 'react';
interface Props {
    runUuid?: string;
    masterlistClassId?: string;
    courseCode?: string;
    saving?: boolean;
}
export default function MmsSyncControl({ runUuid, masterlistClassId, courseCode, saving }: Props) {
    const [eligible, setEligible] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmTrainer, setConfirmTrainer] = useState(false);
    const [status, setStatus] = useState<any>(null);
    const [message, setMessage] = useState('');
    const funded = (courseCode || '').trim().toUpperCase().startsWith('TGS');
    const refresh = useCallback(async () => {
        if (funded)
            return false;
        const query = new URLSearchParams();
        if (runUuid)
            query.set('run_uuid', runUuid);
        if (masterlistClassId)
            query.set('masterlist_class_id', masterlistClassId);
        const response = await fetch(`/api/admin/mms-sync-status?${query}`);
        const result = await response.json();
        setEligible(result.eligible === true);
        setStatus(result.data?.[0] || null);
        return result.enabled === true;
    }, [runUuid, masterlistClassId, funded]);
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const load = async () => {
            try {
                const enabled = await refresh();
                if (!stopped && enabled)
                    timer = setTimeout(load, 10000);
            }
            catch {
                if (!stopped)
                    timer = setTimeout(load, 30000);
            }
        };
        load();
        return () => { stopped = true; clearTimeout(timer); };
    }, [refresh]);
    if (funded || !eligible)
        return null;
    const sync = async () => {
        setBusy(true);
        setMessage('');
        try {
            const response = await fetch('/api/admin/mms-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run_uuid: runUuid, masterlist_class_id: masterlistClassId, confirm_trainer: confirmTrainer }) });
            const result = await response.json();
            if (!response.ok || !result.success)
                throw new Error(result.error || 'Synchronization failed.');
            setMessage('Sync request processed.');
            await refresh();
        }
        catch (e) {
            setMessage(e instanceof Error ? e.message : 'Synchronization failed.');
        }
        finally {
            setBusy(false);
        }
    };
    const target = status?.target_result;
    return <div className="my-2 rounded border border-gray-200 dark:border-gray-700 p-3 text-xs" aria-busy={busy} onClick={e => e.stopPropagation()}>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={sync} disabled={busy || saving || status?.state === 'running'} className="min-h-11 cursor-pointer rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Syncing…' : 'Sync MMS now'}</button>
      {masterlistClassId && <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={confirmTrainer} onChange={e => setConfirmTrainer(e.target.checked)}/>I confirm the saved Master List trainer is assigned</label>}
      <span aria-live="polite">{status?.state || 'Not linked'}{target ? ` · ${target.class_id} · ${target.readiness}` : ''}</span>
      {target?.class_url && /^https?:\/\//i.test(target.class_url) && <a href={target.class_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">Open MMS class</a>}
      {status?.last_success_at && <span>Last sync: {new Date(status.last_success_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT</span>}
    </div>
    {saving && <p className="mt-1">Waiting for the TMS class changes to finish saving.</p>}
    {(message || status?.last_error) && <p role="status" className="mt-2">{status?.last_error || message}</p>}
    {!!target?.warnings?.length && <p className="mt-2">{target.warnings.join(' ')}</p>}
  </div>;
}
