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
  ssgApiBaseUrl: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
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
  async getSSGCredentials(trainingProviderId?: number, appOverride?: string): Promise<SSGCredentials | null> {
    try {
      let query = `
        SELECT
          uen,
          ssg_encryption_key,
          ssg_self_sign_cert_file,
          ssg_private_key_file,
          ssg_api_base_url,
          ssg_default_app,
          ssg_app1_cert_file,
          ssg_app1_private_key_file,
          ssg_app1_encryption_key,
          ssg_app3_cert_file,
          ssg_app3_private_key_file,
          ssg_app3_encryption_key,
          ssg_app4_client_id,
          ssg_app4_client_secret
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
      const selectedApp = appOverride || row.ssg_default_app || 'app2';

      // Resolve credentials based on selected app
      let certFile: string | null;
      let keyFile: string | null;
      let encKey: string | null;

      switch (selectedApp) {
        case 'app1':
          certFile = row.ssg_app1_cert_file;
          keyFile = row.ssg_app1_private_key_file;
          encKey = row.ssg_app1_encryption_key;
          break;
        case 'app3':
          certFile = row.ssg_app3_cert_file;
          keyFile = row.ssg_app3_private_key_file;
          encKey = row.ssg_app3_encryption_key;
          break;
        case 'app4':
          // App 4 uses OAuth (client_id/secret), no cert files
          certFile = null;
          keyFile = null;
          encKey = null;
          break;
        case 'app2':
        default:
          certFile = row.ssg_self_sign_cert_file;
          keyFile = row.ssg_private_key_file;
          encKey = row.ssg_encryption_key;
          break;
      }

      console.log(`[creds] Using SSG credentials from app: ${selectedApp}${appOverride ? ' (override)' : ' (default)'}`);

      // For App 4 (OAuth), return OAuth credentials
      if (selectedApp === 'app4') {
        return {
          uen: row.uen || process.env.TRAINING_PARTNER_UEN,
          encryptionKey: '',
          certificatePath: '',
          privateKeyPath: '',
          ssgApiBaseUrl: 'https://public-api.ssg-wsg.sg',
          oauthClientId: row.ssg_app4_client_id || process.env.SSG_CLIENT_ID || '',
          oauthClientSecret: row.ssg_app4_client_secret || process.env.SSG_CLIENT_SECRET || '',
        } as SSGCredentials;
      }

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
        uen: row.uen || process.env.TRAINING_PARTNER_UEN,
        encryptionKey: encKey || process.env.SSG_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || process.env.CERT_1_ENCRYPTION_KEY || '',
        certificatePath: convertToAbsolutePath(certFile),
        privateKeyPath: convertToAbsolutePath(keyFile),
        ssgApiBaseUrl: row.ssg_api_base_url || process.env.SSG_API_BASE_URL || process.env.SSG_API_URL || 'https://api.ssg-wsg.sg'
      };

      // Normalize PEM from env var — handles base64-encoded PEM, literal \n, Windows \r\n
      const resolvePem = (val: string): string => {
        const trimmed = val.trim();
        // If it doesn't start with -----, try base64 decode first
        if (!trimmed.startsWith('-----')) {
          try {
            const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
            if (decoded.startsWith('-----BEGIN')) return decoded;
          } catch { /* not base64, fall through */ }
        }
        // Otherwise normalize line endings
        return trimmed
          .replace(/\\n/g, '\n')   // literal backslash-n → real newline
          .replace(/\r\n/g, '\n')  // Windows CRLF → LF
          .replace(/\r/g, '\n');   // stray CR → LF
      };

      /** Ignore editor placeholders and non-PEM garbage in env. */
      const usablePemEnv = (raw: string | undefined): string | undefined => {
        if (raw === undefined || raw === null) return undefined;
        const t = raw.trim();
        if (t.length === 0) return undefined;
        if (/multiline environment variable|edit in normal view/i.test(t)) return undefined;
        const normalized = resolvePem(t);
        if (!normalized.includes('-----BEGIN')) return undefined;
        return raw;
      };

      const resolveOptionalPath = (p: string | undefined): string => {
        const t = p?.trim() ?? '';
        if (!t) return '';
        // Allow relative paths from project root
        return path.isAbsolute(t) ? t : path.join(process.cwd(), t);
      };

      // Read certificate and private key — DB file paths first, then env disk paths, then inline PEM env
      const certEnv = usablePemEnv(process.env.CERT_VALUE || process.env.CERT_1_CERT);
      const keyEnv = usablePemEnv(process.env.PRIVATE_KEY_VALUE || process.env.CERT_1_KEY);

      const envCertDisk = resolveOptionalPath(process.env.SSG_CERT_PATH);
      const envKeyDisk = resolveOptionalPath(process.env.SSG_PRIVATE_KEY_PATH);

      const pickCertPath = (): string => {
        const db = credentials.certificatePath?.trim() ?? '';
        if (db && fs.existsSync(db)) return db;
        if (envCertDisk && fs.existsSync(envCertDisk)) return envCertDisk;
        return db || envCertDisk;
      };

      const pickKeyPath = (): string => {
        const db = credentials.privateKeyPath?.trim() ?? '';
        if (db && fs.existsSync(db)) return db;
        if (envKeyDisk && fs.existsSync(envKeyDisk)) return envKeyDisk;
        return db || envKeyDisk;
      };

      const certPath = pickCertPath();
      const keyPath = pickKeyPath();

      // Certificate: DB file path first
      try {
        if (certPath && certPath.trim() !== '' && fs.existsSync(certPath)) {
          credentials.certificateContent = fs.readFileSync(certPath, 'utf8');
          console.log(`[creds] Certificate loaded from file path: ${certPath}`);
        } else if (certEnv) {
          credentials.certificateContent = resolvePem(certEnv);
          console.log('[creds] Certificate loaded from env var');
        } else {
          console.warn(`[creds] ❌ Certificate not found — no DB file path and no env var`);
        }
      } catch (fileError) {
        if (certEnv) {
          credentials.certificateContent = resolvePem(certEnv);
          console.log('[creds] Certificate loaded from env var (file read failed)');
        } else {
          console.error('[creds] Error reading certificate file:', fileError);
        }
      }

      // Private key: DB file path first
      try {
        if (keyPath && keyPath.trim() !== '' && fs.existsSync(keyPath)) {
          credentials.privateKeyContent = fs.readFileSync(keyPath, 'utf8');
          console.log(`[creds] Private key loaded from file path: ${keyPath}`);
        } else if (keyEnv) {
          credentials.privateKeyContent = resolvePem(keyEnv);
          console.log('[creds] Private key loaded from env var');
        } else {
          console.warn(`[creds] ❌ Private key not found — no DB file path and no env var`);
        }
      } catch (fileError) {
        if (keyEnv) {
          credentials.privateKeyContent = resolvePem(keyEnv);
          console.log('[creds] Private key loaded from env var (file read failed)');
        } else {
          console.error('[creds] Error reading private key file:', fileError);
        }
      }

      // Log encryption key source
      if (row.ssg_encryption_key) {
        console.log('[creds] Encryption key loaded from DB');
      } else if (process.env.SSG_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || process.env.CERT_1_ENCRYPTION_KEY) {
        console.log('[creds] Encryption key loaded from env var');
      } else {
        console.warn('[creds] ❌ No encryption key found');
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