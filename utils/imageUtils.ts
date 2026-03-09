/**
 * Utility functions for handling image URLs in profile components
 */

import { getBaseUrl } from '../lib/config';

/**
 * Ensures that image URLs are absolute, pointing to the API server
 * Handles both relative URLs from old data and absolute URLs from new uploads
 * @param url - The image URL (can be relative or absolute)
 * @returns Absolute URL pointing to the base URL
 */
export function ensureAbsoluteImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;

  // If it's a data URL (base64), return as-is
  if (url.startsWith('data:')) {
    return url;
  }

  // Strip localhost URLs — extract just the path so they can be re-resolved with the correct host.
  // This handles old DB records that stored full http://localhost:PORT/... URLs.
  if (/^https?:\/\/localhost(:\d+)?\//.test(url)) {
    url = url.replace(/^https?:\/\/localhost(:\d+)?/, '');
  }

  // If URL is already absolute (non-localhost), return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  const baseUrl = getBaseUrl().replace(/\/$/, '');

  // For locally-hosted uploads, use relative URLs when baseUrl is empty or localhost.
  // This prevents baked-in localhost build-time values from breaking image URLs in production.
  const isLocalhostBase = !baseUrl || /^https?:\/\/localhost(:\d+)?$/.test(baseUrl);

  // If it's a relative URL, make it absolute pointing to API server
  if (url.startsWith('/uploads/')) {
    return isLocalhostBase ? url : `${baseUrl}${url}`;
  }

  // If it doesn't start with /, add the leading slash and make absolute
  if (url.startsWith('uploads/')) {
    return isLocalhostBase ? `/${url}` : `${baseUrl}/${url}`;
  }

  // For any other relative URL, assume it needs the API server prefix
  return isLocalhostBase ? `/${url}` : `${baseUrl}/${url}`;
}

/**
 * Gets the proper image URL for course images with fallback
 * Handles blob URLs, relative URLs, and provides fallback placeholder
 * @param imageUrl - The image URL from the course data
 * @param courseId - Course ID for generating unique placeholder
 * @returns Proper image URL or fallback placeholder
 */
export function getCourseImageUrl(imageUrl?: string, courseId?: string): string {
  if (!imageUrl) {
    return `https://picsum.photos/seed/${courseId || 'default'}/400/200`;
  }

  // Strip localhost URLs before further processing
  if (/^https?:\/\/localhost(:\d+)?\//.test(imageUrl)) {
    imageUrl = imageUrl.replace(/^https?:\/\/localhost(:\d+)?/, '');
  }

  // If it's already a full URL (http/https), use it as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  const baseUrl = getBaseUrl().replace(/\/$/, '');
  const isLocalhostBase = !baseUrl || /^https?:\/\/localhost(:\d+)?$/.test(baseUrl);

  // If it starts with /uploads, it's a local file - prepend the server URL
  if (imageUrl.startsWith('/uploads/')) {
    return isLocalhostBase ? imageUrl : `${baseUrl}${imageUrl}`;
  }

  // If it's a blob URL (from file upload preview), return it as-is
  // Note: blob URLs from database will be invalid after page reload,
  // but we let the browser handle the error and fall back to onerror handling
  if (imageUrl.startsWith('blob:')) {
    return imageUrl;
  }

  // Default fallback
  return `https://picsum.photos/seed/${courseId || 'default'}/400/200`;
}

/**
 * Gets the display filename from a URL path (removes timestamp prefix if present)
 * @param url - The file URL or path
 * @returns Original filename without timestamp prefix
 */
export function getOriginalFilename(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  
  const filename = url.split('/').pop() || '';
  
  // Check if filename has timestamp prefix (matches pattern: numbers_filename)
  const timestampMatch = filename.match(/^\d+_(.+)$/);
  if (timestampMatch) {
    return timestampMatch[1];
  }
  
  return filename;
}