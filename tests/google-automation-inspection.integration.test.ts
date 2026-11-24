import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PgAutomationStore } from '../lib/googleAutomations/store';
import { AutomationService } from '../lib/googleAutomations/service';
import { AutomationInspection } from '../lib/googleAutomations/inspection';
import { syncGoogleAutomationSources } from '../lib/googleAutomations/sync';
import { connectionId, type AutomationConfig } from '../lib/googleAutomations/config';
import { normalizeFiles, seal, sourceHash, type ScriptFile } from '../lib/googleAutomations/model';

test('isolated PostgreSQL preserves old source, changed revisions, offline search, scoping and refresh failure state',
  {skip:!process.env.GOOGLE_AUTOMATIONS_INSPECTION_TEST_DATABASE_URL},async()=>{
  const url=new URL(process.env.GOOGLE_AUTOMATIONS_INSPECTION_TEST_DATABASE_URL!);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15447');assert.equal(url.pathname,'/google_automation_test');
  const pool=new Pool({connectionString:url.toString(),max:5});
  const connection=randomUUID(),otherConnection=randomUUID(),key=randomBytes(32).toString('base64');
  const scriptId='synthetic-inspection-project',hidden='synthetic-hidden-project',missing='synthetic-missing-project';
  let files:ScriptFile[]=normalizeFiles([{name:'Code',type:'SERVER_JS',source:'const API_TOKEN="synthetic-sensitive-token";\nfunction createEvent() { return "before"; }'},
    {name:'appsscript',type:'JSON',source:'{"timeZone":"Asia/Singapore"}'}]);
  let googleReads=0,writes=0;
  const gateway={identity:async()=> 'owner@example.test',list:async()=>[],metadata:async()=>({scriptId,name:'Synthetic'}),
    read:async()=>{googleReads++;return structuredClone(files);},write:async()=>{writes++;}};
  const store=new PgAutomationStore(pool,connection),other=new PgAutomationStore(pool,otherConnection);
  try{
    await pool.query(await readFile('database/migrations/create_google_automation_registry.sql','utf8'));
    // Represent a pre-extension database containing only the latest snapshot.
    await store.register({scriptId,name:'Synthetic Calendar'});
    await pool.query('UPDATE google_automation_project SET source_hash=$3,source_ciphertext=$4,refreshed_at=now() WHERE connection_id=$1 AND script_id=$2',[connection,scriptId,sourceHash(files),seal(files,key)]);
    const migration=await readFile('database/migrations/create_google_automation_source_revisions.sql','utf8');
    await pool.query(migration);await pool.query(migration);await store.init();
    assert.equal((await store.revisions(scriptId)).length,1);
    await store.register({scriptId:hidden,name:'Hidden project'});await store.register({scriptId:missing,name:'Missing project'});
    const service=new AutomationService(store,gateway,key),inspection=new AutomationInspection(store,service,key);
    const first=await service.storedSource(scriptId);assert.equal(googleReads,0);
    await service.source(scriptId);assert.equal((await store.revisions(scriptId)).length,1);
    files=files.map(f=>f.name==='Code'?{...f,source:f.source.replace('before','after')}:f);
    await service.source(scriptId);const history=await store.revisions(scriptId);assert.equal(history.length,2);
    const old=await inspection.revision(scriptId,history.find(r=>r.hash===first.hash).id);
    assert.match(old.files.find(f=>f.name==='Code')!.source,/before/);assert.doesNotMatch(JSON.stringify(old),/synthetic-sensitive-token|ciphertext/);
    assert.doesNotMatch(JSON.stringify(history),/synthetic-sensitive-token|ciphertext/);
    const readsBefore=googleReads;
    const search=await inspection.search('createEvent',id=>id!==hidden);assert.equal(search.matches.length,1);assert.equal(search.matches[0].line,2);
    assert.equal(search.origin,'database');assert.equal(googleReads,readsBefore);
    assert.equal((await inspection.search('synthetic-sensitive-token')).matches.length,0);
    const coverage=await inspection.coverage(id=>id!==hidden);assert.equal(coverage.total,2);assert.equal(coverage.stored,1);assert.equal(coverage.missing[0].scriptId,missing);
    await assert.rejects(other.revision(scriptId,history[0].id),/not found/);
    const beforeFailure=(await store.project(scriptId)).source_ciphertext;
    await store.sourceFailure(scriptId);
    assert.equal((await store.project(scriptId)).source_ciphertext,beforeFailure);
    assert.match((await store.projects()).find(p=>p.scriptId===scriptId)!.lastSourceError!,/retained/);
    // Returning to prior source records another observation rather than deleting history.
    files=files.map(f=>f.name==='Code'?{...f,source:f.source.replace('after','before')}:f);
    await service.source(scriptId);assert.equal((await store.revisions(scriptId)).length,3);
    assert.equal((await store.projects()).find(p=>p.scriptId===scriptId)!.lastSourceError,null);
    const cipher=(await pool.query('SELECT source_ciphertext FROM google_automation_source_revision WHERE connection_id=$1',[connection])).rows;
    assert.doesNotMatch(JSON.stringify(cipher),/synthetic-sensitive-token|function createEvent/);assert.equal(writes,0);
    // A scheduled sync persists successful projects and retains failed projects' saved source.
    const config:AutomationConfig={enabled:true,allowPublish:false,accountEmail:`${randomUUID()}@example.test`,encryptionKey:key,credentials:{client_id:'synthetic',client_secret:'synthetic',refresh_token:'synthetic'},projects:[{scriptId,name:'Successful project',purpose:'',category:'',schedule:'',dependencies:''},{scriptId:hidden,name:'Failure project',purpose:'',category:'',schedule:'',dependencies:''}]};
    const syncStore=new PgAutomationStore(pool,connectionId(config));
    await syncStore.init();await syncStore.register({scriptId:hidden,name:'Previously saved failure project'});
    await syncStore.snapshot(hidden,sourceHash(files),seal(files,key));
    const retained=(await syncStore.project(hidden)).source_ciphertext;
    const result=await syncGoogleAutomationSources(pool,config,{...gateway,list:async()=>[{scriptId:'synthetic-newly-discovered-project',name:'New source'}],read:async(id:string)=>{if(id===hidden)throw Error('Google exception containing synthetic-sensitive-token');return files;}});
    assert.equal(result.success,false);assert.equal(result.refreshed,2);assert.equal(result.discovered,1);assert.equal(result.total,3);
    assert.doesNotMatch(JSON.stringify(result),/synthetic-sensitive-token/);
    assert.equal((await syncStore.projects()).find(p=>p.scriptId===scriptId)!.hasStoredSource,true);
    assert.match((await syncStore.projects()).find(p=>p.scriptId===hidden)!.lastSourceError!,/failed/);
    assert.equal((await syncStore.project(hidden)).source_ciphertext,retained);
    await pool.query('DELETE FROM google_automation_source_revision WHERE connection_id=$1',[connectionId(config)]);
    await pool.query('DELETE FROM google_automation_project WHERE connection_id=$1',[connectionId(config)]);
  }finally{
    await pool.query('DELETE FROM google_automation_source_revision WHERE connection_id IN ($1,$2)',[connection,otherConnection]).catch(()=>{});
    await pool.query('DELETE FROM google_automation_project WHERE connection_id IN ($1,$2)',[connection,otherConnection]).catch(()=>{});
    await pool.end();
  }
});
