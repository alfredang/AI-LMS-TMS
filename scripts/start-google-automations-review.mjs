// Foreground runner, also suitable for Start-Process -WindowStyle Hidden with
// output redirected to the private local review log directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const configFile=path.join(process.cwd(),'config','google-automations-review.private.json');
const config=JSON.parse(await fs.readFile(configFile,'utf8'));
const db=config.review?.database;
if(config.allowPublish!==false || db?.host!=='127.0.0.1' || db?.port!==15447 || db?.database!=='google_automation_review')throw new Error('Run setup-google-automations-review.mjs first. A local review configuration with publishing disabled is required.');
const databaseUrl=new URL(`postgresql://127.0.0.1:15447/${db.database}`);
databaseUrl.username=db.user;databaseUrl.password=db.password;
const child=spawn(process.execPath,[path.join(process.cwd(),'node_modules','next','dist','bin','next'),'dev','--webpack','--hostname','127.0.0.1','-p','3004'],{
  stdio:'inherit',windowsHide:true,
  env:{...process.env,NODE_ENV:'development',NODE_OPTIONS:'--max-old-space-size=8192',
    DATABASE_URL:databaseUrl.toString(),ENABLE_APP_SCHEDULER:'false',MMS_SYNC_ENABLED:'false',
    GOOGLE_AUTOMATIONS_ENABLED:'true',GOOGLE_AUTOMATIONS_CONFIG_FILE:configFile,
    BASE_URL:'http://localhost:3004',NEXT_PUBLIC_BASE_URL:'http://localhost:3004',
    SCHEDULER_SECRET:randomBytes(32).toString('hex'),EXTERNAL_API_KEY_FOR_CLAWDBOT:randomBytes(32).toString('hex')},
});
child.on('exit',code=>{process.exitCode=code ?? 1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
