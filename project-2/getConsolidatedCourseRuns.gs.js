function consolidateCourseRuns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName("DONT USE");
  const targetSheet = ss.getSheetByName("Consolidated Course Runs");
  const financialSheet = ss.getSheetByName("Financial Transaction");

  if (!sourceSheet || !targetSheet || !financialSheet)
    throw new Error("❌ Missing sheet: check 'DONT USE', 'Consolidated Course Runs', or 'Financial Transaction'.");

  // --- Read all source data (skip header)
  const data = sourceSheet.getDataRange().getValues();
  const headers = data.shift();

  // --- Read Financial Transaction data
  const financialData = financialSheet.getDataRange().getValues();
  const financialHeaders = financialData.shift();

  // Build lookup for Bank Reference ID
  const finCol = {
    transactionId: financialHeaders.indexOf("Financial Transaction ID"),
    bankRefId: financialHeaders.indexOf("Bank Reference ID"),
  };

  const bankRefMap = new Map();
  for (const row of financialData) {
    const txnId = row[finCol.transactionId];
    const bankRef = row[finCol.bankRefId];
    if (txnId) bankRefMap.set(txnId, bankRef);
  }

  // Column index mapping
  const COL = {
    courseRun: 0,
    courseCode: 1,
    courseTitle: 2,
    startDate: 3,
    endDate: 4,
    trainee: 5,
    traineeEmail: 6,
    traineeContact: 7,
    traineeId: 8,
    traineeDob: 9,
    sponsorship: 10,
    uen: 11,
    employerName: 12,
    enrolmentId: 13,
    grantApplDate: 14,
    grantStatus: 15,
    grantId: 16,
    scheme: 17,
    amount: 18,
    tgPaymentStatus: 19,
    sfcClaimID: 20,
    sfcPaymentDate: 21,
    sfcPaymentStatus: 22,
    tgPaymentDate: 23,
    finTransId: 24,
    attendance: 25,
    assessment: 26,
    qbNetInvoice: 27,
    paymentType: 28,
    qbNetStatus: 29,
    qbGrantInvoice: 30,
    qbGrantStatus: 31,
  };

  // --- Helper function: force format to yyyy-mm-dd using displayed value ---
  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return "";
    const cleaned = dateStr.toString().trim().replace(/\//g, "-");
    const parts = cleaned.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // already yyyy-mm-dd
        return cleaned;
      } else {
        // dd-mm-yyyy → yyyy-mm-dd
        const [d, m, y] = parts;
        return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
    }
    return cleaned;
  };

  // --- Get display values for date columns (keeps what user sees) ---
  const sLastRow = sourceSheet.getLastRow();
  const sDisplay = {
    startDate: sourceSheet.getRange(2, COL.startDate + 1, sLastRow - 1, 1).getDisplayValues(),
    endDate: sourceSheet.getRange(2, COL.endDate + 1, sLastRow - 1, 1).getDisplayValues(),
    grantApplDate: sourceSheet.getRange(2, COL.grantApplDate + 1, sLastRow - 1, 1).getDisplayValues(),
    tgPaymentDate: sourceSheet.getRange(2, COL.tgPaymentDate + 1, sLastRow - 1, 1).getDisplayValues(),
    sfcPaymentDate: sourceSheet.getRange(2, COL.sfcPaymentDate + 1, sLastRow - 1, 1).getDisplayValues(),
    traineeDob: sourceSheet.getRange(2, COL.traineeDob + 1, sLastRow - 1, 1).getDisplayValues(),
  };

  // --- Merge logic ---
  const mergedMap = new Map();

  data.forEach((row, i) => {
    const key = `${row[COL.courseRun]}||${row[COL.trainee]}`;
    const existing = mergedMap.get(key);

    // Dates using display-based conversion
    const startDate = formatDisplayDate(sDisplay.startDate[i][0]);
    const endDate = formatDisplayDate(sDisplay.endDate[i][0]);
    const sfcPaymentDate = formatDisplayDate(sDisplay.sfcPaymentDate[i][0]);
    const tgPaymentDate = formatDisplayDate(sDisplay.tgPaymentDate[i][0]);
    const traineeDob = formatDisplayDate(sDisplay.traineeDob[i][0]);
    const grantApplDate = formatDisplayDate(sDisplay.grantApplDate[i][0]);

    if (!existing) {
      mergedMap.set(key, {
        courseRun: row[COL.courseRun],
        courseCode: row[COL.courseCode],
        courseTitle: row[COL.courseTitle],
        startDate,
        endDate,
        trainee: row[COL.trainee],
        traineeEmail: row[COL.traineeEmail],
        traineeContact: row[COL.traineeContact],
        traineeId: row[COL.traineeId],
        traineeDob,
        sponsorship: row[COL.sponsorship],
        uen: row[COL.uen],
        employerName: row[COL.employerName],
        enrolmentId: row[COL.enrolmentId],
        grantApplDate,
        grantStatus: row[COL.grantStatus],
        grantIdBL: "",
        amountBL: "",
        grantIdMCES: "",
        amountMCES: "",
        tgPaymentStatus: row[COL.tgPaymentStatus],
        sfcClaimID: row[COL.sfcClaimID],
        sfcPaymentDate,
        sfcPaymentStatus: row[COL.sfcPaymentStatus],
        tgPaymentDate,
        finTransId: row[COL.finTransId],
        attendance: row[COL.attendance],
        assessment: row[COL.assessment],
        qbNetInvoice: row[COL.qbNetInvoice],
        paymentType: row[COL.paymentType],
        qbNetStatus: row[COL.qbNetStatus],
        qbGrantInvoice: row[COL.qbGrantInvoice],
        qbGrantStatus: row[COL.qbGrantStatus],
      });
    }

    const record = mergedMap.get(key);

    const scheme = row[COL.scheme];
    const grantId = row[COL.grantId];
    const amount = row[COL.amount];

    if (scheme === "Baseline SkillsFuture Funding") {
      record.grantIdBL = grantId;
      record.amountBL = amount;
    } else if (
      scheme === "Mid-Career Enhanced Subsidy" ||
      scheme === "Enhanced Training Support for SMEs"
    ) {
      record.grantIdMCES = grantId;
      record.amountMCES = amount;
    }
  });

  // --- Prepare final output ---
  const output = [[
    "Course Run", "Course Code", "Course Title", "Start Date", "End Date", "Trainee", "Trainee Email",
    "Trainee Contact", "Trainee ID", "Trainee DOB", "Sponsorship Type", "UEN of Employer", "Employer Name",
    "Enrolment ID", "Grant Appl Date", "Grant Status", "Grant ID (BL)", "Amount (BL)",
    "Grant (MCES/SME)", "Amount (MCES/SME)", "TG Payment Status", "SFC Claim ID", "SFC Payment Date",
    "SFC Payment Status", "TG Payment Date", "Financial Transaction ID", "Attendance", "Assessment",
    "QB Invoice # (Net Fee)", "Payment Type", "QB Net Fee Status", "QB Invoice # (Grant)",
    "QB TG Status", "Bank Reference ID"
  ]];

  mergedMap.forEach((r) => {
    const bankRefId = bankRefMap.get(r.finTransId) || "";
    output.push([
      r.courseRun, r.courseCode, r.courseTitle, r.startDate, r.endDate, r.trainee, r.traineeEmail,
      r.traineeContact, r.traineeId, r.traineeDob, r.sponsorship, r.uen, r.employerName, r.enrolmentId,
      r.grantApplDate, r.grantStatus, r.grantIdBL, r.amountBL, r.grantIdMCES, r.amountMCES,
      r.tgPaymentStatus, r.sfcClaimID, r.sfcPaymentDate, r.sfcPaymentStatus, r.tgPaymentDate,
      r.finTransId, r.attendance, r.assessment, r.qbNetInvoice, r.paymentType, r.qbNetStatus,
      r.qbGrantInvoice, r.qbGrantStatus, bankRefId
    ]);
  });

  // --- Write to target ---
  targetSheet.clearContents();
  targetSheet.getRange(1, 1, output.length, output[0].length).setValues(output);

  // Force date columns to yyyy-mm-dd format
  const dateCols = ["D", "E", "J", "O", "V", "W", "Y"];
  dateCols.forEach(col => targetSheet.getRange(`${col}2:${col}`).setNumberFormat("yyyy-mm-dd"));

  Logger.log(`✅ Consolidation complete! ${output.length - 1} records written.`);
  targetSheet.getRange("A1").setNote(`Last consolidated on ${new Date().toLocaleString()} (${output.length - 1} records)`);
}
