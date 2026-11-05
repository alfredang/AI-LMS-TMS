import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Code2, ExternalLink, FileCode2, History, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { Project, ScriptFile } from '../../lib/googleAutomations/model';
import { SourceEditor, SourceComparison } from './GoogleAutomationSource';
import GoogleAutomationTriggers from './GoogleAutomationTriggers';

type Access = { canView: boolean; canEdit: boolean; canPublish: boolean };
type Change = { id: string; script_id: string; actor_id: string; reason: string; status: string; changed_files: string[]; created_at: string; applied_at: string | null; published_by: string | null };
type Draft = Change & { before: ScriptFile[]; after: ScriptFile[] };
const endpoint = '/api/admin/google-automations';
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-600 dark:hover:bg-slate-700';
const primary = `${button} border-transparent bg-primary text-white hover:bg-primary/90 dark:hover:bg-primary/90`;
const time = (date: string | null | undefined) => date ? new Date(date).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }) + ' SGT' : 'Not checked';
async function request(query = '', body?: unknown, signal?: AbortSignal) {
  const response = await fetch(endpoint + query, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : { signal });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load Google Automations.');
  return data;
}

export default function GoogleAutomationsView() {
  const [projects,setProjects] = useState<Project[]>([]);
  const [access,setAccess] = useState<Access>({canView:false,canEdit:false,canPublish:false});
  const [enabled,setEnabled] = useState<boolean | null>(null);
  const [account,setAccount] = useState('');
  const [connection,setConnection] = useState('Connection not checked');
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState('');
  const [files,setFiles] = useState<ScriptFile[]>([]);
  const [baseline,setBaseline] = useState<ScriptFile[]>([]);
  const [hash,setHash] = useState('');
  const [fileName,setFileName] = useState('');
  const [reason,setReason] = useState('');
  const [draft,setDraft] = useState<Draft | null>(null);
  const [history,setHistory] = useState<Change[]>([]);
  const [tab,setTab] = useState('overview');
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [newId,setNewId] = useState('');
  const [acknowledged,setAcknowledged] = useState(false);
  const [metadata,setMetadata] = useState({purpose:'',category:'',schedule:'',dependencies:''});
  const sourceRequest = useRef<AbortController | null>(null);
  const selectedRef = useRef('');
  const project = projects.find(p => p.scriptId === selected);
  const dirty = JSON.stringify(files) !== JSON.stringify(baseline);
  const activeFile = files.find(f => f.name === fileName);
  const [initialLoading,setInitialLoading] = useState(true);

  const loadRegistry = useCallback(async () => {
    const data = await request();
    setProjects(data.projects); setAccess(data.capabilities); setEnabled(data.enabled); setAccount(data.connection.accountEmail || '');
    return data;
  },[]);
  useEffect(() => { let active=true; loadRegistry().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setInitialLoading(false);}); return ()=>{active=false;sourceRequest.current?.abort();}; },[loadRegistry]);
  useEffect(() => {
    const guard=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',guard); return()=>window.removeEventListener('beforeunload',guard);
  },[dirty]);

  async function run(label:string, task:()=>Promise<void>) {
    setBusy(label);setError('');setNotice('');
    try { await task(); } catch(e:any) { if(e.name!=='AbortError')setError(e.message); } finally { setBusy(''); }
  }
  async function loadSource(id:string) {
    sourceRequest.current?.abort();
    const controller=new AbortController();sourceRequest.current=controller;
    const data=await request(`?view=source&scriptId=${encodeURIComponent(id)}`,undefined,controller.signal);
    if(selectedRef.current!==id)return;
    setFiles(data.files);setBaseline(data.files);setHash(data.hash);setFileName(data.files.find((f:ScriptFile)=>f.type==='SERVER_JS')?.name || data.files[0]?.name || '');
    setProjects(list=>list.map(p=>p.scriptId===id?{...p,refreshedAt:data.refreshedAt,accessStatus:'Readable',sourceHash:data.hash}:p));
  }
  function choose(id:string) {
    if(dirty && !window.confirm('Discard the unsaved source edits and open another project?'))return;
    sourceRequest.current?.abort();selectedRef.current=id;setSelected(id);setFiles([]);setBaseline([]);setHash('');setFileName('');setDraft(null);setHistory([]);setReason('');setAcknowledged(false);setTab('overview');setError('');setNotice('');
    const p=projects.find(item=>item.scriptId===id);
    setMetadata({purpose:p?.purpose||'',category:p?.category||'',schedule:p?.schedule||'Not verified',dependencies:p?.dependencies||''});
  }
  async function showHistory() {
    setTab('history');const id=selected;
    await run('Loading history',async()=>{const data=await request(`?view=history&scriptId=${encodeURIComponent(id)}`);if(selectedRef.current===id)setHistory(data.history);});
  }
  const visible=projects.filter(p=>`${p.name} ${p.category} ${p.purpose} ${p.scriptId}`.toLowerCase().includes(query.toLowerCase()));

  return <section className="min-w-0 space-y-6 break-words text-slate-800 dark:text-slate-100">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400"><Code2 size={18}/>External tools / Google Apps Script</div><h1 className="text-3xl font-semibold tracking-tight">Google Automations</h1><p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">Inspect registered Google scripts, prepare source changes and keep a history of updates.</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={!!busy || !enabled} onClick={()=>run('Checking connection',async()=>{const d=await request('?view=connection');setConnection(`Verified ${time(d.checkedAt)}`);setNotice(`Connected as ${d.accountEmail}. Source read/write permission verified.`);})}><ShieldCheck size={16}/>Check connection</button>{access.canEdit && <button className={button} disabled={!!busy || !enabled} onClick={()=>run('Discovering projects',async()=>{const d=await request('',{action:'discover'});setProjects(d.projects);setNotice(`${d.discovered} standalone projects found. Container-bound scripts can be added by project ID.`);})}><RefreshCw size={16}/>Discover projects</button>}</div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800"><div className="min-w-0 break-all"><span className="font-semibold">{account || 'Google connection'}</span><span className="ml-3 text-slate-500 dark:text-slate-400">{connection}</span></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">Runs in Google · schedules managed externally</span></div>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{notice}</div>}
    {initialLoading && <p role="status">Loading automation registry…</p>}
    {enabled===false && <div className="rounded-xl border border-slate-200 p-6 dark:border-slate-700"><h2 className="font-semibold">Connect Google Automations on this server</h2><p className="mt-2 text-sm">The dedicated Apps Script connection has not been configured. Ask your administrator to follow docs/google-automations.md and provision the private connection file. Existing Calendar and Gmail connections are separate.</p></div>}
    {enabled && <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 p-4 dark:border-slate-700"><label className="mb-2 flex items-center gap-2 text-sm font-medium" htmlFor="automation-search"><Search size={16}/>Search {projects.length} projects</label><input id="automation-search" className={field} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, purpose or project ID"/></div>
        <div className="max-h-[65vh] overflow-y-auto">{visible.map(p=><button key={p.scriptId} disabled={!!busy} onClick={()=>choose(p.scriptId)} className={`block w-full border-l-4 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${selected===p.scriptId?'border-primary bg-primary/5':'border-transparent hover:bg-slate-50 dark:hover:bg-slate-700'}`}><span className="block text-sm font-semibold">{p.name}</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{p.category} · {p.accessStatus}</span></button>)}{!visible.length && <p className="p-4 text-sm text-slate-500">No matching projects. Discover projects or register a project ID.</p>}</div>
        {access.canEdit && <form className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-700" onSubmit={e=>{e.preventDefault();run('Registering project',async()=>{const d=await request('',{action:'register',scriptId:newId.trim()});setProjects(d.projects);setNewId('');setNotice('Project registered. Its source and execution settings were preserved.');});}}><label className="text-xs font-semibold" htmlFor="automation-register">Add a project by script ID</label><input id="automation-register" className={field} value={newId} onChange={e=>setNewId(e.target.value)} placeholder="Apps Script project ID"/><button className={button} disabled={!!busy || !newId.trim()}>Register project</button></form>}
      </aside>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {!project ? <div className="p-10"><FileCode2 size={32} className="mb-4 text-slate-400"/><h2 className="text-lg font-semibold">Choose a Google automation</h2><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Review its purpose, inspect live source or prepare a draft. Registration does not run a script.</p></div> : <>
          <div className="border-b border-slate-200 p-5 dark:border-slate-700"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-semibold">{project.name}</h2><p className="mt-2 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{project.scriptId}</p></div><a className={button} href={`https://script.google.com/home/projects/${project.scriptId}/edit`} target="_blank" rel="noopener noreferrer">Open in Google<ExternalLink size={14}/></a></div><p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Last source refresh: {time(project.refreshedAt)} · Trigger schedule: {project.schedule || 'Not verified'}</p></div>
          <nav aria-label="Project sections" className="flex flex-wrap gap-1 border-b border-slate-200 px-4 dark:border-slate-700">{[['overview','Overview'],['triggers','Triggers'],['source','Source'],['review','Review draft'],['history','Change history']].map(([id,label])=><button key={id} disabled={!!busy} aria-current={tab===id?'page':undefined} onClick={()=>{if(id==='history'){void showHistory();return;}setTab(id);if(id==='source' && !hash)void run('Loading Google source',()=>loadSource(selected));}} className={`border-b-2 px-3 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tab===id?'border-primary text-primary':'border-transparent text-slate-500 dark:text-slate-400'}`}>{label}</button>)}</nav>
          <div className="space-y-4 p-5">
          {busy && <p role="status" className="text-sm text-slate-500">{busy}…</p>}
          {tab==='triggers' && <GoogleAutomationTriggers key={selected} scriptId={selected}/>}
          {tab==='overview' && <form className="space-y-4" onSubmit={e=>{e.preventDefault();run('Saving registry details',async()=>{const d=await request('',{action:'metadata',scriptId:selected,...metadata});setProjects(d.projects);setNotice('Registry details saved in TMS. Google source and schedules were preserved.');});}}><p className="text-sm text-slate-500 dark:text-slate-400">These details document the automation. Editing them does not configure Google triggers.</p>{(['purpose','category','schedule','dependencies'] as const).map(key=><div key={key}><label htmlFor={`automation-${key}`} className="mb-1 block text-sm font-semibold capitalize">{key==='schedule'?'Documented trigger schedule':key}</label><textarea id={`automation-${key}`} className={field} rows={key==='purpose'||key==='dependencies'?3:1} value={metadata[key]} readOnly={!access.canEdit} onChange={e=>setMetadata({...metadata,[key]:e.target.value})}/></div>)}{access.canEdit && <button className={button} disabled={!!busy}>Save registry details</button>}</form>}
          {tab==='source' && <>
            <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex min-w-0 items-center gap-2 text-sm font-medium">File<select aria-label="Source file" className={field} value={fileName} onChange={e=>setFileName(e.target.value)}>{files.map(f=><option key={f.name} value={f.name}>{f.name}{f.type==='SERVER_JS'?'.gs':f.type==='HTML'?'.html':'.json'}</option>)}</select></label><button className={button} disabled={!!busy} onClick={()=>{if(dirty&&!window.confirm('Discard unsaved edits and reload Google source?'))return;setDraft(null);setAcknowledged(false);void run('Reloading source',()=>loadSource(selected));}}><RefreshCw size={14}/>Reload Google source</button></div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Known credential values are masked. Keep placeholders unchanged. The manifest is read-only in this phase.</p>
            {activeFile && <SourceEditor label={`Source code for ${activeFile.name}`} source={activeFile.source} readOnly={!access.canEdit || activeFile.type==='JSON' || !!busy} onChange={source=>{setFiles(files.map(f=>f.name===fileName?{...f,source}:f));setDraft(null);setAcknowledged(false);}}/>}
            {access.canEdit && <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700"><label className="block text-sm font-semibold" htmlFor="automation-reason">Change reason</label><input id="automation-reason" className={field} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explain why this source needs changing"/><button className={primary} disabled={!!busy || !dirty || reason.trim().length<5} onClick={()=>run('Saving draft',async()=>{const d=await request('',{action:'draft',scriptId:selected,baseHash:hash,files,reason});setDraft(d.draft);setFiles(baseline);setTab('review');setAcknowledged(false);setNotice('Draft saved in TMS. Review it before applying to Google.');})}>Save draft and review</button><span className="ml-3 text-xs text-slate-500">{dirty?'Unsaved edits':'No unsaved edits'}</span></div>}
          </>}
          {tab==='review' && (!draft ? <p className="text-sm text-slate-500">Save source edits as a draft, or open a draft from change history.</p> : <>
            <div className="flex flex-wrap justify-between gap-2 text-sm"><div><p className="font-semibold">{draft.reason}</p><p className="mt-1 text-slate-500">By {draft.actor_id} · {time(draft.created_at)}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-700">{draft.status.replaceAll('_',' ')}</span></div>
            {draft.changed_files.map(name=><div key={name} className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className="font-mono text-sm font-semibold">{name}</h3><SourceComparison before={draft.before.find(f=>f.name===name)?.source || ''} after={draft.after.find(f=>f.name===name)?.source || ''}/></div>)}
            {draft.status==='draft' && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"><p>Applying source updates the live script used by existing Google triggers. Versioned web-app deployments are not redeployed here.</p>{access.canPublish ? <><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/>I reviewed these changes and understand that existing triggers will use the applied source.</label><button className={primary} disabled={!!busy || !acknowledged} onClick={()=>run('Applying source to Google',async()=>{await request('',{action:'publish',scriptId:selected,draftId:draft.id,acknowledged});const data=await request(`?view=draft&scriptId=${encodeURIComponent(selected)}&draftId=${draft.id}`);setDraft(data.draft);setAcknowledged(false);await loadSource(selected);setNotice('Source applied to Google and read back successfully. The previous source is retained in change history.');})}>Apply to Google</button></> : <p>Publishing requires an Admin or Developer account and publishing enabled on this server.</p>}</div>}
          </>)}
          {tab==='history' && <>{!history.length && <div className="py-6 text-sm text-slate-500"><History className="mb-3"/>No TMS source changes yet. Changes made directly in Google are not part of this history.</div>}{history.map(h=><div key={h.id} className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{h.reason}</p><span className="text-xs font-medium">{h.status.replaceAll('_',' ')}</span></div><p className="text-xs text-slate-500">Created by {h.actor_id} · {time(h.created_at)}{h.published_by?` · Applied/attempted by ${h.published_by}`:''}</p><p className="font-mono text-xs">{h.changed_files.join(', ')}</p><div className="flex flex-wrap gap-2"><button className={button} disabled={!!busy} onClick={()=>run('Opening draft',async()=>{const d=await request(`?view=draft&scriptId=${encodeURIComponent(selected)}&draftId=${h.id}`);setDraft(d.draft);setAcknowledged(false);setTab('review');})}>Inspect changes</button>{access.canEdit && h.published_by && <button className={button} disabled={!!busy} onClick={()=>run('Preparing restoration draft',async()=>{const d=await request('',{action:'restore',scriptId:selected,draftId:h.id,reason:`Restore source from before change ${h.id}`});setDraft(d.draft);setAcknowledged(false);setTab('review');setNotice('Restoration draft prepared. Review and apply it to restore the backup.');})}>Prepare restoration draft</button>}</div></div>)}</>}
          </div>
        </>}
      </div>
    </div>}
  </section>;
}
