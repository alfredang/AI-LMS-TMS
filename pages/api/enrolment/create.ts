import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';

interface CreateEnrolmentRequest {
  enrolment: {
    course: {
      run?: {
        id?: string;
      };
      referenceNumber: string;
    };
    trainee: {
      id: string;
      fees: {
        discountAmount?: number;
        collectionStatus: string;
      };
      idType: {
        type: string;
      };
      employer?: {
        uen?: string;
        contact?: {
          fullName?: string;
          emailAddress?: string;
          contactNumber?: {
            areaCode?: string;
            countryCode?: string;
            phoneNumber?: string;
          };
        };
      };
      fullName: string;
      dateOfBirth: string;
      emailAddress: string;
      contactNumber: {
        areaCode?: string;
        countryCode: string;
        phoneNumber: string;
      };
      enrolmentDate?: string;
      sponsorshipType: string;
    };
    trainingPartner: {
      uen: string;
      code: string;
    };
  };
}

interface ApiResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * API endpoint for creating enrolment records
 * POST /api/enrolment/create
 */
export default async function handler(
  req: NextApiRequest, 
  res: NextApiResponse<ApiResponse>
) {
  // Handle CORS
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const requestBody: CreateEnrolmentRequest = req.body;

    // Validate required fields
    if (!requestBody.enrolment?.course?.referenceNumber) {
      return res.status(400).json({ 
        success: false, 
        error: 'Course Reference Number is required' 
      });
    }

    if (!requestBody.enrolment?.trainee?.id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Trainee ID is required' 
      });
    }

    if (!requestBody.enrolment?.trainee?.fullName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Trainee Full Name is required' 
      });
    }

    if (!requestBody.enrolment?.trainee?.emailAddress) {
      return res.status(400).json({ 
        success: false, 
        error: 'Trainee Email Address is required' 
      });
    }

    if (!requestBody.enrolment?.trainingPartner?.uen) {
      return res.status(400).json({ 
        success: false, 
        error: 'Training Partner UEN is required' 
      });
    }

    if (!requestBody.enrolment?.trainingPartner?.code) {
      return res.status(400).json({ 
        success: false, 
        error: 'Training Partner Code is required' 
      });
    }

    // Additional validation for employer-sponsored trainees
    if (requestBody.enrolment.trainee.sponsorshipType === 'EMPLOYER') {
      if (!requestBody.enrolment.trainee.employer?.uen) {
        return res.status(400).json({ 
          success: false, 
          error: 'Employer UEN is required for employer-sponsored trainees' 
        });
      }

      if (!requestBody.enrolment.trainee.employer?.contact?.fullName) {
        return res.status(400).json({ 
          success: false, 
          error: 'Employer Full Name is required for employer-sponsored trainees' 
        });
      }

      if (!requestBody.enrolment.trainee.employer?.contact?.emailAddress) {
        return res.status(400).json({ 
          success: false, 
          error: 'Employer Email Address is required for employer-sponsored trainees' 
        });
      }
    }

    console.log('🚀 Creating enrolment with request body:', JSON.stringify(requestBody, null, 2));

    // Get SSG credentials for authentication and encryption
    const credentialsService = getSSGCredentialsService();
    const credentials = await credentialsService.getSSGCredentials();

    if (!credentials) {
      console.error('❌ SSG credentials not found');
      return res.status(500).json({ 
        success: false, 
        error: 'SSG credentials not configured' 
      });
    }

    // Check if SSG API base URL is configured
    const baseUrl = process.env.SSG_API_BASE_URL;
    if (!baseUrl) {
      console.error('❌ SSG_API_BASE_URL not configured');
      return res.status(500).json({
        success: false,
        error: 'SSG API configuration missing'
      });
    }

    // Import required modules - use the same pattern as search enrolment
    const { HTTPRequestBuilder, HttpMethod } = await import('../../../lib/ssg/utils/http-utils');
    const { Cryptography } = await import('../../../lib/ssg/utils/cryptography');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(baseUrl, '/tpg/enrolments')
      .withMethod(HttpMethod.POST)
      .withHeader('Content-Type', 'application/json')
      .withHeader('accept', 'application/json');

    // Add certificate authentication
    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    // Clean the payload by removing null/undefined fields
    const cleanPayload = JSON.parse(JSON.stringify(requestBody, (key, value) => {
      if (value === null || value === undefined || value === '') {
        return undefined;
      }
      return value;
    }));

    console.log('🔍 Cleaned payload:', JSON.stringify(cleanPayload, null, 2));

    // Encrypt the payload
    const encryptedPayload = Cryptography.encryptJSON(credentials.encryptionKey, cleanPayload);
    builder.withBody(encryptedPayload);

    const config = builder.build();
    
    // Create HTTP client and make the request
    const { HttpClient } = await import('../../../lib/ssg/utils/http-utils');
    const httpClient = new HttpClient(baseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });
    
    console.log('📡 Making encrypted POST request to SSG API...');
    
    const response = await httpClient.post('/tpg/enrolments', encryptedPayload, config);
    
    console.log('📥 SSG API Response Status:', response.status);
    console.log('📥 SSG API Response Headers:', response.headers);

    if (response.status === 200 || response.status === 201) {
      // Decrypt the response if it's encrypted
      let responseData = response.data;
      
      if (typeof responseData === 'string' && credentials.encryptionKey) {
        try {
          responseData = Cryptography.decryptJSON(credentials.encryptionKey, responseData);
          console.log('🔓 Decrypted response:', responseData);
        } catch (decryptError) {
          console.warn('⚠️ Could not decrypt response, using as-is:', decryptError);
        }
      }

      return res.status(200).json({
        success: true,
        data: responseData
      });
    } else {
      console.error('❌ SSG API Error:', response.status, response.data);
      
      let errorMessage = 'Failed to create enrolment';
      
      // Try to extract error message from response
      if (response.data) {
        if (typeof response.data === 'string') {
          try {
            // Try to decrypt error response
            const decryptedError = Cryptography.decryptJSON(credentials.encryptionKey, response.data);
            errorMessage = decryptedError.error || decryptedError.message || errorMessage;
          } catch {
            errorMessage = response.data;
          }
        } else if (typeof response.data === 'object') {
          errorMessage = response.data.error || response.data.message || JSON.stringify(response.data);
        }
      }

      return res.status(response.status).json({
        success: false,
        error: errorMessage
      });
    }

  } catch (error) {
    console.error('❌ Error in create enrolment API:', error);
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}