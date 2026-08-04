import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';

export const config = {
  api: {
    responseLimit: false,
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const fileId = typeof req.query.fileId === 'string' ? req.query.fileId.trim() : '';
  if (!fileId) {
    return res.status(400).json({ success: false, message: 'fileId is required' });
  }

  try {
    const drive = await getDriveClient();

    const metadata = await drive.files.get({
      fileId,
      fields: 'id,mimeType,name',
      supportsAllDrives: true,
    });

    const mimeType = metadata.data.mimeType || 'application/octet-stream';

    const driveResponse = await drive.files.get(
      {
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      },
      {
        responseType: 'stream',
      }
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');

    const stream = driveResponse.data;
    stream.on('error', (error: Error) => {
      console.error('❌ Google Drive image stream error:', error);
      if (!res.headersSent) {
        res.status(502).end('Failed to stream Google Drive image');
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error('❌ Failed to fetch Google Drive image:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to fetch Google Drive image',
    });
  }
}

export default withAuth(handler);
