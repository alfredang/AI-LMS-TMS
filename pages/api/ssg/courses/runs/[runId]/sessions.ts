import { withAuth } from '@lib/auth/withAuth';
/**
 * Next.js API route for course sessions
 * GET /api/ssg/courses/runs/[runId]/sessions?courseCode=TGS-XXX&uen=<uen>
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../../../../lib/ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../../../../../../lib/trainingPartnerIdentifiers';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { runId, courseRunId: courseRunIdParam, courseCode, uen: uenParam } = req.query;
    const courseRunId = (runId ?? courseRunIdParam) as string | undefined;

    if (!courseRunId || typeof courseRunId !== 'string') {
      return res.status(400).json({ error: 'runId is required' });
    }

    if (!courseCode || typeof courseCode !== 'string') {
      return res.status(400).json({ error: 'courseCode is required as a query parameter' });
    }

    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

    const tp = await getTrainingPartnerIdentifiers();
    const uen = (typeof uenParam === 'string' ? uenParam : null)
      || credentials.uen
      || tp.uen;

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, `/courses/runs/${courseRunId}/sessions`)
      .withMethod(HttpMethod.GET)
      .withParam('uen', uen)
      .withParam('courseReferenceNumber', courseCode)
      .withParam('includeExpiredCourses', 'true');

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG course sessions error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      if (httpResponse.status === 404) {
        return res.status(404).json({ error: 'Not Found — No record matches the provided details.' });
      }
      return res.status(httpResponse.status).json({
        error: `SSG error ${httpResponse.status}`,
        details: httpResponse.data,
      });
    }

    const parsed = typeof httpResponse.data === 'string'
      ? JSON.parse(httpResponse.data)
      : httpResponse.data;

    return res.status(200).json({ data: { result: parsed.data ?? parsed } });

  } catch (error) {
    console.error('❌ Course Sessions API Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance', 'developer', 'trainer'] });
