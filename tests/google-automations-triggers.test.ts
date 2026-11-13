import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { sourceDiff } from '../lib/googleAutomations/diff';
import { validTriggerSettings } from '../lib/googleAutomations/triggerModel';
import { triggerReviewOnly, TriggerService } from '../lib/googleAutomations/triggers';
import { triggerGateway } from '../lib/googleAutomations/triggerGateway';
import { PgAutomationStore } from '../lib/googleAutomations/store';
import type { AutomationConfig } from '../lib/googleAutomations/config';
import { readConfig } from '../lib/googleAutomations/config';

const project='synthetic_trigger_project_12345';
const owner='owner@example.test';
const secret=randomBytes(32).toString('base64');
const base=():AutomationConfig=>({enabled:true,allowPublish:false,accountEmail:owner,encryptionKey:randomBytes(32).toString('base64'),credentials:{client_id:'synthetic',client_secret:'synthetic',refresh_token:'synthetic'},projects:[],triggerManagement:{inventory:[{scriptId:project,handler:'testHandler',eventType:'CLOCK',owner,observedAt:'2026-11-05T00:00:00Z',schedule:{kind:'minutes',every:30}}]}});

test('runtime-only configuration can replace a private mount and rejects malformed secrets',async()=>{
  const previous=process.env.GOOGLE_AUTOMATIONS_CONFIG_B64;
  try {
    process.env.GOOGLE_AUTOMATIONS_CONFIG_B64=Buffer.from(JSON.stringify(base())).toString('base64');
    assert.equal((await readConfig())!.accountEmail,owner);
    process.env.GOOGLE_AUTOMATIONS_CONFIG_B64=Buffer.from('invalid-json').toString('base64');
    await assert.rejects(readConfig(),/configuration cannot be read/);
  } finally {if(previous===undefined)delete process.env.GOOGLE_AUTOMATIONS_CONFIG_B64;else process.env.GOOGLE_AUTOMATIONS_CONFIG_B64=previous;}
});

test('line comparison highlights inserted/replaced/deleted lines without shifting unchanged lines',()=>{
  let d=sourceDiff('a\nb\nc','a\ninserted\nb\nc');assert.deepEqual([...d.added],[1]);assert.equal(d.removed.size,0);
  d=sourceDiff('a\nb\nc','a\nchanged\nc');assert.deepEqual([...d.added],[1]);assert.deepEqual([...d.removed],[1]);
  d=sourceDiff('a\nb\nc','a\nc');assert.equal(d.added.size,0);assert.deepEqual([...d.removed],[1]);
  d=sourceDiff('a\nb','a\nb');assert.equal(d.added.size+d.removed.size,0);
});
test('schedule validation accepts Google intervals and rejects unsupported values',()=>{
  assert.ok(validTriggerSettings({enabled:true,schedule:{kind:'minutes',every:5}}));
  assert.equal(validTriggerSettings({enabled:true,schedule:{kind:'minutes',every:2}}),false);
  assert.equal(validTriggerSettings({enabled:true,schedule:{kind:'daily',hour:24,timezone:'Asia/Singapore'}}),false);
  assert.equal(validTriggerSettings({enabled:true,schedule:{kind:'daily',hour:8,timezone:'invalid_zone'}}),false);
});
test('local trigger review cannot run against another database or with source publishing enabled',()=>{
  const c=base();c.triggerManagement!.reviewOnly=true;
  assert.ok(triggerReviewOnly(c,'postgresql://127.0.0.1:15447/google_automation_review'));
  assert.throws(()=>triggerReviewOnly(c,'postgresql://remote.invalid:5432/production'),/isolated/);
  c.allowPublish=true;assert.throws(()=>triggerReviewOnly(c,'postgresql://127.0.0.1:15447/google_automation_review'),/isolated/);
});

function helperFixture() {
  const properties:Record<string,string>={TMS_TRIGGER_BRIDGE_SECRET:secret,TMS_TRIGGER_BRIDGE_OWNER:owner,TMS_TRIGGER_BRIDGE_HANDLERS:JSON.stringify(['testHandler'])};
  let counter=0,mutations=0;
  const item=(id:string)=>({getUniqueId:()=>id,getHandlerFunction:()=> 'testHandler',getEventType:()=> 'CLOCK',getTriggerSourceId:()=>null});
  let triggers=[item('original')];
  const store={getProperty:(k:string)=>properties[k]??null,setProperty:(k:string,v:string)=>{properties[k]=v;},deleteProperty:(k:string)=>{delete properties[k];},getProperties:()=>({...properties})};
  const builder:any={timeBased:()=>builder,everyMinutes:()=>builder,everyHours:()=>builder,everyDays:()=>builder,atHour:()=>builder,inTimezone:()=>builder,create:()=>{mutations++;const t=item('created-'+(++counter));triggers.push(t);return t;}};
  const context=vm.createContext({PropertiesService:{getScriptProperties:()=>store},Session:{getEffectiveUser:()=>({getEmail:()=>owner})},ScriptApp:{getScriptId:()=>project,getProjectTriggers:()=>triggers,newTrigger:()=>builder,deleteTrigger:(t:any)=>{mutations++;triggers=triggers.filter(x=>x!==t);}},LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})},Utilities:{base64Decode:(v:string)=>[...Buffer.from(v,'base64')],newBlob:(v:string)=>({getBytes:()=>[...Buffer.from(v)]}),computeHmacSha256Signature:(v:number[],k:number[])=>[...createHmac('sha256',Buffer.from(k)).update(Buffer.from(v)).digest()],formatDate:()=>''},ContentService:{MimeType:{JSON:'json'},createTextOutput:(value:string)=>({setMimeType:()=>value})}});
  vm.runInContext(fs.readFileSync('integrations/google-apps-script/TmsTriggerBridge.js','utf8'),context);
  const invoke=(payload:any,signature?:string)=>{
    const raw=JSON.stringify(payload);const sig=signature??createHmac('sha256',Buffer.from(secret,'base64')).update(raw).digest('hex');
    const response=(context as any).tmsTriggerBridgePost_({postData:{contents:JSON.stringify({payload:raw,signature:sig})}});
    const env=JSON.parse(response);return env.payload?JSON.parse(env.payload):env;
  };
  const req=(extra={})=>({version:1,owner,scriptId:project,requestId:randomUUID(),timestamp:Date.now(),action:'list',...extra});
  return {invoke,req,get mutations(){return mutations;},get triggers(){return triggers;}};
}
test('Google helper rejects forged, replayed, stale, wrong-project and disallowed-handler requests',()=>{
  const h=helperFixture();let req=h.req();assert.equal(h.invoke(req,'0'.repeat(64)).ok,false);assert.equal(h.mutations,0);
  assert.equal(h.invoke(req).ok,true);assert.equal(h.invoke(req).ok,false);
  assert.equal(h.invoke(h.req({timestamp:Date.now()-100000})).ok,false);
  assert.equal(h.invoke(h.req({scriptId:'other'})).ok,false);
  assert.equal(h.invoke(h.req({action:'change',changeId:randomUUID(),handler:'businessFunction',settings:{enabled:false,schedule:{kind:'minutes',every:30}}})).ok,false);
  assert.equal(h.mutations,0);
});
test('helper replaces only the expected trigger, reports stored schedule and prevents repeating a change',()=>{
  const h=helperFixture(),changeId=randomUUID();
  const change={action:'change',changeId,handler:'testHandler',eventType:'CLOCK',liveId:'original',settings:{enabled:true,schedule:{kind:'minutes',every:5}}};
  let result=h.invoke(h.req(change));assert.equal(result.ok,true);assert.equal(h.mutations,2);assert.equal(h.triggers.length,1);assert.equal(result.triggers[0].settings.schedule.every,5);
  assert.equal(h.invoke(h.req(change)).ok,false);assert.equal(h.mutations,2);
  result=h.invoke(h.req({...change,changeId:randomUUID(),liveId:'wrong'}));assert.equal(result.ok,false);assert.equal(h.mutations,2);
});
test('server gateway verifies signed response identity and refuses non-Google endpoints',async()=>{
  const bridge={url:'https://script.google.com/macros/s/synthetic/exec',secret,handlers:['testHandler']};
  const transport:any=async (_url:unknown,init:any)=>{
    const request=JSON.parse(JSON.parse(init.body).payload);
    const payload=JSON.stringify({ok:true,owner,scriptId:project,requestId:request.requestId,triggers:[]});
    return new Response(JSON.stringify({payload,signature:createHmac('sha256',Buffer.from(secret,'base64')).update(payload).digest('hex')}));
  };
  assert.deepEqual((await triggerGateway(bridge,project,owner,transport).call('list')).triggers,[]);
  const forged:any=async()=>new Response(JSON.stringify({payload:'{}',signature:'0'.repeat(64)}));
  await assert.rejects(triggerGateway(bridge,project,owner,forged).call('list'),/could not verify/);
  assert.throws(()=>triggerGateway({...bridge,url:'http://127.0.0.1/private'},project,owner),/Google web-app/);
});

test('real isolated PostgreSQL trigger drafts persist, preview applies without Google calls, and stale/unauthorized applies fail',{skip:!process.env.GOOGLE_AUTOMATIONS_TRIGGER_TEST_DATABASE_URL},async()=>{
  const db=new URL(process.env.GOOGLE_AUTOMATIONS_TRIGGER_TEST_DATABASE_URL!);
  assert.equal(db.hostname,'127.0.0.1');assert.equal(db.port,'15447');assert.equal(db.pathname,'/google_automation_test');
  const {Pool}=await import('pg');const pool=new Pool({connectionString:db.toString(),max:3});
  const connection=randomUUID();const c=base();c.triggerManagement!.reviewOnly=true;
  const previous=process.env.DATABASE_URL;process.env.DATABASE_URL='postgresql://127.0.0.1:15447/google_automation_review';
  let calls=0;const factory:any=()=>{calls++;throw new Error('Google must not be called in review');};
  try {
    const store=new PgAutomationStore(pool,connection);await store.init();await store.register({scriptId:project,name:'Synthetic trigger test'});
    const s=new TriggerService(pool,connection,c,factory);await s.init();await s.init();
    let view=await s.view(project,true);const key=view.rows[0].key;
    view=await s.draft(project,key,{enabled:true,schedule:{kind:'minutes',every:5}},'Review a synthetic schedule','author');
    const id=view.history[0].id;await assert.rejects(s.apply(project,id,'author',false),/acknowledge/);
    view=await s.apply(project,id,'author',true);assert.equal(view.mode,'local_review');assert.deepEqual(view.rows[0].settings.schedule,{kind:'minutes',every:5});assert.equal(view.rows[0].baseline.schedule.kind,'minutes');assert.equal((view.rows[0].baseline.schedule as any).every,30);
    await s.apply(project,id,'author',true);assert.equal((await s.view(project,true)).history.length,1);
    const reopened=new TriggerService(pool,connection,c,factory);assert.equal(((await reopened.view(project,true)).rows[0].settings.schedule as any).every,5);
    view=await s.draft(project,key,{enabled:false,schedule:{kind:'minutes',every:5}},'Disable in review only','author');const disabled=view.history[0].id;
    view=await s.draft(project,key,{enabled:true,schedule:{kind:'minutes',every:10}},'Competing review draft','author');await s.apply(project,view.history[0].id,'author',true);
    await assert.rejects(s.apply(project,disabled,'author',true),/changed after/);
    c.triggerManagement!.reviewOnly=false;
    view=await s.draft(project,key,{enabled:false,schedule:{kind:'minutes',every:30}},'No live helper connected','author');await assert.rejects(s.apply(project,view.history[0].id,'author',true),/connected/);
    assert.equal(calls,0);
    // Exercise the live code path against a synthetic remote, never Google.
    c.triggerManagement!.allowApply=true;
    c.triggerManagement!.bridges={[project]:{url:'https://script.google.com/macros/s/synthetic/exec',secret,handlers:['testHandler']}};
    let remote:any[]=[{id:'original',handler:'testHandler',eventType:'CLOCK',sourceId:null,settings:{enabled:true,schedule:{kind:'minutes',every:30}}}];
    let writes=0,failAfterWrite=false;
    const liveFactory:any=()=>({async call(action:string,details:any){
      if(action==='change'){
        writes++;
        remote=details.settings.enabled?[{id:'new-'+writes,handler:'testHandler',eventType:'CLOCK',sourceId:null,settings:details.settings}]:[];
        if(failAfterWrite)throw Error('Synthetic timeout after mutation');
      }
      return {triggers:structuredClone(remote)};
    }});
    const live=new TriggerService(pool,connection,c,liveFactory);
    view=await live.draft(project,key,{enabled:true,schedule:{kind:'minutes',every:15}},'Synthetic remote replacement','author');
    const liveId=view.history[0].id;
    view=await live.apply(project,liveId,'different-publisher',true);assert.equal(writes,1);assert.equal(view.history[0].applied_by,'different-publisher');
    await live.apply(project,liveId,'different-publisher',true);assert.equal(writes,1);
    view=await live.draft(project,key,{enabled:false,schedule:{kind:'minutes',every:15}},'Synthetic remote disable','author');view=await live.apply(project,view.history[0].id,'publisher',true);assert.equal(view.rows[0].settings.enabled,false);assert.equal((view.rows[0].settings.schedule as any).every,15);
    view=await live.draft(project,key,{enabled:true,schedule:{kind:'minutes',every:10}},'Synthetic uncertain replacement','author');const uncertain=view.history[0].id;failAfterWrite=true;
    await assert.rejects(live.apply(project,uncertain,'publisher',true),/needs verification/);assert.equal(writes,3);
    await assert.rejects(live.apply(project,uncertain,'publisher',true),/already attempted/);assert.equal(writes,3);
    view=await live.draft(project,key,{enabled:true,schedule:{kind:'minutes',every:5}},'Do not bypass uncertain update','author');await assert.rejects(live.apply(project,view.history[0].id,'publisher',true),/previous uncertain/);assert.equal(writes,3);
  }finally{
    process.env.DATABASE_URL=previous;
    await pool.query('DELETE FROM google_automation_trigger_change WHERE connection_id=$1',[connection]);
    await pool.query('DELETE FROM google_automation_project WHERE connection_id=$1',[connection]);await pool.end();
  }
});
