/**
 * SSG Encryption Service
 * Handles encryption and decryption using AES-256-CBC
 * Converted from Python utilities
 */

import crypto from 'crypto';

export class SSGEncryptionService {
  /**
   * Encrypts plaintext using AES-256-CBC with the provided key
   * @param plaintext - Text to encrypt
   * @param encryptionKey - Base64 encoded AES-256 key
   * @returns Base64 encoded ciphertext
   */
  encrypt(plaintext: string, encryptionKey: string): string {
    try {
      // Decode the base64 key
      const key = Buffer.from(encryptionKey, 'base64');
      
      if (key.length !== 32) {
        throw new Error('Invalid encryption key length. Expected 32 bytes for AES-256.');
      }

      // Generate a random IV (16 bytes for AES)
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipher('aes-256-cbc', key);
      cipher.setAutoPadding(true);
      
      // Encrypt the plaintext
      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      // Combine IV and encrypted data, then encode as base64
      const combined = Buffer.concat([iv, Buffer.from(encrypted, 'base64')]);
      return combined.toString('base64');
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypts ciphertext using AES-256-CBC with the provided key
   * @param ciphertext - Base64 encoded ciphertext (includes IV)
   * @param encryptionKey - Base64 encoded AES-256 key
   * @returns Decrypted plaintext
   */
  decrypt(ciphertext: string, encryptionKey: string): string {
    try {
      // Decode the base64 key
      const key = Buffer.from(encryptionKey, 'base64');
      
      if (key.length !== 32) {
        throw new Error('Invalid encryption key length. Expected 32 bytes for AES-256.');
      }

      // Decode the combined ciphertext
      const combined = Buffer.from(ciphertext, 'base64');
      
      if (combined.length < 16) {
        throw new Error('Invalid ciphertext: too short');
      }

      // Extract IV (first 16 bytes) and encrypted data
      const iv = combined.subarray(0, 16);
      const encryptedData = combined.subarray(16);
      
      // Create decipher
      const decipher = crypto.createDecipher('aes-256-cbc', key);
      decipher.setAutoPadding(true);
      
      // Decrypt the data
      let decrypted = decipher.update(encryptedData.toString('base64'), 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generates a new AES-256 encryption key
   * @returns Base64 encoded 32-byte key
   */
  generateKey(): string {
    const key = crypto.randomBytes(32);
    return key.toString('base64');
  }
}