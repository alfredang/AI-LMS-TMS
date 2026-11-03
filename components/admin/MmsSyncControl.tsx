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
    const [status, setStatus] = useState<any>(null);
    const [message, setMessage] = useState('');
    const [preview, setPreview] = useState<any>(null);
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
            const response = await fetch('/api/admin/mms-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run_uuid: runUuid, masterlist_class_id: masterlistClassId }) });
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
    const accessAction = async (action?: 'send_pending' | 'resend', person?: { person_id: string; role: string }) => {
        setBusy(true);
        setMessage('');
        try {
            const identity = { run_uuid: runUuid || '', masterlist_class_id: masterlistClassId || '' };
            if (action) {
                const response = await fetch('/api/admin/mms-access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...identity, action, ...person }) });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'Access send failed.');
                setMessage(`${result.sent || 0} access message(s) accepted by the mail service. Check participant status and actual receipt.`);
            }
            const response = await fetch(`/api/admin/mms-access?${new URLSearchParams(identity)}`);
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Access preview failed.');
            setPreview(result);
            await refresh();
        } catch (e) { setMessage(e instanceof Error ? e.message : 'Access action failed.'); }
        finally { setBusy(false); }
    };
    const target = status?.target_result;
    return <div className="my-2 rounded border border-gray-200 dark:border-gray-700 p-3 text-xs" aria-busy={busy} onClick={e => e.stopPropagation()}>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={sync} disabled={busy || saving || status?.state === 'running'} className="min-h-11 cursor-pointer rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Syncing…' : 'Sync MMS now'}</button>
      <button type="button" onClick={() => accessAction()} disabled={busy || saving} className="min-h-11 rounded border px-3 py-1.5 disabled:opacity-50">Preview MMS access</button>
      {preview && <button type="button" onClick={() => accessAction('send_pending')} disabled={busy || saving || !preview.enabled || preview.context?.state !== 'ready'} className="min-h-11 rounded border px-3 py-1.5 disabled:opacity-50">Send pending MMS access</button>}
      <span aria-live="polite">{status?.state || 'Not linked'}{target ? ` · ${target.class_id} · ${target.readiness}` : ''}</span>
      {target?.class_url && /^https?:\/\//i.test(target.class_url) && <a href={target.class_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">Open MMS class</a>}
      {status?.last_success_at && <span>Last sync: {new Date(status.last_success_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT</span>}
    </div>
    <p className="mt-2">Existing C-code Master List classes sync to MMS, including pending classes. Save learner, trainer and schedule changes here; no separate MMS approval is needed. Direct MMS registrations reconcile into this roster.</p>
    {preview && <details open className="mt-3">
      <summary className="cursor-pointer font-medium">{preview.course_code} · Full run and participant access</summary>
      <ul className="mt-2 space-y-1">{preview.sessions?.map((s: any) => <li key={s.key}>{s.date} · {s.start_time}–{s.end_time} SGT · {s.venue}</li>)}</ul>
      <p className="mt-2">{preview.participants?.filter((p: any) => p.role === 'learner').length || 0} active learners. {preview.trainer_confirmation_pending ? 'Trainer assignment is pending in LMS.' : 'Assigned trainer included.'} Update participant details in Master List as they become available.</p>
      <ul className="mt-1 space-y-1">{preview.participants?.map((p: any) => <li key={`${p.person_id}:${p.role}`}>{p.name} · {p.email} · {p.role}</li>)}</ul>
      <p className="mt-1">{preview.enabled ? 'Access sending enabled when participant access is ready.' : 'Access sending is disabled; preview only.'} {preview.context?.reason || ''}</p>
      <ul className="mt-2 space-y-2">{preview.messages?.map((m: any) => <li key={`${m.person_id}:${m.role}`}><strong>{m.email} · {m.role}</strong><details><summary className="cursor-pointer">{m.subject}</summary><pre className="whitespace-pre-wrap p-2">{m.text}</pre></details></li>)}</ul>
      <ul className="mt-2 space-y-1">{preview.status?.map((n: any) => <li key={n.id}>{n.email} · {n.role} · {n.state}{n.last_error ? ` — ${n.last_error}` : ''}
        {preview.enabled && preview.context?.state === 'ready' && ['sent', 'failed', 'review', 'cancelled'].includes(n.state) && preview.messages?.some((m: any) => m.person_id === n.person_id && m.role === n.role) && <button type="button" onClick={() => accessAction('resend', n)} disabled={busy || saving} className="ml-2 min-h-11 rounded border px-2 disabled:opacity-50">Resend MMS access</button>}</li>)}</ul>
    </details>}
    {saving && <p className="mt-1">Waiting for the TMS class changes to finish saving.</p>}
    {(message || status?.last_error || status?.access_calendar_error) && <p role="status" className="mt-2">{status?.last_error || status?.access_calendar_error || message}</p>}
    {!!target?.warnings?.length && <p className="mt-2">{target.warnings.join(' ')}</p>}
  </div>;
}
