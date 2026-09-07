import http2 from 'node:http2';
import crypto from 'node:crypto';
let cached:{token:string;at:number}|undefined;
function providerToken(){
 const now=Math.floor(Date.now()/1000);
 if(cached&&now-cached.at<3000)return cached.token;
 const key=process.env.MOBILE_APNS_PRIVATE_KEY?.replace(/\\n/g,'\n');
 const kid=process.env.MOBILE_APNS_KEY_ID; const team=process.env.MOBILE_APNS_TEAM_ID;
 if(!key||!kid||!team)throw new Error('APNs credentials not configured');
 const header=Buffer.from(JSON.stringify({alg:'ES256',kid})).toString('base64url');
 const claims=Buffer.from(JSON.stringify({iss:team,iat:now})).toString('base64url');
 const input=header+'.'+claims;
 const signature=crypto.sign('sha256',Buffer.from(input),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
 cached={token:input+'.'+signature,at:now};return cached.token;
}
export async function sendPush(token:string,environment:string,sessionID:string,days:number):Promise<number>{
 const jwt=providerToken();
 return new Promise((resolve,reject)=>{
 const client=http2.connect(environment==='sandbox'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com');
 const timer=setTimeout(()=>{client.destroy();reject(new Error('APNs timeout'));},15000);
 client.on('error',e=>{clearTimeout(timer);client.destroy();reject(e)});
 const collapse=crypto.createHash('sha256').update(`${sessionID}:${days}`).digest('hex');
 const request=client.request({':method':'POST',':path':'/3/device/'+token,authorization:'bearer '+jwt,'apns-topic':process.env.MOBILE_APNS_TOPIC||'com.tertiaryinfotech.ailmstms','apns-push-type':'alert','apns-priority':'10','apns-expiration':'0','apns-collapse-id':collapse});
 let status=0;request.on('response',h=>{status=Number(h[':status'])});request.on('data',()=>{});
 request.on('end',()=>{clearTimeout(timer);client.close();resolve(status)});request.on('error',e=>{clearTimeout(timer);client.destroy();reject(e)});
 request.end(JSON.stringify({aps:{alert:{title:'Upcoming class',body:`Your class starts in ${days} day${days===1?'':'s'}. Open Tertiary LMS for details.`},sound:'default'},sessionID}));
 });
}
