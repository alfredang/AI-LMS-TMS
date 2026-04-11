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
         'QUICKBOOKS_REFRESH_TOKEN',
         'QUICKBOOKS_APP1_REFRESH_TOKEN', 'QUICKBOOKS_APP2_REFRESH_TOKEN',
         'QUICKBOOKS_REALM_ID', 'QUICKBOOKS_DEFAULT_APP'
       )
       LIMIT 20`
    );
    const map: Record<string, string> = {};
    for (const row of result.rows) map[row.key_name] = row.key_value;

    const selectedApp = ((appOverride || map.QUICKBOOKS_DEFAULT_APP || 'app2').toLowerCase() === 'app1' ? 'app1' : 'app2') as 'app1' | 'app2';
    const clientId = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_CLIENT_ID : map.QUICKBOOKS_APP1_CLIENT_ID;
    const clientSecret = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_CLIENT_SECRET : map.QUICKBOOKS_APP1_CLIENT_SECRET;
    const refreshToken =
      (selectedApp === 'app2' ? map.QUICKBOOKS_APP2_REFRESH_TOKEN : map.QUICKBOOKS_APP1_REFRESH_TOKEN) ||
      map.QUICKBOOKS_REFRESH_TOKEN;
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
    // If env vars are used, assume app1 unless explicitly overridden (keeps behavior aligned with "App1 default" setups).
    const selectedApp = ((appOverride || process.env.QBO_DEFAULT_APP || 'app1').toLowerCase() === 'app2' ? 'app2' : 'app1') as 'app1' | 'app2';
    return { clientId, clientSecret, refreshToken, realmId, selectedApp };
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
        `UPDATE training_provider_api
         SET key_value = $1
         WHERE key_name = CASE
           WHEN $2 = 'app2' THEN 'QUICKBOOKS_APP2_REFRESH_TOKEN'
           WHEN $2 = 'app1' THEN 'QUICKBOOKS_APP1_REFRESH_TOKEN'
           ELSE 'QUICKBOOKS_REFRESH_TOKEN'
         END`,
        [data.refresh_token, appKey.split(':')[0]]
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

/**
 * QBO often returns Message: "A business validation error has occurred..."
 * while the real reason is in Error[].Detail — surface both.
 */
export function formatQboFaultMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return 'QuickBooks returned an error with no details';
  const d = data as Record<string, unknown>;
  const fault = d.Fault as { Error?: Array<{ Message?: string; Detail?: string; code?: string }> } | undefined;
  const errors = fault?.Error;
  if (!Array.isArray(errors) || errors.length === 0) {
    return (d as { message?: string }).message || JSON.stringify(data).slice(0, 800);
  }
  return errors
    .map(e => {
      const parts = [e.Message, e.Detail].filter(Boolean);
      if (e.code) parts.push(`(code ${e.code})`);
      return parts.join(' — ');
    })
    .join(' | ');
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
    throw new Error(formatQboFaultMessage(data) || `QBO error ${resp.status}`);
  }
  // Rare: 200 with Fault in body
  if (data?.Fault?.Error?.length) {
    throw new Error(formatQboFaultMessage(data));
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
  const sendPath = `${baseCompanyUrl(creds.realmId)}/invoice/${encodeURIComponent(invoiceId)}/send`;
  const params = new URLSearchParams({ minorversion: String(MINOR_VERSION) });
  if (sendTo?.trim()) params.set('sendTo', sendTo.trim());
  const url = `${sendPath}?${params.toString()}`;

  // Send must not use Content-Type: application/json with an empty body — Intuit often returns NPE (code 10000).
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(formatQboFaultMessage(data) || `QBO send invoice error ${resp.status}`);
  }
  if (data?.Fault?.Error?.length) {
    throw new Error(formatQboFaultMessage(data));
  }
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

/**
 * Singapore (and similar) QBO companies often require TaxCodeRef on invoice lines:
 * "Make sure all your transactions have a GST rate before you save."
 *
 * 1) If `QBO_INVOICE_LINE_TAX_CODE_REF` is set → use that Tax Code Id.
 * 2) Else query TaxCode and pick the best match (GST / Standard / SR / %-rated).
 * 3) Optional: `QBO_PREFER_TAX_CODE_NAME` = exact Tax Code name in QBO to force selection.
 */
export async function qboResolveInvoiceLineTaxCodeRef(appOverride: string | undefined): Promise<string> {
  const envId = process.env.QBO_INVOICE_LINE_TAX_CODE_REF?.trim();
  if (envId) return envId;

  const data = await qboQuery(appOverride, 'SELECT * FROM TaxCode MAXRESULTS 100');
  const raw = data?.QueryResponse?.TaxCode;
  const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (list.length === 0) {
    throw new Error(
      'QuickBooks returned no Tax Codes. Set QBO_INVOICE_LINE_TAX_CODE_REF to your GST tax code Id (Lists → Taxes in QBO), or configure tax codes in the company file.'
    );
  }

  const prefer = (process.env.QBO_PREFER_TAX_CODE_NAME || '').trim().toLowerCase();
  if (prefer) {
    const hit = list.find(t => String(t.Name || '').toLowerCase() === prefer);
    if (hit?.Id) return String(hit.Id);
  }

  const scoreRow = (t: any): number => {
    const name = String(t.Name || '');
    let s = 0;
    if (t.Active === false) return -999;
    if (/gst/i.test(name)) s += 20;
    if (/standard|sr|rated/i.test(name)) s += 15;
    if (/\d+\s*%/.test(name)) s += 10;
    if (/zero|zr|exempt|os|out of scope/i.test(name)) s -= 5;
    return s;
  };

  const sorted = [...list].sort((a, b) => scoreRow(b) - scoreRow(a));
  const best = sorted[0];
  if (best?.Id) {
    console.log(`[qbo] Using TaxCodeRef ${best.Id} (${best.Name}) for invoice lines`);
    return String(best.Id);
  }

  throw new Error('Could not resolve a Tax Code Id for GST lines. Set QBO_INVOICE_LINE_TAX_CODE_REF in environment.');
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

