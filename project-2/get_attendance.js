function processAllRuns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet(); // Dynamically fetch the active sheet
  const sheetName = sheet.getName(); // Get the name of the active sheet for validation or logging

  // Optional: Validate the active sheet
  if (sheetName !== "Detailed Data View" && sheetName !== "Concluded Data") {
    Logger.log(`Unsupported sheet: ${sheetName}`);
    SpreadsheetApp.getUi().alert("This operation is not supported on this sheet.");
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  // Identify necessary columns by header name
  const runIdCol = headers.indexOf('Course Run ID');
  const courseRefCol = headers.indexOf('TGS Course Code');
  const traineeIdCol = headers.indexOf('Trainee ID *');
  const actualAttendanceCol = headers.indexOf('Actual Attendance');
  const expectedAttendanceCol = headers.indexOf('Expected Attendance');

  if (runIdCol === -1 || courseRefCol === -1 || traineeIdCol === -1) {
    throw new Error("Missing required columns (Course Run ID, TGS Course Code, or Trainee ID *)");
  }

  // Group rows by (runId, courseRef) pair
  const runGroups = {};
  rows.forEach((row, i) => {
    const runId = row[runIdCol];
    const courseRef = row[courseRefCol];
    const traineeId = row[traineeIdCol];

    if (!runId || !courseRef) return; // Skip rows missing these values

    const key = runId + '|' + courseRef;
    if (!runGroups[key]) runGroups[key] = [];
    runGroups[key].push({ rowIndex: i + 2, traineeId: traineeId });
  });

  const cloudRunUrl = 'https://ssg-getcourseattendance-api-26788516550.us-central1.run.app'; // Your Cloud Run endpoint

  // Process each runId/courseRef pair once
  for (const key in runGroups) {
    const [runId, courseRef] = key.split('|');
    const traineesData = updateAttendanceForRun(cloudRunUrl, runId, courseRef);
    // traineesData: array of { traineeId, name, email, totalAttendances, expectedAttendance }

    if (traineesData.length === 0) continue;
    const traineeMap = {};
    traineesData.forEach(t => {
      traineeMap[t.traineeId] = t;
    });

    // Update the rows
    runGroups[key].forEach(item => {
      const tId = item.traineeId;
      if (traineeMap[tId]) {
        const actual = traineeMap[tId].totalAttendances || 0;
        const expected = traineeMap[tId].expectedAttendance || 0;
        if (actualAttendanceCol >= 0) {
          sheet.getRange(item.rowIndex, actualAttendanceCol + 1).setValue(actual);
        }
        if (expectedAttendanceCol >= 0) {
          sheet.getRange(item.rowIndex, expectedAttendanceCol + 1).setValue(expected);
        }
      }
    });
  }

  Logger.log("All runs processed.");
}

/**
 * Calls the Cloud Run function once per runId/courseReferenceNumber to get aggregated attendance data.
 */
function updateAttendanceForRun(url, runId, courseRef) {
  const payload = {
    runId: runId.toString(),
    uen: '201200696W',
    courseReferenceNumber: courseRef.toString()
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options); 
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  Logger.log(`updateAttendanceForRun: Code: ${responseCode}, Body: ${responseBody}`);

  if (responseCode === 200) {
    const result = JSON.parse(responseBody);
    return result.trainees || [];
  } else {
    return [];
  }
}
