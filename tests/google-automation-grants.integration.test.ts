import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { AutomationAgentStore, storedAgentForToken } from '../lib/googleAutomations/agentStore';
import { PgAutomationStore } from '../lib/googleAutomations/store';
import { authenticateAutomationAgent } from '../lib/googleAutomations/agentAccess';

test('TMS-managed grants store only digests, bind accounts/projects, reject escalation and revoke access immediately',
  {skip:!process.env.GOOGLE_AUTOMATIONS_INSPECTION_TEST_DATABASE_URL},async()=>{
  const url=new URL(process.env.GOOGLE_AUTOMATIONS_INSPECTION_TEST_DATABASE_URL!);
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15447');assert.equal(url.pathname,'/google_automation_test');
  const pool=new Pool({connectionString:url.toString(),max:3});
  const connection=randomUUID(),otherConnection=randomUUID(),account='grant-fixture@example.test',project='synthetic-grant-allowed-project';
  const token=randomBytes(32).toString('base64url');
  const grant={id:'test-'+randomUUID(),tokenSha256:createHash('sha256').update(token).digest('hex'),accountEmail:account,scopes:['read','draft'],scriptIds:[project],expiresAt:'2099-01-01T00:00:00Z'};
  const store=new AutomationAgentStore(pool,connection,account);
  try{
    const projects=new PgAutomationStore(pool,connection);await projects.init();await projects.register({scriptId:project,name:'Synthetic project'});
    const migration=await readFile('database/migrations/create_google_automation_agent_grants.sql','utf8');await pool.query(migration);await pool.query(migration);await store.init();
    await assert.rejects(store.install(grant,'admin',false,false),/Acknowledge/);
    await assert.rejects(store.install({...grant,accountEmail:'other@example.test'},'admin',true,false),/another Google account/);
    await assert.rejects(store.install({...grant,scopes:['read','publish']},'admin',true,false),/Publishing is disabled/);
    await assert.rejects(store.install({...grant,scriptIds:['synthetic-unregistered-project']},'admin',true,false),/Register all/);
    await assert.rejects(store.install({...grant,expiresAt:'2000-01-01'},'admin',true,false),/expired/);
    const list=await store.install(grant,'admin',true,false);assert.equal(list.length,1);
    assert.doesNotMatch(JSON.stringify(list),new RegExp(token+'|'+grant.tokenSha256));
    const rows=(await pool.query('SELECT * FROM google_automation_agent_grant WHERE connection_id=$1',[connection])).rows;
    assert.doesNotMatch(JSON.stringify(rows),new RegExp(token));assert.equal(rows[0].token_sha256,grant.tokenSha256);assert.equal(rows[0].created_by,'admin');
    const saved=await storedAgentForToken(pool,token);assert.ok(saved);
    const authenticated=authenticateAutomationAgent(token,JSON.stringify([saved]));assert.equal(authenticated.id,grant.id);assert.deepEqual(authenticated.scopes,['read','draft']);
    await assert.rejects(store.install({...grant,scopes:['read','publish']},'admin',true,true),/already registered/);
    assert.deepEqual((await store.list())[0].scopes,['read','draft']);
    await assert.rejects(new AutomationAgentStore(pool,otherConnection,account).revoke(grant.id,'other-admin'),/not found/);
    await store.revoke(grant.id,'revoking-admin');assert.equal(await storedAgentForToken(pool,token),null);
    assert.equal((await store.list())[0].revokedBy,'revoking-admin');
    // Expired records cannot authenticate even without explicit revocation.
    const expiringToken=randomBytes(32).toString('base64url');
    await store.install({...grant,id:'expiry-'+randomUUID(),tokenSha256:createHash('sha256').update(expiringToken).digest('hex')},'admin',true,false);
    await pool.query("UPDATE google_automation_agent_grant SET expires_at=now()-interval '1 second' WHERE token_sha256=$1",[createHash('sha256').update(expiringToken).digest('hex')]);
    assert.equal(await storedAgentForToken(pool,expiringToken),null);
  }finally{
    await pool.query('DELETE FROM google_automation_agent_grant WHERE connection_id IN ($1,$2)',[connection,otherConnection]).catch(()=>{});
    await pool.query('DELETE FROM google_automation_project WHERE connection_id=$1',[connection]).catch(()=>{});await pool.end();
  }
});
