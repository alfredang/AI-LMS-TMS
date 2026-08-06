import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../cors';
import { getAuthedUser, AuthedUser } from './requireRole';
import { isServiceRequest } from './serviceKey';

export interface WithAuthOptions {
  /**
   * Roles allowed to call this route (normalized names: admin,
   * trainingProvider, finance, payroll, trainer, developer, learner).
   * Empty/omitted = any authenticated user.
   */
  roles?: string[];
}

export interface AuthedApiRequest extends NextApiRequest {
  authUser?: AuthedUser;
}

/**
 * Standard guard for API routes: CORS/preflight, then a valid session token
 * (or machine API key) is required before the handler runs. Machine callers
 * pass every role check — they are trusted infrastructure.
 */
export function withAuth(handler: NextApiHandler, opts: WithAuthOptions = {}): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (cors(req, res)) return;

    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (opts.roles && opts.roles.length > 0 && !user.isService) {
      const ok = opts.roles.some((r) => user.roles.has(r));
      if (!ok) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    }

    (req as AuthedApiRequest).authUser = user;
    return handler(req, res);
  };
}

/**
 * Guard for machine-only routes (/api/external/*, internal sync): requires a
 * configured server-side API key; user sessions are not accepted.
 */
export function withServiceAuth(handler: NextApiHandler): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (cors(req, res)) return;
    if (!isServiceRequest(req)) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    return handler(req, res);
  };
}
