import { AutomationError, normalizeFiles, publicFiles, sourceHash, unseal, type ScriptFile } from './model';
import type { PgAutomationStore } from './store';
import type { AutomationService } from './service';

export type ProjectScope = (scriptId: string) => boolean;
export class AutomationInspection {
  constructor(private store: PgAutomationStore, private service: AutomationService, private key: string) {}
  async revision(scriptId: string, revisionId: string) {
    const row=await this.store.revision(scriptId,revisionId);
    const files=normalizeFiles(unseal<ScriptFile[]>(row.source_ciphertext,this.key));
    if(sourceHash(files)!==row.hash)throw new AutomationError(503,'Source revision integrity check failed.');
    return {id:row.id,hash:row.hash,capturedAt:row.capturedAt,files:publicFiles(files),origin:'database',currentGoogleVerified:false};
  }
  async coverage(allowed: ProjectScope = ()=>true) {
    const projects=(await this.store.projects()).filter(p=>allowed(p.scriptId));
    return {total:projects.length,stored:projects.filter(p=>p.hasStoredSource).length,missing:projects.filter(p=>!p.hasStoredSource).map(p=>({scriptId:p.scriptId,name:p.name})),projects};
  }
  async search(query: unknown, allowed: ProjectScope = ()=>true) {
    if(typeof query!=='string'||query.trim().length<2||query.length>200)throw new AutomationError(400,'Search text must contain 2–200 characters.');
    const needle=query.trim().toLowerCase();
    const projects=(await this.store.projects()).filter(p=>allowed(p.scriptId));
    const matches: {scriptId:string;project:string;file:string;line:number;text:string;hash:string|null;refreshedAt:string|null}[]=[];
    const missing: string[]=[];
    let scanned=0;
    for(const project of projects){
      if(!project.hasStoredSource){missing.push(project.scriptId);continue;}
      const saved=await this.service.storedSource(project.scriptId);scanned++;
      // Search only redacted source, never unmasked inline secrets.
      for(const file of saved.files){
        for(const [index,line] of file.source.split(/\r?\n/).entries()){
          const position=line.toLowerCase().indexOf(needle);
          if(position<0)continue;
          const start=Math.max(0,position-100);
          matches.push({scriptId:project.scriptId,project:project.name,file:file.name,line:index+1,text:line.slice(start,start+320),hash:saved.hash,refreshedAt:saved.refreshedAt});
          if(matches.length>=100)return {matches,scannedProjects:scanned,missingSource:missing,truncated:true,origin:'database'};
        }
      }
    }
    return {matches,scannedProjects:scanned,missingSource:missing,truncated:false,origin:'database'};
  }
}
