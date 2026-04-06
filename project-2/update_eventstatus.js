function updateEventStatuses() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const calendarDataSheet = ss.getSheetByName("Detailed Data View"); // Source sheet
  const concludedDataSheet = ss.getSheetByName("Concluded Data"); // Destination sheet
  
  if (!calendarDataSheet || !concludedDataSheet) {
    Logger.log("One or both sheets not found.");
    return;
  }
  
  const dataRange = calendarDataSheet.getDataRange();
  const dataValues = dataRange.getValues(); // Get all data
  const headers = dataValues[0]; // First row (headers)
  const now = new Date(); // Current time
  const concludedRows = []; // Rows to move
  const updatedData = []; // Updated data to rewrite back to the source sheet
  
  // Append headers to updatedData
  updatedData.push(headers);

  for (let i = 1; i < dataValues.length; i++) { // Skip headers
    const row = dataValues[i];
    const endDateTime = new Date(row[3]); // Assuming 'End Date & Time' is in the 4th column (index 3)
    const eventStatus = row[5]; // Assuming 'Event Status' is in the 6th column (index 5)

    if (eventStatus === "Upcoming" && endDateTime < now) {
      row[5] = "Concluded"; // Update the status
      concludedRows.push(row); // Add to concluded rows
    } else {
      updatedData.push(row); // Retain row in the source sheet
    }
  }

  // Clear and rewrite updated data back to the source sheet
  calendarDataSheet.clearContents();
  calendarDataSheet.getRange(1, 1, updatedData.length, updatedData[0].length).setValues(updatedData);

  // Append concluded rows to the 'Concluded Data' sheet
  if (concludedRows.length > 0) {
    const lastRow = concludedDataSheet.getLastRow();
    concludedDataSheet.getRange(lastRow + 1, 1, concludedRows.length, concludedRows[0].length).setValues(concludedRows);
  }
  
  Logger.log("Event statuses updated and concluded events moved.");
}
