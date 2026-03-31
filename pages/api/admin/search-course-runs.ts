import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from '../../../lib/ssg/utils/http-utils';
import { createCourseAPI } from '../../../lib/ssg/api/course-api';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { query, search } = req.query;
    const searchTerm = (query || search)?.toString()?.trim();

    if (!searchTerm) {
        return res.status(400).json({ message: 'Query parameter is required' });
    }

    try {
        console.log('API Native Search: Received request for query:', searchTerm);
        
        const credentials = await getSSGCredentialsService().getSSGCredentials();
        if (!credentials) {
            return res.status(500).json({ success: false, error: 'SSG credentials not found' });
        }

        const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';

        // Check if searchTerm looks like a Course Code (e.g., TGS-XXXXXXX)
        const isCourseCode = /^TGS-/i.test(searchTerm);

        let data;

        if (isCourseCode) {
            // Search by Course Reference Number (Course Code)
            const builder = new HTTPRequestBuilder()
                .withEndpoint(ssgBaseUrl, '/courses/courseRuns/reference')
                .withMethod(HttpMethod.GET)
                .withParam('uen', credentials.uen || '201200696W')
                .withParam('courseReferenceNumber', searchTerm)
                .withParam('pageSize', '100')
                .withParam('page', '0')
                .withParam('includeExpiredCourses', 'true');

            if (credentials.certificateContent && credentials.privateKeyContent) {
                builder.withCertificate(credentials.certificateContent, credentials.privateKeyContent);
            }

            const httpClient = new HttpClient(ssgBaseUrl, {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            });

            const httpResponse = await httpClient.request(builder.build());
            
            if (httpResponse.status !== 200) {
                if (httpResponse.status === 404) {
                    data = []; 
                } else {
                    throw new Error(`SSG responded with ${httpResponse.status}: ${JSON.stringify(httpResponse.data)}`);
                }
            } else {
                data = httpResponse.data;
            }
        } else {
             // Search by Course Run ID
            const courseApi = createCourseAPI(ssgBaseUrl, credentials);
            const response = await courseApi.viewCourseRun(searchTerm);
            
            if (response.error) {
                 if (response.status === 404) {
                     data = [];
                 } else {
                     throw new Error(`SSG responded with error: ${response.error.message || JSON.stringify(response.error)}`);
                 }
            } else {
                 // Format to match the array structure that the UI handles
                 // The viewCourseRun returns { course: { run: {...} } }
                 // Let's create an array of one run for the UI
                 if (response.data && response.data.course && response.data.course.run) {
                      data = [response.data.course.run];
                 } else {
                      data = [];
                 }
            }
        }

        console.log('API Native Search: SSG data received, sending to client.');
        res.status(200).json(data);
    } catch (error) {
        console.error('API Native Search error:', error);
        res.status(500).json({ message: error instanceof Error ? error.message : 'Internal server error' });
    }
}
