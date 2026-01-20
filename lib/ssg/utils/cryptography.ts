/**
 * Encryption/Decryption utilities for SSG API
 * Converted from Python cipher/encrypt_decrypt.py
 * Uses Node.js built-in crypto module for AES-256/CBC/PKCS7
 */

import crypto from 'crypto';

export class Cryptography {
  // Initialization vector used for encryption and decryption
  private static readonly INITIAL_VECTOR: Buffer = Buffer.from('SSGAPIInitVector', 'utf8');

  /**
   * Encrypts a message using AES-256/CBC/PKCS7 and returns the ciphertext.
   * 
   * @param key - Base64 encoded encryption key
   * @param plaintext - Message to be encrypted (string or Buffer)
   * @param returnBytes - If true, returns Buffer; otherwise returns base64 string
   * @returns Encrypted ciphertext
   */
  static encrypt(key: string, plaintext: string | Buffer, returnBytes: boolean = true): Buffer | string {
    try {
      // Convert plaintext to Buffer if it's a string
      const plaintextBuffer = typeof plaintext === 'string' 
        ? Buffer.from(plaintext, 'utf8') 
        : plaintext;

      // Decode the base64 key
      const encKey = Buffer.from(key, 'base64');
      
      // Validate key length (should be 32 bytes for AES-256)
      if (encKey.length !== 32) {
        throw new Error('Invalid key length. Expected 32 bytes for AES-256.');
      }

      // Create cipher with AES-256-CBC
      const cipher = crypto.createCipheriv('aes-256-cbc', encKey, Cryptography.INITIAL_VECTOR);
      
      // Encrypt the plaintext
      let ciphertext = cipher.update(plaintextBuffer);
      ciphertext = Buffer.concat([ciphertext, cipher.final()]);

      // Encode to base64
      const encodedCiphertext = ciphertext.toString('base64');

      return returnBytes ? Buffer.from(encodedCiphertext, 'base64') : encodedCiphertext;
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypts an encrypted message and returns the plaintext.
   * 
   * @param key - Base64 encoded decryption key
   * @param ciphertext - Encrypted message to be decrypted (string or Buffer)
   * @param returnBytes - If true, returns Buffer; otherwise returns string
   * @returns Decrypted plaintext
   */
  static decrypt(key: string, ciphertext: string | Buffer, returnBytes: boolean = true): Buffer | string {
    try {
      // Sanitize and decode the input text
      let ciphertextStr: string;
      if (typeof ciphertext === 'string') {
        // Remove whitespace/newlines which may be introduced when copying/pasting
        ciphertextStr = ciphertext.replace(/\s/g, '');
      } else {
        ciphertextStr = ciphertext.toString('base64');
      }

      // Decode the base64 ciphertext
      const decodedCiphertext = Buffer.from(ciphertextStr, 'base64');

      // Decode the base64 key
      const encKey = Buffer.from(key, 'base64');
      
      // Validate key length
      if (encKey.length !== 32) {
        throw new Error('Invalid key length. Expected 32 bytes for AES-256.');
      }

      // Create decipher with AES-256-CBC
      const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, Cryptography.INITIAL_VECTOR);
      
      // Decrypt the ciphertext
      let plaintext = decipher.update(decodedCiphertext);
      plaintext = Buffer.concat([plaintext, decipher.final()]);

      return returnBytes ? plaintext : plaintext.toString('utf8');
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generates a random AES-256 key (32 bytes) encoded as base64
   * 
   * @returns Base64 encoded AES-256 key
   */
  static generateKey(): string {
    const key = crypto.randomBytes(32);
    return key.toString('base64');
  }

  /**
   * Validates if a base64 string represents a valid AES-256 key
   * 
   * @param key - Base64 encoded key to validate
   * @returns True if valid, false otherwise
   */
  static validateKey(key: string): boolean {
    try {
      const decodedKey = Buffer.from(key, 'base64');
      return decodedKey.length === 32;
    } catch {
      return false;
    }
  }

  /**
   * Encrypts a JSON object and returns base64 encoded ciphertext
   * 
   * @param key - Base64 encoded encryption key
   * @param data - Object to encrypt
   * @returns Base64 encoded encrypted JSON
   */
  static encryptJSON(key: string, data: any): string {
    const jsonString = JSON.stringify(data);
    return this.encrypt(key, jsonString, false) as string;
  }

  /**
   * Decrypts base64 encoded ciphertext and parses as JSON
   * 
   * @param key - Base64 encoded decryption key
   * @param ciphertext - Base64 encoded encrypted JSON
   * @returns Parsed JSON object
   */
  static decryptJSON(key: string, ciphertext: string): any {
    const decryptedString = this.decrypt(key, ciphertext, false) as string;
    return JSON.parse(decryptedString);
  }
}

// Utility functions for common encryption/decryption tasks
export class CryptoUtils {
  /**
   * Creates a hash of the input using SHA-256
   * 
   * @param input - String to hash
   * @returns SHA-256 hash as hex string
   */
  static sha256(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Creates an HMAC signature using SHA-256
   * 
   * @param message - Message to sign
   * @param secret - Secret key for HMAC
   * @returns HMAC signature as hex string
   */
  static hmacSha256(message: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
  }

  /**
   * Generates a random string of specified length
   * 
   * @param length - Length of random string
   * @returns Random hex string
   */
  static randomString(length: number): string {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
  }

  /**
   * Encodes string to base64
   * 
   * @param input - String to encode
   * @returns Base64 encoded string
   */
  static toBase64(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64');
  }

  /**
   * Decodes base64 string
   * 
   * @param input - Base64 string to decode
   * @returns Decoded string
   */
  static fromBase64(input: string): string {
    return Buffer.from(input, 'base64').toString('utf8');
  }

  /**
   * Validates if a string is valid base64
   * 
   * @param input - String to validate
   * @returns True if valid base64, false otherwise
   */
  static isValidBase64(input: string): boolean {
    try {
      return Buffer.from(input, 'base64').toString('base64') === input;
    } catch {
      return false;
    }
  }
}

// Export default instance for convenience
export default Cryptography;