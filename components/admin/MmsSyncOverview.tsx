import React, { useEffect, useState } from 'react';
export default function MmsSyncOverview() {
    const [result, setResult] = useState<any>(null);
    useEffect(() => {
        let active = true;
        let timer: ReturnType<typeof setTimeout>;
        const load = async () => {
            try {
                const response = await fetch('/api/admin/mms-sync-status?list=true');
                const value = await response.json();
                if (active)
                    setResult(value);
                if (active && value.enabled)
                    timer = setTimeout(load, 30000);
            }
            catch {
                if (active)
                    timer = setTimeout(load, 30000);
            }
        };
        load();
        return () => { active = false; clearTimeout(timer); };
    }, []);
    if (!result?.enabled)
        return null;
    const failures = (result.data || []).filter((row: any) => row.last_error || row.access_calendar_error || row.access_failures || row.target_result?.readiness === 'incomplete');
    const exceptions = result.scan?.result?.exceptions || [];
    return <details className="rounded border border-gray-200 dark:border-gray-700 p-3 text-sm">
    <summary className="cursor-pointer font-medium">MMS non-funded handover · {failures.length} classes need attention · {exceptions.length} discovery exceptions</summary>
    <p className="mt-2 text-xs">Connection: {result.connection_configured ? 'configured' : 'needs setup'} · TMS assignments: {result.automatic ? 'automatic' : 'manual approval'} · Course codes: non-funded pilot only</p>
    {!result.scan && <p className="mt-2 text-xs">No completed Calendar discovery yet. Check the MMS tasks in Task Scheduler.</p>}
    {result.scan && <p className="mt-2 text-xs">Last scan: {new Date(result.scan.created_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT</p>}
    {!result.notifications_enabled && <p className="mt-2 text-xs">MMS access sending is disabled. Review class previews and enable it before notifying pilot participants.</p>}
    <ul className="mt-2 space-y-2 text-xs" aria-live="polite">
      {failures.map((row: any) => <li key={row.source_run_key}><strong>{row.course_code} {row.target_result?.class_id || ''}</strong>: {row.last_error || row.access_calendar_error || (row.access_failures ? `${row.access_failures} access messages need attention` : row.target_result?.warnings?.join(' '))}</li>)}
      {exceptions.map((row: any, index: number) => <li key={index}>{row.event_id || row.source_run_key}: {row.reason}</li>)}
      {!failures.length && !exceptions.length && <li>No recorded handover exceptions.</li>}
    </ul>
  </details>;
}
