import type { NextApiHandler, NextApiResponse } from 'next';
import type { AuthedApiRequest } from '../auth/withAuth';
import { AutomationError } from './model';
import { authenticateAutomationAgent, type AutomationAgent } from './agentAccess';

export type AutomationRequest = AuthedApiRequest & {automationAgent?:AutomationAgent};
export function withAutomationAgent(handler:(req:AutomationRequest,res:NextApiResponse)=>unknown,humanHandler:NextApiHandler):NextApiHandler {
  return async(req,res)=>{
    // Dedicated header only. General scheduler/service keys retain no source access.
    const token=req.headers['x-google-automation-key'];
    if(token===undefined)return humanHandler(req,res);
    res.setHeader('Cache-Control','no-store, private');
    try {
      const agent=authenticateAutomationAgent(token);
      const request=req as AutomationRequest;
      request.automationAgent=agent;
      request.authUser={id:`agent:${agent.id}`,roles:new Set(),isService:true};
      return await handler(request,res);
    }catch(error){
      return res.status(error instanceof AutomationError?error.status:503).json({success:false,error:error instanceof AutomationError?error.message:'Google Automations agent request failed.'});
    }
  };
}
