import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { uploadProfileImageBufferToDrive, extractGoogleDriveFileId } from '../../../lib/google-drive/profile-image-helpers';

/**
 * POST /api/admin/sync-trainer-images
 *
 * For trainers with a LinkedIn URL, uses Playwright (headless browser) to:
 *   1. Visit the LinkedIn profile page
 *   2. Extract the profile image URL from the rendered page
 *   3. Download the image
 *   4. Upload to Google Drive trainer image folder
 *   5. Save the URL to app_user.profile_picture_url
 *
 * Body: { trainerIds?: string[] } — optional list of specific trainer user_ids.
 *       If omitted, processes all trainers with linkedin_url but no profile image.
 */

async function extractLinkedInImageWithPlaywright(linkedinUrl: string, trainerName: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Wait a moment for images to load
    await page.waitForTimeout(2000);

    // Try multiple selectors for LinkedIn profile image
    let imageUrl: string | null = null;

    // Method 1: og:image meta tag (works on public profiles)
    imageUrl = await page.evaluate(() => {
      const meta = document.querySelector('meta[property="og:image"]');
      return meta?.getAttribute('content') || null;
    });

    // Method 2: Profile photo img element
    if (!imageUrl || imageUrl.includes('static.licdn.com/sc/h/') || imageUrl.includes('ghost-person')) {
      imageUrl = await page.evaluate(() => {
        // Try the main profile photo
        const selectors = [
          'img.pv-top-card-profile-picture__image',
          'img.profile-photo-edit__preview',
          'img[data-ghost-url]',
          '.pv-top-card__photo-wrapper img',
          'img.evi-image',
          'section.pv-top-card img[src*="media.licdn.com"]',
          'img[src*="profile-displayphoto"]',
          'img[alt*="photo"][src*="media.licdn.com"]',
        ];
        for (const sel of selectors) {
          const img = document.querySelector(sel) as HTMLImageElement;
          if (img?.src && img.src.includes('media.licdn.com') && !img.src.includes('ghost-person')) {
            return img.src;
          }
        }
        // Fallback: find any large LinkedIn CDN image
        const allImgs = Array.from(document.querySelectorAll('img[src*="media.licdn.com"]'));
        for (const img of allImgs) {
          const src = (img as HTMLImageElement).src;
          if (src.includes('profile') && !src.includes('ghost-person') && !src.includes('company-logo')) {
            return src;
          }
        }
        return null;
      });
    }

    await browser.close();
    browser = undefined;

    if (!imageUrl || imageUrl.includes('ghost-person') || imageUrl.includes('static.licdn.com/sc/h/')) {
      console.log(`  ⚠️ ${trainerName}: No profile image found on LinkedIn`);
      return null;
    }

    console.log(`  📸 ${trainerName}: Found image URL: ${imageUrl.substring(0, 80)}...`);

    // Download the image
    const imgRes = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
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
    console.error(`  ❌ ${trainerName}: Playwright error:`, e);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

        console.log(`  🔍 Processing: ${trainer.full_name} (${trainer.linkedin_url})`);

        const imageData = await extractLinkedInImageWithPlaywright(trainer.linkedin_url, trainer.full_name);
        if (!imageData) {
          skipped++;
          results.push({ name: trainer.full_name, status: 'no_image_found', linkedinUrl: trainer.linkedin_url });
          continue;
        }

        // Upload to Google Drive
        const uploadResult = await uploadProfileImageBufferToDrive({
          buffer: imageData.buffer,
          mimeType: imageData.mimeType,
          originalName: `${trainer.full_name.replace(/[^a-zA-Z0-9 ]/g, '_')}_linkedin.jpg`,
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
        });

        console.log(`  ✅ ${trainer.full_name}: uploaded to Google Drive`);
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

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
