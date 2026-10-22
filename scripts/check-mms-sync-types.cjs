/** Compare branch diagnostics to HEAD without checking out or changing user files. */
const ts=require('typescript');
const cp=require('child_process');
const path=require('path');
const configPath=ts.findConfigFile(process.cwd(),ts.sys.fileExists,'tsconfig.json');
const config=ts.readConfigFile(configPath,ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.dirname(configPath));
const changed=cp.execFileSync('git',['diff','HEAD','--name-only','--diff-filter=M'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>/\.tsx?$/.test(f));
const newFeature=f=>/\/lib\/mmsSync\/|\/tests\/mms-(sync|access)|\/components\/admin\/MmsSync(Control|Overview)\.tsx$|\/pages\/api\/(admin\/mms-(sync|access)|external\/mms-sync)/.test(f.replace(/\\/g,'/'));
function diagnostics(baseline){
  const host=ts.createCompilerHost({...parsed.options,incremental:false});
  if(baseline){
    const originalRead=host.readFile;
    const originals=new Map(changed.map(f=>[path.resolve(f),cp.execFileSync('git',['show',`HEAD:${f}`],{encoding:'utf8'})]));
    host.readFile=f=>originals.has(path.resolve(f))?originals.get(path.resolve(f)):originalRead(f);
  }
  const program=ts.createProgram(parsed.fileNames.filter(f=>!baseline||!newFeature(f)),{...parsed.options,incremental:false},host);
  return ts.getPreEmitDiagnostics(program).map(d=>`${d.file?path.relative(process.cwd(),d.file.fileName):''} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);
}
const current=diagnostics(false);
if(global.gc)global.gc();
const previous=new Set(diagnostics(true));
const added=current.filter(d=>!previous.has(d));
console.log(JSON.stringify({baselineDiagnostics:previous.size,currentDiagnostics:new Set(current).size,newDiagnostics:added},null,2));
process.exitCode=added.length?1:0;
