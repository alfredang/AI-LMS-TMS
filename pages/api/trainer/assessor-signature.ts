import { withAuth, AuthedApiRequest } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAssessorDefaults, getAssessorRecord, saveAssessorRecord } from '@lib/assessment/signSubmissions';
import { signatureDataUrlToPng } from '@lib/assessment/assessorStamp';

// The signature PNG travels as a data URL; a 560x180 pad drawing is ~10-40 KB.
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const MAX_SIGNATURE_BYTES = 512 * 1024;

/**
 * The trainer's own assessor block: name, NRIC, date and a drawn signature.
 * Saved from the Trainer Profile page or the grading-roster dialog; stamped
 * onto learner submissions by /api/trainer/sign-assessments.
 *
 * Always acts on the *caller's* record — a user id in the request is ignored
 * unless the caller is a machine key.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = (req as AuthedApiRequest).authUser!;
  const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId : undefined;
  const queryUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const userId = auth.isService ? (bodyUserId || queryUserId) : auth.id;
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required for machine callers' });

  try {
    if (req.method === 'GET') {
      const record = await getAssessorRecord(userId);
      if (record) {
        return res.status(200).json({ success: true, exists: true, data: record });
      }
      const defaults = await getAssessorDefaults(userId);
      return res.status(200).json({
        success: true,
        exists: false,
        data: {
          user_id: userId,
          assessor_name: defaults.name,
          nric: defaults.nric,
          sign_date: new Date().toISOString().slice(0, 10),
          signature_png: null,
        },
      });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const { name, nric, signDate, signaturePng } = req.body || {};
      const cleanName = typeof name === 'string' ? name.trim() : '';
      const cleanNric = typeof nric === 'string' ? nric.trim().toUpperCase() : '';
      const cleanDate = typeof signDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(signDate)
        ? signDate
        : new Date().toISOString().slice(0, 10);

      if (!cleanName) return res.status(400).json({ success: false, error: 'Assessor name is required' });

      // undefined = keep the saved signature, null = clear it, string = replace it
      let cleanSignature: string | null | undefined = undefined;
      if (signaturePng === null || signaturePng === '') {
        cleanSignature = null;
      } else if (typeof signaturePng === 'string') {
        if (!signaturePng.startsWith('data:image/png;base64,')) {
          return res.status(400).json({ success: false, error: 'Signature must be a PNG data URL' });
        }
        let png: Buffer | null = null;
        try { png = signatureDataUrlToPng(signaturePng); } catch { png = null; }
        if (!png || png.length > MAX_SIGNATURE_BYTES) {
          return res.status(400).json({ success: false, error: 'Signature image is invalid or too large' });
        }
        cleanSignature = signaturePng;
      }

      const record = await saveAssessorRecord(userId, {
        name: cleanName, nric: cleanNric, signDate: cleanDate, signaturePng: cleanSignature,
      });
      return res.status(200).json({ success: true, exists: true, data: record });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error: any) {
    console.error('assessor-signature error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer', 'trainer'] });
