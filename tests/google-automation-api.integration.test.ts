import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Pool } from 'pg';
import { PgAutomationStore } from '../lib/googleAutomations/store';
import { connectionId, type AutomationConfig } from '../lib/googleAutomations/config';
import { normalizeFiles, seal, sourceHash } from '../lib/googleAutomations/model';
const {createClient,run}=require('../scripts/google-automations.cjs');

test('CLI and actual TMS route retrieve encrypted saved source over HTTP and enforce account/project/operation grants',
  {skip:!process.env.GOOGLE_AUTOMATIONS_API_TEST_DATABASE_URL},async()=>{
  const databaseUrl=process.env.GOOGLE_AUTOMATIONS_API_TEST_DATABASE_URL!;
  const url=new URL(databaseUrl);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15447');assert.equal(url.pathname,'/google_automation_api_test');
  const saved={DATABASE_URL:process.env.DATABASE_URL,GOOGLE_AUTOMATIONS_CONFIG_B64:process.env.GOOGLE_AUTOMATIONS_CONFIG_B64,
    GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON:process.env.GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON,GOOGLE_AUTOMATIONS_ENABLED:process.env.GOOGLE_AUTOMATIONS_ENABLED,
    SCHEDULER_SECRET:process.env.SCHEDULER_SECRET,EXTERNAL_API_KEY_FOR_CLAWDBOT:process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT};
  const scriptId='synthetic-api-allowed-project',hidden='synthetic-api-hidden-project',key=randomBytes(32).toString('base64');
  const config:AutomationConfig={enabled:true,allowPublish:false,accountEmail:'api-fixture@example.test',encryptionKey:key,
    credentials:{client_id:'synthetic',client_secret:'synthetic',refresh_token:'synthetic'},projects:[]};
  const token=randomBytes(32).toString('base64url'),wrongAccountToken=randomBytes(32).toString('base64url'),publisher=randomBytes(32).toString('base64url');
  const grant=(id:string,secret:string,accountEmail:string,scopes:string[])=>({id,tokenSha256:createHash('sha256').update(secret).digest('hex'),accountEmail,scopes,scriptIds:[scriptId],expiresAt:'2099-01-01T00:00:00Z'});
  process.env.DATABASE_URL=databaseUrl;process.env.GOOGLE_AUTOMATIONS_ENABLED='true';
  process.env.GOOGLE_AUTOMATIONS_CONFIG_B64=Buffer.from(JSON.stringify(config)).toString('base64');
  process.env.GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON=JSON.stringify([grant('reader',token,config.accountEmail,['read']),grant('wrong',wrongAccountToken,'other@example.test',['read']),grant('publisher',publisher,config.accountEmail,['read','publish'])]);
  process.env.SCHEDULER_SECRET='synthetic-general-machine-credential';delete process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT;
  const pool=new Pool({connectionString:databaseUrl,max:3}),store=new PgAutomationStore(pool,connectionId(config));
  let applicationPool:Pool|undefined;
  let server:ReturnType<typeof createServer>|undefined;
  try{
    await store.init();
    const files=normalizeFiles([{name:'Code',type:'SERVER_JS',source:'const API_TOKEN="synthetic-api-sensitive-token";\nfunction createEvent() { return 1; }'},
      {name:'appsscript',type:'JSON',source:'{"timeZone":"Asia/Singapore"}'}]);
    for(const id of [scriptId,hidden]){await store.register({scriptId:id,name:id});await store.snapshot(id,sourceHash(files),seal(files,key));}
    // Imports happen only after the test has pinned all configuration to loopback/synthetic values.
    const handler=require('../pages/api/admin/google-automations.ts').default;
    applicationPool=require('../lib/db.ts').default;
    server=createServer(async(req,res)=>{
      const requestUrl=new URL(req.url!,'http://127.0.0.1');
      if(requestUrl.pathname!=='/api/admin/google-automations'){res.statusCode=404;res.end();return;}
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const request=req as any;request.query=Object.fromEntries(requestUrl.searchParams);request.body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
      const response=res as any;response.status=(code:number)=>{res.statusCode=code;return response;};
      response.json=(body:any)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return response;};
      await handler(request,response);
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const origin=`http://127.0.0.1:${address.port}`,client=await createClient({baseUrl:origin,agentToken:token});
    const registry=await run('list',{},client);assert.deepEqual(registry.projects.map((p:any)=>p.scriptId),[scriptId]);
    const coverage=await run('coverage',{},client);assert.equal(coverage.total,1);assert.equal(coverage.stored,1);
    const source=await run('read',{script:scriptId},client);assert.equal(source.origin,'database');assert.equal(source.currentGoogleVerified,false);
    assert.match(source.files[1].source,/createEvent/);assert.doesNotMatch(JSON.stringify(source),/synthetic-api-sensitive-token|ciphertext/);
    const search=await run('search',{query:'createEvent'},client);assert.equal(search.matches.length,1);assert.equal(search.matches[0].line,2);
    const revisions=await run('revisions',{script:scriptId},client);assert.equal(revisions.revisions.length,1);
    const revision=await run('revision',{script:scriptId,revision:revisions.revisions[0].id},client);assert.equal(revision.hash,source.hash);
    await assert.rejects(run('read',{script:hidden},client),/HTTP 403/);
    await assert.rejects(run('refresh',{script:scriptId},client),/HTTP 403/);
    await assert.rejects(client({},{action:'draft',scriptId}),/HTTP 403/);
    await assert.rejects(client({view:'triggers',scriptId}),/HTTP 403/);
    await assert.rejects(client({},{action:'configure'}),/HTTP 403/);
    const other=await createClient({baseUrl:origin,agentToken:wrongAccountToken});await assert.rejects(other(),/HTTP 403/);
    const publishing=await createClient({baseUrl:origin,agentToken:publisher});
    await assert.rejects(run('publish',{script:scriptId,draft:'synthetic','acknowledge-live-code':true},publishing),/HTTP 403/);
    const generic=await fetch(origin+'/api/admin/google-automations?view=storedSource&scriptId='+scriptId,{headers:{'x-api-key':process.env.SCHEDULER_SECRET!}});
    assert.equal(generic.status,403);assert.equal(generic.headers.get('cache-control'),'no-store, private');
    const anonymous=await fetch(origin+'/api/admin/google-automations');assert.equal(anonymous.status,401);
    assert.equal((await store.revisions(scriptId)).length,1,'Offline inspections and rejected actions do not refresh or alter source.');
  }finally{
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
    await applicationPool?.end();
    await pool.query('DELETE FROM google_automation_source_revision WHERE connection_id=$1',[connectionId(config)]).catch(()=>{});
    await pool.query('DELETE FROM google_automation_project WHERE connection_id=$1',[connectionId(config)]).catch(()=>{});
    await pool.end();
    for(const [name,value] of Object.entries(saved)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
});
