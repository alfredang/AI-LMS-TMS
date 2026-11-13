import React, { useEffect, useState } from 'react';

export default function GoogleAutomationSetup({canEdit,onConnected}:{canEdit:boolean;onConnected:()=>Promise<unknown>}) {
  const [status,setStatus]=useState<{storageAvailable:boolean;canConfigure:boolean}|null>(null);
  const [connection,setConnection]=useState<any>(null),[fileName,setFileName]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;fetch('/api/admin/google-automations?view=setup').then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to check connection setup.');if(active)setStatus(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  async function select(file?:File){setError('');setConnection(null);setConfirmed(false);setFileName('');if(!file)return;if(file.size>1024*1024){setError('The connection JSON must be smaller than 1 MB.');return;}try{
    const raw=JSON.parse(await file.text());
    if(!raw.accountEmail||!raw.credentials||!raw.encryptionKey)throw Error();
    // Whitelist the payload: a mistakenly selected review file must not send its
    // local login/database information to the production server.
    setConnection({enabled:true,allowPublish:raw.allowPublish===true,accountEmail:raw.accountEmail,encryptionKey:raw.encryptionKey,credentials:raw.credentials,projects:raw.projects||[],triggerManagement:{inventory:raw.triggerManagement?.inventory||[]}});setFileName(file.name);
  }catch{setError('Choose the dedicated Google Automations connection JSON, not the login or OAuth client download.');}}
  async function install(){setBusy(true);setError('');try{const r=await fetch('/api/admin/google-automations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'configure',connection,confirmAccount:confirmed?String(connection.accountEmail).toLowerCase():''})});const d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'Unable to install this connection.');setConnection(null);await onConnected();}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  return <div className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-700"><h2 className="text-lg font-semibold">Connect Google Automations</h2><p className="text-sm text-slate-600 dark:text-slate-300">Install the dedicated Google connection through TMS. Google verifies its account and source permissions before TMS stores it encrypted. The existing Calendar and Gmail connection is separate.</p>
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    {!status&&!error&&<p role="status" className="text-sm">Checking secure connection storage…</p>}
    {status&&!status.storageAvailable&&<p className="text-sm text-amber-800 dark:text-amber-200">The server's existing encryption secret is unavailable. A server administrator must configure it before TMS can securely import a connection. A private runtime file or runtime secret remains supported.</p>}
    {canEdit&&status?.canConfigure&&status.storageAvailable&&<>
      <label className="block space-y-2 text-sm font-semibold"><span>Dedicated connection JSON</span><input aria-label="Dedicated connection JSON" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{void select(e.target.files?.[0]);}} className="block w-full rounded-lg border border-slate-300 p-3 font-normal dark:border-slate-600"/></label>
      {connection&&<div className="space-y-3 rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-900"><p className="break-all font-semibold">{connection.accountEmail}</p><p>{connection.projects.length} registered projects · {connection.triggerManagement.inventory.length} documented triggers</p><p>Selected: {fileName}. Source publishing: {connection.allowPublish?'enabled after draft review':'disabled'}. Live trigger application stays disabled.</p><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I authorize this Google account as the TMS automation connection. Installing it does not execute or change a Google script.</label><button type="button" disabled={busy||!confirmed} onClick={install} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy?'Verifying and installing…':'Install Google connection'}</button></div>}
      <p className="text-xs text-slate-500 dark:text-slate-400">Credentials are never displayed or returned. Setup cannot replace an installed connection. Back up the server encryption secret and the original connection encryption key securely.</p>
    </>}
    {!canEdit&&<p className="text-sm">Ask an Admin or Developer to install the connection.</p>}
  </div>;
}
