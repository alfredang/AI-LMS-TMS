import { withAuth } from '@lib/auth/withAuth';
/**
 * API endpoint for SSG encryption
 * Encrypts plaintext using SSG credentials from the database
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
    const { plaintext } = req.body;

    if (!plaintext) {
      return res.status(400).json({
        success: false,
        error: 'Plaintext is required'
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

    // Encrypt the plaintext
    const encryptionService = new SSGEncryptionService();
    const ciphertext = encryptionService.encrypt(plaintext, credentials.encryptionKey);

    res.status(200).json({
      success: true,
      ciphertext
    });
  } catch (error) {
    console.error('Encryption API Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Encryption failed'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
