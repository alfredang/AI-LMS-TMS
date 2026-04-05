import { NextApiRequest, NextApiResponse } from 'next';
import { cors } from '../../../lib/cors';
import { uploadProfileImageBufferToDrive } from '../../../lib/google-drive/profile-image-helpers';

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { role, userId } = req.query;
    const { sourceUrl } = req.body || {};

    if (!sourceUrl || typeof sourceUrl !== 'string' || !isHttpUrl(sourceUrl)) {
      return res.status(400).json({
        success: false,
        error: 'A valid image URL is required.',
      });
    }

    const remoteResponse = await fetch(sourceUrl);
    if (!remoteResponse.ok) {
      return res.status(400).json({
        success: false,
        error: `Failed to fetch image URL: ${remoteResponse.status} ${remoteResponse.statusText}`,
      });
    }

    const mimeType = remoteResponse.headers.get('content-type') || 'application/octet-stream';
    if (!mimeType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        error: 'The provided URL does not point to an image.',
      });
    }

    const buffer = Buffer.from(await remoteResponse.arrayBuffer());
    const urlPath = new URL(sourceUrl).pathname;
    const fileNameFromUrl = urlPath.split('/').pop() || 'profile-image';

    const uploadResult = await uploadProfileImageBufferToDrive({
      buffer,
      mimeType,
      originalName: fileNameFromUrl,
      role: typeof role === 'string' ? role : 'user',
      userId: typeof userId === 'string' ? userId : undefined,
    });

    return res.status(200).json({
      success: true,
      data: {
        fileUrl: uploadResult.fileUrl,
        fileName: uploadResult.fileName,
        fileId: uploadResult.fileId,
        webViewLink: uploadResult.webViewLink,
        originalSourceUrl: sourceUrl,
      },
    });
  } catch (error) {
    console.error('❌ Profile image URL import error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Profile image import failed',
    });
  }
}
