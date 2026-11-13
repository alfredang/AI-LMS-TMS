// Compare feature diagnostics against HEAD through an in-memory compiler host.
// Does not stash, reset, rewrite or remove any working-tree files.
const ts=require('typescript');
const cp=require('node:child_process');
const path=require('node:path');
const root=process.cwd();
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const changed=cp.execFileSync('git',['diff','HEAD','--name-only','--diff-filter=M'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>/\.tsx?$/.test(f));
const originals=new Map(changed.map(f=>[path.resolve(f),cp.execFileSync('git',['show',`HEAD:${f}`],{encoding:'utf8'})]));
const isFeature=f=>/^(components\/admin\/GoogleAutomation[^/]*\.tsx|pages\/api\/admin\/google-automations\.ts|tests\/google-automations[^/]*\.ts)$/.test(path.relative(root,f).replace(/\\/g,'/')) || path.relative(root,f).replace(/\\/g,'/').startsWith('lib/googleAutomations/');
function diagnostics(baseline){
  const host=ts.createCompilerHost({...parsed.options,incremental:false});
  const read=host.readFile;
  if(baseline)host.readFile=f=>originals.get(path.resolve(f))??read(f);
  const program=ts.createProgram(parsed.fileNames.filter(f=>!baseline||!isFeature(f)),{...parsed.options,incremental:false},host);
  return new Set(ts.getPreEmitDiagnostics(program).map(d=>`${d.file?path.relative(root,d.file.fileName):''} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`));
}
const current=diagnostics(false);if(global.gc)global.gc();
const baseline=diagnostics(true);
const added=[...current].filter(d=>!baseline.has(d));
console.log(JSON.stringify({baselineDiagnostics:baseline.size,currentDiagnostics:current.size,newDiagnostics:added},null,2));
process.exitCode=added.length?1:0;
