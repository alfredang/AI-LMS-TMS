// Isolated UI verification only. Unrelated app APIs are fixtures; Google writes
// are intercepted. Live mode permits only registry, connection and source reads.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:3004';
const userId='11111111-1111-4111-8111-111111111111';
const token='lms_'+'a'.repeat(64); // Synthetic session in the isolated database only.
const pool=new Pool({host:'127.0.0.1',port:15447,database:'google_automation_test',user:'postgres',password:'isolated-only'});
assert.equal((await pool.query('SELECT current_database() db')).rows[0].db,'google_automation_test');
await pool.query(`CREATE TABLE IF NOT EXISTS app_user(id uuid PRIMARY KEY,email text,full_name text,account_status text);
CREATE TABLE IF NOT EXISTS user_role_map(user_id uuid,role text,PRIMARY KEY(user_id,role));
CREATE TABLE IF NOT EXISTS user_session(user_id uuid,token_hash text PRIMARY KEY,expires_at timestamptz,last_used_at timestamptz);
CREATE TABLE IF NOT EXISTS training_provider(email_user text,google_client_id text,google_client_secret text,google_refresh_token text);`);
await pool.query(`INSERT INTO app_user(id,email,full_name,account_status) VALUES($1,'isolated-ui@example.com','Isolated UI Admin','active') ON CONFLICT(id) DO NOTHING`,[userId]);
await pool.query(`INSERT INTO user_role_map(user_id,role) VALUES($1,'Admin') ON CONFLICT DO NOTHING`,[userId]);
await pool.query(`INSERT INTO user_session(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour') ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at`,[userId,createHash('sha256').update(token).digest('hex')]);
await pool.end();

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1000}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(({token,userId})=>{if(!localStorage.getItem('auth_token'))localStorage.setItem('auth_token',token);if(!localStorage.getItem('user_data'))localStorage.setItem('user_data',JSON.stringify({id:userId,email:'isolated-ui@example.com',fullName:'Isolated UI Admin',role:'admin',roles:['admin']}));},{token,userId});
let googlePostCount=0;
let fixtureMode=false;
let fixtureReadOnly=false;
const fixtureId='isolated-source-editor-project';
const originalFiles=[{name:'Code',type:'SERVER_JS',source:'function isolatedTool() { return "before"; }'},{name:'appsscript',type:'JSON',source:'{"timeZone":"Asia/Singapore"}'}];
let fixtureFiles=structuredClone(originalFiles);
const fixtureChanges=[];
const fixtureActions=[];
function fixtureResponse(url,request){
  if(request.method()==='GET'){
    const view=url.searchParams.get('view');
    if(view==='source')return {success:true,files:fixtureFiles,hash:'synthetic-hash',refreshedAt:new Date().toISOString()};
    if(view==='history')return {success:true,history:fixtureChanges};
    if(view==='draft')return {success:true,draft:fixtureChanges.find(d=>d.id===url.searchParams.get('draftId'))};
    return {success:true,enabled:true,connection:{accountEmail:'isolated-ui@example.com'},capabilities:{canView:true,canEdit:!fixtureReadOnly,canPublish:!fixtureReadOnly},projects:[{scriptId:fixtureId,name:'Isolated source-editor test',purpose:'Synthetic UI fixture',category:'Test',schedule:'Not verified',dependencies:'None',refreshedAt:null,sourceHash:null,accessStatus:'Not checked'}]};
  }
  const body=request.postDataJSON();fixtureActions.push(body.action);
  if(body.action==='draft'||body.action==='restore'){
    const d={id:`00000000-0000-4000-8000-${String(fixtureChanges.length+1).padStart(12,'0')}`,script_id:fixtureId,actor_id:userId,reason:body.reason,status:'draft',changed_files:['Code'],created_at:new Date().toISOString(),applied_at:null,published_by:null,before:structuredClone(fixtureFiles),after:structuredClone(body.action==='restore'?originalFiles:body.files)};
    fixtureChanges.unshift(d);return {success:true,draft:d};
  }
  if(body.action==='publish'){
    assert.equal(body.acknowledged,true);const d=fixtureChanges.find(d=>d.id===body.draftId);d.status='applied';d.published_by=userId;fixtureFiles=structuredClone(d.after);return {success:true,status:'applied'};
  }
  throw new Error('Unexpected UI fixture action');
}
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/admin/google-automations') {
    if(fixtureMode)return route.fulfill({contentType:'application/json',body:JSON.stringify(fixtureResponse(url,route.request()))});
    if(route.request().method()!=='GET') {googlePostCount++;return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({success:false,error:'Live Google mutations are blocked during UI verification.'})});}
    return route.continue();
  }
  const info={companyName:'TMS Preview',companyShortname:'TMS',companyLogoUrl:'/images/default-company-logo.png'};
  const body=url.pathname.includes('/training-provider/info')?{success:true,data:info}:url.pathname==='/api/health'?{status:'healthy',database:'connected'}:url.pathname==='/api/admin/trainers'?{success:true,data:{trainers:[]}}:url.pathname.includes('/profile/')?{success:true,data:{}}:url.pathname==='/api/analytics/dashboard'?{success:false,error:'Analytics are outside this isolated UI check'}:{success:true,data:[]};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
});
try{
  const response=await page.request.get(`${base}/api/admin/google-automations`);
  assert.equal(response.status(),401,'Unauthenticated source access must be rejected');
  await page.goto(base+'/?view=admin&adminPage=googleAutomations',{waitUntil:'domcontentloaded',timeout:120000});
  await page.getByRole('heading',{name:'Google Automations',exact:true}).waitFor({timeout:120000});
  await page.getByRole('button',{name:/Add Orders to Calendar/}).waitFor({timeout:120000});
  await page.getByRole('button',{name:'Check connection',exact:true}).click();
  await page.getByRole('status').filter({hasText:/Connected as sales@/}).waitFor({timeout:120000});
  await page.getByRole('button',{name:/Add Orders to Calendar/}).click();
  await page.getByRole('button',{name:'Source',exact:true}).click();
  await page.getByRole('textbox',{name:'Source code for Code',exact:true}).waitFor({timeout:120000});
  assert.match(await page.getByRole('textbox',{name:'Source code for Code',exact:true}).inputValue(),/detectNewOrders/);
  await fs.mkdir('outputs/google-automations',{recursive:true});
  await page.screenshot({path:'outputs/google-automations/registry-source-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const bounds=await page.getByRole('heading',{name:'Google Automations',exact:true}).boundingBox();
  assert.ok(bounds && bounds.x>=0 && bounds.x+bounds.width<=390,'Page content must remain visible beside navigation on mobile');
  await page.screenshot({path:'outputs/google-automations/registry-source-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile layout must not overflow horizontally');
  assert.equal(googlePostCount,0);
  await page.setViewportSize({width:1500,height:1000});
  fixtureMode=true;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/Isolated source-editor test/}).click();
  await page.getByRole('button',{name:'Source',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Source code for Code',exact:true});
  await editor.fill('function isolatedTool() { return "after"; }');
  await page.getByRole('textbox',{name:'Change reason',exact:true}).fill('Verify the isolated source editor');
  await page.getByRole('button',{name:'Save draft and review',exact:true}).click();
  await page.getByRole('heading',{name:'Proposed source',exact:true}).waitFor();
  assert.equal(fixtureChanges[0].status,'draft');assert.match(fixtureFiles[0].source,/before/);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'outputs/google-automations/draft-review-desktop.png',fullPage:true});
  const apply=page.getByRole('button',{name:'Apply to Google',exact:true});
  assert.equal(await apply.isDisabled(),true);
  await page.getByRole('checkbox').check();await apply.click();
  await page.getByRole('status').filter({hasText:/Source applied to Google/}).waitFor();
  assert.match(fixtureFiles[0].source,/after/);
  await page.getByRole('button',{name:'Change history',exact:true}).click();
  await page.getByRole('button',{name:'Prepare restoration draft',exact:true}).click();
  await page.getByRole('heading',{name:'Proposed source',exact:true}).waitFor();
  assert.match(fixtureChanges[0].after[0].source,/before/);assert.match(fixtureFiles[0].source,/after/);
  assert.deepEqual(fixtureActions,['draft','publish','restore']);
  fixtureReadOnly=true;
  await page.evaluate(({token,userId})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user_data',JSON.stringify({id:userId,email:'isolated-ui@example.com',fullName:'Isolated Training Provider',role:'trainingProvider',roles:['trainingProvider']}));},{token,userId});
  await page.goto(base+'/?view=googleAutomations',{waitUntil:'domcontentloaded'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/Isolated source-editor test/}).click();
  await page.getByRole('button',{name:'Source',exact:true}).click();
  await editor.waitFor();assert.equal(await editor.getAttribute('readonly'),'');
  assert.equal(await page.getByRole('button',{name:'Save draft and review',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Discover projects',exact:true}).count(),0);
  const roles=new Pool({host:'127.0.0.1',port:15447,database:'google_automation_test',user:'postgres',password:'isolated-only'});
  try{
    await roles.query('UPDATE user_role_map SET role=$2 WHERE user_id=$1',[userId,'Training Provider']);
    const denied=await page.request.post(base+'/api/admin/google-automations',{headers:{Authorization:`Bearer ${token}`},data:{action:'publish'}});
    assert.equal(denied.status(),403,'Backend must deny Training Provider publication');
  }finally{await roles.query('UPDATE user_role_map SET role=$2 WHERE user_id=$1',[userId,'Admin']);await roles.end();}
  assert.deepEqual(errors,[]);
  console.log('UI passed: live registry/connection/source reads, visible desktop/mobile layout, synthetic draft/review/apply/restoration, read-only Training Provider UI, backend role enforcement, and no production Google mutations.');
}catch(error){await page.screenshot({path:'outputs/google-automations/ui-failure.png',fullPage:true}).catch(()=>{});console.error('UI page errors:',errors);throw error;}finally{await browser.close();}
