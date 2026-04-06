/**
 * Main function to retrieve and display attendance for a specific course run.
 */
function checkAttendanceForCourse() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const detailedSheet = ss.getSheetByName('Check Attendance'); // Source sheet with detailed data
  const checkAttendanceSheet = ss.getSheetByName('Check Attendance'); // Output sheet
  checkAttendanceSheet.getRange('D2:H').clear();

  if (!checkAttendanceSheet) {
    throw new Error("Sheet 'Check Attendance' not found.");
  }

  // Get the Course Run ID from cell B1 in "Check Attendance"
  const courseRunId = checkAttendanceSheet.getRange('B1').getValue();
  if (!courseRunId) {
    throw new Error("Please provide a valid Course Run ID in Cell B1.");
  }

  // Get TGS Course Code
  const courseReferenceNumberTGS = checkAttendanceSheet.getRange('B2').getValue();
  if (!courseReferenceNumberTGS) {
    throw new Error("Please provide a valid TGS Course Code in Cell B2.");
  }

  // Get UEN
  const uen = '201200696W';

  const cloudRunUrl = 'https://ssg-getcourseattendance-api-26788516550.us-central1.run.app'; // Cloud Run endpoint

  // Call the API with the necessary details
  const traineesData = fetchAttendanceData(cloudRunUrl, courseRunId, courseReferenceNumberTGS, uen);

  if (traineesData.length === 0) {
    Logger.log(`No attendance data found for Course Run ID: ${courseRunId}`);
    checkAttendanceSheet.getRange('D2:H').clear(); // Clear old results
    return;
  }

  // Headers for output: NRIC, NAME, EMAIL, EXPECTED ATTENDANCE, TOTAL ATTENDANCE
  const headers = ['NRIC', 'NAME', 'EMAIL', 'EXPECTED ATTENDANCE', 'TOTAL ATTENDANCE'];

  // Write headers to "Check Attendance" sheet
  checkAttendanceSheet.getRange(1, 4, 1, headers.length).setValues([headers]);

  // Prepare data for output
  const outputData = traineesData.map(trainee => [
    trainee.traineeId || '',
    trainee.name || '',
    trainee.email || '',
    trainee.expectedAttendance || 0,
    trainee.totalAttendances || 0
  ]);

  // Write data to "Check Attendance" sheet
  checkAttendanceSheet.getRange(2, 4, outputData.length, headers.length).setValues(outputData);

  Logger.log(`Attendance data for Course Run ID: ${courseRunId} has been written to 'Check Attendance'.`);
}

/**
 * Fetch attendance data for a specific course run.
 *
 * @param {string} url - The API endpoint.
 * @param {string} runId - The Course Run ID.
 * @param {string} courseRef - The TGS Course Code.
 * @param {string} uen - The UEN.
 * @return {Array<Object>} - An array of trainee attendance data.
 */
function fetchAttendanceData(url, runId, courseRef, uen) {
  const payload = {
    runId: runId.toString(),
    uen: uen.toString(),
    courseReferenceNumber: courseRef.toString()
  };

  Logger.log(`Payload: ${JSON.stringify(payload, null, 2)}`); // Log the payload

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  Logger.log(`fetchAttendanceData: Code: ${responseCode}, Body: ${responseBody}`);

  if (responseCode === 200) {
    const result = JSON.parse(responseBody);
    return result.trainees || [];
  } else {
    Logger.log(`Error fetching attendance data: ${responseCode}`);
    return [];
  }
}
