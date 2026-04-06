/**
 * Currently Inactive, 19/2/2026
 */

/**
 * Main function to process assessment data and send to the endpoint.
 */
function processAssessmentData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Concluded Data'); // Update with the correct sheet name

  // Retrieve data from the sheet
  const data = getAssessmentSheetData(sheet);

  // Process each row that is marked as "Ready to Process" with "Yes"
  data.forEach(row => {
    if (row['Ready to Process']?.toString().toLowerCase() !== 'yes') {
      return; // Skip rows not marked as "Yes"
    }

    const payload = createAssessmentPayload(row);

    // Skip rows with missing required data
    if (!payload.assessment.course.referenceNumber || !payload.assessment.result || !payload.assessment.assessmentDate) {
      return; // Skip rows missing required data
    }

    const result = sendToAssessmentAPI(payload);

    // Process the API response and update the sheet
    if (result && result.status === 200) {
      updateSheetWithResponse(sheet, row.rowIndex, result);
    }
  });
}

/**
 * Updates the sheet with the Assessment ID and Assessment ID Date from the API response.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @param {number} rowIndex - The row index to update.
 * @param {Object} result - The API response.
 */
function updateSheetWithResponse(sheet, rowIndex, result) {
  const assessmentIdCol = findColumnIndex(sheet, 'Assessment ID');
  const assessmentIdDateCol = findColumnIndex(sheet, 'Assessment ID Date');

  if (result.status >= 200 && result.status < 300) {
    // Successful response
    const assessment = result.data?.assessment || {};
    const referenceNumber = assessment.referenceNumber || ''; // Assessment ID
    const updatedOn = result.meta?.updatedOn || ''; // Assessment ID Date

    if (assessmentIdCol > -1) {
      sheet.getRange(rowIndex, assessmentIdCol).setValue(referenceNumber);
    }

    if (assessmentIdDateCol > -1) {
      sheet.getRange(rowIndex, assessmentIdDateCol).setValue(updatedOn);
    }
  } else {
    // Handle errors
    const errorDetails = result.error?.details || [];
    const errorMessages = errorDetails.map(detail => `${detail.field}: ${detail.message}`).join('; ');
    const errorMessage = errorMessages || result.error?.message || 'Unknown error';

    if (assessmentIdCol > -1) {
      sheet.getRange(rowIndex, assessmentIdCol).setValue('Error');
    }

    if (assessmentIdDateCol > -1) {
      sheet.getRange(rowIndex, assessmentIdDateCol).setValue(errorMessage);
    }
  }
}

/**
 * Finds the column index for a given column name.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @param {string} columnName - The column name to search for.
 * @return {number} The column index (1-based), or -1 if not found.
 */
function findColumnIndex(sheet, columnName) {
  const headers = sheet.getDataRange().getValues()[0];
  return headers.indexOf(columnName) + 1; // Convert 0-based index to 1-based
}

/**
 * Retrieves and structures data from the sheet.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @return {Array<Object>} Array of row data objects.
 */
function getAssessmentSheetData(sheet) {
  const dataRange = sheet.getDataRange();
  const headers = dataRange.getValues()[0]; // Headers remain as raw values
  const rows = dataRange.getDisplayValues().slice(1); // Use display values for rows

  // Ensure "Ready to Process" column exists
  const readyToProcessColIndex = headers.indexOf("Ready to Process");
  if (readyToProcessColIndex === -1) {
    throw new Error('Column "Ready to Process" not found.');
  }

  return rows.map((row, index) => {
    const rowData = {};
    headers.forEach((header, colIndex) => {
      rowData[header] = row[colIndex];
    });
    rowData.rowIndex = index + 2; // Adjust for 1-based indexing with header row
    return rowData;
  });
}

/**
 * Constructs the JSON payload from a row of data.
 *
 * @param {Object} row - The row data object.
 * @return {Object} The structured payload.
 */
function createAssessmentPayload(row) {
  return {
    assessment: {
      course: {
        run: {
          id: row['Course Run ID'] ? row['Course Run ID'].toString() : ''
        },
        referenceNumber: row['TGS Course Code'] ? row['TGS Course Code'].toString() : ''
      },
      result: row['Assessment Grade'] ? row['Assessment Grade'].toString() : '',
      trainee: {
        id: row['Trainee ID *'] ? row['Trainee ID *'].toString() : '',
        idType: row['Trainee ID Type *'] || ''
      },
      assessmentDate: formatAssessmentDate(row['Assessment Date']),
      trainingPartner: {
        uen: "201200696W",
        code: "201200696W-01"
      },
      conferringInstitute: {
        code: "201200696W-01"
      },
      skillCode: row['Skill Code'] ? row['Skill Code'].toString() : ' '      
    }
  };
}

/**
 * Sends the payload to the Google Cloud Function endpoint and retrieves the response.
 *
 * @param {Object} payload - The JSON payload.
 * @return {Object|null} The API response, or null if the request fails.
 */
function sendToAssessmentAPI(payload) {
  const url = `https://ssg-updateassessment-api-26788516550.us-central1.run.app`; // Replace with your Cloud Function URL

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // Log errors instead of halting execution
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    Logger.log('HTTP Status Code: %s', responseCode);
    Logger.log('Response Body: %s', responseBody);

    if (responseCode >= 200 && responseCode < 300) {
      return JSON.parse(responseBody);
    } else {
      Logger.log(`Error in API call. Code: ${responseCode}, Response: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Exception during API call: ${error.message}`);
    return null;
  }
}

/**
 * Formats the date from 'MM/DD/YYYY' or numerical Excel date to 'YYYY-MM-DD'.
 *
 * @param {string|number} dateInput - The input date as a string or Excel numerical format.
 * @return {string} The formatted date in 'YYYY-MM-DD' format, or '' if invalid.
 */
function formatAssessmentDate(dateInput) {
  if (!dateInput || typeof dateInput !== 'string') return '';

  // Split the date string into components
  const parts = dateInput.split('/');
  if (parts.length !== 3) return '';

  const [mm, dd, yyyy] = parts;

  // Validate components
  if (isNaN(parseInt(mm)) || isNaN(parseInt(dd)) || isNaN(parseInt(yyyy))) {
    return '';
  }

  // Pad month and day with leading zeros if necessary
  const month = mm.padStart(2, '0');
  const day = dd.padStart(2, '0');

  return `${yyyy}-${month}-${day}`;
}