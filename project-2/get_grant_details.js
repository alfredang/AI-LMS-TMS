/**
 * Adds a custom menu to the Google Sheets UI.
 */
// function onOpen() {
//   SpreadsheetApp.getUi()
//     .createMenu('Start Processing')
//     .addItem('Process Grants', 'processGrants')
//     .addToUi();
// }

/**
 * Main function to process grants based on Enrolment ID.
 */
function processGrants() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet(); // Dynamically fetch the active sheet
  const sheetName = sheet.getName(); // Get the name of the active sheet for validation or logging

  // Optional: Validate the active sheet
  if (sheetName !== "Detailed Data View" && sheetName !== "Concluded Data") {
    Logger.log(`Unsupported sheet: ${sheetName}`);
    SpreadsheetApp.getUi().alert("This operation is not supported on this sheet.");
    return;
  }

  // Get training partner data
  const scriptProps = PropertiesService.getScriptProperties();
  const trainingPartnerCode = scriptProps.getProperty('TRAINING_PARTNER_CODE') || '201200696W-01';
  const trainingPartnerUEN = scriptProps.getProperty('TRAINING_PARTNER_UEN') || '201200696W';

  // Retrieve data from the active sheet
  const data = getgrantsSheetData(sheet);

  // Process each row
  data.forEach(row => {
    const enrolmentId = row['Enrolment ID']; // Column U (Header: Enrolment ID)
    if (!enrolmentId) {
      Logger.log(`Skipping row ${row.rowIndex}: Missing Enrolment ID`);
      return;
    }

    const payload = createGrantPayload(enrolmentId, trainingPartnerCode, trainingPartnerUEN);
    const result = sendToGrantAPI(payload);

    updateRowWithGrantResult(sheet, row.rowIndex, result);
  });
}

/**
 * Retrieves and structures data from the sheet, only including rows where column AG = "Confirmed".
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @return {Array<Object>} Array of row data objects.
 */
function getgrantsSheetData(sheet) {
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];
  const rows = values.slice(1);

  // Enable or disable the filtering condition
  const filterByColumnAG = true; // Set to false to ignore this condition

  return rows
    .map((row, index) => {
      const rowData = {};
      headers.forEach((header, colIndex) => {
        rowData[header] = row[colIndex];
      });
      rowData.rowIndex = index + 2; // +2 because of 0-based index and header row
      return rowData;
    })
    .filter(row => {
      if (!filterByColumnAG) return true; // Skip filtering if disabled
      return row['Additional Details'] === "Confirmed"; // Replace 'AG' with the actual header name for column AG
    });
}

/**
 * Constructs the JSON payload for grants based on Enrolment ID.
 *
 * @param {string} enrolmentId - The enrolment reference number.
 * @param {string} trainingPartnerCode - The training partner code.
 * @param {string} trainingPartnerUEN - The training partner UEN.
 * @return {Object} The structured payload.
 */
function createGrantPayload(enrolmentId, trainingPartnerCode, trainingPartnerUEN) {
  const payload = {
    grants: {
      enrolment: {
        referenceNumber: enrolmentId
      },
      trainingPartner: {
        uen: trainingPartnerUEN,
        code: trainingPartnerCode
      }
    },
    parameters: {
      page: 0,
      pageSize: 100
    }
  };

  Logger.log('Constructed payload: %s', JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Sends the payload to the API.
 *
 * @param {Object} payload - The JSON payload.
 * @return {Object} The API response.
 * Alfred's GrantSearch API: https://ssg-grantsearch-api-26788516550.us-central1.run.app
 */
function sendToGrantAPI(payload) {
  const url = 'https://ssg-grantsearch-api-26788516550.us-central1.run.app'; // Update as needed

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
      Logger.log('Error in API call. Code: %s, Response: %s', responseCode, responseBody);
      return { status: responseCode, error: responseBody };
    }
  } catch (error) {
    Logger.log('Exception during API call: %s', error.message);
    return { status: 500, error: error.message };
  }
}

/**
 * Updates the Google Sheet with the API response.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @param {number} rowIndex - The row index to update.
 * @param {Object} result - The result from the API.
 */
function updateRowWithGrantResult(sheet, rowIndex, result) {
  const startColumn = 34; // Starting column for Grant details
  const columnMapping = {
    grantId: 0,
    grantStatus: 1,
    fundingSchemeCode: 2,
    fundingSchemeDescription: 3,
    fundingComponentCode: 4,
    fundingComponentDescription: 5,
    estimatedAmount: 6,
    paidAmount: 7,
    recoveryAmount: 8,
  };

  if (result.status >= 200 && result.data && Array.isArray(result.data)) {
    // Sort grants based on the integer value in referenceNumber
    const sortedGrants = result.data.sort((a, b) => {
      const aNumber = parseInt(a.referenceNumber.replace(/\D+/g, ''), 10);
      const bNumber = parseInt(b.referenceNumber.replace(/\D+/g, ''), 10);
      return aNumber - bNumber;
    });

    if (sortedGrants.length > 0) {
      sortedGrants.forEach((grant, index) => {
        const baseColumn = startColumn + index * Object.keys(columnMapping).length;

        // Write Grant ID
        sheet.getRange(rowIndex, baseColumn + columnMapping.grantId)
          .setValue(grant.referenceNumber || 'N/A');

        // Write Grant Status
        sheet.getRange(rowIndex, baseColumn + columnMapping.grantStatus)
          .setValue(grant.status || 'N/A');

        // Write Funding Scheme Code
        sheet.getRange(rowIndex, baseColumn + columnMapping.fundingSchemeCode)
          .setValue(grant.fundingScheme?.code || 'N/A');

        // Write Funding Scheme Description
        sheet.getRange(rowIndex, baseColumn + columnMapping.fundingSchemeDescription)
          .setValue(grant.fundingScheme?.description || 'N/A');

        // Write Funding Component Code
        sheet.getRange(rowIndex, baseColumn + columnMapping.fundingComponentCode)
          .setValue(grant.fundingComponent?.code || 'N/A');

        // Write Funding Component Description
        sheet.getRange(rowIndex, baseColumn + columnMapping.fundingComponentDescription)
          .setValue(grant.fundingComponent?.description || 'N/A');

        // Write Estimated Amount
        sheet.getRange(rowIndex, baseColumn + columnMapping.estimatedAmount)
          .setValue(grant.grantAmount?.estimated || 'N/A');

        // Write Paid Amount
        sheet.getRange(rowIndex, baseColumn + columnMapping.paidAmount)
          .setValue(grant.grantAmount?.paid || 'N/A');

        // Write Recovery Amount
        sheet.getRange(rowIndex, baseColumn + columnMapping.recoveryAmount)
          .setValue(grant.grantAmount?.recovery || 'N/A');
      });
    } else {
      // Handle cases with no grants
      sheet.getRange(rowIndex, startColumn).setValue('No grants found');
    }
  } else {
    const errorMessage = result.error ? `Error: ${result.error}` : 'Unknown error';
    sheet.getRange(rowIndex, startColumn).setValue(errorMessage);
  }
}
