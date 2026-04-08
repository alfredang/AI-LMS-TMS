import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import { extractGoogleDriveFolderId, buildGoogleDriveImageUrl } from '../../../lib/google-drive/profile-image-helpers';

/**
 * POST /api/admin/sync-trainer-images-from-drive
 *
 * Scans the Google Drive trainer profile image folder, matches image files
 * to trainers by name, and updates profile_picture_url for matches.
 *
 * Flow: Admin downloads LinkedIn images to Google Drive folder →
 *       This API scans the folder and auto-assigns images to trainers.
 *
 * Body: { trainerIds?: string[] } — optional list of specific trainer user_ids.
 *       If omitted, processes all trainers without a profile image.
 */

function normalizeToken(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { trainerIds } = req.body || {};

    // Get the trainer profile image folder
    const tpResult = await pool.query(
      `SELECT trainer_profile_image_url FROM training_provider LIMIT 1`
    );
    const folderUrl = tpResult.rows[0]?.trainer_profile_image_url;
    if (!folderUrl) {
      return res.status(400).json({
        success: false,
        error: 'Trainer Profile Image Folder is not configured in Company Settings.',
      });
    }

    const folderId = extractGoogleDriveFolderId(folderUrl);
    const drive = await getDriveClient();

    // List all image files in the folder
    let allFiles: any[] = [];
    let pageToken: string | undefined;
    do {
      const listResult: any = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/')`,
        fields: 'nextPageToken, files(id, name, mimeType, createdTime)',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      allFiles = allFiles.concat(listResult.data.files || []);
      pageToken = listResult.data.nextPageToken;
    } while (pageToken);

    console.log(`📸 [Sync from Drive] Found ${allFiles.length} images in folder`);

    // Get trainers to process
    let query = `
      SELECT au.id AS user_id, au.full_name, au.profile_picture_url
      FROM app_user au
      JOIN trainer_profile tp ON tp.user_id = au.id
    `;
    const params: any[] = [];

    if (Array.isArray(trainerIds) && trainerIds.length > 0) {
      query += ` WHERE au.id = ANY($1)`;
      params.push(trainerIds);
    }

    query += ` ORDER BY au.full_name ASC`;
    const trainersResult = await pool.query(query, params);
    const trainers = trainersResult.rows;

    console.log(`📸 [Sync from Drive] Processing ${trainers.length} trainers`);

    const results: any[] = [];
    let updated = 0;
    let skipped = 0;

    for (const trainer of trainers) {
      const tokens = normalizeToken(trainer.full_name);
      if (tokens.length === 0) {
        skipped++;
        continue;
      }

      // Find best matching file by name
      const bestMatch = allFiles
        .map(file => {
          const fileTokens = normalizeToken(file.name || '');
          const score = tokens.reduce((sum: number, token: string) =>
            sum + (fileTokens.some((ft: string) => ft.includes(token) || token.includes(ft)) ? 1 : 0), 0);
          return { file, score };
        })
        .filter(m => m.score >= tokens.length) // Must match ALL name parts to avoid wrong matches
        .sort((a, b) => b.score - a.score)[0];

      if (!bestMatch) {
        skipped++;
        results.push({ name: trainer.full_name, status: 'no_match' });
        continue;
      }

      const imageUrl = buildGoogleDriveImageUrl(bestMatch.file.id);

      // Skip if already has this exact image
      if (trainer.profile_picture_url === imageUrl) {
        skipped++;
        results.push({ name: trainer.full_name, status: 'already_set' });
        continue;
      }

      // Update profile_picture_url
      await pool.query(
        `UPDATE app_user SET profile_picture_url = $1, updated_at = NOW() WHERE id = $2`,
        [imageUrl, trainer.user_id]
      );

      updated++;
      results.push({
        name: trainer.full_name,
        status: 'updated',
        matchedFile: bestMatch.file.name,
        imageUrl,
      });
      console.log(`  ✅ ${trainer.full_name} → ${bestMatch.file.name}`);
    }

    return res.status(200).json({
      success: true,
      summary: {
        totalFiles: allFiles.length,
        totalTrainers: trainers.length,
        updated,
        skipped,
      },
      results,
    });
  } catch (error) {
    console.error('❌ [Sync from Drive] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync trainer images from Drive',
    });
  }
}
