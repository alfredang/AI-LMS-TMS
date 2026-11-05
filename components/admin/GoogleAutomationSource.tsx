import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sourceDiff } from '../../lib/googleAutomations/diff';

export function SourceEditor({source,label,readOnly,onChange}:{source:string;label:string;readOnly:boolean;onChange:(source:string)=>void}) {
  const gutter=useRef<HTMLDivElement>(null);
  const numbers=useMemo(()=>Array.from({length:source.split('\n').length},(_,i)=>i+1).join('\n'),[source]);
  return <div className="flex h-[752px] min-h-[320px] min-w-0 resize-y overflow-hidden rounded-lg border border-slate-300 bg-slate-50 focus-within:ring-2 focus-within:ring-primary dark:border-slate-600 dark:bg-slate-950" data-testid="numbered-source-editor">
    <div ref={gutter} aria-hidden="true" className="w-16 shrink-0 overflow-hidden border-r border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"><pre className="select-none px-3 py-4 text-right font-mono text-base leading-6">{numbers}</pre></div>
    <textarea aria-label={label} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" rows={30} readOnly={readOnly} className="h-full min-w-0 flex-1 resize-none overflow-auto border-0 bg-transparent p-4 font-mono text-base leading-6 text-slate-900 outline-none dark:text-slate-100" value={source} onScroll={e=>{if(gutter.current)gutter.current.scrollTop=e.currentTarget.scrollTop;}} onChange={e=>onChange(e.target.value)}/>
  </div>;
}

function SourceBlock({source,label,changed,kind,focusLine,jump}:{source:string;label:string;changed:Set<number>;kind:'added'|'removed';focusLine:number;jump:number}) {
  const scroll=useRef<HTMLPreElement>(null);
  useEffect(()=>{if(scroll.current)scroll.current.scrollTop=Math.max(0,focusLine-6)*24;},[focusLine,jump,source]);
  return <div className="min-w-0"><h4 className="mb-2 text-sm font-semibold">{label}</h4><pre ref={scroll} tabIndex={0} aria-label={label} className="h-[752px] min-w-0 overflow-auto rounded-lg border border-slate-200 bg-slate-50 py-4 font-mono text-base leading-6 outline-none focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-950">{source.split('\n').map((line,index)=><div key={index} data-change={changed.has(index)?kind:undefined} className={`min-w-max pr-4 ${changed.has(index)?kind==='added'?'bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100':'bg-rose-100 text-rose-950 dark:bg-rose-950 dark:text-rose-100':''}`}><span aria-hidden="true" className="mr-3 inline-block w-12 select-none text-right text-slate-500 dark:text-slate-400">{index+1}</span><span aria-label={changed.has(index)?kind:undefined} className="mr-2 inline-block w-3 select-none">{changed.has(index)?kind==='added'?'+':'−':' '}</span>{line||' '}</div>)}</pre></div>;
}

export function SourceComparison({before,after}:{before:string;after:string}) {
  const diff=useMemo(()=>sourceDiff(before,after),[before,after]);
  const [jump,setJump]=useState(0);
  const firstAdded=diff.added.values().next().value,firstRemoved=diff.removed.values().next().value;
  return <><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600 dark:text-slate-300"><span className="font-semibold text-emerald-800 dark:text-emerald-300">+ {diff.added.size} added / changed lines</span><span className="mx-3">·</span><span className="font-semibold text-rose-800 dark:text-rose-300">− {diff.removed.size} removed / replaced lines</span></p><button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-600 dark:hover:bg-slate-700" onClick={()=>setJump(n=>n+1)}>Jump to first change</button></div><div className="grid min-w-0 gap-4 2xl:grid-cols-2"><SourceBlock label="Before" source={before} changed={diff.removed} kind="removed" focusLine={firstRemoved??firstAdded??0} jump={jump}/><SourceBlock label="Proposed source" source={after} changed={diff.added} kind="added" focusLine={firstAdded??firstRemoved??0} jump={jump}/></div></>;
}
