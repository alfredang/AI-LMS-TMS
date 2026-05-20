/**
 * POST /api/admin/microsoft-redeem/import-session
 *
 * Accepts a Microsoft Learn storageState JSON (previously exported via
 * /export-session) and stores it so the code generator can reuse it. This
 * is how admins seed a headless production deployment — they sign in on
 * localhost where the headed Playwright window works, export, and import
 * here.
 *
 * Body: either the raw payload returned by /export-session
 *   { version, email, updatedAt, storageState }
 * or a bare Playwright storageState object
 *   { cookies: [...], origins: [...] }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { saveSession } from '../../../../lib/microsoft-redeem/db';

// Allow up to 5 MB — Playwright storageState with all origins can be large.
export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};

/** Loose shape check — has at least one of the fields Playwright populates. */
function looksLikeStorageState(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.cookies) || Array.isArray(obj.origins);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = req.body ?? {};
    // Accept either { storageState, email } wrapper or a bare storageState.
    let storageState: Record<string, unknown> | null = null;
    let email: string | null = null;

    if (looksLikeStorageState(body.storageState)) {
      storageState = body.storageState as Record<string, unknown>;
      email = typeof body.email === 'string' ? body.email.trim() || null : null;
    } else if (looksLikeStorageState(body)) {
      storageState = body as Record<string, unknown>;
    }

    if (!storageState) {
      return res.status(400).json({
        ok: false,
        error:
          'Invalid file. Expected a JSON file exported via the "Download session" ' +
          'button (or a raw Playwright storageState with "cookies" / "origins").',
      });
    }

    await saveSession(storageState, email);
    return res.status(200).json({ ok: true, email });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'Failed to import session' });
  }
}
