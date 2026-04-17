import type { NextApiRequest, NextApiResponse } from 'next';
import { requireFinanceOrAdmin } from '@/lib/services/grantImport/requireFinanceOrAdmin';
import {
  getGrantImportBatchPreview,
  listAlreadyAppliedGrantIds,
  sumAppliedReceivedByEnrolment,
  sumExpectedByEnrolmentFromSsgGrants,
} from '@/lib/services/grantImport/grantImportDb';
import { findQbPaymentDetailsForImportRow, mapWithConcurrency } from '@/lib/services/grantImport/grantImportQbMatch';

function toNum(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const appOverride = (process.env.QBO_GRANT_IMPORT_APP || 'app1').trim() || 'app1';

    const MAX_LIVE_QB = Math.max(50, Math.min(1500, Number(process.env.GRANT_IMPORT_PREVIEW_QB_LIVE_CAP) || 500));

    const liveCandidates = rows
      .map((r: any, idx: number) => ({ r, idx }))
      .filter(({ r }) => {
        if (r.matched_qb_object_id) return false;
        const grn = String(r.grant_id || '').trim();
        if (!grn) return false;
        return true;
      })
      .sort((a, b) => {
        const grnA = String(a.r.grant_id || '').trim();
        const grnB = String(b.r.grant_id || '').trim();
        const pri = (g: string, row: any) =>
          fmsUpdatedSet.has(g) || String(row.match_status || '') === 'already_applied' ? 0 : 1;
        return pri(grnA, a.r) - pri(grnB, b.r);
      });

    const needLiveQb = liveCandidates.slice(0, MAX_LIVE_QB);

    const liveByIndex = new Map<number, boolean>();
    await mapWithConcurrency(needLiveQb, 8, async ({ r, idx }) => {
      try {
        const grn = String(r.grant_id || '').trim();
        const live = await findQbPaymentDetailsForImportRow({
          grantId: grn,
          enrolmentId: r.enrolment_id ?? null,
          paymentDate: r.payment_date_parsed ?? null,
          amount: toNum(r.amount_parsed),
          bankReferenceId: r.bank_reference_id ?? null,
          preferredApp: appOverride,
        });
        liveByIndex.set(idx, !!live?.paymentId);
      } catch {
        liveByIndex.set(idx, false);
      }
    });

    const rowsWithLive = rows.map((r: any, idx: number) => {
      const grn = String(r.grant_id || '').trim();
      const fms_updated_live = !!(grn && fmsUpdatedSet.has(grn));
      let qb_applied_live = !!r.matched_qb_object_id;
      if (!qb_applied_live && liveByIndex.has(idx)) {
        qb_applied_live = !!liveByIndex.get(idx);
      }
      return { ...r, fms_updated_live, qb_applied_live };
    });

    return res.status(200).json({ success: true, data: { batch, rows: rowsWithLive, enrolmentImpact } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    return res.status(500).json({ success: false, error: msg });
  }
}

