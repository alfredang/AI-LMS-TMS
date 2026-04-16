import pool from '@/lib/db';
import { requireGrantImportSchema, sumAppliedReceivedByEnrolment, sumExpectedByEnrolmentFromSsgGrants } from './grantImportDb';

export async function recalcAndPersistGrantPaymentRollups(enrolmentIds: string[], importedAt: Date): Promise<{
  updated: number;
  results: Array<{
    enrolmentId: string;
    expected: number | null;
    received: number;
    pending: number | null;
    status: 'NOT_RECEIVED' | 'PARTIAL' | 'FULLY_PAID';
  }>;
}> {
  await requireGrantImportSchema();
  const ids = Array.from(new Set(enrolmentIds.map((x) => String(x || '').trim()).filter(Boolean)));
  if (ids.length === 0) return { updated: 0, results: [] };

  const expectedMap = await sumExpectedByEnrolmentFromSsgGrants(ids);
  const receivedMap = await sumAppliedReceivedByEnrolment(ids);

  const results = [];
  let updated = 0;
  for (const enrolmentId of ids) {
    const expected = expectedMap.has(enrolmentId) ? expectedMap.get(enrolmentId)! : null;
    const received = receivedMap.get(enrolmentId) || 0;
    const pending = expected == null ? null : Math.max(0, expected - received);
    const status: 'NOT_RECEIVED' | 'PARTIAL' | 'FULLY_PAID' =
      expected != null && pending === 0 ? 'FULLY_PAID' : received > 0 ? 'PARTIAL' : 'NOT_RECEIVED';

    // Persist to ssg_enrolments row (best effort: only if exists)
    const r = await pool.query(
      `UPDATE public.ssg_enrolments
       SET total_grant_expected = COALESCE(total_grant_expected, $2::numeric),
           total_grant_received = $3::numeric,
           total_grant_pending = (CASE WHEN $2::numeric IS NULL THEN NULL ELSE GREATEST(0, $2::numeric - $3::numeric) END),
           grant_payment_status = $4::public.grant_payment_status,
           last_grant_import_at = $5::timestamptz
       WHERE enrolment_id = $1::text`,
      [enrolmentId, expected, received, status, importedAt.toISOString()]
    );
    if (r.rowCount > 0) updated += r.rowCount;

    results.push({ enrolmentId, expected, received, pending, status });
  }

  return { updated, results };
}

