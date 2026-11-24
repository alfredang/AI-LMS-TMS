import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {createClient,originFor,run,writeCheckout,readCheckout,keygen}=require('../scripts/google-automations.cjs');

test('HTTPS client keeps credentials in headers and refuses redirects or unsafe origins',async()=>{
  const calls:any[]=[];
  const request=await createClient({baseUrl:'https://tms.example.test',agentToken:'private-agent-token'},async(url:any,options:any)=>{calls.push({url:String(url),options});return {ok:true,status:200,json:async()=>({success:true})};});
  await request({view:'storedSource',scriptId:'synthetic-project'});
  assert.equal(calls[0].options.headers['x-google-automation-key'],'private-agent-token');
  assert.equal(calls[0].options.redirect,'error');assert.doesNotMatch(calls[0].url,/private-agent-token/);
  for(const origin of ['http://example.test','https://user:password@example.test','https://example.test/?token=secret','file:///tmp'])assert.throws(()=>originFor(origin));
  assert.equal(originFor('http://127.0.0.1:3003'),'http://127.0.0.1:3003');
});

test('saved reads stay offline; synchronization fills missing projects and reports individual failures',async()=>{
  const calls:any[]=[];
  const request=async(query:any={},body:any)=>{
    calls.push({query,body});
    if(!body&&!query.view)return {projects:[{scriptId:'stored',sourceHash:'existing'},{scriptId:'missing'},{scriptId:'denied'}]};
    if(body?.scriptId==='denied')throw Error('HTTP 403');
    return {success:true,hash:'observed'};
  };
  await run('read',{script:'stored'},request);
  assert.deepEqual(calls[0],{query:{view:'storedSource',scriptId:'stored'},body:undefined});
  const result=await run('sync',{'missing-only':true},request);
  assert.equal(result.attempted,2);assert.equal(result.refreshed,1);assert.equal(result.success,false);
  assert.deepEqual(calls.filter(c=>c.body).map(c=>c.body.action),['refresh','refresh']);
  const before=calls.length;
  await assert.rejects(run('publish',{script:'stored',draft:'draft'},request),/acknowledge-live-code/);
  assert.equal(calls.length,before);
});

test('source checkout round-trips the complete project, preserves names and refuses file path escapes',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tms-google-cli-'));
  try{
    const directory=path.join(root,'checkout');
    const files=[{name:'Code',type:'SERVER_JS',source:'function sample() { return 1; }'},{name:'appsscript',type:'JSON',source:'{"timeZone":"Asia/Singapore"}'},{name:'../unsafe:name',type:'HTML',source:'<p>Example</p>'}];
    writeCheckout(directory,'synthetic-project',{hash:'a'.repeat(64),files});
    assert.deepEqual(readCheckout(directory),{scriptId:'synthetic-project',baseHash:'a'.repeat(64),files});
    assert.throws(()=>writeCheckout(directory,'synthetic-project',{hash:'a'.repeat(64),files}),/EEXIST/);
    const manifest=JSON.parse(fs.readFileSync(path.join(directory,'checkout.json'),'utf8'));
    manifest.files[0].path='../outside.gs';fs.writeFileSync(path.join(directory,'checkout.json'),JSON.stringify(manifest));
    assert.throws(()=>readCheckout(directory),/Invalid checkout file path/);
    const config=path.join(root,'agent.private.json');
    const grantFile=path.join(root,'grant.private.json');
    const generated=keygen({id:'test-agent',account:'owner@example.test','base-url':'https://tms.example.test',projects:'*',expires:'2099-01-01T00:00:00Z',out:config,'grant-out':grantFile});
    const privateConfig=JSON.parse(fs.readFileSync(config,'utf8'));
    assert.doesNotMatch(JSON.stringify(generated),new RegExp(privateConfig.agentToken));
    assert.doesNotMatch(fs.readFileSync(grantFile,'utf8'),new RegExp(privateConfig.agentToken));
    assert.deepEqual(generated.serverEntry.scopes,['read','refresh','draft']);
    assert.throws(()=>keygen({id:'test-agent',account:'owner@example.test','base-url':'https://tms.example.test',projects:'*',expires:'2099-01-01T00:00:00Z',out:config}),/EEXIST/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
