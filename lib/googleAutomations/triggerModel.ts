export type TriggerSchedule = {kind:'minutes'|'hours';every:number} | {kind:'daily';hour:number;timezone:string} | {kind:'spreadsheetChange'};
export type TriggerSettings = {enabled:boolean;schedule:TriggerSchedule};
export type TriggerSeed = {
  scriptId:string;handler:string;eventType:'CLOCK'|'ON_CHANGE';owner:string;
  observedAt:string;schedule:TriggerSchedule;googleTriggerId?:string;sourceId?:string;
  errorRate?:string;
};
export type TriggerRow = TriggerSeed & {
  key:string;liveId:string|null;settings:TriggerSettings;baseline:TriggerSettings;
  evidence:'google_ui'|'google_api';localReview:boolean;updatedAt?:string;
};
export type TriggerChange = {id:string;trigger_key:string;actor_id:string;reason:string;before:TriggerSettings;after:TriggerSettings;status:string;created_at:string;applied_at:string|null;applied_by:string|null};
export type TriggerView = {rows:TriggerRow[];history:TriggerChange[];mode:'local_review'|'connected'|'not_connected';canEdit:boolean;canApply:boolean;checkedAt:string|null;owner:string};
export function scheduleLabel(s:TriggerSchedule) {
  if(s.kind==='minutes')return `Every ${s.every===1?'minute':`${s.every} minutes`}`;
  if(s.kind==='hours')return `Every ${s.every===1?'hour':`${s.every} hours`}`;
  if(s.kind==='spreadsheetChange')return 'Spreadsheet · On change';
  if(s.kind==='daily')return `Daily, ${String(s.hour).padStart(2,'0')}:00–${String((s.hour+1)%24).padStart(2,'0')}:00 (${s.timezone})`;
  return 'Unsupported schedule';
}
export function validTriggerSettings(value:unknown):value is TriggerSettings {
  const v=value as TriggerSettings;
  if(!v || typeof v.enabled!=='boolean' || !v.schedule)return false;
  const s=v.schedule;
  if(s.kind==='minutes')return [1,5,10,15,30].includes(s.every);
  if(s.kind==='hours')return [1,2,4,6,8,12].includes(s.every);
  if(s.kind==='spreadsheetChange')return true;
  if(s.kind==='daily' && Number.isInteger(s.hour) && s.hour>=0 && s.hour<24 && typeof s.timezone==='string' && s.timezone.length<=100) {
    try {new Intl.DateTimeFormat('en',{timeZone:s.timezone});return true;}catch{return false;}
  }
  return false;
}
