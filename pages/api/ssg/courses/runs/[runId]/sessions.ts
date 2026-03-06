/**
 * Next.js API route for course sessions
 * GET /api/ssg/courses/runs/[runId]/sessions - View course sessions via n8n webhook
 */

import { NextApiRequest, NextApiResponse } from 'next';

const WEBHOOK_URL = 'https://n8n.srv1231536.hstgr.cloud/webhook/117adf9a-7802-439c-aa2d-7d2e0d10fe13';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { runId } = req.query;
    const { courseReferenceNumber, includeExpired, month, year } = req.query;

    console.log('📚 Course Sessions API - Request received:', {
      runId,
      courseReferenceNumber,
      includeExpired,
      month,
      year,
      timestamp: new Date().toISOString()
    });

    if (!runId || typeof runId !== 'string') {
      console.error('❌ Missing or invalid runId');
      return res.status(400).json({ error: 'runId is required' });
    }

    if (!courseReferenceNumber || typeof courseReferenceNumber !== 'string') {
      console.error('❌ Missing or invalid courseReferenceNumber');
      return res.status(400).json({ error: 'courseReferenceNumber is required as a query parameter' });
    }

    const requestBody = {
      runId,
      courseReferenceNumber,
      includeExpired: includeExpired || 'false',
      ...(month && { month }),
      ...(year && { year }),
    };

    console.log('🔄 Sending request to webhook:', requestBody);

    const webhookResponse = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const webhookData = await webhookResponse.json();

    console.log('📥 Webhook response status:', webhookResponse.status);
    console.log('📥 Webhook response data:', JSON.stringify(webhookData, null, 2));

    if (!webhookResponse.ok) {
      console.error('❌ Webhook error response:', webhookData);
      return res.status(webhookResponse.status).json({ error: webhookData });
    }

    // Log session count if available
    const sessionCount = webhookData?.result?.sessions?.length || 0;
    console.log(`✅ Successfully retrieved ${sessionCount} sessions`);

    // Return as { data: webhookData } so frontend can access data.data.result.sessions
    return res.status(200).json({ data: webhookData });
  } catch (error) {
    console.error('❌ Course Sessions API Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}