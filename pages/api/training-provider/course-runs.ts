import { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!process.env.GOOGLE_SHEETS_ID) {
      return res.status(400).json({
        error: 'Missing GOOGLE_SHEETS_ID environment variable',
        data: [],
      });
    }

    if (!process.env.GOOGLE_SHEETS_KEY_FILE) {
      return res.status(400).json({
        error: 'Missing GOOGLE_SHEETS_KEY_FILE environment variable',
        data: [],
      });
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SHEETS_KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: 'All Course Runs!A1:CP', // ✅ removed row limit — fetches all rows
    });

    const rows = response.data.values || [];

    if (rows.length === 0) {
      return res.status(200).json({ data: [] });
    }

    const headerMapping: { [key: string]: string } = {
      'Course Run': 'courseRun',
      'Course Code': 'courseCode',
      'Course Title': 'courseTitle',
      'Start Date': 'startDate',
      'End Date': 'endDate',
      'Trainee': 'traineeName',
      'Trainee Email': 'traineeEmail',
      'Trainee Contact': 'traineeContactNo',
      'Trainee ID': 'traineeId',
      'Trainee DOB': 'traineeDOB',
      'Sponsorship Type': 'sponsorshipType',
      'UEN of Employer': 'employerUEN',
      'Employer Name': 'employerCompany',
      'Employer Phone': 'employerContactNo',
      'Employer Contact Name': 'employerName',
      'Employer Contact Email': 'employerEmail',
      'Enrolement Status': 'enrollmentStatus',
      'Enrolment ID': 'enrollmentId',
      'Grant Appl Date': 'grantApplicationDate',
      'Grant Status (BL)': 'grantStatusBL',
      "Grant ID (BL)": 'grantIdBL',
      'Amount (BL)': 'amountBL',
      'Grant Status (MCES/SME/IBF)': 'grantStatusMCES',
      'Grant ID (MCES/SME)': 'grantIdMCES',
      'Funding Scheme Code': 'fundingSchemeCode',
      'Amount (MCES/SME)': 'amountMCES',
      'Total TG Amount': 'totalTGAmount',
      'TG Payment Status': 'tgPaymentStatus',
      'SFC Claim ID': 'sfcClaimId',
      'SFC Amount': 'sfcAmount',
      'SFC Payment Date': 'sfcPaymentDate',
      'SFC Payout Request ID': 'sfcPayoutRequestId',
      'SFC Application ID': 'sfcApplicationId',
      'SFC Payment Status': 'sfcPaymentStatus',
      'QB SFC Invoice Num': 'qbSFCInvoiceNum',
      'QB SFC Invoice Amount': 'qbSFCInvoiceAmount',
      'QB SFC Status': 'qbSFCStatus',
      'TG Payment Date': 'tgPaymentDate',
      'Financial Transaction ID (BL)': 'financialTxnIdBL',
      'Financial Transaction ID (MCES/SME)': 'financialTxnIdMCES',
      'Assessment': 'assessment',
      'Fee Collection Update Status': 'feeCollectionStatus',
      'Assessment ID': 'assessmentId',
      'Assessment ID Date': 'assessmentDate',
      'Skill Code': 'skillCode',
      'Assessment Update': 'assessmentUpdate',
      'QB Invoice # (Net Fee)': 'qbInvoiceNetFee',
      'QB Net Fee Amount': 'qbNetFeeAmount',
      'Payment Type': 'paymentType',
      'QB Net Fee Status': 'qbNetFeeStatus',
      'QB Invoice # (Grant)': 'qbInvoiceGrant',
      'QB TG Status': 'qbTGStatus',
      'Bank Reference ID (BL)': 'bankRefIdBL',
      'Course Fees': 'courseFees',
      'Bank Reference ID (MCES/SME)': 'bankRefIdMCES',
      'Course Type': 'courseType',
      'Invoice No.': 'invoiceNo',
      'Pay by SFC': 'paybySFC',
      'Terms': 'terms',
      'Payable Fees': 'payableFees',
      'Invoice Creation': 'invoiceCreation',
    };

    const headers = rows[0];

    const data = rows.slice(1).map((row) => {
      const obj: any = {};
      headers.forEach((header, index) => {
        const key = headerMapping[header] || header;
        obj[key] = row[index] || '';
      });
      return obj;
    });

    return res.status(200).json({ data });

  } catch (error) {
    console.error('Error fetching Google Sheets:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    return res.status(500).json({
      error: `Failed to fetch data from Google Sheets: ${errorMessage}`,
      data: [],
    });
  }
}