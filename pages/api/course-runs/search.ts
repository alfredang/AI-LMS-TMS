import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';

/**
 * GET /api/course-runs/search?courseCode=TGS-XXXXXXXXX&page=0&pageSize=100&includeExpired=true
 * Search course runs by course reference number via SSG API.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { courseCode, page = '0', pageSize = '100', includeExpired = 'true' } = req.query;

  if (!courseCode || typeof courseCode !== 'string' || !courseCode.trim()) {
    return res.status(400).json({ success: false, error: 'courseCode query parameter is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tp = await getTrainingPartnerIdentifiers();

    const builder = new HTTPRequestBuilder()
      .withEndpoint(ssgBaseUrl, '/courses/courseRuns/reference')
      .withMethod(HttpMethod.GET)
      .withParam('uen', credentials.uen || tp.uen)
      .withParam('courseReferenceNumber', courseCode.trim())
      .withParam('pageSize', String(pageSize))
      .withParam('page', String(page))
      .withParam('includeExpiredCourses', String(includeExpired));

    if (credentials.certificateContent && credentials.privateKeyContent) {
      builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
    }

    const httpClient = new HttpClient(ssgBaseUrl, {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });

    const httpResponse = await httpClient.request(builder.build());

    console.log('📦 SSG search course runs status:', httpResponse.status);

    if (httpResponse.status !== 200) {
      console.error(`❌ SSG search course runs error [${httpResponse.status}]:`, JSON.stringify(httpResponse.data));
      if (httpResponse.status === 404) {
        return res.status(404).json({ success: false, error: 'No course runs found for this Course Code.' });
      }
      return res.status(httpResponse.status).json({
        success: false,
        error: `SSG error ${httpResponse.status}`,
        details: httpResponse.data,
      });
    }

    const responseData = httpResponse.data as any;

    // SSG response: { data: { course: { runs: [...] } }, status, error, meta }
    const ssgData = responseData?.data ?? responseData;
    const courseRuns = ssgData?.course?.runs ?? ssgData?.runs ?? [];

    // SSG always returns "error": {} even on success — only treat as error if code/message present
    const ssgError = responseData?.error;
    const hasError = ssgError && (ssgError.code || ssgError.message);
    if (hasError) {
      const status = Number(responseData?.status) || 400;
      if (status === 403 || status === 404) {
        return res.status(404).json({ success: false, error: 'No course runs found for this Course Code.' });
      }
      return res.status(status).json({ success: false, error: ssgError.message });
    }

    console.log(`✅ Found ${courseRuns.length} course runs for ${courseCode} (page ${page})`);

    return res.status(200).json({
      success: true,
      data: ssgData,
      courseRuns,
      meta: responseData?.meta ?? {},
    });

  } catch (error) {
    console.error('❌ Search course runs error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
