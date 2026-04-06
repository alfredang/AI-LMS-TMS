/**
 * Inactive , Not In Used , Replaced
 * Adds a custom menu to the Google Sheets UI for cancellation.
 */
// function onOpen() {
//   SpreadsheetApp.getUi()
//     .createMenu('Start Processing')
//     .addItem('Cancel Enrolments', 'processCancellations')
//     .addToUi();
// }

/**
 * Main function to process enrolment cancellations.
 */
// function processCancellations() {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const sheet = ss.getSheetByName('Detailed Data View'); // Ensure correct sheet name
//   const trainingPartnerCode = "201200696W-01";
//   const trainingPartnerUEN = "201200696W";

//   const { headers, rows } = getSheetData(sheet);
  
//   // Find column index for 'Cancellation Status'
//   const statusColumnIndex = headers.indexOf('Cancellation Status') + 1;
//   if (statusColumnIndex < 1) {
//     Logger.log('Error: "Cancellation Status" column not found.');
//     return;
//   }

//   // Process each row marked for cancellation
//   rows.forEach(row => {
//     if (row['Cancel?'] === 'Yes') { // Check for 'Yes' under 'Cancel?'
//       const enrolmentId = row['Enrolment ID'];
//       if (!enrolmentId) {
//         Logger.log(`Skipping row ${row.rowIndex}: Missing Enrolment ID`);
//         sheet.getRange(row.rowIndex, statusColumnIndex).setValue('Missing Enrolment ID');
//         return;
//       }

//       const payload = createCancellationPayload(row, trainingPartnerCode, trainingPartnerUEN);
//       const result = sendToCancelAPI(payload);

//       // Update the sheet with cancellation status
//       updateRowWithCancellationResult(sheet, row.rowIndex, result, statusColumnIndex);
//     }
//   });
// }

/**
 * Retrieves and structures data from the sheet.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @return {Array<Object>} Array of row data objects.
 */
// function getSheetData(sheet) {
//   const dataRange = sheet.getDataRange();
//   const values = dataRange.getValues();
//   const headers = values[0]; // First row is headers
//   const rows = values.slice(1);

//   return {
//     headers: headers,
//     rows: rows.map((row, index) => {
//       const rowData = {};
//       headers.forEach((header, colIndex) => {
//         rowData[header] = row[colIndex];
//       });
//       rowData.rowIndex = index + 2; // +2 because of header row and 0-based index
//       return rowData;
//     })
//   };
// }

/**
 * Constructs the JSON payload for cancellations.
 *
 * @param {Object} row - The row data object.
 * @param {string} trainingPartnerCode - The training partner code.
 * @param {string} trainingPartnerUEN - The training partner UEN.
 * @return {Object} The structured payload.
 */
// function createCancellationPayload(row, trainingPartnerCode, trainingPartnerUEN) {
//   const payload = {
//     enrolment: {
//       referenceNumber: row['Enrolment ID'], // Ensure this column has the enrolment ID
//       trainingPartner: {
//         code: trainingPartnerCode,
//         uen: trainingPartnerUEN,
//       },
//       action: 'Cancel', // Action for cancellation
//     },
//   };

//   Logger.log('Cancellation Payload: %s', JSON.stringify(payload, null, 2));
//   return payload;
// }

/**
 * Sends the cancellation payload to the API.
 *
 * @param {Object} payload - The JSON payload.
 * @return {Object} The API response.
 */
// function sendToCancelAPI(payload) {
//   const url = 'https://ssg-cancelenrolment-api-26788516550.us-central1.run.app'; // Replace with your Cloud Function endpoint

//   const options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify(payload),
//     muteHttpExceptions: true, // Log errors instead of halting execution
//   };

//   try {
//     const response = UrlFetchApp.fetch(url, options);
//     const responseCode = response.getResponseCode();
//     const responseBody = response.getContentText();

//     Logger.log('HTTP Status Code: %s', responseCode);
//     Logger.log('Response Body: %s', responseBody);

//     if (responseCode >= 200 && responseCode < 300) {
//       return JSON.parse(responseBody);
//     } else {
//       Logger.log('Error in API call. Code: %s, Response: %s', responseCode, responseBody);
//       return { status: responseCode, error: responseBody };
//     }
//   } catch (error) {
//     Logger.log('Exception during API call: %s', error.message);
//     return { status: 500, error: error.message };
//   }
// }

/**
 * Updates the Google Sheet with the API response.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @param {number} rowIndex - The row index to update.
 * @param {Object} result - The result from the API.
 * @param {number} statusColumn - The column index for writing the cancellation status.
 */
// function updateRowWithCancellationResult(sheet, rowIndex, result, statusColumnIndex) {
//   if (result.status >= 200 && result.status < 300) {
//     const cancellationStatus = result.data?.enrolment?.status || 'Success'; // Default to 'Success'
//     sheet.getRange(rowIndex, statusColumnIndex).setValue(cancellationStatus);
//   } else {
//     const errorMessage = result.error ? `Error: ${result.error}` : 'Unknown error';
//     sheet.getRange(rowIndex, statusColumnIndex).setValue(errorMessage);
//   }
// }
