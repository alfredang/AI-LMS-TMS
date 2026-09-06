import type {NextApiRequest,NextApiResponse} from 'next';
import sendOtp from '../auth/send-otp';
import {mobileAccount,normalizedEmail,limited} from '../../../lib/android/auth';
export default async function handler(req:NextApiRequest,res:NextApiResponse){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).end();
 const email=normalizedEmail(req.body?.email);if(!email)return res.status(400).json({error:'Enter a valid email address.'});
 try {
 if(await limited('send:'+email,3,15)){res.setHeader('Retry-After','900');return res.status(429).json({error:'Too many code requests. Please wait 15 minutes.'});}
 if(!await mobileAccount(email))return res.json({success:true,message:'If this email belongs to a learner or trainer, a sign-in code will arrive shortly.'});
 req.body={email};return sendOtp(req,res);
 }catch{return res.status(503).json({error:'Sign-in is temporarily unavailable. Please try again.'});}
}
