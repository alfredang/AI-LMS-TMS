/**
 * Main function to update fee collection status.
 * Inactive
 */
function updateFeeCollections() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Concluded Data'); // Update sheet name as needed

  // Retrieve data from the sheet
  const data = getFeeStatusSheetData(sheet);

  // Process each row
  data.forEach(row => {
    const payload = createFeeCollectionPayload(row);

    // Skip rows with missing required data
    if (!payload.referenceNumber || !payload.enrolment.fees.collectionStatus) {
      Logger.log(`Skipping Row ${row.rowIndex}: Missing Enrolment ID or Fee Collection Status.`);
      return;
    }

    // Log the payload
    Logger.log(`Payload for Row ${row.rowIndex}: ${JSON.stringify(payload, null, 2)}`);

    const result = sendToFeeCollectionAPI(payload);

    // Check the response for a successful update
    if (result && result.status === 200 && result.meta && result.meta.updatedOn) {
      const updatedOn = formatFeeDate(result.meta.updatedOn);
      Logger.log(`Row ${row.rowIndex}: Fee Collection Status Update - ${updatedOn}`);

      // Write formatted updatedOn value to the "Fee Collection Status Update" column
      writeToFeeColumnByName(sheet, row.rowIndex, "Fee Collection Status Update Time", updatedOn);
    } else {
      Logger.log(`Row ${row.rowIndex}: Fee Update Unsuccessful`);

      // Write "Fee Update Unsuccessful" if the request fails or `updatedOn` is missing
      writeToFeeColumnByName(sheet, row.rowIndex, "Fee Collection Status Update Time", "Fee Update Unsuccessful");
    }
  });
}

/**
 * Formats a date string into a readable format.
 *
 * @param {string} isoDateString - The ISO date string to format.
 * @return {string} The formatted date string.
 */
function formatFeeDate(isoDateString) {
  const date = new Date(isoDateString);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
}


/**
 * Retrieves and structures data from the sheet.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @return {Array<Object>} Array of row data objects.
 */
function getFeeStatusSheetData(sheet) {
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];
  const rows = values.slice(1);

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
      // Only include rows where "Ready to Process" column is "Yes"
      if (row['Ready to Process'] !== "Yes") {
        Logger.log(`Skipping Row ${row.rowIndex}: "Ready to Process" is not "Yes".`);
        return false; // Skip rows where "Ready to Process" is not "Yes"
      }
      return true; // Include rows where "Ready to Process" is "Yes"
    });
}
/**
 * Constructs the JSON payload from a row of data.
 *
 * @param {Object} row - The row data object.
 * @return {Object} The structured payload.
 */
function createFeeCollectionPayload(row) {
  return {
    referenceNumber: row['Enrolment ID'] ? row['Enrolment ID'].toString() : '',
    enrolment: {
      fees: {
        collectionStatus: row['Fee Collection Status Update'] ? row['Fee Collection Status Update'].toString() : ''
      }
    }
  };
}

/**
 * Sends the payload to the Google Cloud Function endpoint and retrieves the response.
 *
 * @param {Object} payload - The JSON payload.
 * @return {Object|null} The API response, or null if the request fails.
 */
function sendToFeeCollectionAPI(payload) {
  const url = `https://ssg-updatefeecollectionstatus-api-26788516550.us-central1.run.app`; // Replace with your Cloud Function URL

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
 * Writes a value to a specific column based on the column name.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @param {number} rowIndex - The row index to write to (1-based).
 * @param {string} columnName - The name of the column to write to.
 * @param {string} value - The value to write into the cell.
 */
function writeToFeeColumnByName(sheet, rowIndex, columnName, value) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const columnIndex = headers.indexOf(columnName) + 1; // Convert to 1-based index

  if (columnIndex > 0) {
    sheet.getRange(rowIndex, columnIndex).setValue(value);
  } else {
    Logger.log(`Column "${columnName}" not found.`);
  }
}
