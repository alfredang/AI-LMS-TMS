import { withAuth } from '@lib/auth/withAuth';
/**
 * API endpoint for SSG decryption
 * Decrypts ciphertext using SSG credentials from the database
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { SSGEncryptionService } from '../../../lib/ssg/services/encryption-service';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed`
    });
  }

  try {
    const { ciphertext } = req.body;

    if (!ciphertext) {
      return res.status(400).json({
        success: false,
        error: 'Ciphertext is required'
      });
    }

    // Get SSG credentials for the single training provider (no ID needed - will get first one)
    const credentialsService = getSSGCredentialsService();
    const credentials = await credentialsService.getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined); // No parameter = get first provider

    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Training provider credentials not found'
      });
    }

    // Decrypt the ciphertext
    const encryptionService = new SSGEncryptionService();
    const plaintext = encryptionService.decrypt(ciphertext, credentials.encryptionKey);

    res.status(200).json({
      success: true,
      plaintext
    });
  } catch (error) {
    console.error('Decryption API Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Decryption failed'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
