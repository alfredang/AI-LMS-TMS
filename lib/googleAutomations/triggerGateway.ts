import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AutomationError } from './model';
import type { TriggerBridgeConfig } from './config';

export type RemoteTrigger = {id:string;handler:string;eventType:string;sourceId:string|null;settings?:unknown};
export interface TriggerGateway { call(action:'list'|'change',details?:Record<string,unknown>):Promise<{triggers:RemoteTrigger[];triggerId?:string|null}> }
export function triggerGateway(bridge:TriggerBridgeConfig,scriptId:string,owner:string,transport:typeof fetch=fetch):TriggerGateway {
  let url:URL;
  try {url=new URL(bridge.url);}catch{throw new AutomationError(503,'The trigger connection URL is invalid.');}
  if(url.origin!=='https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.username || Buffer.from(bridge.secret||'','base64').length!==32)throw new AutomationError(503,'The trigger connection requires a Google web-app URL and a 32-byte signing key.');
  const key=Buffer.from(bridge.secret,'base64');
  const sign=(s:string)=>createHmac('sha256',key).update(s).digest('hex');
  return {async call(action,details={}) {
    const requestId=randomUUID();
    const payload=JSON.stringify({...details,version:1,scriptId,owner,action,requestId,timestamp:Date.now()});
    try {
      const response=await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature:sign(payload)}),signal:AbortSignal.timeout(25000),redirect:'follow'});
      if(!response.ok || Number(response.headers.get('content-length'))>1000000)throw new Error('response');
      const raw=await response.text();if(raw.length>1000000)throw new Error('size');
      const envelope=JSON.parse(raw);
      if(typeof envelope.payload!=='string' || typeof envelope.signature!=='string' || !/^[a-f0-9]{64}$/.test(envelope.signature))throw new Error('signature');
      if(!timingSafeEqual(Buffer.from(sign(envelope.payload),'hex'),Buffer.from(envelope.signature,'hex')))throw new Error('signature');
      const data=JSON.parse(envelope.payload);
      if(data.requestId!==requestId || data.scriptId!==scriptId || data.owner!==owner || data.ok!==true || !Array.isArray(data.triggers))throw new Error('identity');
      if(data.triggers.length>100 || data.triggers.some((t:any)=>typeof t.id!=='string'||typeof t.handler!=='string'||typeof t.eventType!=='string'))throw new Error('inventory');
      return data;
    }catch{throw new AutomationError(503,'The Google trigger helper could not verify this request. Check its deployment, owner authorization and signing key. If a change was attempted, inspect Google before trying again.');}
  }};
}
