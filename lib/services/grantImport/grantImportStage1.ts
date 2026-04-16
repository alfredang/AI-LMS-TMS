import type { GrantImportBatchPreview, GrantImportRowMatched } from './tpGatewayDisbursementTypes';
import { parseTpGatewayDisbursementXlsx, normalizeAndParseTpGatewayRow } from './tpGatewayDisbursementParser';
import { validateTpGatewayDisbursementRow } from './tpGatewayDisbursementValidator';
import {
  findDuplicateFtx,
  insertGrantImportBatch,
  insertGrantImportRows,
  ssgGrantExists,
  sumAppliedReceivedByEnrolment,
  sumExpectedByEnrolmentFromSsgGrants,
  wasGrantAlreadyApplied,
} from './grantImportDb';

export async function stage1UploadParseValidateMatchAndPersist(input: {
  filepath: string;
  filename: string | null;
  actorUserId: string | null;
}): Promise<GrantImportBatchPreview> {
  const rawRows = parseTpGatewayDisbursementXlsx(input.filepath);

  const parsed = rawRows.map((r) => validateTpGatewayDisbursementRow(normalizeAndParseTpGatewayRow(r.rowNumber, r.raw)));

  const ftxList = parsed
    .map((r) => r.financialTransactionId)
    .filter((x): x is string => !!x);
  const duplicates = await findDuplicateFtx([...new Set(ftxList)]);
  const dupMap = new Map<string, string>();
  for (const d of duplicates) dupMap.set(d.ftx, d.previousBatchId);

  const matched: GrantImportRowMatched[] = [];
  for (const row of parsed) {
    if (row.validationStatus !== 'valid') {
      matched.push({
        ...row,
        matchStatus: 'invalid',
        matchedFmsRecordId: null,
        existingAmount: null,
        existingPaymentDate: null,
        matchedQbObjectId: null,
        duplicateFinancialTransactionIdBatchId: row.financialTransactionId ? dupMap.get(row.financialTransactionId) ?? null : null,
      });
      continue;
    }

    const grn = row.grantId!;
    const exists = await ssgGrantExists(grn);
    if (!exists.ok) {
      matched.push({
        ...row,
        matchStatus: 'unmatched',
        matchedFmsRecordId: null,
        existingAmount: null,
        existingPaymentDate: null,
        matchedQbObjectId: null,
        duplicateFinancialTransactionIdBatchId: row.financialTransactionId ? dupMap.get(row.financialTransactionId) ?? null : null,
      });
      continue;
    }

    const alreadyApplied = await wasGrantAlreadyApplied(grn);
    matched.push({
      ...row,
      matchStatus: alreadyApplied ? 'already_applied' : 'ready',
      matchedFmsRecordId: exists.ssgGrantRowId ?? null,
      existingAmount: null,
      existingPaymentDate: null,
      matchedQbObjectId: null,
      duplicateFinancialTransactionIdBatchId: row.financialTransactionId ? dupMap.get(row.financialTransactionId) ?? null : null,
    });
  }

  const totalRows = matched.length;
  const validRows = matched.filter((r) => r.validationStatus === 'valid').length;
  const readyRows = matched.filter((r) => r.matchStatus === 'ready').length;
  const alreadyAppliedRows = matched.filter((r) => r.matchStatus === 'already_applied').length;
  const unmatchedRows = matched.filter((r) => r.matchStatus === 'unmatched').length;
  const ambiguousRows = matched.filter((r) => r.matchStatus === 'ambiguous').length;
  const invalidRows = matched.filter((r) => r.matchStatus === 'invalid').length;

  const batch = await insertGrantImportBatch({
    uploadedBy: input.actorUserId,
    filename: input.filename,
    totals: {
      totalRows,
      validRows,
      readyRows,
      unmatchedRows,
      ambiguousRows,
      alreadyAppliedRows,
    },
  });

  await insertGrantImportRows(
    batch.id,
    matched.map((r) => ({
      row_number: r.rowNumber,
      financial_transaction_id: r.financialTransactionId,
      enrolment_id: r.enrolmentId,
      grant_id: r.grantId,
      course_title: r.courseTitle,
      scheme: r.scheme,
      trainee_id: r.traineeId,
      trainee_name: r.traineeName,
      employer_name: r.employerName,
      amount_raw: r.amountRaw,
      amount_parsed: r.amountParsed,
      payment_date_raw: r.paymentDateRaw,
      payment_date_parsed: r.paymentDateParsed,
      bank_reference_id: r.bankReferenceId,
      funding_component: r.fundingComponent,
      raw_row_json: r.rawRowJson,
      validation_status: r.validationStatus,
      validation_errors: JSON.stringify({
        errors: r.validationErrors,
        warnings: r.warnings,
        duplicateFinancialTransactionIdBatchId: r.duplicateFinancialTransactionIdBatchId,
      }),
      match_status: r.matchStatus,
      matched_fms_record_id: r.matchedFmsRecordId,
      matched_qb_object_id: r.matchedQbObjectId,
      existing_amount: r.existingAmount,
      existing_payment_date: r.existingPaymentDate,
      selected_for_apply: r.matchStatus === 'ready',
      apply_status: null,
      apply_error: null,
      applied_at: null,
    }))
  );

  // Enrolment impact preview (computed in-memory)
  const enrolmentIds = Array.from(
    new Set(matched.map((r) => r.enrolmentId).filter((x): x is string => !!x))
  );
  const expectedMap = await sumExpectedByEnrolmentFromSsgGrants(enrolmentIds);
  const receivedMap = await sumAppliedReceivedByEnrolment(enrolmentIds);

  const willReceiveByEnr = new Map<string, number>();
  for (const row of matched) {
    if (!row.enrolmentId) continue;
    if (row.matchStatus !== 'ready') continue;
    const amt = Number(row.amountParsed) || 0;
    willReceiveByEnr.set(row.enrolmentId, (willReceiveByEnr.get(row.enrolmentId) || 0) + amt);
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

  return {
    batch: {
      id: batch.id,
      filename: batch.filename ?? null,
      uploadedAt: batch.uploaded_at,
      uploadedBy: batch.uploaded_by ?? null,
      status: batch.status,
    },
    summary: {
      totalRows,
      validRows,
      readyRows,
      alreadyAppliedRows,
      unmatchedRows,
      ambiguousRows,
      invalidRows,
      duplicateFtxRows: duplicates.length,
    },
    enrolmentImpact,
    rows: matched,
    duplicateFinancialTransactionIds: duplicates.map((d) => ({ ftx: d.ftx, previousBatchId: d.previousBatchId })),
  };
}

