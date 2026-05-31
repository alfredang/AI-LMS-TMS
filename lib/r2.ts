import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pool from './db';

// R2 credentials live in the training_provider row (per-tenant, like every
// other integration in this app — Magento, n8n, OpenClaw, Zoom, Google).
// Schema columns (added on demand by training-provider/update.ts):
//   r2_endpoint, r2_access_key_id, r2_secret_access_key, r2_bucket, r2_public_url
//
// Single source of truth: the DB. No env-var fallback.

interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}

interface CachedConfig {
  config: R2Config | null;
  expiresAt: number;
}

let cached: CachedConfig | null = null;
let cachedClient: { client: S3Client; config: R2Config } | null = null;
const CACHE_TTL_MS = 60_000; // re-read DB every minute so cred updates propagate

async function loadConfig(): Promise<R2Config | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  let dbValues: Partial<R2Config> = {};
  try {
    const r = await pool.query(
      `SELECT r2_endpoint, r2_access_key_id, r2_secret_access_key, r2_bucket, r2_public_url
       FROM training_provider ORDER BY created_at ASC NULLS LAST LIMIT 1`,
    );
    if (r.rows[0]) {
      dbValues = {
        endpoint: r.rows[0].r2_endpoint || undefined,
        accessKeyId: r.rows[0].r2_access_key_id || undefined,
        secretAccessKey: r.rows[0].r2_secret_access_key || undefined,
        bucket: r.rows[0].r2_bucket || undefined,
        publicUrl: r.rows[0].r2_public_url || undefined,
      };
    }
  } catch {
    // Columns might not exist yet on a fresh schema — fall through to env.
  }

  const merged: R2Config = {
    endpoint: dbValues.endpoint || '',
    accessKeyId: dbValues.accessKeyId || '',
    secretAccessKey: dbValues.secretAccessKey || '',
    bucket: dbValues.bucket || '',
    publicUrl: dbValues.publicUrl || '',
  };

  const complete = !!(merged.endpoint && merged.accessKeyId && merged.secretAccessKey && merged.bucket && merged.publicUrl);
  const config = complete ? merged : null;
  cached = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

export async function isR2Configured(): Promise<boolean> {
  const c = await loadConfig();
  return c !== null;
}

async function getClient(): Promise<{ client: S3Client; config: R2Config }> {
  const config = await loadConfig();
  if (!config) {
    throw new Error('R2 is not configured. Set credentials under Company Settings → Integrations → Cloudflare R2.');
  }
  if (cachedClient && cachedClient.config.endpoint === config.endpoint && cachedClient.config.accessKeyId === config.accessKeyId) {
    return cachedClient;
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClient = { client, config };
  return cachedClient;
}

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<string> {
  const { client, config } = await getClient();
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${config.publicUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

export async function publicUrlFor(key: string): Promise<string> {
  const config = await loadConfig();
  if (!config) throw new Error('R2 not configured');
  return `${config.publicUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

// Tests / settings UI: bust the cache after an admin updates R2 creds
// so the next upload uses fresh values without waiting for the TTL.
export function invalidateR2ConfigCache(): void {
  cached = null;
  cachedClient = null;
}
