// Prepare an empty local UI-review database and a normal password-authenticated
// account. Never loads operational data, sends mail, or writes Google source.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

async function main() {
  const password=process.env.GOOGLE_AUTOMATIONS_REVIEW_DB_PASSWORD;
  if(!password)throw new Error('Set GOOGLE_AUTOMATIONS_REVIEW_DB_PASSWORD for the isolated local database.');
  const database={host:'127.0.0.1',port:15447,user:'postgres',password,database:'google_automation_review'};
  const admin=new Pool({...database,database:'postgres'});
  try {
    const marker=await admin.query("SELECT 1 FROM pg_database WHERE datname='google_automation_test'");
    if(!marker.rowCount)throw new Error('The expected isolated Google Automation test instance was not found.');
    const found=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database.database]);
    if(!found.rowCount)await admin.query('CREATE DATABASE google_automation_review');
  } finally {await admin.end();}

  const target=path.join(process.cwd(),'config','google-automations-review.private.json');
  const original=JSON.parse(await fs.readFile(path.join(process.cwd(),'config','google-automations.private.json'),'utf8'));
  let previous;
  try {previous=JSON.parse(await fs.readFile(target,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const review={
    url:'http://localhost:3004/?view=admin&adminPage=googleAutomations',
    email:'ui-review@localhost.test',
    password:previous?.review?.password || randomBytes(18).toString('base64url'),
    userId:previous?.review?.userId || randomUUID(),
    providerId:previous?.review?.providerId || randomUUID(),
    database,
  };
  const pool=new Pool(database);
  const client=await pool.connect();
  try {
    if((await client.query('SELECT current_database() AS name')).rows[0].name!=='google_automation_review')throw new Error('Unexpected review database.');
    const exists=await client.query("SELECT to_regclass('public.app_user') AS name");
    if(!exists.rows[0].name){
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
      let schema=await fs.readFile(path.join(process.cwd(),'database','01-schema.sql'),'utf8');
      if(/^\s*(COPY|INSERT INTO)\s/im.test(schema))throw new Error('Review setup accepts schema-only SQL, not operational data.');
      schema=schema.replace(/^\\.*$/gm,'').replace('CREATE SCHEMA public;','CREATE SCHEMA IF NOT EXISTS public;');
      // This schema dump contains a few hand-added inline foreign keys before
      // the referenced dump primary keys. Defer those keys until after the dump.
      const deferred=[];
      schema=schema.replace(/CREATE TABLE public\.(\w+) \(\r?\n([\s\S]*?)\r?\n\);/g,(whole,table,body)=>{
        const reordered=body.replace(/^(\s*)(\w+)(\s+[^,\r\n]*?)\s+REFERENCES public\.(\w+)\((\w+)\)(\s+ON DELETE (?:CASCADE|SET NULL|RESTRICT))?/gm,(_line,space,column,type,target,targetColumn,onDelete)=>{
          deferred.push(`ALTER TABLE public.${table} ADD FOREIGN KEY (${column}) REFERENCES public.${target}(${targetColumn})${onDelete || ''};`);
          return `${space}${column}${type}`;
        });
        return `CREATE TABLE public.${table} (\n${reordered}\n);`;
      });
      schema+='\n'+deferred.join('\n');
      await client.query(schema);
      await client.query('SET search_path=public');
    }
    const hash=await bcrypt.hash(review.password,12);
    await client.query(`INSERT INTO public.app_user(id,email,full_name,password_hash,account_status,must_change_password)
      VALUES($1,$2,'Local Google Automation Review',$3,'active',false)
      ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,account_status='active',must_change_password=false`,[review.userId,review.email,hash]);
    await client.query(`INSERT INTO public.user_role_map(user_id,role) VALUES($1,'Admin') ON CONFLICT DO NOTHING`,[review.userId]);
    await client.query(`INSERT INTO public.training_provider(id,uen,company_name,company_shortname,enable_otp_login,force_first_password_change,color_scheme)
      VALUES($1,'LOCAL-REVIEW','TMS Local UI Review','TMS Review',false,false,'blue') ON CONFLICT(id) DO NOTHING`,[review.providerId]);
    await client.query(`INSERT INTO public.training_provider_member(provider_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[review.providerId,review.userId]);
    await client.query(`CREATE TABLE IF NOT EXISTS public.user_session(
      token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,last_used_at timestamptz)`);
    const triggerManagement=previous?.triggerManagement?{...previous.triggerManagement,reviewOnly:true,allowApply:false}:undefined;
    const projects=[...original.projects];
    for(const p of previous?.projects||[])if(!projects.some(existing=>existing.scriptId===p.scriptId))projects.push(p);
    await fs.writeFile(target,JSON.stringify({...original,projects,allowPublish:false,triggerManagement,review},null,2),{mode:0o600});
    await fs.writeFile(path.join(process.cwd(),'config','google-automations-review-login.private.json'),JSON.stringify({url:review.url,email:review.email,password:review.password,note:'Local review account only. Google source publishing is disabled. This file contains no Google OAuth credentials.'},null,2),{mode:0o600});
    console.log(`Local UI review database and normal Admin login are ready. ${review.url}`);
    console.log('Login details are stored in config/google-automations-review-login.private.json.');
    console.log('Google source publishing is disabled in the review connection.');
  } finally {client.release();await pool.end();}
}
main().catch(error=>{console.error(error?.message || 'Local review setup failed.');process.exitCode=1;});
