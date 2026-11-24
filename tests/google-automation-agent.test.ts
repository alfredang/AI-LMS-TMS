import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { authenticateAutomationAgent, assertAgentOperation, agentAllowsProject } from '../lib/googleAutomations/agentAccess';
import { withAutomationAgent } from '../lib/googleAutomations/agentAuth';

const token=randomBytes(32).toString('base64url');
const project='synthetic-agent-allowed-project';
const entry={id:'inspection',tokenSha256:createHash('sha256').update(token).digest('hex'),accountEmail:'owner@example.test',
  scopes:['read','refresh','draft'],scriptIds:[project],expiresAt:'2099-01-01T00:00:00Z'};
const configuration=JSON.stringify([entry]);

test('dedicated agent credentials are hashed, expiring, account bound and fail closed',()=>{
  const agent=authenticateAutomationAgent(token,configuration);
  assert.equal(agent.id,'inspection');assert.equal(agent.accountEmail,'owner@example.test');
  assert.doesNotMatch(JSON.stringify(agent),new RegExp(token+'|'+entry.tokenSha256));
  assert.throws(()=>authenticateAutomationAgent('wrong'.repeat(10),configuration),/Invalid or expired/);
  assert.throws(()=>authenticateAutomationAgent(token,configuration,Date.parse('2100-01-01')),/expired/);
  assert.throws(()=>authenticateAutomationAgent(token,'not-json'),/not configured/);
  assert.throws(()=>authenticateAutomationAgent(token,JSON.stringify([{...entry,scopes:['read','admin']}])) ,/not configured/);
  assert.throws(()=>authenticateAutomationAgent(token,JSON.stringify([entry,entry])),/not configured/);
  assert.throws(()=>authenticateAutomationAgent(token,JSON.stringify([{...entry,scriptIds:[]}])) ,/not configured/);
  assert.throws(()=>authenticateAutomationAgent(token,JSON.stringify([{...entry,scopes:['publish']}])) ,/not configured/);
});

test('agents cannot escalate from read/draft to publishing, triggers, setup, discovery or other projects',()=>{
  const agent=authenticateAutomationAgent(token,configuration);
  for(const view of ['registry','coverage','search'])assertAgentOperation(agent,'GET',view);
  for(const view of ['storedSource','sourceRevisions','sourceRevision','history','draft'])assertAgentOperation(agent,'GET',view,project);
  assertAgentOperation(agent,'POST','refresh',project);assertAgentOperation(agent,'POST','draft',project);assertAgentOperation(agent,'POST','restore',project);
  for(const action of ['publish','triggerApply','triggerDraft','configure','discover','metadata'])assert.throws(()=>assertAgentOperation(agent,'POST',action,project),/not allowed/);
  assert.throws(()=>assertAgentOperation(agent,'GET','triggers',project),/not allowed/);
  assert.throws(()=>assertAgentOperation(agent,'GET','storedSource','another-synthetic-project'),/outside/);
  const readOnly={...agent,scopes:['read'] as const};
  assert.throws(()=>assertAgentOperation({...readOnly,scopes:[...readOnly.scopes]},'GET','source',project),/not allowed/);
  assert.equal(agentAllowsProject(agent,'another-synthetic-project'),false);
  assert.equal(agentAllowsProject({...agent,scriptIds:['*']},'another-synthetic-project'),true);
  assertAgentOperation({...agent,scopes:['read','publish']},'POST','publish',project);
});

test('invalid dedicated credentials never fall through to human or generic machine authentication',async()=>{
  const previous=process.env.GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON;
  process.env.GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON=configuration;
  let agentCalls=0,humanCalls=0,actor='';
  const handler=withAutomationAgent(async(req:any,res:any)=>{agentCalls++;actor=req.authUser.id;return res.json({success:true});},async(_req:any,res:any)=>{humanCalls++;return res.json({human:true});});
  const response=()=>({statusCode:200,body:null as any,setHeader(){},status(value:number){this.statusCode=value;return this;},json(value:any){this.body=value;return this;}});
  try{
    let res=response();await handler({headers:{'x-google-automation-key':token}} as any,res as any);
    assert.equal(res.statusCode,200);assert.equal(actor,'agent:inspection');assert.equal(agentCalls,1);assert.equal(humanCalls,0);
    res=response();await handler({headers:{'x-google-automation-key':'invalid','x-api-key':'generic-key'}} as any,res as any);
    assert.equal(res.statusCode,401);assert.equal(agentCalls,1);assert.equal(humanCalls,0);
    res=response();await handler({headers:{authorization:'Bearer human-session'}} as any,res as any);
    assert.equal(humanCalls,1);
  }finally{if(previous===undefined)delete process.env.GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON;else process.env.GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON=previous;}
});
