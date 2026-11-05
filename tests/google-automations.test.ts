import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { AutomationError, capabilities, normalizeFiles, publicFiles, restoreMaskedFiles, seal, sourceHash, unseal, type ScriptFile, type Project } from '../lib/googleAutomations/model';
import { AutomationService } from '../lib/googleAutomations/service';
import { PgAutomationStore, type AutomationStore, type Draft } from '../lib/googleAutomations/store';
import type { ScriptGateway } from '../lib/googleAutomations/google';

const key=randomBytes(32).toString('base64');
const scriptId='isolated-script-project-for-tests';
const fixture=():ScriptFile[]=>normalizeFiles([{name:'Code',type:'SERVER_JS',source:'const API_TOKEN = "synthetic-secret-value";\nfunction testTool() { return "before"; }'},{name:'appsscript',type:'JSON',source:'{"timeZone":"Asia/Singapore","runtimeVersion":"V8"}'},{name:'Panel',type:'HTML',source:'<p>Existing file preserved</p>'}]);
class MemoryStore implements AutomationStore {
  rows=new Map<string,Draft>(); projectsMap=new Map<string,any>(); lockedNow=false;
  async init(){}
  async projects(){return [...this.projectsMap.values()];}
  async register(p:Partial<Project>&Pick<Project,'scriptId'|'name'>){this.projectsMap.set(p.scriptId,{...p,source_ciphertext:null});}
  async project(id:string){if(!this.projectsMap.has(id))throw new AutomationError(404,'Not registered');return this.projectsMap.get(id);}
  async metadata(id:string,p:any){Object.assign(await this.project(id),p);}
  async snapshot(id:string,hash:string,ciphertext:string){Object.assign(await this.project(id),{sourceHash:hash,source_ciphertext:ciphertext});}
  async saveDraft(d:any){this.rows.set(d.id,{...d,status:'draft',created_at:new Date().toISOString(),applied_at:null,published_by:null});}
  async draft(id:string,projectId:string){const d=this.rows.get(id);if(!d||d.script_id!==projectId)throw new AutomationError(404,'Draft not found');return d;}
  async history(id:string){return [...this.rows.values()].filter(d=>d.script_id===id).map(({source_ciphertext,...d})=>d);}
  async status(id:string,status:string,actor:string){Object.assign(this.rows.get(id)!,{status,published_by:actor,applied_at:status==='applied'?new Date().toISOString():null});}
  async locked<T>(_id:string,fn:(store:AutomationStore)=>Promise<T>):Promise<T>{if(this.lockedNow)throw new AutomationError(409,'Locked');this.lockedNow=true;try{return await fn(this);}finally{this.lockedNow=false;}}
}
async function setup(store:AutomationStore=new MemoryStore()) {
  await store.init();await store.register({scriptId,name:'Isolated test script'});
  let files=fixture();let writes=0;let fail=false;let mismatch=false;let duringWrite:()=>Promise<void>=async()=>{};
  const gateway:ScriptGateway={identity:async()=> 'test@example.com',list:async()=>[],metadata:async()=>({scriptId,name:'Test'}),read:async()=>structuredClone(files),write:async(_id,after)=>{writes++;await duringWrite();files=structuredClone(after);if(mismatch)files.find(f=>f.name==='Code')!.source+='\n// Concurrent external edit';if(fail)throw new Error('transport error containing credential must never escape');}};
  const service=new AutomationService(store,gateway,key);
  const edit=async()=>{const source=await service.source(scriptId);return service.draft(scriptId,source.hash,source.files.map(f=>({...f,source:f.source.replace('"before"','"after"')})),'Update test return value','author');};
  return{store,service,edit,get files(){return files;},set files(v:ScriptFile[]){files=v;},get writes(){return writes;},set fail(v:boolean){fail=v;},set mismatch(v:boolean){mismatch=v;},set duringWrite(v:()=>Promise<void>){duringWrite=v;}};
}
test('source reads and saved drafts never write Google; source and history hide credentials',async()=>{
  const f=await setup();const source=await f.service.source(scriptId);assert.doesNotMatch(JSON.stringify(source),/synthetic-secret-value/);
  const d=await f.edit();assert.equal(f.writes,0);assert.doesNotMatch(JSON.stringify(d),/synthetic-secret-value/);assert.doesNotMatch(JSON.stringify(await f.store.history(scriptId)),/source_ciphertext|synthetic-secret-value/);
  const stored=await f.store.draft(d.id,scriptId);assert.doesNotMatch(stored.source_ciphertext,/synthetic-secret-value/);
  assert.equal(unseal<any>(stored.source_ciphertext,key).before[0].source,fixture()[0].source);
});
test('publishing preserves all project files and credentials, verifies and is idempotent',async()=>{
  const f=await setup();const d=await f.edit();
  await assert.rejects(f.service.publish(scriptId,d.id,'publisher',false),/Acknowledge/);assert.equal(f.writes,0);
  f.duringWrite=async()=>{assert.equal((await f.store.draft(d.id,scriptId)).status,'applying');};
  await f.service.publish(scriptId,d.id,'publisher',true);
  assert.equal(f.writes,1);assert.equal(f.files.length,3);assert.match(f.files.find(file=>file.name==='Code')!.source,/synthetic-secret-value/);assert.match(f.files.find(file=>file.name==='Code')!.source,/"after"/);
  await f.service.publish(scriptId,d.id,'publisher',true);assert.equal(f.writes,1);
  assert.equal((await f.store.draft(d.id,scriptId)).published_by,'publisher');
});
test('stale source at draft time or apply time is blocked',async()=>{
  const f=await setup();const source=await f.service.source(scriptId);f.files=f.files.map(file=>file.name==='Code'?{...file,source:file.source+'\n// external'}:file);
  await assert.rejects(f.service.draft(scriptId,source.hash,source.files,'Test stale draft','author'),/changed/);
  const d=await f.edit();f.files=f.files.map(file=>file.name==='Code'?{...file,source:file.source+'\n// later'}:file);
  await assert.rejects(f.service.publish(scriptId,d.id,'publisher',true),/changed/);assert.equal(f.writes,0);
});
test('uncertain write results require reconciliation and cannot be replayed',async()=>{
  const f=await setup();const d=await f.edit();f.fail=true;
  await assert.rejects(f.service.publish(scriptId,d.id,'publisher',true),/could not be verified/);
  assert.equal((await f.store.draft(d.id,scriptId)).status,'verification_required');
  await assert.rejects(f.service.publish(scriptId,d.id,'publisher',true),/already been attempted/);assert.equal(f.writes,1);
});
test('readback mismatch never reports success',async()=>{
  const f=await setup();const d=await f.edit();f.mismatch=true;
  await assert.rejects(f.service.publish(scriptId,d.id,'publisher',true),/differs/);assert.equal((await f.store.draft(d.id,scriptId)).status,'verification_required');
});
test('restoration is a separate reviewable draft and restores the encrypted backup',async()=>{
  const f=await setup();const d=await f.edit();await f.service.publish(scriptId,d.id,'publisher',true);
  const restored=await f.service.restore(scriptId,d.id,'Undo the test change','restorer');assert.equal(f.writes,1);assert.notEqual(restored.id,d.id);
  await f.service.publish(scriptId,restored.id,'publisher',true);assert.equal(sourceHash(f.files),sourceHash(fixture()));
});
test('invalid code, removed files, manifest changes and credential placeholder tampering are rejected',async()=>{
  const f=await setup();const source=await f.service.source(scriptId);
  const tryFiles=(files:ScriptFile[])=>f.service.draft(scriptId,source.hash,files,'Validation test','author');
  await assert.rejects(tryFiles(source.files.filter(file=>file.name!=='Panel')),/Adding or deleting/);
  await assert.rejects(tryFiles(source.files.map(file=>file.name==='Code'?{...file,source:'function broken( {'}:file)),/placeholder/);
  await assert.rejects(tryFiles(source.files.map(file=>file.name==='Code'?{...file,source:file.source+'\nfunction broken( {'}:file)),/syntax/);
  await assert.rejects(tryFiles(source.files.map(file=>file.type==='JSON'?{...file,source:'{}'}:file)),/Manifest/);
  await assert.rejects(tryFiles(source.files.map(file=>file.name==='Code'?{...file,source:file.source.replace(/\[TMS_SECRET_[a-f0-9]+\]/,'different')}:file)),/placeholder/);
  assert.equal(f.writes,0);
});
test('only human Admin/Developer can edit and publish; Training Provider can view',()=>{
  assert.equal(capabilities(new Set(['trainingProvider'])).canEdit,false);
  assert.equal(capabilities(new Set(['trainingProvider'])).canView,true);
  for(const role of ['learner','trainer','finance','payroll'])assert.equal(capabilities(new Set([role])).canView,false);
  for(const role of ['admin','developer'])assert.equal(capabilities(new Set([role])).canPublish,true);
  assert.equal(capabilities(new Set(['admin']),true).canPublish,false);
});
test('encryption authenticates backups and canonical source hashes ignore file order',()=>{
  const encrypted=seal(fixture(),key);assert.deepEqual(unseal(encrypted,key),fixture());
  assert.throws(()=>unseal(encrypted,randomBytes(32).toString('base64')));
  assert.equal(sourceHash(fixture()),sourceHash(fixture().reverse()));
  assert.throws(()=>normalizeFiles([...fixture(),fixture()[0]]),/Duplicate/);
});
test('masked values are restored exactly, including repeated values and URL credentials',()=>{
  const files=fixture();files.find(f=>f.name==='Code')!.source+='\nconst CLIENT_SECRET="synthetic-secret-value";\nconst url="https://example.com/?token=another-synthetic-value";';
  const masked=publicFiles(files);assert.doesNotMatch(JSON.stringify(masked),/synthetic-secret-value|another-synthetic-value/);
  assert.deepEqual(restoreMaskedFiles(files,masked),files);
});
test('isolated PostgreSQL migration, account scoping, encrypted drafts, lock and restoration', {skip:process.env.GOOGLE_AUTOMATIONS_TEST_DB!=='1'},async()=>{
  const pool=new Pool({host:'127.0.0.1',port:15447,user:'postgres',password:'isolated-only',database:'google_automation_test'});
  try{
    assert.equal((await pool.query('SELECT current_database() db')).rows[0].db,'google_automation_test');
    const sql=await readFile('database/migrations/create_google_automation_registry.sql','utf8');
    await pool.query(sql);await pool.query(sql);
    const store=new PgAutomationStore(pool,randomUUID());const f=await setup(store);
    const d=await f.edit();await f.service.publish(scriptId,d.id,'publisher',true);
    const other=new PgAutomationStore(pool,randomUUID());await assert.rejects(other.project(scriptId),/not registered/);await assert.rejects(other.draft(d.id,scriptId),/not found/);
    assert.doesNotMatch(JSON.stringify(await store.history(scriptId)),/ciphertext|synthetic-secret-value/);
    const restore=await f.service.restore(scriptId,d.id,'Restore isolated source','author');await f.service.publish(scriptId,restore.id,'publisher',true);
    assert.equal(sourceHash(f.files),sourceHash(fixture()));
    await store.locked(scriptId,async()=>{await assert.rejects(store.locked(scriptId,async()=>{}),/in progress/);});
  }finally{await pool.end();}
});
