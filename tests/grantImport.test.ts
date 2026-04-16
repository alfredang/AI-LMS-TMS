import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAndParseTpGatewayRow } from '../lib/services/grantImport/tpGatewayDisbursementParser';
import { validateTpGatewayDisbursementRow } from '../lib/services/grantImport/tpGatewayDisbursementValidator';

test('normalizes null cells and parses amount/date', () => {
  const raw: Record<string, unknown> = {
    'Financial Transaction ID': 'FTX-2602-123456',
    'Enrolment ID': 'ENR-2602-006040',
    'Grant ID': 'GRN-2602-010020',
    'Scheme': 'Baseline SkillsFuture Funding',
    'Amount': '$1,000.00',
    'Payment Date': '03-03-2026',
    'Bank Reference ID': 'FTB-2602-006094',
    'Funding Component': "'-",
  };

  const parsed = normalizeAndParseTpGatewayRow(12, raw);
  assert.equal(parsed.rowNumber, 12);
  assert.equal(parsed.financialTransactionId, 'FTX-2602-123456');
  assert.equal(parsed.enrolmentId, 'ENR-2602-006040');
  assert.equal(parsed.grantId, 'GRN-2602-010020');
  assert.equal(parsed.scheme, 'Baseline SkillsFuture Funding');
  assert.equal(parsed.amountRaw, '$1,000.00');
  assert.equal(parsed.amountParsed, 1000);
  assert.equal(parsed.paymentDateParsed, '2026-03-03');
  assert.equal(parsed.bankReferenceId, 'FTB-2602-006094');
  assert.equal(parsed.fundingComponent, null);
});

test('validator flags invalid IDs and missing required fields', () => {
  const raw: Record<string, unknown> = {
    'Financial Transaction ID': 'bad',
    'Enrolment ID': 'ENR-2602-006040',
    'Grant ID': 'GRN-2602-01002', // wrong format
    'Scheme': 'Some New Scheme',
    'Amount': "'-",
    'Payment Date': '2026/03/03',
    'Bank Reference ID': 'FTB-2602-006094',
    'Transaction Type': 'Disbursement',
    'Status': 'Paid',
  };

  const parsed = validateTpGatewayDisbursementRow(normalizeAndParseTpGatewayRow(2, raw));
  assert.equal(parsed.validationStatus, 'invalid');
  assert.ok(parsed.validationErrors.some((e) => e.field === 'financial_transaction_id'));
  assert.ok(parsed.validationErrors.some((e) => e.field === 'grant_id'));
  assert.ok(parsed.validationErrors.some((e) => e.field === 'amount'));
  assert.ok(parsed.validationErrors.some((e) => e.field === 'payment_date'));
  // Unknown scheme is a warning, not an error
  assert.ok(parsed.warnings.some((w) => w.field === 'scheme'));
});

