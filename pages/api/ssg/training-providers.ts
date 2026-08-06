import { withAuth } from '@lib/auth/withAuth';
/**
 * Next.js API route for SSG training providers
 * GET /api/ssg/training-providers - List available training providers
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const credentialsService = getSSGCredentialsService();
    const trainingProviders = await credentialsService.getTrainingProviders();

    res.status(200).json({
      success: true,
      data: trainingProviders,
      count: trainingProviders.length
    });
  } catch (error) {
    console.error('Training Providers API Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
