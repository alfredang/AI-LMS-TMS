function appendNewRows() {
  const sourceSpreadsheetId = '1gcFAeO-EDbD-BQmk56zC8NC9u8b2XOYOmQnrQ5CJBPE';
  Logger.log('Opening source spreadsheet with ID: %s', sourceSpreadsheetId);

  const sourceSpreadsheet = SpreadsheetApp.openById(sourceSpreadsheetId);
  const sourceSheet = sourceSpreadsheet.getSheetByName('Calendar View');
  if (!sourceSheet) {
    Logger.log("Error: Source sheet 'Calendar View' not found.");
    throw new Error("Source sheet 'Calendar View' not found.");
  }
  Logger.log('Source sheet "Calendar View" found.');

  const sourceRange = sourceSheet.getDataRange();
  const sourceValues = sourceRange.getValues(); // 2D array of all rows and columns
  Logger.log('Retrieved %d rows and %d columns from source sheet.', sourceValues.length, sourceValues[0]?.length || 0);

  const lastAppendedDate = PropertiesService.getScriptProperties().getProperty('lastAppendedDate') || '';
  Logger.log('Last appended date from properties: %s', lastAppendedDate || 'None');

  const dateColIndex = 2; // zero-based index for the date column
  const newRows = sourceValues.filter((row, index) => {
    if (index === 0) return false; // Skip headers
    const rowDate = new Date(row[dateColIndex]);
    const isNewRow = !lastAppendedDate || (rowDate > new Date(lastAppendedDate));
    Logger.log('Row %d: Date: %s, New Row: %s', index + 1, row[dateColIndex], isNewRow);
    return isNewRow;
  });

  Logger.log('%d new rows identified for appending.', newRows.length);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('Detailed Data View');
  if (!dataSheet) {
    Logger.log("Error: Target sheet 'Detailed Data View' not found.");
    throw new Error("Target sheet 'Detailed Data View' not found.");
  }
  Logger.log('Target sheet "Detailed Data View" found.');

  if (newRows.length > 0) {
    Logger.log('Appending %d new rows to target sheet.', newRows.length);

    // Insert rows if needed
    dataSheet.insertRowsAfter(dataSheet.getLastRow(), newRows.length);
    Logger.log('Inserted %d rows after the last row in the target sheet.', newRows.length);

    // Place the new rows
    dataSheet.getRange(dataSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
      .setValues(newRows);
    Logger.log('New rows added to target sheet.');

    // Update the lastAppendedDate
    const dateColumn = 3; // Date column (1-based index), if date is in Column C
    const maxDate = newRows.reduce((max, row) => {
      const d = new Date(row[dateColumn - 1]);
      return d > max ? d : max;
    }, lastAppendedDate ? new Date(lastAppendedDate) : new Date(0));

    PropertiesService.getScriptProperties().setProperty('lastAppendedDate', maxDate.toISOString());
    Logger.log('Updated last appended date to: %s', maxDate.toISOString());
  } else {
    Logger.log('No new rows to append.');
  }
}
