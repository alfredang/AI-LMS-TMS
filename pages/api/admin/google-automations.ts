import type { NextApiResponse } from 'next';
import { withAuth } from '@lib/auth/withAuth';
import { connectionId, readConfig } from '@lib/googleAutomations/config';
import { AutomationError, assertScriptId, capabilities } from '@lib/googleAutomations/model';
import { googleGateway } from '@lib/googleAutomations/google';
import { PgAutomationStore } from '@lib/googleAutomations/store';
import { AutomationService } from '@lib/googleAutomations/service';
import { TriggerService } from '@lib/googleAutomations/triggers';
import { connectionStorageAvailable,normalizeImportedConnection,saveInitialConnection } from '@lib/googleAutomations/connectionStore';
import { withAutomationAgent, type AutomationRequest } from '@lib/googleAutomations/agentAuth';
import { agentAllowsProject, assertAgentOperation, parseAgentConfiguration } from '@lib/googleAutomations/agentAccess';
import { AutomationInspection } from '@lib/googleAutomations/inspection';
import { AutomationAgentStore } from '@lib/googleAutomations/agentStore';

export const config = { api: { bodyParser: { sizeLimit: '5mb' }, responseLimit: '12mb' } };
const str = (v: unknown, max: number) => {
  if (typeof v !== 'string' || v.length > max) throw new AutomationError(400,'Invalid registry metadata.');
  return v.trim();
};
const uuid = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)) throw new AutomationError(400,'Invalid draft ID.');
  return v;
};
async function handler(req: AutomationRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control','no-store, private');
  if (!['GET','POST'].includes(req.method || '')) { res.setHeader('Allow','GET, POST'); return res.status(405).json({success:false,error:'Method not allowed'}); }
  const user = req.authUser!;
  const agent=req.automationAgent;
  const access = agent?{canView:true,canEdit:agent.scopes.includes('draft'),canPublish:agent.scopes.includes('publish')}:capabilities(user.roles,user.isService);
  if (!access.canView) return res.status(403).json({success:false,error:'Google Automations requires an Admin, Developer or Training Provider session.'});
  try {
    const action = req.method === 'POST' ? req.body?.action : '';
    if(agent)assertAgentOperation(agent,req.method!,req.method==='GET'?String(req.query.view||'registry'):action,req.method==='GET'?req.query.scriptId:req.body?.scriptId);
    const connection = await readConfig();
    if(agent&&connection&&agent.accountEmail!==connection.accountEmail)throw new AutomationError(403,'This agent credential belongs to another Google connection.');
    if(req.method==='GET'&&req.query.view==='setup')return res.json({success:true,configured:!!connection,storageAvailable:connectionStorageAvailable(),canConfigure:access.canEdit&&!connection&&process.env.GOOGLE_AUTOMATIONS_ENABLED!=='false'});
    if(req.method==='POST'&&action==='configure') {
      if(!access.canEdit)throw new AutomationError(403,'Installing a connection requires an Admin or Developer session.');
      if(process.env.GOOGLE_AUTOMATIONS_ENABLED==='false')throw new AutomationError(403,'Google Automations is disabled on this server.');
      if(connection)throw new AutomationError(409,'A Google connection is already installed; setup cannot replace it.');
      if(!connectionStorageAvailable())throw new AutomationError(503,'The existing server encryption secret is unavailable. Ask the server administrator to configure it.');
      const candidate=normalizeImportedConnection(req.body?.connection);
      if(req.body?.confirmAccount!==candidate.accountEmail)throw new AutomationError(400,'Confirm the Google account before installing this connection.');
      await googleGateway(candidate).identity();
      const {default:pool}=await import('@lib/db');
      await saveInitialConnection(pool,candidate,user.id);
      return res.json({success:true,accountEmail:candidate.accountEmail});
    }
    if (!connection) {
      if (req.method === 'GET' && !req.query.view) return res.json({success:true,enabled:false,projects:[],capabilities:{...access,canPublish:false},connection:{configured:false},message:'Configure the dedicated Google Automations server connection to register and inspect projects.'});
      throw new AutomationError(503,'Google Automations is not configured on this TMS server.');
    }
    const canPublish = access.canPublish && connection.allowPublish;
    if (req.method === 'POST' && ((!agent&&!access.canEdit) || (action === 'publish' && !canPublish))) throw new AutomationError(403,action === 'publish' ? 'Publishing is not permitted for this account or server.' : 'Editing requires an Admin or Developer session.');
    const { default: pool } = await import('@lib/db');
    const store = new PgAutomationStore(pool,connectionId(connection));
    await store.init();
    for (const p of connection.projects) { assertScriptId(p.scriptId); await store.register(p); }
    if((req.method==='GET'&&req.query.view==='agentAccess')||(req.method==='POST'&&['installAgentGrant','revokeAgentGrant'].includes(action))){
      if(agent||!access.canEdit)throw new AutomationError(403,'Managing agent access requires a human Admin or Developer session.');
      const grants=new AutomationAgentStore(pool,connectionId(connection),connection.accountEmail);
      await grants.init();
      if(req.method==='GET'){
        const runtimeGrants=parseAgentConfiguration(process.env.GOOGLE_AUTOMATIONS_AGENT_KEYS_JSON||'[]').filter(g=>g.accountEmail===connection.accountEmail).map(({tokenSha256,...grant})=>grant);
        return res.json({success:true,grants:await grants.list(),runtimeGrants,syncServerDisabled:process.env.GOOGLE_AUTOMATIONS_SYNC_ENABLED==='false'});
      }
      const list=action==='installAgentGrant'?await grants.install(req.body.grant,user.id,req.body.acknowledged,canPublish):await grants.revoke(req.body.id,user.id);
      return res.json({success:true,grants:list});
    }
    const gateway = googleGateway(connection);
    const service = new AutomationService(store,gateway,connection.encryptionKey);
    const inspection=new AutomationInspection(store,service,connection.encryptionKey);
    const allowed=(id:string)=>!agent||agentAllowsProject(agent,id);
    const refresh=async(id:string)=>{try{return await service.source(id);}catch(error){await store.sourceFailure(id).catch(()=>{});throw error;}};
    if (req.method === 'GET' && !req.query.view) return res.json({success:true,enabled:true,projects:(await store.projects()).filter(p=>allowed(p.scriptId)),capabilities:{...access,canPublish},connection:{configured:true,accountEmail:connection.accountEmail}});
    if(req.method==='GET'&&req.query.view==='coverage')return res.json({success:true,...await inspection.coverage(allowed)});
    if(req.method==='GET'&&req.query.view==='search')return res.json({success:true,...await inspection.search(req.query.q,allowed)});
    if (req.method === 'GET' && req.query.view === 'connection') {
      const accountEmail = await gateway.identity();
      return res.json({success:true,accountEmail,scope:'script.projects',checkedAt:new Date().toISOString()});
    }
    if (req.method === 'POST' && action === 'discover') {
      await gateway.identity();
      const found = await gateway.list();
      for (const p of found) await store.register(p);
      return res.json({success:true,projects:await store.projects(),discovered:found.length});
    }
    const scriptId = req.method === 'GET' ? req.query.scriptId : req.body?.scriptId;
    assertScriptId(scriptId);
    if (req.method === 'POST' && action === 'register') {
      await gateway.identity();
      await store.register(await gateway.metadata(scriptId));
      return res.json({success:true,projects:await store.projects()});
    }
    await store.project(scriptId);
    if ((req.method==='GET'&&req.query.view==='triggers') || (req.method==='POST'&&['triggerDraft','triggerApply'].includes(action))) {
      const triggers=new TriggerService(pool,connectionId(connection),connection);
      await triggers.init();
      if(req.method==='GET')return res.json({success:true,...await triggers.view(scriptId,access.canEdit)});
      if(action==='triggerDraft')return res.json({success:true,...await triggers.draft(scriptId,req.body.triggerKey,req.body.settings,req.body.reason,user.id)});
      return res.json({success:true,...await triggers.apply(scriptId,uuid(req.body.draftId),user.id,req.body.acknowledged)});
    }
    if (req.method === 'GET') {
      if (req.query.view === 'source') { await gateway.identity(); return res.json({success:true,...await refresh(scriptId)}); }
      if(req.query.view==='storedSource')return res.json({success:true,...await service.storedSource(scriptId)});
      if(req.query.view==='sourceRevisions')return res.json({success:true,revisions:await store.revisions(scriptId)});
      if(req.query.view==='sourceRevision')return res.json({success:true,...await inspection.revision(scriptId,uuid(req.query.revisionId))});
      if (req.query.view === 'history') return res.json({success:true,history:await store.history(scriptId)});
      if (req.query.view === 'draft') return res.json({success:true,draft:await service.review(scriptId,uuid(req.query.draftId))});
    } else {
      if(action==='refresh'){await gateway.identity();return res.json({success:true,...await refresh(scriptId)});}
      if (action === 'metadata') {
        const p=req.body;
        await store.metadata(scriptId,{purpose:str(p.purpose,4000),category:str(p.category,100),schedule:str(p.schedule,1000),dependencies:str(p.dependencies,4000)});
        return res.json({success:true,projects:await store.projects()});
      }
      if (['draft','restore','publish'].includes(action)) await gateway.identity();
      if (action === 'draft') return res.json({success:true,draft:await service.draft(scriptId,req.body.baseHash,req.body.files,req.body.reason,user.id)});
      if (action === 'restore') return res.json({success:true,draft:await service.restore(scriptId,uuid(req.body.draftId),req.body.reason,user.id)});
      if (action === 'publish') return res.json({success:true,...await service.publish(scriptId,uuid(req.body.draftId),user.id,req.body.acknowledged)});
    }
    throw new AutomationError(400,'Unsupported Google Automation action.');
  } catch(error: any) {
    // Google errors can contain request headers/source/credentials. Never return
    // or log the raw SDK error, URL, response body or request configuration.
    if (error instanceof AutomationError) return res.status(error.status).json({success:false,error:error.message});
    const code=Number(error?.response?.status || error?.code);
    const message=code===401 || code===403 ? 'Google denied access. Check the connected account, project permissions and OAuth grant.' : code===404 ? 'Google could not find this script project.' : 'Google Automations could not complete this request. Check the connection and registry database.';
    return res.status(code===401 || code===403 ? 403 : code===404 ? 404 : 503).json({success:false,error:message});
  }
}
export default withAutomationAgent(handler,withAuth(handler,{roles:['admin','developer','trainingProvider']}));
