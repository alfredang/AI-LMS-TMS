import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { uploadProfileImageBufferToDrive, buildGoogleDriveImageUrl, extractGoogleDriveFileId } from '../../../lib/google-drive/profile-image-helpers';

/**
 * POST /api/admin/sync-trainer-images
 *
 * For trainers with a LinkedIn URL but no profile image (or stale image),
 * fetches the LinkedIn public profile page, extracts the og:image,
 * downloads it, uploads to Google Drive, and saves the URL.
 *
 * Body: { trainerIds?: string[] } — optional list of specific trainer user_ids.
 *       If omitted, processes all trainers with linkedin_url but no profile_picture_url.
 */

async function fetchLinkedInImage(linkedinUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    // Fetch the LinkedIn public profile page
    const res = await fetch(linkedinUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Extract og:image from meta tags
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

    if (!ogImageMatch?.[1]) return null;

    let imageUrl = ogImageMatch[1];

    // Skip default LinkedIn placeholder images
    if (imageUrl.includes('static.licdn.com/sc/h/') || imageUrl.includes('ghost-person')) {
      return null;
    }

    // Download the image
    const imgRes = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    });

    if (!imgRes.ok) return null;

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;

    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Must be at least 1KB (skip tiny placeholders)
    if (buffer.length < 1024) return null;

    return { buffer, mimeType: contentType };
  } catch (e) {
    console.error(`Failed to fetch LinkedIn image from ${linkedinUrl}:`, e);
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { trainerIds } = req.body || {};

    // Get trainers with LinkedIn URLs
    let query = `
      SELECT au.id AS user_id, au.full_name, au.profile_picture_url, tp.linkedin_url
      FROM app_user au
      JOIN trainer_profile tp ON tp.user_id = au.id
      WHERE tp.linkedin_url IS NOT NULL AND tp.linkedin_url != ''
    `;
    const params: any[] = [];

    if (Array.isArray(trainerIds) && trainerIds.length > 0) {
      query += ` AND au.id = ANY($1)`;
      params.push(trainerIds);
    } else {
      // Only process trainers without a profile picture
      query += ` AND (au.profile_picture_url IS NULL OR au.profile_picture_url = '')`;
    }

    query += ` ORDER BY au.full_name ASC`;

    const result = await pool.query(query, params);
    const trainers = result.rows;

    console.log(`📸 [Sync Images] Found ${trainers.length} trainers to process`);

    const results: any[] = [];
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const trainer of trainers) {
      try {
        // Skip if already has a Google Drive image (unless specifically requested)
        if (!Array.isArray(trainerIds) && trainer.profile_picture_url && extractGoogleDriveFileId(trainer.profile_picture_url)) {
          skipped++;
          results.push({ name: trainer.full_name, status: 'already_has_image' });
          continue;
        }

        const imageData = await fetchLinkedInImage(trainer.linkedin_url);
        if (!imageData) {
          skipped++;
          results.push({ name: trainer.full_name, status: 'no_linkedin_image', linkedinUrl: trainer.linkedin_url });
          continue;
        }

        // Upload to Google Drive
        const uploadResult = await uploadProfileImageBufferToDrive({
          buffer: imageData.buffer,
          mimeType: imageData.mimeType,
          originalName: `${trainer.full_name.replace(/[^a-zA-Z0-9]/g, '_')}_linkedin.jpg`,
          role: 'trainer',
          userId: trainer.user_id,
        });

        // Update profile_picture_url in app_user
        await pool.query(
          `UPDATE app_user SET profile_picture_url = $1, updated_at = NOW() WHERE id = $2`,
          [uploadResult.fileUrl, trainer.user_id]
        );

        updated++;
        results.push({
          name: trainer.full_name,
          status: 'updated',
          imageUrl: uploadResult.fileUrl,
          driveFileId: uploadResult.fileId,
        });

        console.log(`  ✅ ${trainer.full_name}: uploaded LinkedIn image`);
      } catch (e) {
        failed++;
        results.push({
          name: trainer.full_name,
          status: 'error',
          error: e instanceof Error ? e.message : 'Unknown error',
        });
        console.error(`  ❌ ${trainer.full_name}: ${e}`);
      }
    }

    return res.status(200).json({
      success: true,
      summary: { total: trainers.length, updated, skipped, failed },
      results,
    });
  } catch (error) {
    console.error('❌ [Sync Images] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync trainer images',
    });
  }
}
