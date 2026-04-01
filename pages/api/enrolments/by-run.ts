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
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { courseRunId } = req.query;
  if (!courseRunId || typeof courseRunId !== 'string' || !courseRunId.trim()) {
    return res.status(400).json({ success: false, error: 'courseRunId is required' });
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return res.status(500).json({ success: false, error: 'SSG credentials not found' });
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const tp = await getTrainingPartnerIdentifiers();
    const tpUen  = tp.uen || credentials.uen;
    const tpCode = tp.code;

    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);
    const result = await api.searchEnrolment({
      enrolment: {
        course: { run: { id: courseRunId.trim() } },
        trainingPartner: { uen: tpUen, code: tpCode },
      },
      parameters: { page: 0, pageSize: 20 },
    } as any);

    if (result.error) {
      const status = Number(result.status) || 0;
      if (status === 404) {
        return res.status(200).json({ success: true, data: [] });
      }
      return res.status(status || 500).json({ success: false, error: result.error?.message ?? 'SSG error' });
    }

    // SSG returns enrolments as data.enrolment[] or data[]
    const raw: any = result.data;
    let enrolments: any[];
    if (Array.isArray(raw?.enrolment)) {
      enrolments = raw.enrolment;
    } else if (Array.isArray(raw)) {
      enrolments = (raw as any[]).map((item: any) => item.enrolment ?? item);
    } else {
      enrolments = [];
    }

    return res.status(200).json({ success: true, data: enrolments });
  } catch (error) {
    console.error('[enrolments/by-run] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
