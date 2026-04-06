function fetchPowerAutomateResults() {
  // Open the spreadsheet and sheet
  var eligibilitySpreadsheet = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1gcFAeO-EDbD-BQmk56zC8NC9u8b2XOYOmQnrQ5CJBPE/edit?usp=sharing');
  var eligibilityTargetSheet = eligibilitySpreadsheet.getSheetByName('Verification'); // Eligibility sheet

  // Get the last row in the Eligibility sheet
  var lastRow = eligibilityTargetSheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("No data to transform.");
    return;
  }

  // Get the range for Column E starting from row 2
  var range = eligibilityTargetSheet.getRange(2, 5, lastRow - 1, 1); // Column E (5), from row 2
  var data = range.getValues();

  // Iterate through each row in Column E and format dates
  for (var i = 0; i < data.length; i++) {
    var cellValue = data[i][0]; // Column E value for the current row
    
    // Check if the cell contains a valid date
    if (Object.prototype.toString.call(cellValue) === '[object Date]') {
      // Convert to the desired format: 12 Dec 2024
      var formattedDate = Utilities.formatDate(cellValue, Session.getScriptTimeZone(), "dd MMM yyyy");
      data[i][0] = formattedDate; // Update the cell value in the data array
      // Logger.log(formattedDate)
    }
  }

  // Write the transformed data back to Column E
  range.setValues(data);

  // Logger.log("Date formatting for Column E complete.");

  // Open the "Grant" spreadsheet and sheet
  var grantSpreadsheet = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?gid=0#gid=0');
  var grantTargetSheet = grantSpreadsheet.getSheetByName('All Grants'); // Grant sheet

  // Find the first empty row in Column A of the Grant sheet
  var grantLastRow = grantTargetSheet.getLastRow();
  var firstEmptyRow = grantLastRow + 1; // The next row after the last row

  // Copy Column G from the Eligibility sheet to Column A in the Grant sheet
  var columnGRange = eligibilityTargetSheet.getRange(2, 7, lastRow - 1, 1); // Column G (7), from row 2
  var columnGData = columnGRange.getValues();

  // Append Course Code in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 1, columnGData.length, 1).setValues(columnGData);


  // Copy Column F from the Eligibility sheet to Column B in the Grant sheet
  var columnFRange = eligibilityTargetSheet.getRange(2, 6, lastRow - 1, 1); // Column F (6), from row 2
  var columnFData = columnFRange.getValues();

  // Append Course Name in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 2, columnFData.length, 1).setValues(columnFData);


  // Copy Column E from the Eligibility sheet to Column C in the Grant sheet
  var columnERange = eligibilityTargetSheet.getRange(2, 5, lastRow - 1, 1); // Column E (5), from row 2
  var columnEData = columnERange.getValues();

  // Append Course Date in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 3, columnEData.length, 1).setValues(columnEData);


  // Copy Column H from the Eligibility sheet to Column D in the Grant sheet
  var columnHRange = eligibilityTargetSheet.getRange(2, 8, lastRow - 1, 1); // Column E (8), from row 2
  var columnHData = columnHRange.getValues();

  // Append Course Run in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 4, columnHData.length, 1).setValues(columnHData);


  // Copy Column D from the Eligibility sheet to Column E in the Grant sheet
  var columnDRange = eligibilityTargetSheet.getRange(2, 4, lastRow - 1, 1); // Column D (4), from row 2
  var columnDData = columnDRange.getValues();

  // Append Name of Trainee in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 5, columnDData.length, 1).setValues(columnDData);


  // Copy Column I from the Eligibility sheet to Column F in the Grant sheet
  var columnIRange = eligibilityTargetSheet.getRange(2, 9, lastRow - 1, 1); // Column I (9), from row 2
  var columnIData = columnIRange.getValues();

  // Append Trainee Email in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 6, columnIData.length, 1).setValues(columnIData);


  // Copy Column M from the Eligibility sheet to Column G in the Grant sheet
  var columnMRange = eligibilityTargetSheet.getRange(2, 13, lastRow - 1, 1); // Column M (13), from row 2
  var columnMData = columnMRange.getValues();

  // Append Sponsorship in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 7, columnMData.length, 1).setValues(columnMData);



  // Copy Column N from the Eligibility sheet to Column H in the Grant sheet
  var columnNRange = eligibilityTargetSheet.getRange(2, 14, lastRow - 1, 1); // Column N (14), from row 2
  var columnNData = columnNRange.getValues();

  // Replace empty cells with "NA"
  for (var i = 0; i < columnNData.length; i++) {
    if (!columnNData[i][0] || columnNData[i][0].toString().trim() === "") { 
      columnNData[i][0] = "NA";
    }
  }

  // Append UEN in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 8, columnNData.length, 1).setValues(columnNData);


  // Copy Column O from the Eligibility sheet to Column I in the Grant sheet
  var columnORange = eligibilityTargetSheet.getRange(2, 15, lastRow - 1, 1); // Column O (15), from row 2
  var columnOData = columnORange.getValues();

  // Replace empty cells with "NA"
  for (var i = 0; i < columnNData.length; i++) {
    if (!columnOData[i][0] || columnOData[i][0].toString().trim() === "") { 
      columnOData[i][0] = "NA";
    }
  }

  // Append Name of Employer in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 9, columnOData.length, 1).setValues(columnOData);


  // Copy Column X from the Eligibility sheet to Column J in the Grant sheet
  var columnXRange = eligibilityTargetSheet.getRange(2, 24, lastRow - 1, 1); // Column X (24), from row 2
  var columnXData = columnXRange.getValues();

  // Append Grant ID_1  in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 10, columnXData.length, 1).setValues(columnXData);


  // Copy Column Y from the Eligibility sheet to Column K in the Grant sheet
  var columnYRange = eligibilityTargetSheet.getRange(2, 25, lastRow - 1, 1); // Column Y (25), from row 2
  var columnYData = columnYRange.getValues();

  // Append Grant Type 1 in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 11, columnYData.length, 1).setValues(columnYData);


  // Copy Column Z from the Eligibility sheet to Column O in the Grant sheet
  var columnZRange = eligibilityTargetSheet.getRange(2, 26, lastRow - 1, 1); // Column Z (26), from row 2
  var columnZData = columnZRange.getValues();

  // Append Grant ID_2 in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 15, columnZData.length, 1).setValues(columnZData);


  // Copy Column AA from the Eligibility sheet to Column P in the Grant sheet
  var columnAARange = eligibilityTargetSheet.getRange(2, 27, lastRow - 1, 1); // Column AA (27), from row 2
  var columnAAData = columnAARange.getValues();

  // Append Grant Type 2 in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 16, columnAAData.length, 1).setValues(columnAAData);


  // Copy Column AB from the Eligibility sheet to Column P in the Grant sheet
  var columnABRange = eligibilityTargetSheet.getRange(2, 28, lastRow - 1, 1); // Column AB (28), from row 2
  var columnABData = columnABRange.getValues();

  // Append Enrolment ID in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 20, columnABData.length, 1).setValues(columnABData);



  // Determine the number of rows to append based on the added data (e.g., columnABData)
  var numberOfRows = columnABData.length; // Assuming columnABData is the data being appended

  // Create an array with "Pending" or "Error" based on Column AC
  var columnACRange = eligibilityTargetSheet.getRange(2, 29, lastRow - 1, 1); // Column AC (29), from row 2
  var columnACData = columnACRange.getValues();

  // Create an array for the Status column in the Grant sheet
  var statusData = [];
  for (var i = 0; i < numberOfRows; i++) {
    var eligibilityValue = columnACData[i][0]; // Value in Column AC for the current row
    
    if (eligibilityValue && eligibilityValue.toString().toLowerCase() === "error") {
      statusData.push(["Error"]); // Set as "Error" if Column AC contains "Error"
    } else {
      statusData.push(["Successful"]); // Otherwise, set as "Successful"
    }
  }

  // Append Status in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 21, numberOfRows, 1).setValues(statusData);


  // Append Dates to Column P
  var today = new Date();
  var todayFormatted = Utilities.formatDate(today, Session.getScriptTimeZone(), "dd MMM yyyy");
  var todayData = [];
  for (var i = 0; i < numberOfRows; i++) {
    todayData.push([todayFormatted]);
  }

  // Set today's date in Column V (22) of the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 22, numberOfRows, 1).setValues(todayData);



  // Copy Column AD from the Eligibility sheet to Column S in the Grant sheet
  var columnADRange = eligibilityTargetSheet.getRange(2, 30, lastRow - 1, 1); // Column AD (30), from row 2
  var columnADData = columnADRange.getValues();

  // Append UEN Verification in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 23, columnADData.length, 1).setValues(columnADData);


  Logger.log("Appended.");
}

