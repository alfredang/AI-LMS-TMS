#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import pg from 'pg';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { chromium } from 'playwright';

dotenv.config({ path: '.env.local' });
dotenv.config();

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL;
const STATE_PATH = path.resolve('output/playwright/linkedin-state.json');
const DELAY_MS = 1500;
const FORCE_REFRESH_ALL = process.argv.includes('--all');
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number.parseInt(LIMIT_ARG.split('=')[1], 10) : null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractGoogleDriveFolderId(input) {
  const trimmed = String(input || '').trim();
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];
  return trimmed || null;
}

function sanitizeFileName(name) {
  return String(name || 'trainer')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

async function getDriveClient(companySettings) {
  const oauth2Client = new google.auth.OAuth2(
    companySettings.google_client_id,
    companySettings.google_client_secret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: companySettings.google_refresh_token });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function uploadToGoogleDrive(drive, folderId, trainer, image) {
  const ext = image.contentType.includes('png') ? 'png' : 'jpg';
  const fileName = `${sanitizeFileName(trainer.full_name)}_${trainer.id.slice(0, 8)}.${ext}`;

  const createResponse = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: image.contentType,
      body: Readable.from(image.buffer),
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const fileId = createResponse.data.id;
  if (!fileId) throw new Error('Google Drive did not return a file ID');

  await drive.permissions.create({
    fileId,
    supportsAllDrives: true,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

async function extractProfileImageUrl(page) {
  return page.evaluate(() => {
    const candidates = [...document.images]
      .map((img, index) => {
        const src = img.currentSrc || img.src || '';
        const rect = img.getBoundingClientRect();
        const width = img.naturalWidth || rect.width || 0;
        const height = img.naturalHeight || rect.height || 0;
        const isProfilePhoto = src.includes('profile-displayphoto');
        const isGhost = /ghost|\/ghp_/i.test(src);
        const isTopCard = rect.top > -50 && rect.top < 900 && rect.left > -50 && rect.left < 700;
        const area = width * height;
        const sizeBonus = src.includes('400_400') || src.includes('800_800') ? 500000 : 0;
        const score = (isProfilePhoto ? 1000000 : 0) + (isTopCard ? 500000 : 0) + area + sizeBonus - index;
        return { src, width, height, top: rect.top, left: rect.left, score, isProfilePhoto, isGhost };
      })
      .filter(item => item.src && item.src.includes('licdn.com') && item.isProfilePhoto && !item.isGhost)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.src || null;
  });
}

async function downloadImage(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to download image: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { buffer, contentType };
}

async function main() {
  if (!DB_URL) throw new Error('DATABASE_URL is not configured.');
  if (!fs.existsSync(STATE_PATH)) throw new Error(`Playwright storage state not found at ${STATE_PATH}`);

  const pool = new Pool({ connectionString: DB_URL });
  const browser = await chromium.launch({ headless: true });

  try {
    const { rows: companyRows } = await pool.query(`
      SELECT trainer_profile_image_url, google_client_id, google_client_secret, google_refresh_token
      FROM training_provider
      LIMIT 1
    `);

    const companySettings = companyRows[0];
    if (!companySettings) throw new Error('Company settings not found.');

    const folderId = extractGoogleDriveFolderId(companySettings.trainer_profile_image_url);
    if (!folderId) throw new Error('Trainer Profile Image Folder is not configured.');
    if (!companySettings.google_client_id || !companySettings.google_client_secret || !companySettings.google_refresh_token) {
      throw new Error('Google OAuth credentials are not configured in Company Settings.');
    }

    const drive = await getDriveClient(companySettings);

    const query = FORCE_REFRESH_ALL ? `
      SELECT au.id, au.full_name, au.profile_picture_url, tp.linkedin_url
      FROM app_user au
      JOIN trainer_profile tp ON tp.user_id = au.id
      JOIN user_role_map ur ON ur.user_id = au.id AND ur.role = 'Trainer'
      WHERE tp.linkedin_url IS NOT NULL AND tp.linkedin_url <> ''
      ORDER BY au.full_name
    ` : `
      SELECT au.id, au.full_name, au.profile_picture_url, tp.linkedin_url
      FROM app_user au
      JOIN trainer_profile tp ON tp.user_id = au.id
      JOIN user_role_map ur ON ur.user_id = au.id AND ur.role = 'Trainer'
      WHERE tp.linkedin_url IS NOT NULL AND tp.linkedin_url <> ''
        AND (
          au.profile_picture_url IS NULL
          OR au.profile_picture_url = ''
          OR au.profile_picture_url LIKE '%drive.google.com%'
          OR au.profile_picture_url LIKE '%licdn.com%'
        )
      ORDER BY au.full_name
    `;

    const { rows } = await pool.query(query);
    const trainers = LIMIT ? rows.slice(0, LIMIT) : rows;

    console.log(`Found ${trainers.length} trainers to process${FORCE_REFRESH_ALL ? ' (force refresh mode)' : ''}.`);

    const context = await browser.newContext({ storageState: STATE_PATH });
    const page = await context.newPage();

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (let index = 0; index < trainers.length; index += 1) {
      const trainer = trainers[index];
      console.log(`[${index + 1}/${trainers.length}] ${trainer.full_name}`);

      try {
        await page.goto(trainer.linkedin_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);

        const profileImageUrl = await extractProfileImageUrl(page);
        if (!profileImageUrl) {
          console.log('  SKIP - no profile image found on page');
          skipped += 1;
          continue;
        }

        const image = await downloadImage(profileImageUrl);
        const driveUrl = await uploadToGoogleDrive(drive, folderId, trainer, image);

        await pool.query(
          'UPDATE app_user SET profile_picture_url = $1, updated_at = NOW() WHERE id = $2',
          [driveUrl, trainer.id]
        );

        console.log(`  UPDATED - ${driveUrl}`);
        updated += 1;
      } catch (error) {
        console.log(`  ERROR - ${error instanceof Error ? error.message : String(error)}`);
        failed += 1;
      }

      await sleep(DELAY_MS);
    }

    await context.close();

    console.log('\nSummary');
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
  } finally {
    await browser.close();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
