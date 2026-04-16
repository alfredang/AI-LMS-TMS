export type TpGatewayDisbursementColumns = [
  'Financial Transaction ID',
  'Enrolment ID',
  'Claim ID',
  'Agreement ID',
  'Grant ID',
  'Course',
  'Course Title',
  'Course Run',
  'Start Date',
  'End Date',
  'Funding Component',
  'Claim Funding Component',
  'Scheme',
  'Trainee ID',
  'Trainee',
  'Employer Name',
  'Amount',
  'Transaction Type',
  'Status',
  'Payment Date',
  'Bank Reference ID',
];

export type TpGatewayDisbursementRowRaw = Record<string, unknown>;

export type GrantImportRowParsed = {
  rowNumber: number;

  financialTransactionId: string | null;
  enrolmentId: string | null;
  grantId: string | null;

  courseTitle: string | null;
  scheme: string | null;
  traineeId: string | null;
  traineeName: string | null;
  employerName: string | null;

  amountRaw: string | null;
  amountParsed: number | null;

  paymentDateRaw: string | null;
  paymentDateParsed: string | null; // YYYY-MM-DD

  bankReferenceId: string | null;
  fundingComponent: string | null;

  rawRowJson: TpGatewayDisbursementRowRaw;

  validationStatus: 'valid' | 'invalid';
  validationErrors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
};

export type GrantImportRowMatched = GrantImportRowParsed & {
  matchStatus: 'ready' | 'already_applied' | 'ambiguous' | 'unmatched' | 'invalid';
  matchedFmsRecordId: string | null;
  existingAmount: number | null;
  existingPaymentDate: string | null; // YYYY-MM-DD
  matchedQbObjectId: string | null;
  duplicateFinancialTransactionIdBatchId: string | null;
};

export type GrantImportBatchPreview = {
  batch: {
    id: string;
    filename: string | null;
    uploadedAt: string;
    uploadedBy: string | null;
    status: 'pending_review' | 'applying' | 'completed' | 'cancelled';
  };
  summary: {
    totalRows: number;
    validRows: number;
    readyRows: number;
    alreadyAppliedRows: number;
    unmatchedRows: number;
    ambiguousRows: number;
    invalidRows: number;
    duplicateFtxRows: number;
  };
  enrolmentImpact: Array<{
    enrolmentId: string;
    expectedTotal: number | null;
    receivedSoFar: number;
    willReceiveIfApplied: number;
    projectedReceived: number;
    projectedPending: number | null;
    projectedStatus: 'NOT_RECEIVED' | 'PARTIAL' | 'FULLY_PAID';
  }>;
  rows: GrantImportRowMatched[];
  duplicateFinancialTransactionIds: Array<{ ftx: string; previousBatchId: string }>;
};

