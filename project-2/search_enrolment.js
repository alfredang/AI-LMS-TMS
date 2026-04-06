/**
 * Inactive
 * Main function to process enrolments and retrieve the referenceNumber and status.
 */
// function searchEnrolments() {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const sheet = ss.getActiveSheet(); // Dynamically fetches the active sheet
//   const sheetName = sheet.getName(); // Get the name of the active sheet for validation or logging
  

//   // Optional: Validate the active sheet
//   if (sheetName !== "Detailed Data View" && sheetName !== "Concluded Data") {
//     Logger.log(`Unsupported sheet: ${sheetName}`);
//     SpreadsheetApp.getUi().alert("This operation is not supported on this sheet.");
//     return;
//   }

//   // Retrieve data from the active sheet
//   const data = getlookupSheetData(sheet);

//   // Process each row
//   data.forEach(row => {
//     const payload = createlookupPayload(row);

//     // Log the payload
//     Logger.log(`Payload for Row ${row.rowIndex}: ${JSON.stringify(payload, null, 2)}`);

//     const result = sendTolookupEnrolmentAPI(payload);

//     // Process the API response
//     if (result && result.data && result.data.length > 0 && result.data[0].enrolment) {
//       const enrolment = result.data[0].enrolment;

//       // Extract required fields
//       const enrolmentId = enrolment.referenceNumber || "No records found";
//       const additionalDetails = enrolment.status || "No records found";

//       Logger.log(`Row ${row.rowIndex}: Enrolment ID - ${enrolmentId}, Status - ${additionalDetails}`);

//       // Update the sheet with the enrolment ID and additional details
//       sheet.getRange(row.rowIndex, 32).setValue(enrolmentId); // Column AF
//       sheet.getRange(row.rowIndex, 33).setValue(additionalDetails); // Column AG
//     } else {
//       Logger.log(`Row ${row.rowIndex}: No Enrolment details found.`);

//       // Write "No records found" if no enrolment data is returned
//       sheet.getRange(row.rowIndex, 32).setValue("No records found"); // Column AF
//       sheet.getRange(row.rowIndex, 33).setValue("No records found"); // Column AG
//     }
//   });
// }


// function getlookupSheetData(sheet) {
//   const dataRange = sheet.getDataRange();
//   const values = dataRange.getValues();
//   const headers = values[0];
//   const rows = values.slice(1);

//   // Enable or disable the filtering condition
//   const filterByColumnK = true; // Set to true to filter by "Form Status"

//   return rows
//     .map((row, index) => {
//       const rowData = {};
//       headers.forEach((header, colIndex) => {
//         rowData[header] = row[colIndex];
//       });
//       rowData.rowIndex = index + 2; // Store the actual row index
//       return rowData;
//     })
//     .filter(row => {
//       // Filter logic to exclude empty rows
//       const isEmptyRow = Object.values(row).every(value => value === "" || value === null || value === undefined);
//       if (isEmptyRow) return false; // Skip empty rows

//       // Exclude rows where "Enrolment ID" starts with "ENR"
//       if (row['Enrolment ID'] && row['Enrolment ID'].toString().startsWith('ENR')) {
//         Logger.log(`Skipping Row ${row.rowIndex}: Enrolment ID already present (${row['Enrolment ID']}).`);
//         return false;
//       }

//       // Additional filtering condition if enabled
//       if (filterByColumnK) {
//         return row['Ready to Process'] === "Yes"; // Use the header key for clarity
//       }

//       return true; // Include non-empty rows
//     });
// }

/**
 * Constructs the JSON payload from a row of data.
 *
 * @param {Object} row - The row data object.
 * @return {Object} The structured payload.
 */
// function createlookupPayload(row) {
//   return {
//     enrolment: {
//       course: {
//         run: { id: row['Course Run ID'] ? row['Course Run ID'].toString() : '' },
//         referenceNumber: row['TGS Course Code'] ? row['TGS Course Code'].toString() : ''
//       },
//       trainee: {
//         id: row['Trainee ID *'] ? row['Trainee ID *'].toString() : '',
//         idType: { type: row['Trainee ID Type *'] || '' },
//         employer: {
//           uen: row['Employer UEN (mandatory if sponsorship type = employer)']
//             ? row['Employer UEN (mandatory if sponsorship type = employer)'].toString()
//             : ''
//         },
//         sponsorshipType: row['Sponsorship Type *'] ? row['Sponsorship Type *'].toUpperCase() : ''
//       },
//       trainingPartner: {
//         uen: "201200696W",
//         code: "201200696W-01"
//       }
//     },
//     parameters: {
//       page: 0,
//       pageSize: 20
//     }
//   };
// }

/**
 * Sends the payload to the API endpoint and retrieves the response.
 *
 * @param {Object} payload - The JSON payload.
 * @return {Object} The API response.
 */
// function sendTolookupEnrolmentAPI(payload) {
//   const url = 'https://lookup-enrolment-api-26788516550.us-central1.run.app'; // Update with your endpoint

//   const options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify(payload),
//     muteHttpExceptions: true // Log errors instead of halting execution
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
//       Logger.log(`Error in API call. Code: ${responseCode}, Response: ${responseBody}`);
//       return null;
//     }
//   } catch (error) {
//     Logger.log(`Exception during API call: ${error.message}`);
//     return null;
//   }
// }