import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { createSSGEnrolmentAPI } from '../../../lib/ssg/api/enrolment-api';

/**
 * GET /api/enrolments/by-run?courseRunId=xxx
 *
 * Searches SSG for all enrolments under a given course run ID.
 * Returns: { success: true, data: enrolment[] }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  if (!courseRunId || typeof courseRunId !== 'string' || !courseRunId.trim()) {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tp = await getTrainingPartnerIdentifiers();
    const tpUen  = tp.uen || credentials.uen;
    const tpCode = tp.code;

    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

    // SSG pages the search results. Read every page: a single page of 20 silently
    // dropped learners from classes larger than 20 (run 1362296 showed 20 of 22).
    const PAGE_SIZE = 100;
    const enrolments: any[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 50; page++) {
      const result = await api.searchEnrolment({
        enrolment: {
          course: { run: { id: courseRunId.trim() } },
          trainingPartner: { uen: tpUen, code: tpCode },
        },
        parameters: { page, pageSize: PAGE_SIZE },
      } as any);

      if (result.error) {
        const status = Number(result.status) || 0;
        // 404 = no (more) records: an empty run on page 0, the end of the list after that.
        if (status === 404) break;
        // A later page failing must not hide the error behind a partial list.
        return res.status(status || 500).json({ success: false, error: result.error?.message ?? 'SSG error' });
      }

      // SSG returns enrolments as data.enrolment[] or data[]
      const raw: any = result.data;
      let pageItems: any[];
      if (Array.isArray(raw?.enrolment)) {
        pageItems = raw.enrolment;
      } else if (Array.isArray(raw)) {
        pageItems = (raw as any[]).map((item: any) => item.enrolment ?? item);
      } else {
        pageItems = [];
      }

      for (const e of pageItems) {
        const key = e?.referenceNumber ? String(e.referenceNumber) : '';
        if (key) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        enrolments.push(e);
      }
      if (pageItems.length < PAGE_SIZE) break; // last page
    }

    return res.status(200).json({ success: true, data: enrolments });
  } catch (error) {
    console.error('[enrolments/by-run] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

export default withAuth(handler);
