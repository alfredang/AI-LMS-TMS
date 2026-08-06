import crypto from 'crypto';
import type { NextApiRequest } from 'next';

/**
 * Service-principal auth for machine callers (in-process scheduler, OpenClaw
 * agents, other tenant systems talking over HTTPS).
 *
 * Accepted secrets are SERVER-SIDE env vars only. NEXT_PUBLIC_SCHEDULER_SECRET
 * is deliberately NOT accepted: NEXT_PUBLIC_* values are compiled into the
 * public JS bundle, so treating one as an API key is an auth bypass.
 * There is no dev fallback — unset keys mean machine auth is disabled.
 */

function configuredKeys(): string[] {
  return [process.env.EXTERNAL_API_KEY_FOR_CLAWDBOT, process.env.SCHEDULER_SECRET].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Pull a candidate key from the places existing callers put it. */
function providedKey(req: NextApiRequest): string | null {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header) return header;
  const q = req.query?.authKey ?? req.query?.key;
  if (typeof q === 'string' && q) return q;
  const b = (req.body as any)?.authKey;
  if (typeof b === 'string' && b) return b;
  return null;
}

export function isServiceRequest(req: NextApiRequest): boolean {
  const candidate = providedKey(req);
  if (!candidate) return false;
  return configuredKeys().some((k) => safeEqual(candidate, k));
}
