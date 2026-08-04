import { withAuth } from '@lib/auth/withAuth';
/**
 * GET /api/ssg/cert-check
 * Temporary debug endpoint — shows which cert/key is loaded from each source.
 * DELETE THIS AFTER VERIFYING.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../lib/ssg/services/credentials-service';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  // 1. What credentials-service returns (current active cert)
  try {
    const creds = await getSSGCredentialsService().getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    if (creds) {
      result.active = {
        source: (creds.certificatePath && fs.existsSync(creds.certificatePath)) ? 'file path' : 'env var',
        uen: creds.uen,
        encryptionKeyLength: creds.encryptionKey?.length ?? 0,
        certLoaded: !!creds.certificateContent,
        certStart: creds.certificateContent?.slice(28, 60) ?? null,
        keyLoaded: !!creds.privateKeyContent,
        keyValid: false,
      };
      if (creds.privateKeyContent) {
        try {
          crypto.createPrivateKey(creds.privateKeyContent);
          (result.active as Record<string, unknown>).keyValid = true;
        } catch (e) {
          (result.active as Record<string, unknown>).keyValid = false;
          (result.active as Record<string, unknown>).keyError = (e as Error).message.slice(0, 100);
        }
      }
    }
  } catch (e) {
    result.active = { error: (e as Error).message };
  }

  // 2. What's in the DB file path columns + read the actual files
  try {
    const { rows } = await pool.query(
      'SELECT ssg_self_sign_cert_file, ssg_private_key_file, ssg_encryption_key FROM training_provider LIMIT 1'
    );
    const row = rows[0];
    const certPath = row.ssg_self_sign_cert_file
      ? path.join(process.cwd(), 'public', row.ssg_self_sign_cert_file)
      : null;
    const keyPath = row.ssg_private_key_file
      ? path.join(process.cwd(), 'public', row.ssg_private_key_file)
      : null;

    result.filePathFromDB = {
      certPath: row.ssg_self_sign_cert_file,
      keyPath: row.ssg_private_key_file,
      encryptionKeyInDB: row.ssg_encryption_key ? row.ssg_encryption_key.slice(0, 10) + '...' : null,
      certFileExists: certPath ? fs.existsSync(certPath) : false,
      keyFileExists: keyPath ? fs.existsSync(keyPath) : false,
      certStart: null as string | null,
      keyValid: null as boolean | null,
      keyError: null as string | null,
    };

    if (certPath && fs.existsSync(certPath)) {
      const certContent = fs.readFileSync(certPath, 'utf8');
      result.filePathFromDB.certStart = certContent.slice(28, 60);
    }

    if (keyPath && fs.existsSync(keyPath)) {
      const keyContent = fs.readFileSync(keyPath, 'utf8');
      try {
        crypto.createPrivateKey(keyContent);
        result.filePathFromDB.keyValid = true;
      } catch (e) {
        result.filePathFromDB.keyValid = false;
        result.filePathFromDB.keyError = (e as Error).message.slice(0, 100);
      }
    }
  } catch (e) {
    result.filePathFromDB = { error: (e as Error).message };
  }

  // 3. Known cert fingerprints for identification
  const knownCerts: Record<string, string> = {
    'MIIGQTCCBCmgAwIBAgIUZlFUosQZBHmf': 'Skilleto (CERT_1)',
    'MIIGVTCCBD2gAwIBAgIURju131Ko7t6d': 'TMS_1 (CERT_2)',
    'MIIGQTCCBCmgAwIBAgIUQniiitugzkr5': 'TMS_3_NEW (CERT_3)',
  };

  // Identify active cert
  const activeCertStart = (result.active as Record<string, unknown>)?.certStart as string;
  if (activeCertStart && knownCerts[activeCertStart]) {
    (result.active as Record<string, unknown>).certIdentity = knownCerts[activeCertStart];
  }

  // Identify file cert
  const fileCertStart = (result.filePathFromDB as Record<string, unknown>)?.certStart as string;
  if (fileCertStart && knownCerts[fileCertStart]) {
    (result.filePathFromDB as Record<string, unknown>).certIdentity = knownCerts[fileCertStart];
  }

  // 4. Env vars present (names only, not values)
  result.envVarsSet = {
    CERT_VALUE: !!process.env.CERT_VALUE,
    CERT_1_CERT: !!process.env.CERT_1_CERT,
    PRIVATE_KEY_VALUE: !!process.env.PRIVATE_KEY_VALUE,
    CERT_1_KEY: !!process.env.CERT_1_KEY,
    ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
    SSG_ENCRYPTION_KEY: !!process.env.SSG_ENCRYPTION_KEY,
    CERT_1_ENCRYPTION_KEY: !!process.env.CERT_1_ENCRYPTION_KEY,
  };

  return res.status(200).json(result);
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
