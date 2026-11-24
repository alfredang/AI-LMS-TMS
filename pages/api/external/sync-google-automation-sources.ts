import type { NextApiRequest, NextApiResponse } from 'next';
import { withServiceAuth } from '../../../lib/auth/withAuth';
import { readConfig } from '../../../lib/googleAutomations/config';
import { syncGoogleAutomationSources } from '../../../lib/googleAutomations/sync';

async function handler(req:NextApiRequest,res:NextApiResponse){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'POST required.'});}
  if(process.env.GOOGLE_AUTOMATIONS_SYNC_ENABLED!=='true')return res.json({success:true,skipped:true,reason:'Google source synchronization is disabled.'});
  try{
    const connection=await readConfig();
    if(!connection)return res.status(503).json({success:false,error:'Google Automations connection is unavailable.'});
    const {default:pool}=await import('../../../lib/db');
    const result=await syncGoogleAutomationSources(pool,connection);
    return res.status(result.success?200:503).json(result);
  }catch{return res.status(503).json({success:false,error:'Google source synchronization failed. Saved source has been retained.'});}
}
export default withServiceAuth(handler);
