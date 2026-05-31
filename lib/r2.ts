import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const {
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_URL,
} = process.env;

export function isR2Configured(): boolean {
  return Boolean(R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_URL);
}

let cachedClient: S3Client | null = null;
function getClient(): S3Client {
  if (!cachedClient) {
    if (!isR2Configured()) {
      throw new Error('R2 is not configured — set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL in .env.local');
    }
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT!,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return cachedClient;
}

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<string> {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return publicUrlFor(key);
}

export function publicUrlFor(key: string): string {
  if (!R2_PUBLIC_URL) throw new Error('R2_PUBLIC_URL not set');
  return `${R2_PUBLIC_URL.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}
