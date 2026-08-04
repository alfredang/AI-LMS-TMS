import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import {
  getGrantImportBatchPreview,
  listAlreadyAppliedGrantIds,
  sumAppliedReceivedByEnrolment,
  sumExpectedByEnrolmentFromSsgGrants,
} from '@/lib/services/grantImport/grantImportDb';

function toNum(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId.trim() : '';
  if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' });

  try {
    await requireFinanceOrAdmin(req);
    const { batch, rows } = await getGrantImportBatchPreview(batchId);

    const grantIds = Array.from(new Set(rows.map((r: any) => String(r.grant_id || '').trim()).filter(Boolean)));
    const fmsUpdatedSet = await listAlreadyAppliedGrantIds(grantIds);

    const enrolmentIds = Array.from(new Set(rows.map((r: any) => String(r.enrolment_id || '').trim()).filter(Boolean)));
    const expectedMap = await sumExpectedByEnrolmentFromSsgGrants(enrolmentIds);
    const receivedMap = await sumAppliedReceivedByEnrolment(enrolmentIds);

    const willReceiveByEnr = new Map<string, number>();
    for (const row of rows) {
      const enr = String(row.enrolment_id || '').trim();
      if (!enr) continue;
      if (!row.selected_for_apply) continue;
      if (String(row.match_status) !== 'ready') continue;
      const amt = toNum(row.amount_parsed) || 0;
      willReceiveByEnr.set(enr, (willReceiveByEnr.get(enr) || 0) + amt);
    }

    const enrolmentImpact = enrolmentIds.map((enrolmentId) => {
      const expectedTotal = expectedMap.has(enrolmentId) ? expectedMap.get(enrolmentId)! : null;
      const receivedSoFar = receivedMap.get(enrolmentId) || 0;
      const willReceiveIfApplied = willReceiveByEnr.get(enrolmentId) || 0;
      const projectedReceived = receivedSoFar + willReceiveIfApplied;
      const projectedPending = expectedTotal == null ? null : Math.max(0, expectedTotal - projectedReceived);
      const projectedStatus: 'NOT_RECEIVED' | 'PARTIAL' | 'FULLY_PAID' =
        expectedTotal != null && projectedPending === 0
          ? 'FULLY_PAID'
          : projectedReceived > 0
            ? 'PARTIAL'
            : 'NOT_RECEIVED';
      return {
        enrolmentId,
        expectedTotal,
        receivedSoFar,
        willReceiveIfApplied,
        projectedReceived,
        projectedPending,
        projectedStatus,
      };
    });

    const rowsWithLive = rows.map((r: any) => {
      const grn = String(r.grant_id || '').trim();
      const fms_updated_live = !!(grn && fmsUpdatedSet.has(grn));
      const qb_applied_live = !!r.matched_qb_object_id;
      return { ...r, fms_updated_live, qb_applied_live };
    });

    return res.status(200).json({ success: true, data: { batch, rows: rowsWithLive, enrolmentImpact } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
