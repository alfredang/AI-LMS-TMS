import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { uploadProfileImageBufferToDrive } from '../../../lib/google-drive/profile-image-helpers';

/**
 * POST /api/admin/download-linkedin-image
 *
 * Downloads an image from a given URL (e.g. LinkedIn CDN),
 * uploads it permanently to the Google Drive trainer image folder,
 * and updates the trainer's profile_picture_url.
 *
 * Body: { userId, trainerName, imageUrl }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { userId, trainerName, imageUrl } = req.body || {};

  if (!userId || !imageUrl) {
    return res.status(400).json({ success: false, error: 'userId and imageUrl are required' });
  }

  try {
    // Download the image
    const imgRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!imgRes.ok) {
      return res.status(400).json({ success: false, error: `Failed to download image: HTTP ${imgRes.status}` });
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ success: false, error: 'URL does not point to an image' });
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 500) {
      return res.status(400).json({ success: false, error: 'Image too small — may be a placeholder' });
    }

    // Upload to Google Drive
    const safeName = (trainerName || 'trainer').replace(/[^a-zA-Z0-9 ]/g, '_');
    const uploadResult = await uploadProfileImageBufferToDrive({
      buffer,
      mimeType: contentType,
      originalName: `${safeName}_linkedin.jpg`,
      role: 'trainer',
      userId,
    });

    // Update profile_picture_url in DB
    await pool.query(
      `UPDATE app_user SET profile_picture_url = $1, updated_at = NOW() WHERE id = $2`,
      [uploadResult.fileUrl, userId]
    );

    console.log(`✅ [Download LinkedIn Image] ${trainerName}: ${uploadResult.fileUrl}`);

    return res.status(200).json({
      success: true,
      data: {
        fileUrl: uploadResult.fileUrl,
        fileId: uploadResult.fileId,
        fileName: uploadResult.fileName,
      },
    });
  } catch (error) {
    console.error('❌ [Download LinkedIn Image] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download and save image',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
