import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { getDriveClient } from '../../../lib/google-drive/drive-helpers';
import { extractGoogleDriveFileId, extractGoogleDriveFolderId } from '../../../lib/google-drive/profile-image-helpers';

const DRIVE_LOOKUP_CACHE = new Map<string, string | null>();
const DEFAULT_TRAINER_AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#F3F4F6"/>
    <circle cx="20" cy="15" r="7" fill="#A3A3A3"/>
    <path d="M8 34c2.8-6.2 7.5-9.5 12-9.5S29.2 27.8 32 34" fill="#A3A3A3"/>
  </svg>`
)}`;

function normalizeToken(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeImageUrl(profilePictureUrl: string): string {
  const driveFileId = extractGoogleDriveFileId(profilePictureUrl);
  if (driveFileId) {
    return `/api/google-drive/image?fileId=${encodeURIComponent(driveFileId)}`;
  }

  if (
    profilePictureUrl.startsWith('/') ||
    profilePictureUrl.startsWith('data:') ||
    profilePictureUrl.startsWith('http://') ||
    profilePictureUrl.startsWith('https://')
  ) {
    return profilePictureUrl;
  }

  return `/${profilePictureUrl.replace(/^\/+/, '')}`;
}

async function getTrainerImageFolderId(): Promise<string | null> {
  const result = await pool.query(
    `SELECT trainer_profile_image_url
     FROM training_provider
     LIMIT 1`
  );

  const folderUrl = result.rows[0]?.trainer_profile_image_url;
  return folderUrl ? extractGoogleDriveFolderId(folderUrl) : null;
}

async function findDriveFileIdByTrainerName(trainerName: string): Promise<string | null> {
  const tokens = normalizeToken(trainerName);
  const cacheKey = tokens.join(' ');

  if (!cacheKey) return null;
  if (DRIVE_LOOKUP_CACHE.has(cacheKey)) return DRIVE_LOOKUP_CACHE.get(cacheKey) || null;

  const folderId = await getTrainerImageFolderId();
  if (!folderId) {
    DRIVE_LOOKUP_CACHE.set(cacheKey, null);
    return null;
  }

  const q = [
    `'${folderId}' in parents`,
    ...tokens.slice(0, 4).map(token => `name contains '${token.replace(/'/g, "\\'")}'`),
    'trashed = false',
  ].join(' and ');

  const drive = await getDriveClient();
  const result = await drive.files.list({
    q,
    fields: 'files(id,name,mimeType)',
    pageSize: 25,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const bestMatch = (result.data.files || [])
    .filter(file => Boolean(file.id))
    .map(file => {
      const fileTokens = normalizeToken(file.name || '');
      const score = tokens.reduce((sum, token) => sum + (fileTokens.includes(token) ? 1 : 0), 0);
      return { file, score };
    })
    .sort((a, b) => b.score - a.score)[0];

  const fileId = bestMatch?.score ? bestMatch.file.id || null : null;
  DRIVE_LOOKUP_CACHE.set(cacheKey, fileId);
  return fileId;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const profilePictureUrl =
    typeof req.query.profilePictureUrl === 'string' ? req.query.profilePictureUrl.trim() : '';

  if (!name) {
    return res.status(400).json({ success: false, message: 'name is required' });
  }

  try {
    if (profilePictureUrl) {
      return res.redirect(307, normalizeImageUrl(profilePictureUrl));
    }

    const driveFileId = await findDriveFileIdByTrainerName(name);
    if (driveFileId) {
      return res.redirect(307, `/api/google-drive/image?fileId=${encodeURIComponent(driveFileId)}`);
    }

    return res.redirect(307, DEFAULT_TRAINER_AVATAR);
  } catch (error) {
    console.error('❌ Failed to resolve trainer image:', error);
    return res.redirect(307, DEFAULT_TRAINER_AVATAR);
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
