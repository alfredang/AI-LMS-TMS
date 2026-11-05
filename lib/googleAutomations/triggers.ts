import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AutomationConfig } from './config';
import { AutomationError } from './model';
import { triggerGateway, type TriggerGateway } from './triggerGateway';
import { validTriggerSettings, type TriggerChange, type TriggerRow, type TriggerSettings, type TriggerView } from './triggerModel';

export const TRIGGER_SCHEMA=`CREATE TABLE IF NOT EXISTS google_automation_trigger_change (
 id UUID PRIMARY KEY,connection_id TEXT NOT NULL,script_id TEXT NOT NULL,trigger_key TEXT NOT NULL,
 actor_id TEXT NOT NULL,reason TEXT NOT NULL,before JSONB NOT NULL,after JSONB NOT NULL,context JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),applied_at TIMESTAMPTZ,applied_by TEXT,
 FOREIGN KEY(connection_id,script_id) REFERENCES google_automation_project(connection_id,script_id));
 ALTER TABLE google_automation_trigger_change ADD COLUMN IF NOT EXISTS applied_by TEXT;
 CREATE INDEX IF NOT EXISTS google_automation_trigger_change_project_idx ON google_automation_trigger_change(connection_id,script_id,created_at DESC);`;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function triggerReviewOnly(config:AutomationConfig,databaseUrl=process.env.DATABASE_URL) {
  if(config.triggerManagement?.reviewOnly!==true)return false;
  let db:URL;try{db=new URL(databaseUrl||'');}catch{throw new AutomationError(503,'Trigger review requires the isolated localhost review database.');}
  if(config.allowPublish || db.hostname!=='127.0.0.1' || db.port!=='15447' || db.pathname!=='/google_automation_review')throw new AutomationError(503,'Trigger review is restricted to the isolated localhost review database.');
  return true;
}
type Context = {handler:string;eventType:string;sourceId:string|null;liveId:string|null;inventoryHash:string};
export class TriggerService {
  constructor(private pool:Pool,private connection:string,private config:AutomationConfig,private factory=triggerGateway){}
  async init(){
    const client=await this.pool.connect();
    try {await client.query("SELECT pg_advisory_lock(hashtext('google-trigger-schema-v1'))");await client.query(TRIGGER_SCHEMA);}
    finally {await client.query("SELECT pg_advisory_unlock(hashtext('google-trigger-schema-v1'))").catch(()=>{});client.release();}
  }
  private bridge(scriptId:string):TriggerGateway|null {
    const b=this.config.triggerManagement?.bridges?.[scriptId];
    return b?this.factory(b,scriptId,this.config.accountEmail):null;
  }
  async view(scriptId:string,canEdit:boolean,client?:PoolClient):Promise<TriggerView> {
    const review=triggerReviewOnly(this.config);
    const bridge=review?null:this.bridge(scriptId);
    const remote=bridge?await bridge.call('list'):null;
    const inventory=(this.config.triggerManagement?.inventory||[]).filter(t=>t.scriptId===scriptId&&t.owner===this.config.accountEmail);
    const history=(await (client||this.pool).query(`SELECT id,trigger_key,actor_id,reason,before,after,status,created_at,applied_at,applied_by FROM google_automation_trigger_change WHERE connection_id=$1 AND script_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100`,[this.connection,scriptId])).rows as TriggerChange[];
    const states=(await (client||this.pool).query(`SELECT DISTINCT ON (trigger_key) trigger_key,after,status,applied_at FROM google_automation_trigger_change WHERE connection_id=$1 AND script_id=$2 AND status IN ('applied','preview_applied') ORDER BY trigger_key,applied_at DESC,id DESC`,[this.connection,scriptId])).rows as TriggerChange[];
    const rows:TriggerRow[]=inventory.map(seed=>{
      const key=hash([scriptId,seed.handler,seed.eventType,seed.sourceId||'']);
      const matches=remote?.triggers.filter(t=>t.handler===seed.handler&&t.eventType===seed.eventType&&(seed.sourceId?t.sourceId===seed.sourceId:true))||[];
      if(matches.length>1)throw new AutomationError(409,'Multiple Google triggers match this handler. Reconcile their IDs before editing from TMS.');
      const live=matches[0];
      const lastApplied=states.find(h=>h.trigger_key===key&&h.status==='applied');
      const baseline={enabled:remote?!!live:true,schedule:live&&validTriggerSettings(live.settings)?live.settings.schedule:remote&&!live&&lastApplied?lastApplied.after.schedule:seed.schedule};
      const preview=review?states.find(h=>h.trigger_key===key&&h.status==='preview_applied'):null;
      return {...seed,key,liveId:live?.id||null,sourceId:live?.sourceId||seed.sourceId,baseline,settings:preview?.after||baseline,evidence:remote?'google_api':'google_ui',localReview:!!preview,updatedAt:preview?.applied_at||undefined};
    });
    return {rows,history,mode:review?'local_review':bridge?'connected':'not_connected',canEdit,canApply:canEdit&&(review||!!bridge&&this.config.triggerManagement?.allowApply===true),checkedAt:remote?new Date().toISOString():null,owner:this.config.accountEmail};
  }
  async draft(scriptId:string,key:unknown,after:unknown,reason:unknown,actor:string) {
    if(typeof key!=='string'||!validTriggerSettings(after))throw new AutomationError(400,'Choose a valid trigger schedule.');
    if(typeof reason!=='string'||reason.trim().length<5||reason.length>2000)throw new AutomationError(400,'Give a trigger change reason between 5 and 2000 characters.');
    const view=await this.view(scriptId,true);
    const row=view.rows.find(t=>t.key===key);if(!row)throw new AutomationError(404,'This trigger is not registered for this project.');
    if((row.eventType==='ON_CHANGE')!==(after.schedule.kind==='spreadsheetChange'))throw new AutomationError(400,'Keep the trigger event type unchanged.');
    if(hash(row.settings)===hash(after))throw new AutomationError(400,'There are no trigger changes to save.');
    const inventoryHash=hash(view.rows.map(t=>[t.key,t.liveId,t.settings]));
    const context:Context={handler:row.handler,eventType:row.eventType,sourceId:row.sourceId||null,liveId:row.liveId,inventoryHash};
    const id=randomUUID();
    await this.pool.query(`INSERT INTO google_automation_trigger_change(id,connection_id,script_id,trigger_key,actor_id,reason,before,after,context) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,this.connection,scriptId,key,actor,reason.trim(),row.settings,after,context]);
    return this.view(scriptId,true);
  }
  async apply(scriptId:string,id:string,actor:string,acknowledged:unknown) {
    if(acknowledged!==true)throw new AutomationError(400,'Review and acknowledge the trigger change before applying.');
    const client=await this.pool.connect();const lock=`google-trigger:${this.connection}:${scriptId}`;let acquired=false;
    try {
      acquired=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[lock])).rows[0].acquired;
      if(!acquired)throw new AutomationError(409,'Another trigger update is in progress.');
      const d=(await client.query(`SELECT * FROM google_automation_trigger_change WHERE connection_id=$1 AND script_id=$2 AND id=$3`,[this.connection,scriptId,id])).rows[0];
      if(!d)throw new AutomationError(404,'Trigger draft not found.');
      if(['preview_applied','applied'].includes(d.status))return this.view(scriptId,true,client);
      if(d.status!=='draft')throw new AutomationError(409,'This trigger change was already attempted. Inspect Google and reconcile its result before preparing another change.');
      const view=await this.view(scriptId,true,client);
      if(!view.canApply)throw new AutomationError(403,'Live trigger changes require a connected, owner-authorized helper and trigger changes enabled on this server.');
      if(hash(view.rows.map(t=>[t.key,t.liveId,t.settings]))!==d.context.inventoryHash)throw new AutomationError(409,'Trigger settings changed after this draft. Reload and prepare a new draft.');
      const pending=await client.query(`SELECT id FROM google_automation_trigger_change WHERE connection_id=$1 AND script_id=$2 AND status IN ('applying','verification_required') LIMIT 1`,[this.connection,scriptId]);
      if(pending.rows.length)throw new AutomationError(409,'Reconcile the previous uncertain trigger update in Google before making another change.');
      if(view.mode==='local_review') {
        await client.query(`UPDATE google_automation_trigger_change SET status='preview_applied',applied_at=now(),applied_by=$3 WHERE id=$1 AND connection_id=$2`,[id,this.connection,actor]);
      }else{
        const b=this.config.triggerManagement?.bridges?.[scriptId];
        if(!b?.handlers.includes(d.context.handler))throw new AutomationError(403,'This handler is not allowed by the trigger connection.');
        if(d.after.schedule.kind==='spreadsheetChange'&&d.after.enabled&&!d.context.sourceId)throw new AutomationError(400,'The spreadsheet source must be verified by the Google helper first.');
        await client.query(`UPDATE google_automation_trigger_change SET status='applying',applied_by=$3 WHERE id=$1 AND connection_id=$2`,[id,this.connection,actor]);
        try {
          await this.bridge(scriptId)!.call('change',{changeId:id,...d.context,settings:d.after});
          const verified=await this.view(scriptId,true,client);
          const current=verified.rows.find(t=>t.key===d.trigger_key);
          if(!current||current.settings.enabled!==d.after.enabled||(d.after.enabled&&hash(current.settings)!==hash(d.after)))throw new Error('readback');
          await client.query(`UPDATE google_automation_trigger_change SET status='applied',applied_at=now() WHERE id=$1 AND connection_id=$2`,[id,this.connection]);
        }catch{
          await client.query(`UPDATE google_automation_trigger_change SET status='verification_required' WHERE id=$1 AND connection_id=$2`,[id,this.connection]);
          throw new AutomationError(409,'The Google trigger change needs verification. Inspect Google before making another change; TMS will not retry automatically.');
        }
      }
      return this.view(scriptId,true,client);
    }finally{if(acquired)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]).catch(()=>{});client.release();}
  }
}
