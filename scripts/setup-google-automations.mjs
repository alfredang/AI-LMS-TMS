// Explicit one-time local provisioning. Reads an existing authorized_user token;
// never writes Google source, changes triggers or touches Calendar/Gmail settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';

async function main() {
const [tokenFile,inventoryFile,expectedAccount]=process.argv.slice(2);
if (!tokenFile || !inventoryFile || !expectedAccount) throw new Error('Usage: node scripts/setup-google-automations.mjs <token-file> <inventory-file> <expected-google-email>');
const token=JSON.parse(await fs.readFile(path.resolve(tokenFile),'utf8'));
if (token.type!=='authorized_user' || !token.client_id || !token.client_secret || !token.refresh_token) throw new Error('A valid authorized_user token is required.');
const auth=new google.auth.OAuth2(token.client_id,token.client_secret);
auth.setCredentials({refresh_token:token.refresh_token});
const drive=google.drive({version:'v3',auth});
const about=await drive.about.get({fields:'user(emailAddress)'});
const account=about.data.user?.emailAddress?.toLowerCase();
if (account!==expectedAccount.toLowerCase()) throw new Error('The token belongs to a different Google account.');
const access=await auth.getAccessToken();
const info=await auth.getTokenInfo(access.token);
if (!info.scopes.includes('https://www.googleapis.com/auth/script.projects')) throw new Error('The token requires script.projects.');
const inventory=JSON.parse(await fs.readFile(path.resolve(inventoryFile),'utf8'));
function describe(name) {
  if (/Add Orders/i.test(name)) return ['Orders and Calendar','Reads order emails, creates or matches Calendar events, adds guests and updates supporting sheets.'];
  if (/Direct Applications/i.test(name)) return ['Application intake','Forwards application confirmation emails to the TMS intake API.'];
  if (/Courseware/i.test(name)) return ['Courseware','Sends courseware links to Calendar guests using spreadsheet course mappings.'];
  if (/Google Meet/i.test(name)) return ['Meeting details','Sends virtual-class joining details to Calendar guests.'];
  if (/Confirmation|Reminder/i.test(name)) return ['Confirmations','Sends upcoming-class confirmations or reminders based on Calendar events.'];
  if (/Thank You/i.test(name)) return ['Completion','Sends post-class thank-you messages. Verify country and Calendar scope before consolidation.'];
  if (/Grant/i.test(name)) return ['Grant and invoice','Sends grant-application instructions; the invoice variant also generates invoice documents.'];
  if (/Contact Us/i.test(name)) return ['Enquiries','Responds to Google Form enquiries using course keywords and spreadsheet data.'];
  if (/Encryption/i.test(name)) return ['Integration helper','Encryption/decryption helper. Existing callers and deployments need verification.'];
  return ['Unclassified','Purpose and callers need review.'];
}
const projects=inventory.projects.filter(p=>p.status==='backed-up').map(p=>{
  const [category,purpose]=describe(p.name);
  return {scriptId:p.scriptId,name:p.name,purpose,category,schedule:'Not verified',dependencies:'Not verified'};
});
const target=path.join(process.cwd(),'config','google-automations.private.json');
await fs.mkdir(path.dirname(target),{recursive:true});
await fs.writeFile(target,JSON.stringify({enabled:true,allowPublish:true,accountEmail:account,encryptionKey:randomBytes(32).toString('base64'),credentials:{client_id:token.client_id,client_secret:token.client_secret,refresh_token:token.refresh_token},projects},null,2),{mode:0o600,flag:'wx'});
console.log(`Dedicated Google Automations connection verified and configured for ${account}. Registered seed projects: ${projects.length}.`);
console.log('Private configuration created. Back it up securely: its encryption key is required to recover source backups.');
}
main().catch(()=>{console.error('Google Automations provisioning failed. Verify the token and inventory paths, expected account, Google access and whether the private configuration already exists. Existing configuration is never overwritten.');process.exitCode=1;});
