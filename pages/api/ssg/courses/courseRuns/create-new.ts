/**
 * Next.js API route for Creating New Course Runs
 * POST /api/ssg/courses/courseRuns/create-new - Create new course runs
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../../../lib/ssg/services/credentials-service';
import { OptionalSelector } from '../../../../../lib/ssg/models/course-runs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST for creating course runs.' });
  }

  try {
    const { includeExpiredCourses } = req.query;
    const includeExpired = includeExpiredCourses === 'true' ? OptionalSelector.YES : OptionalSelector.NO;

    // Get SSG credentials (using default provider for now)
    const credentialsService = getSSGCredentialsService();
    const credentials = await credentialsService.getSSGCredentials();
    
    if (!credentials) {
      return res.status(404).json({ 
        error: 'SSG credentials not found. Please configure your training provider credentials.' 
      });
    }

    // Check required credentials for encryption
    if (!credentials.encryptionKey) {
      return res.status(400).json({ 
        error: 'Encryption key is required for course run operations' 
      });
    }

    if (!credentials.certificateContent || !credentials.privateKeyContent) {
      return res.status(400).json({ 
        error: 'Certificate and private key are required for SSG API authentication' 
      });
    }

    // Create API client
    // Note: We'll build the request manually to bypass TypeScript validation issues

    // Get request data (expect complex nested structure from frontend)
    const requestData = req.body;
    
    if (!requestData) {
      return res.status(400).json({ error: 'Request body is required for creating course runs' });
    }


    // The frontend already sends the correct nested structure that matches Python AddRunIndividualInfo.payload()
    // We just need to pass the runs through without transformation, as they match the expected SSG API format
    
    if (!requestData.course || !requestData.course.runs || requestData.course.runs.length === 0) {
      return res.status(400).json({ error: 'Course data with runs array is required' });
    }

    if (!requestData.course.trainingProvider?.uen) {
      return res.status(400).json({ error: 'Training Provider UEN is required in course.trainingProvider.uen' });
    }

    // Clean up the runs data to remove empty trainer arrays as requested
    const cleanedRuns = requestData.course.runs.map((run: any) => {
      const cleanedRun = { ...run };
      
      // Remove linkCourseRunTrainer if it's empty or doesn't exist
      if (!cleanedRun.linkCourseRunTrainer || cleanedRun.linkCourseRunTrainer.length === 0) {
        delete cleanedRun.linkCourseRunTrainer;
      }
      
      // Remove empty file fields if they're empty
      if (cleanedRun.file && cleanedRun.file.Name === "" && cleanedRun.file.content === "") {
        delete cleanedRun.file;
      }
      
      return cleanedRun;
    });

    // Build AddRunInfo structure that matches the Python format and TypeScript interface expectations
    const addRunInfo = {
      courseReferenceNumber: requestData.course.courseReferenceNumber,
      runs: cleanedRuns // Use the original nested structure from frontend
    };


    // Build the final payload structure that matches Python AddRunInfo.payload()
    const finalPayload = {
      course: {
        courseReferenceNumber: requestData.course.courseReferenceNumber,
        trainingProvider: {
          uen: credentials.uen  // Use UEN from credentials (database)
        },
        runs: cleanedRuns
      }
    };


    // Build the request manually to bypass TypeScript validation issues
    // This matches exactly what the Python add_course_run.py does
    const { HTTPRequestBuilder, HttpMethod, handleRequest } = await import('../../../../../lib/ssg/utils/http-utils');
    const { Cryptography } = await import('../../../../../lib/ssg/utils/cryptography');

    const builder = new HTTPRequestBuilder()
      .withEndpoint(process.env.SSG_API_URL || 'https://api.ssg-wsg.sg', '/courses/courseRuns/publish')
      .withMethod(HttpMethod.POST)
      .withHeader('Content-Type', 'application/json');

    // Add certificate authentication
    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    // Add query parameter based on includeExpired
    switch (includeExpired) {
      case OptionalSelector.YES:
        builder.withParam('includeExpiredCourses', 'true');
        break;
      case OptionalSelector.NO:
        builder.withParam('includeExpiredCourses', 'false');
        break;
    }

    // Encrypt the payload (matches Python post_encrypted method)
    const encryptedPayload = Cryptography.encryptJSON(credentials.encryptionKey, finalPayload);
    builder.withBody(encryptedPayload);

    const config = builder.build();
    
    // Create HTTP client and make the request
    const { HttpClient } = await import('../../../../../lib/ssg/utils/http-utils');
    const httpClient = new HttpClient(process.env.SSG_API_URL || 'https://api.ssg-wsg.sg', {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });

    const result = await handleRequest(httpClient, config);

    // SSG always returns "error": {} even on success — only treat as error if code/message/details present
    const hasError = result.error && (result.error.code || result.error.message ||
      (result.error.details && result.error.details.length > 0));

    if (hasError) {
      const errMsg = result.error?.details?.[0]?.message || result.error?.message;
      return res.status(result.status || 400).json({ error: { message: errMsg, details: result.error?.details } });
    }

    console.log('✅ SSG create course run response:', JSON.stringify(result.data));
    return res.status(200).json(result.data);

  } catch (error) {
    console.error('Course run creation error:', error);
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}