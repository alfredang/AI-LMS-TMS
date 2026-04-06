function updateBankReferenceIDs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const courseSheet = ss.getSheetByName("All Course Runs");
  const financialSheet = ss.getSheetByName("Financial Transaction");
  if (!courseSheet || !financialSheet) throw new Error("❌ Missing sheet. Check 'All Course Runs' or 'Financial Transaction'.");

  // --- Read Financial Transaction sheet ---
  const finData = financialSheet.getDataRange().getValues();
  const finHeaders = finData.shift(); // remove header
  const finGrantIdx = finHeaders.indexOf("Grant ID");
  const finBankRefIdx = finHeaders.indexOf("Bank Reference ID");
  if (finGrantIdx === -1 || finBankRefIdx === -1)
    throw new Error("❌ Missing 'Grant ID' or 'Bank Reference ID' column in Financial Transaction sheet.");

  // Build lookup map: Grant ID -> Bank Reference ID
  const bankRefMap = new Map();
  finData.forEach(row => {
    const grantId = row[finGrantIdx];
    const bankRef = row[finBankRefIdx];
    if (grantId) bankRefMap.set(grantId.toString().trim(), bankRef);
  });

  // --- Read All Course Runs sheet ---
  const courseData = courseSheet.getDataRange().getValues();
  const courseHeaders = courseData.shift();

  const colGrantBL = courseHeaders.indexOf("Grant ID (BL)");
  const colGrantMCES = courseHeaders.indexOf("Grant (MCES/SME)");
  const colBankRefBL = courseHeaders.indexOf("Bank Reference ID (BL)");
  const colBankRefMCES = courseHeaders.indexOf("Bank Reference ID (MCES/SME)");

  if ([colGrantBL, colGrantMCES].some(idx => idx === -1))
    throw new Error("❌ Missing 'Grant ID (BL)' or 'Grant (MCES/SME)' in All Course Runs.");
  if ([colBankRefBL, colBankRefMCES].some(idx => idx === -1))
    throw new Error("❌ Missing 'Bank Reference ID (BL)' or 'Bank Reference ID (MCES/SME)' in All Course Runs.");

  // --- Process rows ---
  for (let i = 0; i < courseData.length; i++) {
    const row = courseData[i];

    const grantBL = row[colGrantBL] ? row[colGrantBL].toString().trim() : "";
    const grantMCES = row[colGrantMCES] ? row[colGrantMCES].toString().trim() : "";

    // Check matches and fill Bank Reference ID accordingly
    if (grantBL && bankRefMap.has(grantBL)) {
      row[colBankRefBL] = bankRefMap.get(grantBL);
    }

    if (grantMCES && bankRefMap.has(grantMCES)) {
      row[colBankRefMCES] = bankRefMap.get(grantMCES);
    }

    courseData[i] = row;
  }

  // --- Write back updated data ---
  courseSheet.getRange(2, 1, courseData.length, courseHeaders.length).setValues(courseData);

  Logger.log(`✅ Updated ${courseData.length} rows in All Course Runs.`);
}
