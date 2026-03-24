/**
 * SSG Encryption Service
 * Convenience wrappers around Cryptography using ENCRYPTION_KEY from env.
 * Usage:
 *   import { encryptPayload, decryptResponse } from '@/lib/ssg/utils/encryption-service';
 */

import { Cryptography } from './cryptography';

function getKey(): string {
  const key = process.env.SSG_ENCRYPTION_KEY;
  if (!key) throw new Error('SSG_ENCRYPTION_KEY is not set in environment variables');
  return key;
}

/**
 * Encrypt a payload object using AES-256-CBC.
 * @param payload - The data to encrypt.
 * @returns Base64 encoded encrypted string.
 */
export function encryptPayload(payload: object): string {
  return Cryptography.encryptJSON(getKey(), payload);
}

/**
 * Decrypt a base64 encoded response string using AES-256-CBC.
 * @param encryptedData - Base64 encoded encrypted string.
 * @returns Decrypted plaintext string.
 */
export function decryptResponse(encryptedData: string): string {
  return Cryptography.decrypt(getKey(), encryptedData, false) as string;
}
