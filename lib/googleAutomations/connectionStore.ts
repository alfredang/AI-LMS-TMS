import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { AutomationConfig } from './config';
import { AutomationError, assertScriptId, seal, unseal } from './model';
import { validTriggerSettings } from './triggerModel';

export const CONNECTION_SCHEMA=`CREATE TABLE IF NOT EXISTS google_automation_connection (
 singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton),config_ciphertext TEXT NOT NULL,
 configured_by TEXT NOT NULL,configured_at TIMESTAMPTZ NOT NULL DEFAULT now());`;
function storageKey() {
  // Use the established server encryption secret, with a distinct derivation.
  // Never fall back to a public value, a machine API key, or a database-held key.
  const secret=process.env.AI_OAUTH_ENCRYPTION_KEY||process.env.JWT_SECRET;
  if(!secret||secret.length<32)throw new AutomationError(503,'The server needs its existing AI OAuth encryption key or JWT secret (at least 32 characters) to store this connection securely.');
  return createHash('sha256').update('google-automations-connection-v1\0').update(secret).digest('base64');
}
export function connectionStorageAvailable(){try{storageKey();return true;}catch{return false;}}
async function init(pool:Pool){
  if((await pool.query("SELECT to_regclass('public.google_automation_connection') AS name")).rows[0]?.name)return;
  const client=await pool.connect();
  try{await client.query("SELECT pg_advisory_lock(hashtext('google-automation-connection-schema-v1'))");await client.query(CONNECTION_SCHEMA);}
  finally{await client.query("SELECT pg_advisory_unlock(hashtext('google-automation-connection-schema-v1'))").catch(()=>{});client.release();}
}
export function normalizeImportedConnection(input:unknown):AutomationConfig {
  const c=input as AutomationConfig;
  if(!c||typeof c!=='object'||typeof c.accountEmail!=='string'||!/^[^\s@]+@[^\s@]+$/.test(c.accountEmail)||Buffer.from(c.encryptionKey||'','base64').length!==32)throw new AutomationError(400,'Choose the dedicated Google Automations connection JSON with its backup encryption key.');
  const credentials=c.credentials;
  if(!credentials||['client_id','client_secret','refresh_token'].some(k=>typeof (credentials as any)[k]!=='string'||!(credentials as any)[k]||(credentials as any)[k].length>10000))throw new AutomationError(400,'The connection JSON needs the dedicated OAuth client and authorized refresh token.');
  if(!Array.isArray(c.projects)||c.projects.length>1000)throw new AutomationError(400,'Invalid Google project inventory.');
  const text=(v:unknown,max:number,fallback='')=>{if(v==null)return fallback;if(typeof v!=='string'||v.length>max)throw new AutomationError(400,'Invalid connection metadata.');return v;};
  const projects=c.projects.map(p=>{assertScriptId(p.scriptId);return {scriptId:p.scriptId,name:text(p.name,200),purpose:text(p.purpose,4000),category:text(p.category,100,'Unclassified'),schedule:text(p.schedule,1000,'Not verified'),dependencies:text(p.dependencies,4000)};});
  const accountEmail=c.accountEmail.toLowerCase();
  const seeds=c.triggerManagement?.inventory||[];
  if(!Array.isArray(seeds)||seeds.length>500)throw new AutomationError(400,'Invalid trigger inventory.');
  const inventory=seeds.map(t=>{
    assertScriptId(t.scriptId);
    if(t.owner!==accountEmail||typeof t.handler!=='string'||!/^[A-Za-z_$][\w$]{0,199}$/.test(t.handler)||!['CLOCK','ON_CHANGE'].includes(t.eventType)||!validTriggerSettings({enabled:true,schedule:t.schedule})||!Number.isFinite(Date.parse(t.observedAt))||(t.eventType==='ON_CHANGE')!==(t.schedule.kind==='spreadsheetChange')||!projects.some(p=>p.scriptId===t.scriptId))throw new AutomationError(400,'Invalid owner-scoped trigger inventory.');
    return {scriptId:t.scriptId,handler:t.handler,eventType:t.eventType,owner:accountEmail,observedAt:t.observedAt,schedule:t.schedule};
  });
  // No review logins, local database passwords, helper keys or live-trigger
  // enablement are accepted through this bootstrap action.
  return {enabled:true,allowPublish:c.allowPublish===true,accountEmail,encryptionKey:c.encryptionKey,credentials:{client_id:credentials.client_id,client_secret:credentials.client_secret,refresh_token:credentials.refresh_token},projects,triggerManagement:{reviewOnly:false,allowApply:false,inventory,bridges:{}}};
}
export async function loadStoredConnection(pool:Pool):Promise<AutomationConfig|null> {
  await init(pool);
  const row=(await pool.query('SELECT config_ciphertext FROM google_automation_connection WHERE singleton=true')).rows[0];
  if(!row)return null;
  try{return unseal<AutomationConfig>(row.config_ciphertext,storageKey());}
  catch(error){if(error instanceof AutomationError)throw error;throw new AutomationError(503,'The stored Google connection cannot be decrypted. Restore the server encryption key; do not replace the connection or backup key.');}
}
export async function saveInitialConnection(pool:Pool,connection:AutomationConfig,actor:string) {
  const ciphertext=seal(connection,storageKey());
  await init(pool);
  const saved=await pool.query(`INSERT INTO google_automation_connection(singleton,config_ciphertext,configured_by) VALUES(true,$1,$2) ON CONFLICT(singleton) DO NOTHING RETURNING singleton`,[ciphertext,actor]);
  if(!saved.rowCount)throw new AutomationError(409,'A Google connection is already installed. This setup action cannot overwrite its credentials or backup key.');
}
