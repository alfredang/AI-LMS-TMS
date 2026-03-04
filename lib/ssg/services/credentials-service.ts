/**
 * SSG Credentials Service
 * Retrieves SSG API credentials from the database
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export interface SSGCredentials {
  uen: string;
  encryptionKey: string;
  certificatePath: string;
  privateKeyPath: string;
  certificateContent?: string;
  privateKeyContent?: string;
}

export class SSGCredentialsService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL && process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    });
  }

  /**
   * Retrieves SSG credentials from the database
   * @param trainingProviderId Optional ID to get specific training provider's credentials
   * @returns SSG credentials including file contents
   */
  async getSSGCredentials(trainingProviderId?: number): Promise<SSGCredentials | null> {
    try {
      let query = `
        SELECT 
          uen,
          ssg_encryption_key,
          ssg_self_sign_cert_file,
          ssg_private_key_file
        FROM 
          training_provider
      `;
      
      const params: any[] = [];
      
      if (trainingProviderId) {
        query += ' WHERE id = $1';
        params.push(trainingProviderId);
      } else {
        // Get the first available training provider if no ID specified
        query += ' LIMIT 1';
      }

      const result = await this.pool.query(query, params);

      if (result.rows.length === 0) {
        console.warn('No training provider credentials found in database');
        return null;
      }

      const row = result.rows[0];
      
      // Convert relative paths to absolute paths
      const convertToAbsolutePath = (relativePath: string | null): string => {
        if (!relativePath) return '';
        
        // If path starts with '/', it's a relative path from the public directory
        if (relativePath.startsWith('/')) {
          return path.join(process.cwd(), 'public', relativePath);
        }
        
        // If it's already an absolute path, return as is
        if (path.isAbsolute(relativePath)) {
          return relativePath;
        }
        
        // Otherwise, treat as relative to public directory
        return path.join(process.cwd(), 'public', relativePath);
      };
      
      const credentials: SSGCredentials = {
        uen: row.uen,
        encryptionKey: row.ssg_encryption_key,
        certificatePath: convertToAbsolutePath(row.ssg_self_sign_cert_file),
        privateKeyPath: convertToAbsolutePath(row.ssg_private_key_file)
      };

      // Read certificate and private key file contents
      try {
        if (credentials.certificatePath && credentials.certificatePath.trim() !== '' && fs.existsSync(credentials.certificatePath)) {
          credentials.certificateContent = fs.readFileSync(credentials.certificatePath, 'utf8');
          console.log(`✅ Certificate loaded successfully from: ${credentials.certificatePath}`);
        } else {
          console.warn(`❌ Certificate file not found: ${credentials.certificatePath}`);
        }

        if (credentials.privateKeyPath && credentials.privateKeyPath.trim() !== '' && fs.existsSync(credentials.privateKeyPath)) {
          credentials.privateKeyContent = fs.readFileSync(credentials.privateKeyPath, 'utf8');
          console.log(`✅ Private key loaded successfully from: ${credentials.privateKeyPath}`);
        } else {
          console.warn(`❌ Private key file not found: ${credentials.privateKeyPath}`);
        }
      } catch (fileError) {
        console.error('Error reading certificate/key files:', fileError);
        throw new Error(`Failed to read SSL certificate or private key files: ${fileError instanceof Error ? fileError.message : 'Unknown error'}`);
      }

      return credentials;
    } catch (error) {
      console.error('Error retrieving SSG credentials from database:', error);
      throw new Error(`Failed to retrieve SSG credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates that all required SSG credentials are present and valid
   * @param credentials The credentials to validate
   * @returns Array of validation errors, empty if valid
   */
  validateCredentials(credentials: SSGCredentials): string[] {
    const errors: string[] = [];

    if (!credentials.uen || credentials.uen.trim().length === 0) {
      errors.push('UEN is required');
    }

    if (!credentials.encryptionKey || credentials.encryptionKey.trim().length === 0) {
      errors.push('Encryption key is required');
    }

    if (!credentials.certificateContent) {
      errors.push('Certificate file content is required');
    }

    if (!credentials.privateKeyContent) {
      errors.push('Private key file content is required');
    }

    // Validate UEN format (basic validation)
    if (credentials.uen) {
      const uenPattern = /^[0-9]{8,9}[A-Z]$|^T[0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]$/;
      if (!uenPattern.test(credentials.uen)) {
        errors.push('Invalid UEN format');
      }
    }

    // Validate encryption key format (base64, should decode to 32 bytes for AES-256)
    if (credentials.encryptionKey) {
      try {
        const decoded = Buffer.from(credentials.encryptionKey, 'base64');
        if (decoded.length !== 32) {
          errors.push('Encryption key must be 32 bytes when base64 decoded (AES-256)');
        }
      } catch {
        errors.push('Invalid encryption key format (must be valid base64)');
      }
    }

    return errors;
  }

  /**
   * Gets all available training providers with their UENs
   * @returns List of training providers
   */
  async getTrainingProviders(): Promise<Array<{ id: number; uen: string; name?: string }>> {
    try {
      const query = `
        SELECT 
          id,
          uen,
          company_name
        FROM 
          training_provider
        WHERE 
          uen IS NOT NULL 
          AND ssg_encryption_key IS NOT NULL
          AND ssg_self_sign_cert_file IS NOT NULL
          AND ssg_private_key_file IS NOT NULL
      `;

      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error retrieving training providers:', error);
      throw new Error(`Failed to retrieve training providers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Singleton instance
let ssgCredentialsService: SSGCredentialsService | null = null;

export const getSSGCredentialsService = (): SSGCredentialsService => {
  if (!ssgCredentialsService) {
    ssgCredentialsService = new SSGCredentialsService();
  }
  return ssgCredentialsService;
};