import type { NextApiRequest, NextApiResponse } from 'next';
import { qboQuery } from '../../../lib/services/qboInvoiceService';

/**
 * GET /api/admin/ca-search-qbo-customer?q=polyclinics&limit=20
 *
 * Used by the inline rescue UI on View Company Application — when the invoice
 * generator can't find a QBO customer for an employer, the admin types a
 * partial name here, picks the right customer, and the mapping gets persisted
 * to employer_qbo_alias.
 *
 * Searches DisplayName, CompanyName, and FullyQualifiedName via QBO's LIKE
 * operator (case-insensitive). Returns up to `limit` candidates with enough
 * detail for the admin to disambiguate (BillAddr line + email).
 */
function escapeQboLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

interface QboCustomerResult {
  id: string;
  displayName: string;
  companyName: string;
  fullyQualifiedName: string;
  email: string;
  addressLine: string;
}

function shapeCustomer(c: any): QboCustomerResult {
  const billAddr = c?.BillAddr || {};
  const addressParts = [billAddr.Line1, billAddr.Line2, billAddr.City, billAddr.PostalCode]
    .filter(Boolean)
    .join(', ');
  return {
    id: String(c?.Id || ''),
    displayName: String(c?.DisplayName || ''),
    companyName: String(c?.CompanyName || ''),
    fullyQualifiedName: String(c?.FullyQualifiedName || ''),
    email: String(c?.PrimaryEmailAddr?.Address || ''),
    addressLine: addressParts,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const q = String(req.query.q || '').trim();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  if (q.length < 2) {
    return res.status(400).json({ success: false, error: 'Search term must be at least 2 characters' });
  }

  try {
    const safe = escapeQboLiteral(q);
    // Three parallel LIKE searches; merge + dedup by Id. Each capped at `limit`
    // so the worst case is 3*limit rows pre-dedup.
    const queries = [
      `SELECT * FROM Customer WHERE DisplayName LIKE '%${safe}%' MAXRESULTS ${limit}`,
      `SELECT * FROM Customer WHERE CompanyName LIKE '%${safe}%' MAXRESULTS ${limit}`,
      `SELECT * FROM Customer WHERE FullyQualifiedName LIKE '%${safe}%' MAXRESULTS ${limit}`,
    ];

    const responses = await Promise.all(
      queries.map(query =>
        qboQuery(undefined, query).catch(err => {
          console.warn(`[ca-search-qbo-customer] Query failed (continuing): ${query}`, err instanceof Error ? err.message : err);
          return null;
        })
      )
    );

    const seen = new Set<string>();
    const results: QboCustomerResult[] = [];
    for (const data of responses) {
      const raw = data?.QueryResponse?.Customer;
      const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const c of rows) {
        const id = String(c?.Id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push(shapeCustomer(c));
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('[ca-search-qbo-customer] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
