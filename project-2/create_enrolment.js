// /**
//  * Adds a custom menu to the Google Sheets UI.
//  */
// function onOpen() {
//   SpreadsheetApp.getUi()
//     .createMenu('Start Processing')
//     .addItem('Process Enrolments', 'processEnrolments')
//     .addToUi();
// }
/**
 * Active, Under "Start Processing", "Process Enrolments"
 */

/**
 * Main function to process enrolments.
 */
function processEnrolments() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const sheetName = sheet.getName();

  if (sheetName !== "Detailed Data View" && sheetName !== "Concluded Data") {
    Logger.log(`Unsupported sheet: ${sheetName}`);
    SpreadsheetApp.getUi().alert("This operation is not supported on this sheet.");
    return;
  }

  const trainingPartnerCode = "201200696W-01";
  const trainingPartnerUEN = "201200696W";
  const encryptionKey = "j+PIkNgt8a4JhDQzvBNk8Z5ocxakJ/YDQsLHaQD6Hww=";

  const data = getEnrolmentSheetData(sheet);
  
  data.forEach(row => {
    const payload = createPayload(row, trainingPartnerCode, trainingPartnerUEN);
    const result = sendToEnrolmentAPI(payload, encryptionKey);
    updateRowWithResult(sheet, row.originalRowIndex, result);
  });
}

/**
 * Retrieves and structures data from the sheet, optionally filtering rows where column "Ready to Process" is "Yes".
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @return {Array<Object>} Array of row data objects.
 */
function getEnrolmentSheetData(sheet) {
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];
  const rows = values.slice(1);

  const readyToProcessColIndex = headers.indexOf("Ready to Process");
  if (readyToProcessColIndex === -1) {
    throw new Error('Column "Ready to Process" not found.');
  }

  const enrolmentIdColIndex = headers.indexOf("Enrolment ID");
  const additionalDetailsColIndex = headers.indexOf("Additional Details");

  if (enrolmentIdColIndex === -1 || additionalDetailsColIndex === -1) {
    throw new Error('Required column "Enrolment ID" or "Additional Details" not found.');
  }

  Logger.log(`"Ready to Process" column index: ${readyToProcessColIndex}`);
  
  const filteredRows = rows
    .map((row, index) => {
      const readyToProcess = row[readyToProcessColIndex];
      return {
        rowData: row,
        originalRowIndex: index + 2, // Account for header row and 0-based indexing
        readyToProcess
      };
    })
    .filter(row => {
      Logger.log(`Row ${row.originalRowIndex}: "Ready to Process" value: ${row.readyToProcess}`);
      return row.readyToProcess && row.readyToProcess.toString().toLowerCase() === "yes";
    });

  Logger.log(`Number of rows ready to process: ${filteredRows.length}`);

  return filteredRows.map(row => {
    const rowDataObject = {};
    headers.forEach((header, colIndex) => {
      rowDataObject[header] = row.rowData[colIndex];
    });
    rowDataObject.originalRowIndex = row.originalRowIndex;
    Logger.log(`Row ${rowDataObject.originalRowIndex} mapped data: ${JSON.stringify(rowDataObject)}`);
    return rowDataObject;
  });
}

/**
 * Constructs the JSON payload from a row of data.
 *
 * @param {Object} row - The row data object.
 * @param {string} trainingPartnerCode - The training partner code.
 * @param {string} trainingPartnerUEN - The training partner UEN.
 * @return {Object} The structured payload.
 */
function createPayload(row, trainingPartnerCode, trainingPartnerUEN) {
  const payload = {
    enrolment: {
      trainingPartner: {
        code: trainingPartnerCode,
        uen: trainingPartnerUEN,
      },
      course: {
        referenceNumber: row['TGS Course Code'] ? row['TGS Course Code'].toString() : '',
        run: {
          id: row['Course Run ID'] ? row['Course Run ID'].toString() : '',
        },
      },
      trainee: {
        idType: {
          type: row['Trainee ID Type *'] || '',
        },
        id: row['Trainee ID *'] ? row['Trainee ID *'].toString() : '',
        dateOfBirth: formatEnrolmentDate(row['Date of Birth (MM/DD/YYYY format) *']),
        fullName: row['Trainee Name (as on government ID)'] || '',
        contactNumber: {
          countryCode: row['Trainee Phone Country Code (+xx) *']
            ? row['Trainee Phone Country Code (+xx) *'].toString()
            : '',
          areaCode: row['Trainee Phone Area Code']
            ? row['Trainee Phone Area Code'].toString()
            : '',
          phoneNumber: row['Trainee Phone *']
            ? row['Trainee Phone *'].toString()
            : '',
        },
        emailAddress: row['Email'] || '',
        sponsorshipType: row['Sponsorship Type *'] ? row['Sponsorship Type *'].toUpperCase() : '',
        enrolmentDate: Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd'),
        fees: {
          discountAmount: 0, // Hardcoded value
          collectionStatus: 'Pending Payment', // Hardcoded value
        },
      },
    },
  };

  // Add employer details if sponsorshipType is "EMPLOYER"
  if (payload.enrolment.trainee.sponsorshipType === 'EMPLOYER') {
    payload.enrolment.trainee.employer = {
      uen: row['Employer UEN (mandatory if sponsorship type = employer)']
        ? row['Employer UEN (mandatory if sponsorship type = employer)'].toString()
        : '',
      contact: {
        fullName: row['Employer Contact Name (mandatory if sponsorship type = employer)'] || '',
        contactNumber: {
          countryCode: row['Employer Phone Country Code (+xx) (mandatory if sponsorship type = employer)']
            ? row['Employer Phone Country Code (+xx) (mandatory if sponsorship type = employer)'].toString()
            : '',
          areaCode: row['Employer Phone Area Code']
            ? row['Employer Phone Area Code'].toString()
            : '',
          phoneNumber: row['Employer Phone (mandatory if sponsorship type = employer)']
            ? row['Employer Phone (mandatory if sponsorship type = employer)'].toString()
            : '',
        },
        emailAddress: row['Employer Contact Email (mandatory if sponsorship type = employer)'] || '',
      },
    };
  }

  return payload;
}

/**
 * Sends the payload to the API.
 *
 * @param {Object} payload - The JSON payload.
 * @param {string} encryptionKey - The encryption key.
 * @return {Object} The API response.
 */
function sendToEnrolmentAPI(payload, encryptionKey) {
  const url = 'https://ssg-enrolment-api-26788516550.us-central1.run.app';

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true, // Log errors instead of halting execution
  };

  Logger.log('Sending payload: %s', JSON.stringify(payload, null, 2));

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
 * Updates the Google Sheet with the API response using column names.
 *
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @param {Object} row - The row data object.
 * @param {Object} result - The result from the API.
 */
function updateRowWithResult(sheet, originalRowIndex, result) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const enrolmentIdColIndex = headers.indexOf("Enrolment ID") + 1;
  const additionalDetailsColIndex = headers.indexOf("Additional Details") + 1;

  if (result.status >= 200 && result.status < 300) {
    const enrolment = result.data?.enrolment || {};
    const enrolmentId = enrolment.referenceNumber || "";
    const additionalDetails = enrolment.status || "";

    Logger.log(`Updating row ${originalRowIndex} in columns: Enrolment ID (${enrolmentIdColIndex}), Additional Details (${additionalDetailsColIndex})`);
    sheet.getRange(originalRowIndex, enrolmentIdColIndex).setValue(enrolmentId);
    sheet.getRange(originalRowIndex, additionalDetailsColIndex).setValue(additionalDetails);
  } else {
    const errorDetails = result.error?.details || [];
    const errorMessages = errorDetails.map(detail => `${detail.field}: ${detail.message}`).join("; ");
    const errorMessage = errorMessages || result.error?.message || "Unknown error";

    Logger.log(`Updating row ${originalRowIndex} with error: ${errorMessage}`);
    sheet.getRange(originalRowIndex, enrolmentIdColIndex).setValue("Error");
    sheet.getRange(originalRowIndex, additionalDetailsColIndex).setValue(errorMessage);
  }
}

/**
 * Formats the date from various possible formats to 'yyyy-MM-dd'.
 *
 * @param {string|number} dateInput - The input date.
 * @return {string} The formatted date.
 */
function formatEnrolmentDate(dateInput) {
  if (!dateInput || typeof dateInput !== 'string') return '';

  const parts = dateInput.split('/');
  if (parts.length !== 3) return '';

  const [mm, dd, yyyy] = parts;
  if (isNaN(parseInt(mm)) || isNaN(parseInt(dd)) || isNaN(parseInt(yyyy))) {
    return '';
  }

  const month = mm.padStart(2, '0');
  const day = dd.padStart(2, '0');

  return `${yyyy}-${month}-${day}`;
}