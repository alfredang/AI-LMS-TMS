import type { GrantImportRowParsed } from './tpGatewayDisbursementTypes';

const GRN_RE = /^GRN-\d{4}-\d{6}$/;
const ENR_RE = /^ENR-\d{4}-\d{6}$/;
const FTX_RE = /^FTX-\d{4}-\d{6}$/;
const FTB_RE = /^FTB-\d{4}-\d{6}$/;

const KNOWN_SCHEMES = new Set([
  'Baseline SkillsFuture Funding',
  'Enhanced Training Support for SMEs',
  'Mid-Career Enhanced Subsidy',
  'IBF STS',
]);

function addErr(row: GrantImportRowParsed, field: string, message: string) {
  row.validationErrors.push({ field, message });
}

function addWarn(row: GrantImportRowParsed, field: string, message: string) {
  row.warnings.push({ field, message });
}

export function validateTpGatewayDisbursementRow(row: GrantImportRowParsed): GrantImportRowParsed {
  row.validationErrors = [];
  row.warnings = [];

  if (!row.financialTransactionId) addErr(row, 'financial_transaction_id', 'Missing Financial Transaction ID');
  else if (!FTX_RE.test(row.financialTransactionId)) addErr(row, 'financial_transaction_id', 'Invalid FTX format');

  if (!row.enrolmentId) addErr(row, 'enrolment_id', 'Missing Enrolment ID');
  else if (!ENR_RE.test(row.enrolmentId)) addErr(row, 'enrolment_id', 'Invalid ENR format');

  if (!row.grantId) addErr(row, 'grant_id', 'Missing Grant ID');
  else if (!GRN_RE.test(row.grantId)) addErr(row, 'grant_id', 'Invalid GRN format');

  if (row.amountRaw && row.amountParsed == null) addErr(row, 'amount', 'Invalid amount format');
  if (row.amountParsed == null) addErr(row, 'amount', 'Missing amount');

  if (row.paymentDateRaw && !row.paymentDateParsed) addErr(row, 'payment_date', 'Invalid payment date format (expected DD-MM-YYYY)');
  if (!row.paymentDateParsed) addErr(row, 'payment_date', 'Missing payment date');

  // These are present in valid exports; keep as warnings (file variants happen)
  const txType = String((row.rawRowJson['Transaction Type'] ?? '')).trim();
  const status = String((row.rawRowJson['Status'] ?? '')).trim();
  if (txType && txType.toLowerCase() !== 'disbursement') addWarn(row, 'transaction_type', `Unexpected Transaction Type: ${txType}`);
  if (status && status.toLowerCase() !== 'paid') addWarn(row, 'status', `Unexpected Status: ${status}`);

  const bankRef = row.bankReferenceId;
  if (bankRef && !FTB_RE.test(bankRef)) addWarn(row, 'bank_reference_id', 'Bank Reference ID not in expected FTB format');

  if (row.scheme && !KNOWN_SCHEMES.has(row.scheme)) {
    addWarn(row, 'scheme', `Unknown scheme: ${row.scheme}`);
  }

  row.validationStatus = row.validationErrors.length === 0 ? 'valid' : 'invalid';
  return row;
}

