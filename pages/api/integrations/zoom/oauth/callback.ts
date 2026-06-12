import type { NextApiRequest, NextApiResponse } from 'next';
import { exchangeZoomAuthorizationCode, getZoomCurrentUser, saveZoomConnectedUser } from '../../../../../lib/zoom/client';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error: oauthError } = req.query;

  if (oauthError) {
    return res.status(400).send(htmlPage('Zoom Authorization Failed', `Zoom returned: ${oauthError}`, false));
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).send(htmlPage('Missing Authorization Code', 'Zoom did not return an authorization code.', false));
  }

  try {
    await exchangeZoomAuthorizationCode(code);
    const user = await getZoomCurrentUser();
    await saveZoomConnectedUser(user);

    return res.status(200).send(htmlPage(
      'Zoom Connected',
      `Connected ${user.email || 'Zoom account'}. You can close this window and return to Company Settings.`,
      true
    ));
  } catch (error) {
    return res.status(500).send(htmlPage('Zoom Connection Failed', error instanceof Error ? error.message : 'Unexpected error', false));
  }
}

function htmlPage(title: string, message: string, success: boolean): string {
  const color = success ? '#16a34a' : '#dc2626';
  const icon = success ? '&#10004;' : '&#10008;';
  return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0f172a;color:white;margin:0">
  <div style="text-align:center;max-width:560px;padding:40px">
    <div style="font-size:64px;color:${color};margin-bottom:16px">${icon}</div>
    <h1 style="margin:0 0 12px">${title}</h1>
    <p style="color:#cbd5e1;line-height:1.6">${message}</p>
    <button onclick="window.close()" style="margin-top:24px;padding:10px 24px;background:#2563eb;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer">Close Window</button>
  </div>
</body></html>`;
}
