import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureZoomColumns, getZoomCredentials, getZoomRedirectUri, getZoomScopes } from '../../../../../lib/zoom/client';

const ZOOM_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await ensureZoomColumns();
    const credentials = await getZoomCredentials();
    const redirectUri = await getZoomRedirectUri();
    if (!redirectUri.startsWith('http')) {
      return res.status(400).json({ error: 'Redirect URI could not be resolved. Set it in Company Setting → Zoom (or ensure NEXT_PUBLIC_BASE_URL is set) before connecting.' });
    }

    const scopes = await getZoomScopes();
    const state = `zoom_${Date.now()}`;
    const authUrl = `${ZOOM_AUTHORIZE_URL}?response_type=code&client_id=${encodeURIComponent(credentials.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
    return res.redirect(authUrl);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to start Zoom OAuth' });
  }
}
