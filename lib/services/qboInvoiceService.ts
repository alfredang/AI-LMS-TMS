import pool from '../db';

const QBO_BASE_URL = process.env.QBO_BASE_URL || 'https://quickbooks.api.intuit.com';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const MINOR_VERSION = '75';

interface QBOCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fallbackRefreshToken?: string;
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

    // Default to app1 unless explicitly configured to app2.
    // This matches the existing `/api/quickbooks/proxy` behavior and avoids surprises when only app1 creds are set up.
    const selectedApp = ((appOverride || map.QUICKBOOKS_DEFAULT_APP || 'app1').toLowerCase() === 'app2' ? 'app2' : 'app1') as
      | 'app1'
      | 'app2';
    const clientId = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_CLIENT_ID : map.QUICKBOOKS_APP1_CLIENT_ID;
    const clientSecret = selectedApp === 'app2' ? map.QUICKBOOKS_APP2_CLIENT_SECRET : map.QUICKBOOKS_APP1_CLIENT_SECRET;
    const appSpecific =
      (selectedApp === 'app2' ? map.QUICKBOOKS_APP2_REFRESH_TOKEN : map.QUICKBOOKS_APP1_REFRESH_TOKEN) || '';
    const globalToken = map.QUICKBOOKS_REFRESH_TOKEN || '';
    const refreshToken = (appSpecific || globalToken).trim();
    const realmId = map.QUICKBOOKS_REALM_ID;

    if (clientId && clientSecret && refreshToken && realmId) {
      return {
        clientId,
        clientSecret,
        refreshToken,
        fallbackRefreshToken: appSpecific && globalToken && appSpecific.trim() !== globalToken.trim() ? globalToken.trim() : undefined,
        realmId,
        selectedApp,
      };
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
  const refreshOnce = async (refreshToken: string) => {
    const resp = await fetch(QBO_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    const text = await resp.text();
    const parsed = text ? JSON.parse(text) : null;
    return { ok: resp.ok, status: resp.status, data: parsed as any, rawText: text };
  };

  let usedRefreshToken = creds.refreshToken;
  let r1 = await refreshOnce(usedRefreshToken);
  if (!r1.ok) {
    const isInvalidGrant = String(r1.data?.error || '').toLowerCase() === 'invalid_grant';
    if (isInvalidGrant && creds.fallbackRefreshToken) {
      usedRefreshToken = creds.fallbackRefreshToken;
      r1 = await refreshOnce(usedRefreshToken);
    }
  }

  if (!r1.ok) {
    throw new Error(`QBO token refresh failed: ${r1.status} ${r1.rawText}`);
  }

  const data: any = r1.data;

  // Best-effort refresh token rotation persistence
  if (data.refresh_token && data.refresh_token !== usedRefreshToken) {
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

function normalizeEmailAddressList(value: unknown): string | null {
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && typeof (value as { Address?: unknown }).Address === 'string'
        ? (value as { Address: string }).Address
        : '';
  const emails = raw
    .split(/[,\n;]/)
    .map(email => email.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(emails));
  return unique.length ? unique.join(',') : null;
}

function findNestedValueByKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const child of Object.values(obj)) {
    const found = findNestedValueByKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
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

export async function qboReadPreferences(appOverride: string | undefined): Promise<any> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/preferences?minorversion=${MINOR_VERSION}`;
  const data = await qboFetchJson({ token, url, method: 'GET' });
  return data?.Preferences ?? data;
}

export async function qboGetDefaultInvoiceEmailCc(appOverride: string | undefined): Promise<string | null> {
  const envCc = normalizeEmailAddressList(process.env.QBO_INVOICE_EMAIL_CC);
  if (envCc) return envCc;

  const preferences = await qboReadPreferences(appOverride);
  return normalizeEmailAddressList(findNestedValueByKey(preferences, 'SalesEmailCc'));
}

export async function qboGetDefaultInvoiceEmailBcc(appOverride: string | undefined): Promise<string | null> {
  const envBcc = normalizeEmailAddressList(process.env.QBO_INVOICE_EMAIL_BCC);
  if (envBcc) return envBcc;

  const preferences = await qboReadPreferences(appOverride);
  return normalizeEmailAddressList(findNestedValueByKey(preferences, 'SalesEmailBcc'));
}

export async function qboGetQuickBooksInvoiceEmailFields(
  appOverride: string | undefined
): Promise<{ cc: string; bcc: string }> {
  const preferences = await qboReadPreferences(appOverride);
  return {
    cc: normalizeEmailAddressList(findNestedValueByKey(preferences, 'SalesEmailCc')) || '',
    bcc: normalizeEmailAddressList(findNestedValueByKey(preferences, 'SalesEmailBcc')) || '',
  };
}

export async function qboGetDefaultInvoiceEmailFields(
  appOverride: string | undefined
): Promise<{ BillEmailCc?: { Address: string }; BillEmailBcc?: { Address: string } }> {
  let dbCc: string | null = null;
  let dbBcc: string | null = null;
  let hasDbCcSetting = false;
  let hasDbBccSetting = false;

  try {
    const result = await pool.query(
      `SELECT da_invoice_email_cc, da_invoice_email_bcc
       FROM training_provider
       LIMIT 1`
    );
    hasDbCcSetting = result.rows[0]?.da_invoice_email_cc !== null && result.rows[0]?.da_invoice_email_cc !== undefined;
    hasDbBccSetting = result.rows[0]?.da_invoice_email_bcc !== null && result.rows[0]?.da_invoice_email_bcc !== undefined;
    dbCc = normalizeEmailAddressList(result.rows[0]?.da_invoice_email_cc);
    dbBcc = normalizeEmailAddressList(result.rows[0]?.da_invoice_email_bcc);
  } catch {
    // Columns may not exist until the migration is applied. Fall back below.
  }

  const envCc = normalizeEmailAddressList(process.env.QBO_INVOICE_EMAIL_CC);
  const envBcc = normalizeEmailAddressList(process.env.QBO_INVOICE_EMAIL_BCC);
  let cc = hasDbCcSetting ? dbCc : envCc;
  let bcc = hasDbBccSetting ? dbBcc : envBcc;

  if ((!hasDbCcSetting && !cc) || (!hasDbBccSetting && !bcc)) {
    try {
      const preferences = await qboReadPreferences(appOverride);
      if (!hasDbCcSetting) cc = cc || normalizeEmailAddressList(findNestedValueByKey(preferences, 'SalesEmailCc'));
      if (!hasDbBccSetting) bcc = bcc || normalizeEmailAddressList(findNestedValueByKey(preferences, 'SalesEmailBcc'));
    } catch (err) {
      console.warn('[qbo] Could not read invoice email CC/BCC preferences:', err instanceof Error ? err.message : err);
    }
  }

  return {
    ...(cc ? { BillEmailCc: { Address: cc } } : {}),
    ...(bcc ? { BillEmailBcc: { Address: bcc } } : {}),
  };
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

export async function qboReadInvoice(
  appOverride: string | undefined,
  invoiceId: string
): Promise<{ id: string; docNumber?: string; syncToken?: string; raw: any }> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/invoice/${encodeURIComponent(invoiceId)}?minorversion=${MINOR_VERSION}`;
  const data = await qboFetchJson({ token, url, method: 'GET' });
  const inv = data?.Invoice ?? data;
  return {
    id: String(inv?.Id ?? ''),
    docNumber: inv?.DocNumber ? String(inv.DocNumber) : undefined,
    syncToken: inv?.SyncToken ? String(inv.SyncToken) : undefined,
    raw: inv,
  };
}

export async function qboFindInvoiceByDocNumber(
  appOverride: string | undefined,
  docNumber: string
): Promise<{ id: string; customerRef?: string; syncToken?: string; raw: any } | null> {
  const safe = String(docNumber || '').replace(/'/g, "''").trim();
  if (!safe) return null;
  const data = await qboQuery(appOverride, `SELECT * FROM Invoice WHERE DocNumber = '${safe}' MAXRESULTS 1`);
  const inv = data?.QueryResponse?.Invoice;
  const row = Array.isArray(inv) ? inv[0] : inv;
  if (!row?.Id) return null;
  return {
    id: String(row.Id),
    customerRef: row?.CustomerRef?.value ? String(row.CustomerRef.value) : undefined,
    syncToken: row?.SyncToken ? String(row.SyncToken) : undefined,
    raw: row,
  };
}

/**
 * Find an invoice whose DocNumber matches a QBO SQL LIKE pattern (`%` wildcards
 * supported). Used to recover an orphan main invoice created by a prior
 * attempt when today's computed DocNumber differs (e.g. retry on a later
 * day) — we match by the stable last-6 of the enrolment reference instead.
 * Returns the most recent match.
 */
export async function qboFindInvoiceByDocNumberLike(
  appOverride: string | undefined,
  pattern: string
): Promise<{ id: string; docNumber?: string; customerRef?: string; syncToken?: string; raw: any } | null> {
  const safe = String(pattern || '').replace(/'/g, "''").trim();
  if (!safe) return null;
  const data = await qboQuery(
    appOverride,
    `SELECT * FROM Invoice WHERE DocNumber LIKE '${safe}' ORDERBY MetaData.CreateTime DESC MAXRESULTS 1`
  );
  const inv = data?.QueryResponse?.Invoice;
  const row = Array.isArray(inv) ? inv[0] : inv;
  if (!row?.Id) return null;
  return {
    id: String(row.Id),
    docNumber: row?.DocNumber ? String(row.DocNumber) : undefined,
    customerRef: row?.CustomerRef?.value ? String(row.CustomerRef.value) : undefined,
    syncToken: row?.SyncToken ? String(row.SyncToken) : undefined,
    raw: row,
  };
}

/**
 * Sparse-update an existing QBO invoice. Only the fields in `fields` are
 * modified; all other fields are preserved. Caller must supply the current
 * SyncToken (available via qboReadInvoice / qboFindInvoiceByDocNumber).
 */
export async function qboSparseUpdateInvoice(
  appOverride: string | undefined,
  invoiceId: string,
  syncToken: string,
  fields: Record<string, any>
): Promise<{ id: string; syncToken?: string; raw: any }> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/invoice?minorversion=${MINOR_VERSION}`;
  const body = { Id: invoiceId, SyncToken: syncToken, sparse: true, ...fields };
  const data = await qboFetchJson({ token, url, method: 'POST', body });
  const inv = data?.Invoice ?? data;
  return {
    id: String(inv?.Id ?? ''),
    syncToken: inv?.SyncToken ? String(inv.SyncToken) : undefined,
    raw: inv,
  };
}

export async function qboCreatePayment(
  appOverride: string | undefined,
  body: any
): Promise<{ id: string; syncToken?: string; raw: any }> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/payment?minorversion=${MINOR_VERSION}`;
  const data = await qboFetchJson({ token, url, method: 'POST', body });
  const p = data?.Payment ?? data;
  return { id: String(p?.Id ?? ''), syncToken: p?.SyncToken ? String(p.SyncToken) : undefined, raw: data };
}

export async function qboReadPayment(
  appOverride: string | undefined,
  paymentId: string
): Promise<{ id: string; syncToken?: string; raw: any }> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/payment/${encodeURIComponent(paymentId)}?minorversion=${MINOR_VERSION}`;
  const data = await qboFetchJson({ token, url, method: 'GET' });
  const p = data?.Payment ?? data;
  return { id: String(p?.Id ?? ''), syncToken: p?.SyncToken ? String(p.SyncToken) : undefined, raw: p };
}

export async function qboVoidPayment(appOverride: string | undefined, paymentId: string, syncToken: string): Promise<void> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/payment?operation=void&minorversion=${MINOR_VERSION}`;
  await qboFetchJson({ token, url, method: 'POST', body: { Id: paymentId, SyncToken: syncToken } });
}

export async function qboDeleteInvoice(appOverride: string | undefined, invoiceId: string, syncToken: string): Promise<void> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/invoice?operation=delete&minorversion=${MINOR_VERSION}`;
  await qboFetchJson({ token, url, method: 'POST', body: { Id: invoiceId, SyncToken: syncToken } });
}

export async function qboSendInvoice(appOverride: string | undefined, invoiceId: string, sendTo?: string): Promise<void> {
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const emailFields = await qboGetDefaultInvoiceEmailFields(appOverride);
  const trimmedSendTo = sendTo?.trim();

  // Important: QBO often only sends emails if the Invoice has BillEmail populated.
  // When `sendTo` is provided (from our /send endpoint), explicitly set BillEmail first.
  const mergedSparseFields: Record<string, any> = { ...emailFields };
  if (trimmedSendTo) {
    mergedSparseFields.BillEmail = { Address: trimmedSendTo };
  }

  if (Object.keys(mergedSparseFields).length > 0) {
    const invoice = await qboReadInvoice(appOverride, invoiceId);
    if (invoice.syncToken) {
      await qboSparseUpdateInvoice(appOverride, invoiceId, invoice.syncToken, mergedSparseFields);
    }
  }
  const sendPath = `${baseCompanyUrl(creds.realmId)}/invoice/${encodeURIComponent(invoiceId)}/send`;
  const params = new URLSearchParams({ minorversion: String(MINOR_VERSION) });
  if (trimmedSendTo) params.set('sendTo', trimmedSendTo);
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

/**
 * Tax code for WSQ subsidy / SkillsFuture credit lines (no GST on those amounts).
 * 1) `QBO_OOS_TAX_CODE_REF` or `QBO_SUBSIDY_LINE_TAX_CODE_REF`
 * 2) Query TaxCode and prefer names like "Out of Scope" / "Zero" / "Exempt"
 * 3) Fallback `"18"` (matches legacy createDirectApplicationInvoice defaults)
 */
export async function qboResolveOosTaxCodeRef(appOverride: string | undefined): Promise<string> {
  const envId =
    process.env.QBO_OOS_TAX_CODE_REF?.trim() || process.env.QBO_SUBSIDY_LINE_TAX_CODE_REF?.trim();
  if (envId) return envId;

  const data = await qboQuery(appOverride, 'SELECT * FROM TaxCode MAXRESULTS 100');
  const raw = data?.QueryResponse?.TaxCode;
  const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const scoreOos = (t: any): number => {
    const name = String(t.Name || '').toLowerCase();
    if (t.Active === false) return -999;
    let s = 0;
    if (/out of scope|^\s*oos\s*$/i.test(name)) s += 40;
    if (/zero|zr|exempt|no gst|non-taxable/i.test(name)) s += 25;
    if (/gst|standard|sr|rated|\d+\s*%/.test(name)) s -= 10;
    return s;
  };
  const sorted = [...list].sort((a, b) => scoreOos(b) - scoreOos(a));
  const best = sorted[0];
  if (best?.Id && scoreOos(best) > 0) {
    console.log(`[qbo] Using TaxCodeRef ${best.Id} (${best.Name}) for OOS / subsidy lines`);
    return String(best.Id);
  }
  return '18';
}

function escapeQboStringLiteral(value: string): string {
  return String(value || '').replace(/'/g, "''");
}

function pickFirstQboItem(
  data: any,
  fallbackName: string
): { id: string; name: string; unitPrice: number } | null {
  const raw = data?.QueryResponse?.Item;
  const item = Array.isArray(raw) ? raw[0] : raw;
  if (!item?.Id) return null;
  return {
    id: String(item.Id),
    name: String(item.Name || fallbackName),
    unitPrice: Number(item.UnitPrice || 0),
  };
}

export async function qboFindItemBySku(appOverride: string | undefined, sku: string): Promise<{ id: string; name: string; unitPrice: number } | null> {
  const safeSku = escapeQboStringLiteral(sku);
  if (!safeSku) return null;
  const q = `SELECT * FROM Item WHERE Sku = '${safeSku}' MAXRESULTS 1`;
  const data = await qboQuery(appOverride, q);
  return pickFirstQboItem(data, sku);
}

export async function qboFindItemByName(
  appOverride: string | undefined,
  itemName: string
): Promise<{ id: string; name: string; unitPrice: number } | null> {
  const safeName = escapeQboStringLiteral(itemName);
  if (!safeName) return null;
  const q = `SELECT * FROM Item WHERE Name = '${safeName}' MAXRESULTS 1`;
  const data = await qboQuery(appOverride, q);
  return pickFirstQboItem(data, itemName);
}

/**
 * Look up a QuickBooks "Term" by exact Name (e.g. "25 Days SFC", "35 Days Term").
 * Returns the Term Id for use as SalesTermRef on an invoice, or null if no
 * matching Term is configured in the QBO realm.
 */
export async function qboFindTermByName(
  appOverride: string | undefined,
  termName: string
): Promise<{ id: string; name: string } | null> {
  const safeName = escapeQboStringLiteral(termName);
  if (!safeName) return null;
  const data = await qboQuery(appOverride, `SELECT * FROM Term WHERE Name = '${safeName}' MAXRESULTS 1`);
  const raw = data?.QueryResponse?.Term;
  const term = Array.isArray(raw) ? raw[0] : raw;
  if (!term?.Id) return null;
  return { id: String(term.Id), name: String(term.Name || termName) };
}

/**
 * Look up a QuickBooks Customer by exact DisplayName.
 *
 * Used for fixed-identity customers like "WSQ Individual (Not for Company)"
 * and "Singapore Workforce Development Agency (WSG)" that are configured
 * once in QBO and reused across all DA invoices. Returns null if the
 * customer doesn't exist — callers should throw a helpful error so the
 * admin knows to create the Customer in QB.
 */
export async function qboFindCustomerByName(
  appOverride: string | undefined,
  displayName: string
): Promise<{ id: string; displayName: string } | null> {
  const safe = escapeQboStringLiteral(displayName);
  if (!safe) return null;
  const data = await qboQuery(
    appOverride,
    `SELECT * FROM Customer WHERE DisplayName = '${safe}' MAXRESULTS 1`
  );
  const raw = data?.QueryResponse?.Customer;
  const c = Array.isArray(raw) ? raw[0] : raw;
  if (!c?.Id) return null;
  return { id: String(c.Id), displayName: String(c.DisplayName || displayName) };
}

/**
 * Find a QB customer by exact DisplayName. Throws a descriptive error if not found.
 * Use this for fixed customers (e.g. "WSQ Individual (Not for Company)") that must be pre-created in QB.
 */
export async function qboFindCustomerByDisplayName(appOverride: string | undefined, displayName: string): Promise<string> {
  const safe = displayName.replace(/'/g, "''");
  const data = await qboQuery(appOverride, `SELECT * FROM Customer WHERE DisplayName = '${safe}' MAXRESULTS 1`);
  const c = data?.QueryResponse?.Customer?.[0];
  if (c?.Id) return String(c.Id);
  throw new Error(
    `QuickBooks customer "${displayName}" not found. Please create this customer in QuickBooks first (Customers → New Customer).`
  );
}

/**
 * Find a QB customer by exact DisplayName, creating it if not found.
 * Use this for system customers (e.g. "WSG") that should exist but may need auto-creation.
 */
export async function qboFindOrCreateCustomerByDisplayName(appOverride: string | undefined, displayName: string): Promise<string> {
  const safe = displayName.replace(/'/g, "''");
  const data = await qboQuery(appOverride, `SELECT * FROM Customer WHERE DisplayName = '${safe}' MAXRESULTS 1`);
  const c = data?.QueryResponse?.Customer?.[0];
  if (c?.Id) return String(c.Id);
  const creds = await getQBOCredentials(appOverride);
  if (!creds) throw new Error('QuickBooks credentials not configured');
  const appKey = `${creds.selectedApp}:${creds.realmId}`;
  const token = await getAccessToken(creds, appKey);
  const url = `${baseCompanyUrl(creds.realmId)}/customer?minorversion=${MINOR_VERSION}`;
  const created = await qboFetchJson({ token, url, method: 'POST', body: { DisplayName: displayName } });
  const cust = created?.Customer ?? created;
  if (!cust?.Id) throw new Error('QBO customer create returned no Id');
  return String(cust.Id);
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

