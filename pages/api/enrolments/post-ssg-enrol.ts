import type { NextApiRequest, NextApiResponse } from 'next';
import { runPostSsgEnrolSync } from '@/lib/services/postSsgEnrolSync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const {
    traineeEmail,
    courseReferenceNumber,
    courseRunId,
    sponsorshipType,
    traineeName,
    traineeNric,
    enrolmentId,
    referenceNumber,
    enrolmentStatus,
  } = req.body;

  if (!traineeEmail || !courseReferenceNumber || !courseRunId) {
    return res.status(400).json({
      success: false,
      error: 'traineeEmail, courseReferenceNumber, and courseRunId are required',
    });
  }

  const resolvedEnrolmentId = (enrolmentId ?? referenceNumber ?? '').trim() || null;

  try {
    const result = await runPostSsgEnrolSync({
      traineeEmail,
      courseReferenceNumber,
      courseRunId,
      sponsorshipType,
      traineeName,
      traineeNric,
      enrolmentId: resolvedEnrolmentId,
      enrolmentStatus,
    });

    return res.status(200).json({
      success: true,
      enrollmentCreated: result.enrollmentCreated,
      alreadyExisted: result.alreadyExisted,
      enrollmentId: result.dbEnrollmentId,
      created: result.created,
    });
  } catch (error) {
    console.error('Error in post-ssg-enrol:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}
