/**
 * Centralized configuration for the application
 * Handles base URLs and other environment-specific settings
 */

/**
 * Get the base URL for the application
 * Uses NEXT_PUBLIC_BASE_URL for client-side access
 * Falls back to localhost:3000 for development
 */
export function getBaseUrl(): string {
  // Client-side: use NEXT_PUBLIC_BASE_URL
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_BASE_URL || '';
  }

  // Server-side: use BASE_URL or NEXT_PUBLIC_BASE_URL
  return process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
}

/**
 * Get the API base URL (same as base URL for Next.js app)
 */
export function getApiBaseUrl(): string {
  return getBaseUrl();
}

/**
 * Configuration object for easy access
 */
export const config = {
  baseUrl: getBaseUrl(),
  apiBaseUrl: getApiBaseUrl(),
  ssgApiBaseUrl: process.env.SSG_API_BASE_URL || 'https://api.ssg-wsg.sg',
  ssgApiVersion: process.env.SSG_API_VERSION || 'v1',
  uploadDir: process.env.UPLOAD_DIR || './public/uploads',
  maxFileSize: process.env.MAX_FILE_SIZE || '5MB',
  nodeEnv: process.env.NODE_ENV || 'development',
} as const;
