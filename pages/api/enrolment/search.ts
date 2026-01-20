import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';

/**
 * API endpoint for searching enrolment records
 * POST /api/enrolment/search
 */
export default async function handler(
  req: NextApiRequest, 
  res: NextApiResponse
) {
  // Handle CORS
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { courseRunId, trainingPartnerUen, trainingPartnerCode, pageSize } = req.body;

    // Validate required fields
    if (!courseRunId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Course Run ID is required' 
      });
    }

    if (!trainingPartnerUen) {
      return res.status(400).json({ 
        success: false, 
        error: 'Training Partner UEN is required' 
      });
    }

    if (!trainingPartnerCode) {
      return res.status(400).json({ 
        success: false, 
        error: 'Training Partner Code is required' 
      });
    }

    // Build the request body according to the SSG API structure
    const requestBody = {
      enrolment: {
        course: {
          run: {
            id: courseRunId
          }
        },
        trainingPartner: {
          uen: trainingPartnerUen,
          code: trainingPartnerCode
        }
      },
      parameters: {
        pageSize: pageSize || 100
      }
    };

    console.log('🔍 Searching enrolments with request body:', JSON.stringify(requestBody, null, 2));

    // Get SSG credentials for authentication and encryption
    const credentialsService = getSSGCredentialsService();
    const credentials = await credentialsService.getSSGCredentials();

    if (!credentials) {
      console.error('❌ SSG credentials not found');
      return res.status(500).json({
        success: false,
        error: 'SSG credentials not found',
        message: 'Please configure SSG credentials in the database',
        requestBody
      });
    }

    // Check if SSG API base URL is configured
    const baseUrl = process.env.SSG_API_BASE_URL;
    if (!baseUrl) {
      console.error('❌ SSG_API_BASE_URL not configured');
      return res.status(500).json({
        success: false,
        error: 'SSG API configuration missing',
        message: 'Please add SSG_API_BASE_URL to your environment variables',
        requestBody
      });
    }

    // Use the SSG HTTP client with encryption and authentication (matching Python implementation)
    const { HTTPRequestBuilder, HttpMethod, handleRequest } = await import('../../../lib/ssg/utils/http-utils');
    const { Cryptography } = await import('../../../lib/ssg/utils/cryptography');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(baseUrl, '/tpg/enrolments/search')
      .withMethod(HttpMethod.POST)
      .withHeader('Content-Type', 'application/json')
      .withHeader('accept', 'application/json');

    // Add certificate authentication (matches Python cert_pem, key_pem)
    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    // Encrypt the payload (matches Python post_encrypted method)
    const encryptedPayload = Cryptography.encryptJSON(credentials.encryptionKey, requestBody);
    builder.withBody(encryptedPayload);

    const config = builder.build();
    
    // Create HTTP client and make the request
    const { HttpClient } = await import('../../../lib/ssg/utils/http-utils');
    const httpClient = new HttpClient(baseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });

    const result = await handleRequest(httpClient, config);

    if (result.error) {
      console.error('❌ SSG API error:', result.error);
      return res.status(result.status || 400).json({
        success: false,
        error: `SSG API error: ${result.status || 400} - ${result.error}`,
        requestBody
      });
    }

    // The response from SSG API is encrypted, we need to decrypt it (matching Python handle_response)
    let decryptedData;
    try {
      console.log('🔓 Decrypting SSG API response...');
      decryptedData = Cryptography.decryptJSON(credentials.encryptionKey, result.data);
      console.log('✅ Enrolment search successful (decrypted):', decryptedData);
    } catch (decryptionError) {
      console.error('❌ Failed to decrypt response:', decryptionError);
      return res.status(500).json({
        success: false,
        error: 'Failed to decrypt response from SSG API',
        encryptedResponse: result.data,
        requestBody
      });
    }

    return res.status(200).json({
      success: true,
      data: decryptedData,
      encryptedResponse: result.data, // Include encrypted response for debugging
      requestBody,
      message: 'Enrolment search completed successfully'
    });

  } catch (error) {
    console.error('❌ Error in enrolment search:', error);
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      message: 'Failed to search enrolment records'
    });
  }
}