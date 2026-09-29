import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import { getGrantImportBatchPreview } from '@/lib/services/grantImport/grantImportDb';

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Force Excel to keep a value as literal text instead of auto-converting it (dates being
 * the reported case: Excel reinterprets "2026-09-04" as its own date type, then shows
 * "####" whenever the resulting display format doesn't fit the column width). The
 * ="value" formula trick is the standard, reliable fix — a plain leading apostrophe is
 * not always honoured depending on Excel version/locale, this is.
 */
function csvForceText(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (!s) return '';
  return csvEscape(`="${s}"`);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId.trim() : '';
  if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' });

  const mode = typeof req.query.mode === 'string' ? req.query.mode.trim() : 'problem';
  const wantProblemOnly = mode !== 'all';

  try {
    await requireFinanceOrAdmin(req);
    const { batch, rows } = await getGrantImportBatchPreview(batchId);

    const filtered = wantProblemOnly
      ? rows.filter((r: any) => {
          const ms = String(r.match_status || '');
          const as = String(r.apply_status || '');
          return ms === 'unmatched' || ms === 'ambiguous' || ms === 'invalid' || as === 'failed';
        })
      : rows;

    const headers = [
      'row_number',
      'financial_transaction_id',
      'enrolment_id',
      'grant_id',
      'scheme',
      'amount_raw',
      'amount_parsed',
      'payment_date_parsed',
      'bank_reference_id',
      'validation_status',
      'match_status',
      'selected_for_apply',
      'apply_status',
      'apply_error',
    ];

    const forceTextColumns = new Set(['payment_date_parsed']);

    const lines: string[] = [];
    lines.push(headers.join(','));
    for (const r of filtered) {
      const row = headers.map((h) =>
        forceTextColumns.has(h) ? csvForceText((r as any)[h]) : csvEscape((r as any)[h])
      );
      lines.push(row.join(','));
    }

    const filenameSafe = (batch?.filename ? String(batch.filename) : `batch_${batchId}`).replace(/[^\w.-]+/g, '_');
    const filename = `grant_import_${filenameSafe}_${wantProblemOnly ? 'failed_unmatched' : 'all'}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(lines.join('\n'));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
