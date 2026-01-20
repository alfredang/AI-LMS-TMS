/**
 * URL helper utilities for constructing API and file URLs
 * Uses centralized base URL configuration
 */

import { getBaseUrl } from './config';

/**
 * Constructs an API endpoint URL
 * @param path - API path (should start with /api/)
 * @returns Full API URL
 */
export function getApiUrl(path: string): string {
  const baseUrl = getBaseUrl();
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

/**
 * Constructs a file download URL
 * @param filePath - File path (e.g., /uploads/file.pdf or uploads/file.pdf)
 * @returns Full download URL
 */
export function getFileUrl(filePath: string | undefined | null): string | undefined {
  if (!filePath) return undefined;

  // If already a full URL, return as-is
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }

  // If it's a data URL, return as-is
  if (filePath.startsWith('data:')) {
    return filePath;
  }

  const baseUrl = getBaseUrl();
  // Ensure path starts with /
  const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;

  return `${baseUrl}${normalizedPath}`;
}

/**
 * Constructs a download URL through the download API
 * @param filePath - File path to download
 * @returns Full download API URL
 */
export function getDownloadUrl(filePath: string | undefined | null): string | undefined {
  if (!filePath) return undefined;

  const baseUrl = getBaseUrl();

  // Remove base URL if it's already there
  let cleanPath = filePath.replace(baseUrl, '');

  // Remove leading slash for the API route
  cleanPath = cleanPath.startsWith('/') ? cleanPath.substring(1) : cleanPath;

  return `${baseUrl}/api/download/${cleanPath}`;
}

/**
 * Removes the base URL from a full URL, returning just the path
 * Useful when you need to send just the path to an API
 * @param fullUrl - Full URL including base URL
 * @returns Path without base URL
 */
export function stripBaseUrl(fullUrl: string | undefined | null): string | undefined {
  if (!fullUrl) return undefined;

  const baseUrl = getBaseUrl();
  return fullUrl.replace(baseUrl, '');
}

/**
 * Constructs an upload API URL
 * @param role - User role (learner, trainer, admin, developer)
 * @param fileType - Type of file being uploaded
 * @returns Full upload API URL
 */
export function getUploadUrl(role: string, fileType: string): string {
  return getApiUrl(`/api/upload/${role}-file?fileType=${fileType}`);
}

/**
 * Constructs a delete file API URL
 * @param fileUrl - URL of the file to delete
 * @returns Full delete API URL
 */
export function getDeleteFileUrl(fileUrl: string): string {
  const baseUrl = getBaseUrl();
  // Extract just the path (remove base URL if present)
  const filePath = fileUrl.replace(baseUrl, '');
  return getApiUrl(`/api/upload/delete-file?fileUrl=${encodeURIComponent(filePath)}`);
}
