import type { Pool } from 'pg';
import { connectionId, type AutomationConfig } from './config';
import { googleGateway, type ScriptGateway } from './google';
import { PgAutomationStore } from './store';
import { AutomationService } from './service';

export async function syncGoogleAutomationSources(pool:Pool,connection:AutomationConfig,gateway:ScriptGateway=googleGateway(connection)) {
  const store=new PgAutomationStore(pool,connectionId(connection));
  await store.init();
  for(const project of connection.projects)await store.register(project);
  // One account/scope check before all reads. No Google write or business function is called.
  await gateway.identity();
  // Drive exposes standalone projects only; container-bound projects still need registration by ID.
  const discovered=await gateway.list();
  for(const project of discovered)await store.register(project);
  const service=new AutomationService(store,gateway,connection.encryptionKey);
  const results: {scriptId:string;name:string;success:boolean;hash?:string}[]=[];
  for(const project of await store.projects()){
    try{
      const source=await service.source(project.scriptId);
      results.push({scriptId:project.scriptId,name:project.name,success:true,hash:source.hash});
    }catch{
      await store.sourceFailure(project.scriptId);
      results.push({scriptId:project.scriptId,name:project.name,success:false});
    }
  }
  return {success:results.every(r=>r.success),checkedAt:new Date().toISOString(),discovered:discovered.length,total:results.length,refreshed:results.filter(r=>r.success).length,results};
}
