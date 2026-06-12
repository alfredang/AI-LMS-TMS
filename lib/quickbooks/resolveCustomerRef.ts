/**
 * Resolve a QuickBooks CustomerRef by trainee email, creating the customer if missing.
 *
 * Pattern mirrors the n8n workflow "LZ - Update Quickbooks Invoice Upon Payment
 * Received V1" (authored by Liu Zhen, 21 Jan) — see
 * docs/reference/n8n-qb-invoice-payment-flow.json — which looks up QB entities by
 * a single field via the SELECT ... WHERE ... query form.
 *
 * All calls go through the existing QB proxy so OAuth refresh stays centralized.
 */

interface ProxyResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

/**
 * Call the internal QuickBooks proxy endpoint. Uses QBO_PROXY_BASE_URL or falls
 * back to localhost — the pipeline runs inside the same Next.js process.
 */
async function callQbProxy(body: Record<string, any>): Promise<ProxyResponse> {
  const baseUrl = process.env.QBO_PROXY_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const resp = await fetch(`${baseUrl}/api/quickbooks/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.success) {
    throw new Error(data?.error || `QB proxy returned ${resp.status}`);
  }
  return data;
}

function escapeQbQueryString(value: string): string {
  // QBO query language uses single quotes, so any apostrophe must be doubled.
  return value.replace(/'/g, "''");
}

/**
 * Find a QB customer by email, or create one if none exists.
 * Returns the QB Customer Id (which is used as CustomerRef.value on invoices).
 */
export async function resolveCustomerRef(
  traineeName: string,
  traineeEmail: string
): Promise<string> {
  if (!traineeEmail) {
    throw new Error('trainee email is required to resolve QB customer');
  }

  // Step 1: Query by email
  const safeEmail = escapeQbQueryString(traineeEmail);
  const queryResp = await callQbProxy({
    action: 'query',
    entity: 'customer',
    query: `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${safeEmail}'`,
  });

  const existing = queryResp.data?.QueryResponse?.Customer?.[0];
  if (existing?.Id) {
    return String(existing.Id);
  }

  // Step 2: Create a new customer
  const [givenName, ...rest] = (traineeName || traineeEmail).trim().split(/\s+/);
  const familyName = rest.join(' ') || givenName;

  const createBody = {
    DisplayName: traineeName || traineeEmail,
    GivenName: givenName || undefined,
    FamilyName: familyName || undefined,
    PrimaryEmailAddr: { Address: traineeEmail },
  };

  const createResp = await callQbProxy({
    action: 'create',
    entity: 'customer',
    body: createBody,
  });

  const created = createResp.data?.Customer;
  if (!created?.Id) {
    throw new Error('QB customer create returned no Id');
  }
  return String(created.Id);
}
