import type { NextApiResponse } from 'next';
import { withAuth, type AuthedApiRequest } from '@lib/auth/withAuth';
import { connectionId, readConfig } from '@lib/googleAutomations/config';
import { AutomationError, assertScriptId, capabilities } from '@lib/googleAutomations/model';
import { googleGateway } from '@lib/googleAutomations/google';
import { PgAutomationStore } from '@lib/googleAutomations/store';
import { AutomationService } from '@lib/googleAutomations/service';
import { TriggerService } from '@lib/googleAutomations/triggers';

export const config = { api: { bodyParser: { sizeLimit: '5mb' }, responseLimit: '12mb' } };
const str = (v: unknown, max: number) => {
  if (typeof v !== 'string' || v.length > max) throw new AutomationError(400,'Invalid registry metadata.');
  return v.trim();
};
const uuid = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)) throw new AutomationError(400,'Invalid draft ID.');
  return v;
};
async function handler(req: AuthedApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control','no-store, private');
  if (!['GET','POST'].includes(req.method || '')) { res.setHeader('Allow','GET, POST'); return res.status(405).json({success:false,error:'Method not allowed'}); }
  const user = req.authUser!;
  const access = capabilities(user.roles,user.isService);
  if (!access.canView) return res.status(403).json({success:false,error:'Google Automations requires an Admin, Developer or Training Provider session.'});
  try {
    const connection = await readConfig();
    if (!connection) {
      if (req.method === 'GET' && !req.query.view) return res.json({success:true,enabled:false,projects:[],capabilities:{...access,canPublish:false},connection:{configured:false},message:'Configure the dedicated Google Automations server connection to register and inspect projects.'});
      throw new AutomationError(503,'Google Automations is not configured on this TMS server.');
    }
    const canPublish = access.canPublish && connection.allowPublish;
    const action = req.method === 'POST' ? req.body?.action : '';
    if (req.method === 'POST' && (!access.canEdit || (action === 'publish' && !canPublish))) throw new AutomationError(403,action === 'publish' ? 'Publishing is not permitted for this account or server.' : 'Editing requires an Admin or Developer session.');
    const { default: pool } = await import('@lib/db');
    const store = new PgAutomationStore(pool,connectionId(connection));
    await store.init();
    for (const p of connection.projects) { assertScriptId(p.scriptId); await store.register(p); }
    const gateway = googleGateway(connection);
    const service = new AutomationService(store,gateway,connection.encryptionKey);
    if (req.method === 'GET' && !req.query.view) return res.json({success:true,enabled:true,projects:await store.projects(),capabilities:{...access,canPublish},connection:{configured:true,accountEmail:connection.accountEmail}});
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
      if (req.query.view === 'source') { await gateway.identity(); return res.json({success:true,...await service.source(scriptId)}); }
      if (req.query.view === 'history') return res.json({success:true,history:await store.history(scriptId)});
      if (req.query.view === 'draft') return res.json({success:true,draft:await service.review(scriptId,uuid(req.query.draftId))});
    } else {
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
export default withAuth(handler,{roles:['admin','developer','trainingProvider']});
