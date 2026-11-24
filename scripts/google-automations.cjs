#!/usr/bin/env node
// HTTPS client only: no database, Google OAuth credential, or backup key access.
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,createHash}=require('node:crypto');

function argumentsFor(argv){
  const [command='help',...args]=argv,options={};
  for(let i=0;i<args.length;i++){
    if(!args[i].startsWith('--'))throw Error('Use named options; see help.');
    const key=args[i].slice(2);
    if(Object.hasOwn(options,key))throw Error('Duplicate option: '+key);
    options[key]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;
  }
  return {command,options};
}
function originFor(value){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use a base URL containing only the origin.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('HTTPS is required except for localhost.');
  return url.origin;
}
async function createClient(configuration,fetcher=fetch){
  const origin=originFor(configuration.baseUrl);
  let token=configuration.sessionToken;
  if(!configuration.agentToken&&!token&&configuration.email&&configuration.password){
    const response=await fetcher(origin+'/api/auth/login',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:configuration.email,password:configuration.password,loginType:configuration.loginType||'password'}),signal:AbortSignal.timeout(30000)});
    const body=await response.json();
    if(!response.ok||!body.success||!body.data?.token)throw Error('TMS login failed; check the private client configuration.');
    token=body.data.token;
  }
  if(!configuration.agentToken&&!token)throw Error('Configure an agent token or an Admin/Developer session in the private client configuration.');
  return async(query={},body)=>{
    const url=new URL('/api/admin/google-automations',origin);
    for(const [name,value] of Object.entries(query))if(value!==undefined)url.searchParams.set(name,value);
    const headers=configuration.agentToken?{'x-google-automation-key':configuration.agentToken}:{Authorization:'Bearer '+token};
    if(body)headers['Content-Type']='application/json';
    const response=await fetcher(url,{method:body?'POST':'GET',redirect:'error',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
    let result;try{result=await response.json();}catch{throw Error('TMS returned an invalid response (HTTP '+response.status+').');}
    if(!response.ok||!result.success)throw Error('TMS request failed (HTTP '+response.status+'). '+(typeof result.error==='string'?result.error.slice(0,300):''));
    return result;
  };
}
function required(options,key){if(typeof options[key]!=='string'||!options[key])throw Error('Missing --'+key);return options[key];}
function writeCheckout(directory,scriptId,source){
  // Exclusive directory creation prevents overwriting existing work or following a pre-existing symlink.
  fs.mkdirSync(path.dirname(path.resolve(directory)),{recursive:true});
  fs.mkdirSync(directory,{recursive:false});
  fs.mkdirSync(path.join(directory,'files'));
  const manifest={version:1,scriptId,hash:source.hash,files:source.files.map((file,index)=>{
    const extension={SERVER_JS:'gs',HTML:'html',JSON:'json'}[file.type];
    if(!extension)throw Error('Unsupported source file type.');
    const filename=String(index).padStart(3,'0')+'-'+file.name.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)+'.'+extension;
    const relative='files/'+filename;
    fs.writeFileSync(path.join(directory,relative),file.source,{flag:'wx'});
    return {name:file.name,type:file.type,path:relative};
  })};
  fs.writeFileSync(path.join(directory,'checkout.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return {scriptId,hash:source.hash,directory,fileCount:manifest.files.length};
}
function readCheckout(directory){
  const root=fs.realpathSync(directory),manifest=JSON.parse(fs.readFileSync(path.join(root,'checkout.json'),'utf8'));
  if(manifest.version!==1||!/^[a-f0-9]{64}$/.test(manifest.hash)||!Array.isArray(manifest.files))throw Error('Invalid source checkout.');
  return {scriptId:manifest.scriptId,baseHash:manifest.hash,files:manifest.files.map(file=>{
    if(typeof file.path!=='string'||!/^files\/[0-9]{3}-[a-zA-Z0-9_-]+\.(gs|html|json)$/.test(file.path))throw Error('Invalid checkout file path.');
    const resolved=fs.realpathSync(path.join(root,file.path));
    if(!resolved.startsWith(root+path.sep))throw Error('Checkout file is outside the checkout directory.');
    return {name:file.name,type:file.type,source:fs.readFileSync(resolved,'utf8')};
  })};
}
async function run(command,options,request){
  const scriptId=options.script;
  if(command==='list'){
    const result=await request();
    if(options.query){const needle=String(options.query).toLowerCase();result.projects=result.projects.filter(p=>[p.name,p.purpose,p.category,p.dependencies,p.scriptId].join(' ').toLowerCase().includes(needle));}
    return result;
  }
  if(command==='coverage')return request({view:'coverage'});
  if(command==='search')return request({view:'search',q:required(options,'query')});
  if(command==='sync'){
    const registry=await request(),results=[];
    for(const project of registry.projects){
      if(options['missing-only']&&project.sourceHash)continue;
      try{
        const source=options['legacy-source']?await request({view:'source',scriptId:project.scriptId}):await request({},{action:'refresh',scriptId:project.scriptId});
        results.push({scriptId:project.scriptId,name:project.name,success:true,hash:source.hash});
      }catch(error){results.push({scriptId:project.scriptId,name:project.name,success:false,error:error.message});}
    }
    return {success:results.every(r=>r.success),attempted:results.length,refreshed:results.filter(r=>r.success).length,results};
  }
  if(command==='draft')return request({},{action:'draft',...readCheckout(required(options,'dir')),reason:required(options,'reason')});
  required(options,'script');
  if(command==='read')return request({view:'storedSource',scriptId});
  if(command==='refresh')return request({},{action:'refresh',scriptId});
  if(command==='revisions')return request({view:'sourceRevisions',scriptId});
  if(command==='revision')return request({view:'sourceRevision',scriptId,revisionId:required(options,'revision')});
  if(command==='history')return request({view:'history',scriptId});
  if(command==='review')return request({view:'draft',scriptId,draftId:required(options,'draft')});
  if(command==='checkout'){
    const source=options.refresh?await request({},{action:'refresh',scriptId}):await request({view:'storedSource',scriptId});
    return writeCheckout(required(options,'dir'),scriptId,source);
  }
  if(command==='restore')return request({},{action:'restore',scriptId,draftId:required(options,'draft'),reason:required(options,'reason')});
  if(command==='publish'){
    if(options['acknowledge-live-code']!==true)throw Error('Publishing requires --acknowledge-live-code and authorization for this live source change.');
    return request({},{action:'publish',scriptId,draftId:required(options,'draft'),acknowledged:true});
  }
  throw Error('Unknown command. See help.');
}
function keygen(options){
  const id=required(options,'id'),accountEmail=required(options,'account'),baseUrl=originFor(required(options,'base-url'));
  const scopes=String(options.scopes||'read,refresh,draft').split(','),scriptIds=required(options,'projects').split(',');
  const expiresAt=required(options,'expires');
  if(!/^[-\w]{1,64}$/.test(id)||!/^\S+@\S+\.\S+$/.test(accountEmail)||!scopes.includes('read')||scopes.some(s=>!['read','refresh','draft','publish'].includes(s))||!scriptIds.every(s=>s==='*'||/^[A-Za-z0-9_-]{20,200}$/.test(s))||!(Date.parse(expiresAt)>Date.now()))throw Error('Invalid agent ID, account, scopes, projects or expiration.');
  const agentToken='ga_'+randomBytes(32).toString('base64url');
  fs.writeFileSync(required(options,'out'),JSON.stringify({baseUrl,agentToken},null,2)+'\n',{flag:'wx',mode:0o600});
  return {clientConfig:options.out,serverVariable:'GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON',serverEntry:{id,accountEmail:accountEmail.toLowerCase(),scopes,scriptIds,expiresAt,tokenSha256:createHash('sha256').update(agentToken).digest('hex')}};
}
const help=`Google Apps Script tool for TMS
Usage: node scripts/google-automations.cjs <command> [--config <private.json>] [options]
Commands: list [--query text], coverage, search --query text, sync [--missing-only]
  read | refresh | revisions | history --script ID
  revision --script ID --revision UUID
  checkout --script ID --dir NEW_DIRECTORY [--refresh]
  draft --dir DIRECTORY --reason TEXT
  review --script ID --draft UUID
  publish --script ID --draft UUID --acknowledge-live-code
  restore --script ID --draft UUID --reason TEXT  (creates a draft only)
  keygen --id NAME --account GOOGLE_EMAIL --base-url ORIGIN --projects ID,ID|* --expires ISO_DATE --out PRIVATE_JSON [--scopes read,refresh,draft]
Client config: --config, GOOGLE_AUTOMATIONS_CLIENT_CONFIG, or config/google-automations-agent.private.json.
Use scratch/ for source checkouts. --legacy-source on sync uses the existing GET source route during rollout.
Saved reads/search never refresh Google. Refresh/sync never write Google source or execute scripts.`;
if(require.main===module){
  (async()=>{
    const {command,options}=argumentsFor(process.argv.slice(2));
    if(command==='help'||options.help){console.log(help);return;}
    if(command==='keygen'){console.log(JSON.stringify(keygen(options),null,2));return;}
    let config;
    try{config=JSON.parse(fs.readFileSync(options.config||process.env.GOOGLE_AUTOMATIONS_CLIENT_CONFIG||'config/google-automations-agent.private.json','utf8'));}
    catch{throw Error('The private Google Automations client configuration is missing or invalid.');}
    const result=await run(command,options,await createClient(config));
    if(options.output)fs.writeFileSync(required(options,'output'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    else console.log(JSON.stringify(result,null,2));
    if(result.success===false)process.exitCode=1;
  })().catch(error=>{console.error(error instanceof TypeError?'Google Automations connection failed.':error.message);process.exitCode=1;});
}
module.exports={argumentsFor,originFor,createClient,run,writeCheckout,readCheckout,keygen};
