import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {connectionStorageAvailable,normalizeImportedConnection,loadStoredConnection,saveInitialConnection} from '../lib/googleAutomations/connectionStore';

function input(){return {enabled:true,allowPublish:true,accountEmail:'owner@example.test',encryptionKey:randomBytes(32).toString('base64'),credentials:{client_id:'synthetic-client',client_secret:'synthetic-secret',refresh_token:'synthetic-refresh'},projects:[],review:{password:'synthetic-local-only'},triggerManagement:{reviewOnly:true,allowApply:true,inventory:[],bridges:{test:{secret:'synthetic-bridge-secret'}}}};}
test('connection import preserves its backup key and strips local review data and live trigger access',()=>{
  const original=input(),safe=normalizeImportedConnection(original);
  assert.equal(safe.encryptionKey,original.encryptionKey);assert.equal(safe.credentials.refresh_token,'synthetic-refresh');
  assert.equal(safe.triggerManagement!.reviewOnly,false);assert.equal(safe.triggerManagement!.allowApply,false);assert.deepEqual(safe.triggerManagement!.bridges,{});
  assert.doesNotMatch(JSON.stringify(safe),/synthetic-local-only|synthetic-bridge-secret/);
  assert.throws(()=>normalizeImportedConnection({...original,encryptionKey:'bad'}),/backup encryption key/);
});
test('secure storage fails closed without an established server key',()=>{
  const ai=process.env.AI_OAUTH_ENCRYPTION_KEY,jwt=process.env.JWT_SECRET;
  try{delete process.env.AI_OAUTH_ENCRYPTION_KEY;delete process.env.JWT_SECRET;assert.equal(connectionStorageAvailable(),false);process.env.JWT_SECRET=randomBytes(32).toString('hex');assert.equal(connectionStorageAvailable(),true);}
  finally{if(ai===undefined)delete process.env.AI_OAUTH_ENCRYPTION_KEY;else process.env.AI_OAUTH_ENCRYPTION_KEY=ai;if(jwt===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=jwt;}
});
test('real isolated database stores only ciphertext, survives reload, rejects overwrite and detects a lost server key',{skip:!process.env.GOOGLE_AUTOMATIONS_TRIGGER_TEST_DATABASE_URL},async()=>{
  const url=new URL(process.env.GOOGLE_AUTOMATIONS_TRIGGER_TEST_DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15447');assert.equal(url.pathname,'/google_automation_test');
  const {Pool}=await import('pg');const pool=new Pool({connectionString:url.toString(),max:3});
  const previous=process.env.AI_OAUTH_ENCRYPTION_KEY;process.env.AI_OAUTH_ENCRYPTION_KEY=randomBytes(32).toString('hex');
  const actor=randomUUID();
  try{
    assert.equal(await loadStoredConnection(pool),null);
    const safe=normalizeImportedConnection(input());await saveInitialConnection(pool,safe,actor);
    const row=(await pool.query('SELECT * FROM google_automation_connection WHERE configured_by=$1',[actor])).rows[0];
    assert.doesNotMatch(JSON.stringify(row),/synthetic-secret|synthetic-refresh|synthetic-client/);
    assert.deepEqual(await loadStoredConnection(pool),safe);
    await assert.rejects(saveInitialConnection(pool,safe,'another-actor'),/already installed/);
    process.env.AI_OAUTH_ENCRYPTION_KEY=randomBytes(32).toString('hex');await assert.rejects(loadStoredConnection(pool),/cannot be decrypted/);
  }finally{if(previous===undefined)delete process.env.AI_OAUTH_ENCRYPTION_KEY;else process.env.AI_OAUTH_ENCRYPTION_KEY=previous;await pool.query('DELETE FROM google_automation_connection WHERE configured_by=$1',[actor]);await pool.end();}
});
