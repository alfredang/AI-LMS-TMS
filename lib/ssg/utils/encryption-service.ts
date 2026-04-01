/**
 * SSG Encryption Service
 * Convenience wrappers around Cryptography using ENCRYPTION_KEY from env.
 * Usage:
 *   import { encryptPayload, decryptResponse } from '@/lib/ssg/utils/encryption-service';
 */

import { Cryptography } from './cryptography';

function getKey(encryptionKey?: string): string {
  const key = encryptionKey || process.env.SSG_ENCRYPTION_KEY;
  if (!key) throw new Error('No encryption key provided and SSG_ENCRYPTION_KEY is not set');
  return key;
}

/**
 * Encrypt a payload object using AES-256-CBC.
 * @param payload - The data to encrypt.
 * @param encryptionKey - Optional key. Falls back to SSG_ENCRYPTION_KEY env var.
 * @returns Base64 encoded encrypted string.
 */
export function encryptPayload(payload: object, encryptionKey?: string): string {
  return Cryptography.encryptJSON(getKey(encryptionKey), payload);
}

/**
 * Decrypt a base64 encoded response string using AES-256-CBC.
 * @param encryptedData - Base64 encoded encrypted string.
 * @param encryptionKey - Optional key. Falls back to SSG_ENCRYPTION_KEY env var.
 * @returns Decrypted plaintext string.
 */
export function decryptResponse(encryptedData: string, encryptionKey?: string): string {
  return Cryptography.decrypt(getKey(encryptionKey), encryptedData, false) as string;
}
