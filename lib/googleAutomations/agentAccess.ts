import { createHash, timingSafeEqual } from 'node:crypto';
import { AutomationError, assertScriptId } from './model';

export type AgentScope = 'read' | 'refresh' | 'draft' | 'publish';
export type AutomationAgent = {id:string;accountEmail:string;scopes:AgentScope[];scriptIds:string[];expiresAt:string};
export type ConfiguredAgent = AutomationAgent & {tokenSha256:string};
const scopes: AgentScope[]=['read','refresh','draft','publish'];

export function parseAgentConfiguration(configuration: string): ConfiguredAgent[] {
  let keys: ConfiguredAgent[];
  try {
    keys=JSON.parse(configuration);
    if(!Array.isArray(keys)||keys.length>100)throw new Error();
    const hashes=new Set<string>(),ids=new Set<string>();
    for(const key of keys){
      if(!key||typeof key.id!=='string'||!/^[-\w]{1,64}$/.test(key.id)||ids.has(key.id)||typeof key.accountEmail!=='string'||!/^\S+@\S+\.\S+$/.test(key.accountEmail)||typeof key.tokenSha256!=='string'||!/^([a-f0-9]{64})$/.test(key.tokenSha256)||hashes.has(key.tokenSha256)
        ||!Array.isArray(key.scopes)||!key.scopes.includes('read')||key.scopes.some(s=>!scopes.includes(s))
        ||!Array.isArray(key.scriptIds)||!key.scriptIds.length||key.scriptIds.length>1000||typeof key.expiresAt!=='string'||!Number.isFinite(Date.parse(key.expiresAt)))throw new Error();
      for(const id of key.scriptIds)if(id!=='*')assertScriptId(id);
      hashes.add(key.tokenSha256);ids.add(key.id);
    }
  } catch {throw new AutomationError(503,'Google Automations agent access is not configured correctly.');}
  return keys.map(key=>({id:key.id,tokenSha256:key.tokenSha256,accountEmail:key.accountEmail.toLowerCase(),scopes:[...key.scopes],scriptIds:[...key.scriptIds],expiresAt:new Date(key.expiresAt).toISOString()}));
}
export function authenticateAutomationAgent(token: unknown, configuration=process.env.GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON, now=Date.now()): AutomationAgent {
  if(typeof token!=='string'||token.length<32||token.length>1024)throw new AutomationError(401,'Invalid Google Automations agent credential.');
  const keys=parseAgentConfiguration(configuration||'[]');
  const digest=createHash('sha256').update(token).digest();
  const key=keys.find(k=>timingSafeEqual(digest,Buffer.from(k.tokenSha256,'hex')));
  if(!key||Date.parse(key.expiresAt)<=now)throw new AutomationError(401,'Invalid or expired Google Automations agent credential.');
  const {tokenSha256,...agent}=key;
  return {...agent,accountEmail:agent.accountEmail.toLowerCase()};
}
export function agentAllowsProject(agent: AutomationAgent, id: string) {return agent.scriptIds.includes('*')||agent.scriptIds.includes(id);}

export function assertAgentOperation(agent: AutomationAgent, method: string, operation: string, scriptId?: unknown) {
  const reads=['registry','coverage','search','storedSource','sourceRevisions','sourceRevision','history','draft'];
  const required=method==='GET'&&reads.includes(operation)?'read':method==='GET'&&operation==='source'?'refresh'
    :method==='POST'&&operation==='refresh'?'refresh':method==='POST'&&['draft','restore'].includes(operation)?'draft'
    :method==='POST'&&operation==='publish'?'publish':null;
  if(!required||!agent.scopes.includes(required))throw new AutomationError(403,'This operation is not allowed by the Google Automations agent credential.');
  if(!['registry','coverage','search'].includes(operation)){
    assertScriptId(scriptId);
    if(!agentAllowsProject(agent,scriptId))throw new AutomationError(403,'This Google project is outside the agent credential scope.');
  }
}
