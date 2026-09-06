import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { ensureMobileSchema } from '../../../lib/mobile/schema';
export default withAuth(async(req:AuthedApiRequest,res:NextApiResponse)=>{
 if(req.method!=='POST')return res.status(405).end();
 if(req.authUser!.isService||req.body?.confirmation!=='DELETE')return res.status(400).json({error:'Confirmation required'});
 await ensureMobileSchema();
 const client=await pool.connect();
 try {
 await client.query('BEGIN');
 await client.query('INSERT INTO mobile_deletion_request(user_id) VALUES($1) ON CONFLICT DO NOTHING',[req.authUser!.id]);
 await client.query('DELETE FROM mobile_push_device WHERE user_id=$1',[req.authUser!.id]);
 await client.query('DELETE FROM user_session WHERE user_id=$1',[req.authUser!.id]);
 const otpTable=await client.query("SELECT to_regclass('public.mobile_otp') IS NOT NULL AS present");
 if(otpTable.rows[0].present)await client.query('DELETE FROM mobile_otp WHERE user_id=$1',[req.authUser!.id]);
 await client.query(`DELETE FROM otp_codes WHERE lower(email) IN (SELECT lower(email) FROM app_user WHERE id=$1 UNION SELECT lower(secondary_email) FROM app_user WHERE id=$1)`,[req.authUser!.id]);
 await client.query(`DELETE FROM user_role_map WHERE user_id=$1`,[req.authUser!.id]);
 await client.query(`UPDATE app_user SET email='deleted-'||id::text||'@account.invalid',full_name='Deleted account',password=NULL,password_hash=NULL,secondary_email=NULL,additional_emails='{}',profile_picture_url=NULL,oauth_provider=NULL,oauth_provider_id=NULL,auth_provider=NULL,supabase_user_id=NULL,account_status='deleted',updated_at=now() WHERE id=$1`,[req.authUser!.id]);
 await client.query('COMMIT');
 return res.json({success:true,message:'Your portal login and profile identity have been permanently removed. Required training and financial records are retained by your training provider.'});
 }catch{await client.query('ROLLBACK');return res.status(500).json({error:'Unable to request deletion'});}finally{client.release();}
},{roles:['learner','trainer']});
