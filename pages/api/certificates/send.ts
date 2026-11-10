import { withAuth } from '@lib/auth/withAuth';
import {
  CertificateIssueError,
  issueCertificate,
  manualIssueOptions,
} from '@lib/services/certificateDelivery';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_ENROLLMENTS_PER_REQUEST = 100;

/**
 * POST /api/certificates/send
 * Admin/trainer UI bulk action. Machine callers should prefer
 * POST /api/external/certificates/issue, whose contract resolves learners and
 * public course-run IDs without exposing internal database details.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { courseRunId, enrolmentIds, resend = false } = req.body || {};
  if (!courseRunId || !Array.isArray(enrolmentIds) || enrolmentIds.length === 0) {
    return res.status(400).json({ success: false, message: 'courseRunId and enrolmentIds[] are required' });
  }
  if (enrolmentIds.length > MAX_ENROLLMENTS_PER_REQUEST) {
    return res.status(400).json({
      success: false,
      message: `A maximum of ${MAX_ENROLLMENTS_PER_REQUEST} enrollments can be processed at once.`,
    });
  }
  if (!enrolmentIds.every((id: unknown) => typeof id === 'string' && id.trim())) {
    return res.status(400).json({ success: false, message: 'Every enrolmentIds entry must be a non-empty string' });
  }

  const uniqueIds = [...new Set(enrolmentIds.map((id: string) => id.trim()))];
  const results: Array<Record<string, unknown>> = [];
  const manual = manualIssueOptions('Explicit certificate issue from the authenticated admin/trainer UI');

  for (const enrollmentId of uniqueIds) {
    try {
      const result = await issueCertificate({
        enrollmentId,
        courseRunId: String(courseRunId).trim(),
        sendEmail: true,
        resend: resend === true,
        dryRun: false,
        requestSource: 'lms:certificate-bulk-ui',
        ...manual,
      });
      results.push({
        enrollmentId,
        name: result.learnerName,
        status: result.status,
        certificateUrl: result.certificateUrl,
        error: result.error,
      });
    } catch (error: any) {
      const issueError = error instanceof CertificateIssueError ? error : null;
      results.push({
        enrollmentId,
        status: issueError?.code === 'ineligible' ? 'skipped' : 'error',
        error: issueError?.message || error?.message || String(error),
      });
    }
  }

  const sent = results.filter((result) => result.status === 'sent').length;
  const alreadySent = results.filter((result) => result.status === 'already_sent').length;
  const errors = results.filter((result) => result.status === 'error' || result.status === 'email_failed').length;
  return res.status(200).json({
    success: errors === 0,
    message: `${sent} certificate(s) sent, ${alreadySent} already sent, ${errors} error(s)`,
    results,
  });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'trainer', 'developer'] });
