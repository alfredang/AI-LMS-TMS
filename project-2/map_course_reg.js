/**
 * Requires Three Sheet To Make The Script Work - Currently Not Working / Inactive
 * Reg Order Sheet Import Sheet,  got "REF!" Error
 * Concluded Data Sheet - Still Having Recent Data
 * Detailed Data View - Still Having Recent Data
 */
function mapOrderRegistrationNumber() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Sheets
  const regOrderSheet = ss.getSheetByName('Reg Order Sheet Import');
  const concludedSheet = ss.getSheetByName('Concluded Data');
  const detailedSheet = ss.getSheetByName('Detailed Data View');

  if (!regOrderSheet || !concludedSheet || !detailedSheet) {
    Logger.log("One or more required sheets are missing.");
    return;
  }

  // Fetch data
  const regOrderData = getRegistrationSheetData(regOrderSheet);
  const concludedData = getRegistrationSheetData(concludedSheet);
  const detailedData = getRegistrationSheetData(detailedSheet);

  // Create lookup map from "Reg Order Sheet Import"
  const regOrderLookup = regOrderData.reduce((map, row) => {
    const key = `${row['Trainee Email']?.toLowerCase()?.trim()}|${normalizeEventTitle(row['Course Name'])}`;
    map[key] = row['New Course Reg No.'];
    return map;
  }, {});

  // Update "Concluded Data" sheet
  updateCourseRegNo(concludedSheet, concludedData, regOrderLookup);

  // Update "Detailed Data View" sheet
  updateCourseRegNo(detailedSheet, detailedData, regOrderLookup);

  Logger.log("Mapping complete.");
}

/**
 * Fetches data from a sheet and returns it as an array of objects.
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @return {Array<Object>} Array of row data objects.
 */
function getRegistrationSheetData(sheet) {
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];
  const rows = values.slice(1);

  return rows.map((row) => {
    const rowData = {};
    headers.forEach((header, index) => {
      rowData[header] = row[index];
    });
    return rowData;
  });
}

/**
 * Updates the "Course Reg. No" column in the given sheet based on the lookup map.
 * @param {Sheet} sheet - The Google Sheets sheet object.
 * @param {Array<Object>} data - The sheet data as an array of objects.
 * @param {Object} regOrderLookup - A lookup map of { email|eventTitle -> registrationNumber }.
 */
function updateCourseRegNo(sheet, data, regOrderLookup) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const courseRegNoIndex = headers.indexOf('Course Reg. No') + 1; // 1-based index
  const emailIndex = headers.indexOf('Email');
  const eventTitleIndex = headers.indexOf('Event Title');

  if (courseRegNoIndex <= 0 || emailIndex < 0 || eventTitleIndex < 0) {
    Logger.log(`Required columns are missing in sheet: ${sheet.getName()}`);
    return;
  }

  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const email = rows[i][emailIndex]?.toLowerCase()?.trim();
    const eventTitle = normalizeEventTitle(rows[i][eventTitleIndex]);
    if (!email || !eventTitle) continue;

    const key = `${email}|${eventTitle}`;
    const regNo = regOrderLookup[key];

    if (regNo) {
      sheet.getRange(i + 1, courseRegNoIndex).setValue(regNo); // Update "Course Reg. No"
    }
  }
}

/**
 * Normalizes event titles and course names to handle inconsistencies.
 *
 * @param {string} text - The input text to normalize.
 * @return {string} - The normalized text.
 */
function normalizeEventTitle(text) {
  if (!text) return '';

  return text
    .toLowerCase() // Convert to lowercase
    .replace(/\[.*?\]|\(.*?\)|^\*|\*$/g, '') // Remove [tags], (tags), and leading/trailing asterisks
    .replace(/\bwsq\b/g, 'wsq') // Standardize 'WSQ'
    .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
    .trim(); // Trim leading and trailing spaces
}
