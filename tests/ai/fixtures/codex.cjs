#!/usr/bin/env node
// Deterministic stand-in: no network, provider credentials or real generation.
const fs = require('fs');
const path = require('path');
if (process.env.DATABASE_URL || process.env.JWT_SECRET || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) process.exit(9);
const authPath = path.join(process.env.CODEX_HOME, 'auth.json');
if (process.argv.includes('app-server')) {
  require('readline').createInterface({input:process.stdin}).on('line', line => {
    const msg = JSON.parse(line);
    if (msg.id === undefined) return;
    const result = msg.method === 'account/login/start'
      ? { type: 'chatgptDeviceCode', loginId: 'fixture-login', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-ONLY' }
      : {};
    process.stdout.write(JSON.stringify({id:msg.id,result})+'\n');
  });
} else {
  let input=''; process.stdin.on('data',d=>input+=d);
  process.stdin.on('end',()=>{
    const auth=JSON.parse(fs.readFileSync(authPath));
    auth.tokens.refresh_token += '-rotated';
    fs.writeFileSync(authPath,JSON.stringify(auth));
    const args=process.argv.slice(2);
    if(args[args.indexOf('--model')+1]==='unavailable-model')process.exit(1);
    process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:input.includes('Return JSON')?' {"ok":true} ': 'OK'}})+'\n');
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}})+'\n');
  });
}
