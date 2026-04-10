import pool from '../db';

const QBO_BASE_URL = process.env.QBO_BASE_URL || 'https://quickbooks.api.intuit.com';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const MINOR_VERSION = '75';

interface QBOCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  realmId: string;
}

let cachedToken: { token: string; expiresAt: number; appKey: string } | null = null;

async function getQBOCredentials(appOverride?: string): Promise<(QBOCredentials & { selectedApp: 'app1' | 'app2' }) | null> {
  try {
    const result = await pool.query(
      `SELECT a.key_name, a.key_value
       FROM training_provider_api a
       JOIN training_provider tp ON tp.id = a.training_provider_id
       WHERE a.key_name IN (
         'QUICKBOOKS_APP1_CLIENT_ID', 'QUICKBOOKS_APP1_CLIENT_SECRET',
         'QUICKBOOKS_APP2_CLIENT_ID', 'QUICKBOOKS_APP2_CLIENT_SECRET',
         'QUICKBOOKS_REFRESH_TOKEN', 'QUICKBOOKS_REALM_ID', 'QUICKBOOKS_DEFAULT_APP'
       )
       LIMIT 20`
    );
    const map: Record<string, string> = {};
    for (const row of result.rows) map[row.key_name] = row.key_value;

    const selectedApp = ((appOverride || map.QUICKBOOKS_DEFAULT_APP || 'app2').toLowerCase() === 'app1' ? 'app1' : 'app2') as 'app1' | 'app2';
    const clientId = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_CLIENT_ID : map.QUICKBOOKS_APP1_CLIENT_ID;
    const clientSecret = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_CLIENT_SECRET : map.QUICKBOOKS_APP1_CLIENT_SECRET;
    const refreshToken = map.QUICKBOOKS_REFRESH_TOKEN;
    const realmId = map.QUICKBOOKS_REALM_ID;

    if (clientId && clientSecret && refreshToken && realmId) {
      return { clientId, clientSecret, refreshToken, realmId, selectedApp };
    }
  } catch {
    // ignore and fall back to env
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const refreshToken = process.env.QBO_REFRESH_TOKEN;
  const realmId = process.env.QBO_REALM_ID;
  if (clientId && clientSecret && refreshToken && realmId) {
    return { clientId, clientSecret, refreshToken, realmId, selectedApp: 'app2' };
  }
  return null;
}

async function getAccessToken(creds: QBOCredentials, appKey: string): Promise<string> {
  if (cachedToken && cachedToken.appKey === appKey && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const resp = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(creds.refreshToken)}`,
  });

  if (!resp.ok) throw new Error(`QBO token refresh failed: ${resp.status} ${await resp.text()}`);
  const data: any = await resp.json();

  // Best-effort refresh token rotation persistence
  if (data.refresh_token && data.refresh_token !== creds.refreshToken) {
    try {
      await pool.query(
        `UPDATE training_provider_api SET key_value = $1 WHERE key_name = 'QUICKBOOKS_REFRESH_TOKEN'`,
        [data.refresh_token]
      );
    } catch {
      // ignore
    }
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 - 60000 : 3300000),
    appKey,
  };
  return cachedToken.token;
}

function baseCompanyUrl(realmId: string): string {
  return `${QBO_BASE_URL}/v3/company/${realmId}`;
}

async function qboFetchJson(opts: { token: string; url: string; method?: string; body?: any; accept?: string }): Promise<any> {
  const resp = await fetch(opts.url, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: opts.accept || 'application/json',
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = data?.Fault?.Error?.[0]?.Message || `QBO error ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function qboQuery(appOverride: string | undefined, query: string): Promise<any> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/query?query=${encodeURIComponent(query)}&minorversion=${MINOR_VERSION}`;
  return qboFetchJson({ token, url });
}

export async function qboCreateInvoice(appOverride: string | undefined, body: any): Promise<{ id: string; docNumber?: string; raw: any }> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/invoice?minorversion=${MINOR_VERSION}`;
  const data = await qboFetchJson({ token, url, method: 'POST', body });
  const inv = data?.Invoice ?? data;
  return { id: String(inv?.Id ?? ''), docNumber: inv?.DocNumber ? String(inv.DocNumber) : undefined, raw: data };
}

export async function qboSendInvoice(appOverride: string | undefined, invoiceId: string, sendTo?: string): Promise<void> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/invoice/${encodeURIComponent(invoiceId)}/send${sendTo ? `?sendTo=${encodeURIComponent(sendTo)}&` : '?'}minorversion=${MINOR_VERSION}`;
  await qboFetchJson({ token, url, method: 'POST' });
}

export async function qboFetchInvoicePdf(appOverride: string | undefined, invoiceId: string): Promise<Buffer> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/invoice/${encodeURIComponent(invoiceId)}/pdf?minorversion=${MINOR_VERSION}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/pdf',
    },
  });
  if (!resp.ok) throw new Error(`QBO pdf error ${resp.status}: ${await resp.text()}`);
  return Buffer.from(await resp.arrayBuffer());
}

export async function qboFindItemBySku(appOverride: string | undefined, sku: string): Promise<{ id: string; name: string; unitPrice: number } | null> {
  const q = `SELECT * FROM Item WHERE Sku = '${sku.replace(/'/g, "''")}'`;
  const data = await qboQuery(appOverride, q);
  const item = data?.QueryResponse?.Item?.[0];
  if (!item) return null;
  return { id: String(item.Id), name: String(item.Name || sku), unitPrice: Number(item.UnitPrice || 0) };
}

export async function qboFindOrCreateCustomerByEmail(appOverride: string | undefined, email: string, displayName: string): Promise<string> {
  const safeEmail = email.replace(/'/g, "''");
  const q = `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${safeEmail}'`;
  const data = await qboQuery(appOverride, q);
  const c = data?.QueryResponse?.Customer?.[0];
  if (c?.Id) return String(c.Id);

  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/customer?minorversion=${MINOR_VERSION}`;
  const body = {
    DisplayName: displayName,
    PrimaryEmailAddr: { Address: email },
  };
  const created = await qboFetchJson({ token, url, method: 'POST', body });
  const cust = created?.Customer ?? created;
  if (!cust?.Id) throw new Error('QBO customer create returned no Id');
  return String(cust.Id);
}

