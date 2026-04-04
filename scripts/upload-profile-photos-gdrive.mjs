#!/usr/bin/env node
/**
 * Fetches LinkedIn profile images for trainers and uploads them to Google Drive.
 * Updates app_user.profile_picture_url with the direct Google Drive URL.
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const DELAY_MS = 2500; // delay between LinkedIn fetches

let accessToken = '';

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Failed to get access token: ' + JSON.stringify(data));
  }
  accessToken = data.access_token;
  console.log('✅ Got Google Drive access token');
}

async function fetchLinkedInPhoto(linkedinUrl) {
  try {
    // Normalize URL
    let url = linkedinUrl.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    // Ensure www.linkedin.com format
    url = url.replace('sg.linkedin.com', 'www.linkedin.com');

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!res.ok) return null;
    const html = await res.text();

    // Try JSON-LD structured data first
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        if (jsonLd.image?.contentUrl) return jsonLd.image.contentUrl;
        if (typeof jsonLd.image === 'string') return jsonLd.image;
      } catch {}
    }

    // Try og:image meta tag
    const ogMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
    if (ogMatch?.[1] && ogMatch[1].includes('licdn.com')) return ogMatch[1];

    // Try any profile image URL in the HTML
    const imgMatch = html.match(/(https:\/\/media\.licdn\.com\/dms\/image\/[^"'\s]+profile-displayphoto[^"'\s]+)/);
    if (imgMatch?.[1]) return imgMatch[1];

    return null;
  } catch (e) {
    return null;
  }
}

async function downloadImage(imageUrl) {
  const res = await fetch(imageUrl, { redirect: 'follow' });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { buffer, contentType };
}

async function uploadToGoogleDrive(fileName, buffer, contentType) {
  // Multipart upload to Google Drive
  const boundary = 'boundary_' + Date.now();
  const metadata = JSON.stringify({
    name: fileName,
    parents: [DRIVE_FOLDER_ID],
  });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webContentLink,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  const data = await res.json();
  if (!data.id) {
    console.error('  ❌ Drive upload failed:', JSON.stringify(data));
    return null;
  }

  // Make file publicly viewable
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  // Direct image URL
  return `https://lh3.googleusercontent.com/d/${data.id}`;
}

async function main() {
  console.log('🚀 Starting LinkedIn photo → Google Drive upload');

  await getAccessToken();

  const pool = new pg.Pool({ connectionString: DB_URL });

  // Get all trainers with LinkedIn URLs but no profile picture (or local path)
  const { rows: trainers } = await pool.query(`
    SELECT u.id, u.full_name, u.email, u.profile_picture_url, tp.linkedin_url
    FROM app_user u
    JOIN trainer_profile tp ON u.id = tp.user_id
    JOIN user_role_map ur ON u.id = ur.user_id AND ur.role = 'Trainer'
    WHERE tp.linkedin_url IS NOT NULL AND tp.linkedin_url != ''
    AND (
      u.profile_picture_url IS NULL
      OR u.profile_picture_url = ''
      OR u.profile_picture_url LIKE '/uploads/%'
      OR u.profile_picture_url LIKE '%licdn.com%'
    )
    ORDER BY u.full_name
  `);

  console.log(`📋 Found ${trainers.length} trainers to process\n`);

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < trainers.length; i++) {
    const t = trainers[i];
    console.log(`[${i + 1}/${trainers.length}] ${t.full_name} (${t.email})`);
    console.log(`  LinkedIn: ${t.linkedin_url}`);

    // Skip non-LinkedIn URLs
    if (!t.linkedin_url.includes('linkedin.com')) {
      console.log('  ⏭️  Skipping (not a LinkedIn URL)');
      skipped++;
      continue;
    }

    // Fetch LinkedIn photo
    const photoUrl = await fetchLinkedInPhoto(t.linkedin_url);
    if (!photoUrl) {
      console.log('  ⚠️  No photo found on LinkedIn');
      failed++;
      await sleep(DELAY_MS);
      continue;
    }
    console.log('  📸 Found photo');

    // Download image
    const image = await downloadImage(photoUrl);
    if (!image) {
      console.log('  ❌ Failed to download image');
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    // Upload to Google Drive
    const ext = image.contentType.includes('png') ? 'png' : 'jpg';
    const fileName = `${t.full_name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}_${t.id.slice(0, 8)}.${ext}`;
    const driveUrl = await uploadToGoogleDrive(fileName, image.buffer, image.contentType);
    if (!driveUrl) {
      console.log('  ❌ Failed to upload to Drive');
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    // Update DB
    await pool.query(
      'UPDATE app_user SET profile_picture_url = $1, updated_at = NOW() WHERE id = $2',
      [driveUrl, t.id]
    );
    console.log(`  ✅ Uploaded → ${driveUrl}`);
    success++;

    await sleep(DELAY_MS);
  }

  console.log(`\n🏁 Done! Success: ${success}, Failed: ${failed}, Skipped: ${skipped}`);
  await pool.end();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
