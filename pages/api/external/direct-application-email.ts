import { withServiceAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  DirectApplicationEmailIngestError,
  ingestDirectApplicationEmail,
} from '../../../lib/directApplicationEmailIngest';

function getBearerToken(req: NextApiRequest): string {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      code: 'METHOD_NOT_ALLOWED',
      retryable: false,
      error: 'Method not allowed',
    });
  }

  const expected = String(process.env.DIRECT_APPLICATION_EMAIL_INGEST_TOKEN || '').trim();
  const provided = getBearerToken(req);

  if (!expected || provided !== expected) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      retryable: false,
      error: 'Unauthorized',
    });
  }

  try {
    const result = await ingestDirectApplicationEmail(req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof DirectApplicationEmailIngestError) {
      return res.status(err.statusCode).json({
        success: false,
        code: err.code,
        disabled: err.code === 'DISABLED' ? true : undefined,
        retryable: err.retryable,
        error: err.message,
      });
    }

    console.error('[direct-application-email] Unexpected error:', err);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      retryable: true,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withServiceAuth(handler);
