import type { NextApiRequest } from 'next';

/**
 * Extract the SSG app override from request headers.
 * Components send `x-ssg-app` header with values like 'app1', 'app2', 'app3', 'app4'.
 * Returns undefined if no override is set (uses DB default).
 */
export function getAppFromRequest(req: NextApiRequest): string | undefined {
  const app = req.headers['x-ssg-app'];
  if (typeof app === 'string' && app.trim()) {
    return app.trim();
  }
  return undefined;
}
