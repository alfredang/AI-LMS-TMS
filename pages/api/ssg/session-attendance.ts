import { withAuth } from '@lib/auth/withAuth';
/**
 * GET /api/ssg/session-attendance?uen=&courseCode=&courseRunId=&sessionId=
 *
 * Logic:
 *  - If SSG returns a JSON body WITH a "status" field  → error (404/500/etc.)
 *  - If SSG returns a body WITHOUT a "status" field    → encrypted attendance data → decrypt it
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import crypto from 'crypto';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { uen: uenParam, courseCode, courseRunId, sessionId } = req.query;

  if (!courseCode || !courseRunId || !sessionId) {
    return res.status(400).json({ error: 'courseCode, courseRunId and sessionId are required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const encKey = Buffer.from(credentials.encryptionKey, 'base64');
    const iv = Buffer.from('SSGAPIInitVector', 'utf8');

    const tp = await getTrainingPartnerIdentifiers();
    const uen = (typeof uenParam === 'string' ? uenParam : null)
      || credentials.uen
      || tp.uen;

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/courses/runs/${courseRunId}/sessions/attendance`)
      .withMethod(HttpMethod.GET)
      .withParam('uen', uen)
      .withParam('courseReferenceNumber', courseCode as string)
      .withParam('sessionId', sessionId as string);

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    const httpStatus = httpResponse.status;

    if (httpStatus === 404) {
      return res.status(404).json({ success: false, error: 'No attendance data found for this session.' });
    }

    if (httpStatus === 500) {
      return res.status(500).json({ success: false, error: 'Internal Server Error — The service is temporarily unavailable.' });
    }

    if (httpStatus !== 200) {
      const errBody = typeof httpResponse.data === 'string' ? httpResponse.data : JSON.stringify(httpResponse.data);
      return res.status(httpStatus).json({ success: false, error: `SSG error ${httpStatus}`, details: errBody });
    }

    // HTTP 200 — body is encrypted attendance data, decrypt it
    const rawBody = typeof httpResponse.data === 'string'
      ? httpResponse.data
      : JSON.stringify(httpResponse.data);

    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    let decrypted = decipher.update(rawBody, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const attendanceData = JSON.parse(decrypted);

    return res.status(200).json({ success: true, data: attendanceData });

  } catch (error) {
    console.error('❌ Session attendance error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
