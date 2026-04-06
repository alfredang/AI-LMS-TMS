function fetchGoogleAppScriptResults() {
  // Open the spreadsheet and sheet
  var sourceSpreadsheet = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1rOEx9zxXngq5MPi0ukdUGjv_mYCN7A0d3S6gloK3A-k/edit?usp=sharing');
  var targetSheet = sourceSpreadsheet.getSheetByName('Sheet1'); // Sheet

  // Get the last row in the SSG Enrolment (Google Sheet Ver) sheet
  var lastRow = targetSheet.getLastRow();

  if (lastRow < 2) {
    Logger.log("No data to transform.");
    return;
  }


  // Open the "Grant" spreadsheet and sheet
  var grantSpreadsheet = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?gid=0#gid=0');
  var grantTargetSheet = grantSpreadsheet.getSheetByName('All Grants'); // Grant sheet

  // Find the first empty row in Column A of the Grant sheet
  var grantLastRow = grantTargetSheet.getLastRow();
  var firstEmptyRow = grantLastRow + 1; // The next row after the last row

  // Copy Column E from the SSG Enrolment (Google Sheet Ver) sheet to Column A in the Grant sheet
  var columnERange = targetSheet.getRange(2, 5, lastRow - 1, 1); // Column E (5), from row 2
  var columnEData = columnERange.getValues();

  // Append Course Code in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 1, columnEData.length, 1).setValues(columnEData);

  // Copy Column F from the SSG Enrolment (Google Sheet Ver) sheet to Column D in the Grant sheet
  var columnFRange = targetSheet.getRange(2, 6, lastRow - 1, 1); // Column F (6), from row 2
  var columnFData = columnFRange.getValues();

  // Append Course Run in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 4, columnFData.length, 1).setValues(columnFData);


  // Copy Column D from the SSG Enrolment (Google Sheet Ver) sheet to Column E in the Grant sheet
  var columnDRange = targetSheet.getRange(2, 4, lastRow - 1, 1); // Column D (4), from row 2
  var columnDData = columnDRange.getValues();

  // Append Name of Trainee in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 5, columnDData.length, 1).setValues(columnDData);


  // Copy Column G from the SSG Enrolment (Google Sheet Ver) sheet to Column F in the Grant sheet
  var columnGRange = targetSheet.getRange(2, 7, lastRow - 1, 1); // Column G (7), from row 2
  var columnGData = columnGRange.getValues();

  // Append Trainee Email in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 6, columnGData.length, 1).setValues(columnGData);


  // Copy Column K from the SSG Enrolment (Google Sheet Ver) sheet to Column G in the Grant sheet
  var columnKRange = targetSheet.getRange(2, 11, lastRow - 1, 1); // Column K (11), from row 2
  var columnKData = columnKRange.getValues();

  // Append Sponsorship in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 7, columnKData.length, 1).setValues(columnKData);



  // Copy Column L from the SSG Enrolment (Google Sheet Ver) sheet to Column H in the Grant sheet
  var columnLRange = targetSheet.getRange(2, 12, lastRow - 1, 1); // Column L (12), from row 2
  var columnLData = columnLRange.getValues();

  // Replace empty cells with "NA"
  for (var i = 0; i < columnLData.length; i++) {
    if (!columnLData[i][0] || columnLData[i][0].toString().trim() === "") { 
      columnLData[i][0] = "NA";
    }
  }

  // Append UEN in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 8, columnLData.length, 1).setValues(columnLData);


  // Copy Column M from the SSG Enrolment (Google Sheet Ver) sheet to Column I in the Grant sheet
  var columnMRange = targetSheet.getRange(2, 13, lastRow - 1, 1); // Column M (13), from row 2
  var columnMData = columnMRange.getValues();

  // Replace empty cells with "NA"
  for (var i = 0; i < columnMData.length; i++) {
    if (!columnMData[i][0] || columnMData[i][0].toString().trim() === "") { 
      columnMData[i][0] = "NA";
    }
  }

  // Append Name of Employer in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 9, columnMData.length, 1).setValues(columnMData);

  
  // Copy Column W from the SSG Enrolment (Google Sheet Ver) sheet to Column L in the Grant sheet
  var columnWRange = targetSheet.getRange(2, 23, lastRow - 1, 1); // Column W (23), from row 2
  var columnWData = columnWRange.getValues();

  // Append Grant ID_1 in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 10, columnWData.length, 1).setValues(columnWData);


  // Copy Column Z + Y from the SSG Enrolment (Google Sheet Ver) sheet to Column K in the Grant sheet
  var columnZData = targetSheet.getRange(2, 26, lastRow - 1, 1).getValues(); // Column Z
  var columnYRange = targetSheet.getRange(2, 25, lastRow - 1, 1); // Column Y
  var columnYData = columnYRange.getValues();

  // Prepare an array to hold the combined Grant Type 2 values
  var grantType1 = columnZData.map(function(row, index) {
    // Combine Z and Y values into the format "Z (Y)"
    return [row[0] + " (" + columnYData[index][0] + ")"];
  });

  // Append Grant Type 1 in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 11, grantType1.length, 1).setValues(grantType1);

  // Copy Column AC from the SSG Enrolment (Google Sheet Ver) sheet to Column L in the Grant sheet
  var columnACRange = targetSheet.getRange(2, 29, lastRow - 1, 1); // Column AC (29), from row 2
  var columnACData = columnACRange.getValues();

  // Append Grant 1 Estimated in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 12, columnACData.length, 1).setValues(columnACData);

  // Copy Column AD from the SSG Enrolment (Google Sheet Ver) sheet to Column L in the Grant sheet
  var columnADRange = targetSheet.getRange(2, 30, lastRow - 1, 1); // Column AD (30), from row 2
  var columnADData = columnADRange.getValues();

  // Append Grant 1 Paid in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 13, columnADData.length, 1).setValues(columnADData);

  // Copy Column AE from the SSG Enrolment (Google Sheet Ver) sheet to Column L in the Grant sheet
  var columnAERange = targetSheet.getRange(2, 31, lastRow - 1, 1); // Column AE (31), from row 2
  var columnAEData = columnAERange.getValues();

  // Append Grant 1 Recovery in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 14, columnAEData.length, 1).setValues(columnAEData);



  // Copy Column AF from the SSG Enrolment (Google Sheet Ver) sheet to Column J in the Grant sheet
  var columnAFRange = targetSheet.getRange(2, 32, lastRow - 1, 1); // Column AF (32), from row 2
  var columnAFData = columnAFRange.getValues();

  // Append Grant ID_2 in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 15, columnAFData.length, 1).setValues(columnAFData);


  // Copy Column AI + AH from the SSG Enrolment (Google Sheet Ver) sheet to Column K in the Grant sheet
  var columnAIData = targetSheet.getRange(2, 35, lastRow - 1, 1).getValues(); // Column AI
  var columnAHRange = targetSheet.getRange(2, 34, lastRow - 1, 1); // Column AH
  var columnAHData = columnAHRange.getValues();

  // Prepare an array to hold the combined Grant Type 2 values
  var grantType2 = columnAIData.map(function(row, index) {
    // Combine AI and AH values into the format "AI(AH)"
    return [row[0] + " (" + columnAHData[index][0] + ")"];
  });

  // Append Grant Type 2 in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 16, grantType2.length, 1).setValues(grantType2);



  // Copy Column AL from the SSG Enrolment (Google Sheet Ver) sheet to Column L in the Grant sheet
  var columnALRange = targetSheet.getRange(2, 38, lastRow - 1, 1); // Column AL (38), from row 2
  var columnALData = columnALRange.getValues();

  // Append Grant 2 Estimated in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 17, columnALData.length, 1).setValues(columnALData);

  // Copy Column AM from the SSG Enrolment (Google Sheet Ver) sheet to Column L in the Grant sheet
  var columnAMRange = targetSheet.getRange(2, 39, lastRow - 1, 1); // Column AD (30), from row 2
  var columnAMData = columnAMRange.getValues();

  // Append Grant 2 Paid in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 18, columnAMData.length, 1).setValues(columnAMData);

  // Copy Column AN from the SSG Enrolment (Google Sheet Ver) sheet to Column L in the Grant sheet
  var columnANRange = targetSheet.getRange(2, 40, lastRow - 1, 1); // Column AE (31), from row 2
  var columnANData = columnANRange.getValues();

  // Append Grant 2 Recovery in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 19, columnANData.length, 1).setValues(columnANData);


  // Copy Column U from the SSG Enrolment (Google Sheet Ver) sheet to Column L in the Grant sheet
  var columnURange = targetSheet.getRange(2, 21, lastRow - 1, 1); // Column U (21), from row 2
  var columnUData = columnURange.getValues();

  // Append Enrolment ID in the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 20, columnUData.length, 1).setValues(columnUData);



  // Determine the number of rows to append based on the added data (e.g., columnAFData)
  var numberOfRows = columnAFData.length; // Assuming columnAFData is the data being appended

  // Create an array with "Pending" or "Error" based on Column AF
  var columnAFRange = targetSheet.getRange(2, 32, lastRow - 1, 1); // Column AF (32), from row 2
  var columnAFData = columnAFRange.getValues();

  // Create an array for the Status column in the Grant sheet
  var statusData = [];
  for (var i = 0; i < numberOfRows; i++) {
    var columnAF = columnAFData[i][0]; // Value in Column AF for the current row
    
    if (columnAF && columnAF.toString().toLowerCase().includes("error")) {
      statusData.push(["Error"]); // Set as "Error" if Column AF contains "Error"
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



  // Determine the number of rows to append based on the added data (e.g., columnEData)
  var numberOfRows = columnEData.length; // Assuming columnEData determines the number of rows

  // Create an array filled with the static value
  var staticValueData = Array(numberOfRows).fill(["Cannot verify because of method"]);

  // Append the static value in Column W (23) of the Grant sheet
  grantTargetSheet.getRange(firstEmptyRow, 23, numberOfRows, 1).setValues(staticValueData);


  Logger.log("Appended.");

  getCourseNameAndDate()

  Logger.log('Got Course Name and Date')

  swapGrant()

  Logger.log('Checked for swaps.')

  updateGrantSpreadsheet()

  Logger.log('Changed empty to NA.')
  
}



function getCourseNameAndDate() {
  // Open the spreadsheets and sheets
  var traineeSpreadsheet = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1lLphFYcwV_h2gyYeviO4kbF0yb4AfMZ4TKzy9DqW3b8/edit?usp=sharing');
  var traineeTargetSheet = traineeSpreadsheet.getSheetByName('All Class'); // Trainee sheet

  var grantSpreadsheet = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?gid=0#gid=0');
  var grantTargetSheet = grantSpreadsheet.getSheetByName('All Grants'); // Grant sheet

  // Get data from Grant Sheet (Course Code: Column A, Course Run: Column D)
  var grantLastRow = grantTargetSheet.getLastRow();
  var grantData = grantTargetSheet.getRange(2, 1, grantLastRow - 1, 4).getValues(); // Columns A to D

  // Get data from Trainee Sheet (Course Name: Column A, Date: Column C, Course Code: Column B, Course Run ID: Column Y)
  var traineeLastRow = traineeTargetSheet.getLastRow();
  var traineeData = traineeTargetSheet.getRange(2, 1, traineeLastRow - 1, 25).getValues(); // Columns A to Y
  var traineeFontStyles = traineeTargetSheet.getRange(2, 1, traineeLastRow - 1, 1).getFontStyles(); // Font styles for column A

  // Iterate through Grant Sheet data
  for (var i = 0; i < grantData.length; i++) {
    var grantCourseCode = grantData[i][0] // Course Code in column A
    var grantCourseRun = grantData[i][3] // Course Run in column D

    var foundMatch = false;

    // Compare with Trainee Sheet data
    for (var j = 0; j < traineeData.length; j++) {
      // Skip rows with strikethrough in column A
      if (traineeFontStyles[j][0] === "line-through") {
        continue;
      }

      var traineeCourse = traineeData[j][0].trim(); // Course Name in column A
      var traineeDate = traineeData[j][2]; // Date in column C
      var traineeCourseCode = traineeData[j][1]; // Course Code in column B
      var traineeCourseRunId = traineeData[j][24]; // Course Run ID in column Y

      // Normalize the dates for comparison
      var traineeDateNormalized = new Date(traineeDate).toDateString();

      // Check for a match
      if (
        grantCourseRun &&
        traineeCourseRunId &&
        grantCourseCode === traineeCourseCode &&
        grantCourseRun === traineeCourseRunId
      ) {
        foundMatch = true;

        // Write the Course Name and Date back to the Grant Sheet
        grantTargetSheet.getRange(i+2, 2).setValue(traineeCourse); // Column B (Course Name)
        grantTargetSheet.getRange(i+2, 3).setValue(traineeDateNormalized); // Column C (Course Date)

        break;
      }
    }

    // If no match is found, set the Course Name and Date to "NULL"
    if (!foundMatch) {
      grantTargetSheet.getRange(i+2, 2).setValue("NULL"); // Column B (Course Name)
      grantTargetSheet.getRange(i+2, 3).setValue("NULL"); // Column C (Course Date)
    }
  }

  Logger.log("Comparison and update completed.");
}

function swapGrant() {
  // Open the spreadsheets and sheets
  var grantSpreadsheet = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?gid=0#gid=0');
  var grantTargetSheet = grantSpreadsheet.getSheetByName('All Grants'); // Grant sheet

  // Get the last row with data
  var lastRow = grantTargetSheet.getLastRow();

  // Get the data in Columns K (11), J (10), P (16), O (15) starting from row 2
  var columnKData = grantTargetSheet.getRange(2, 11, lastRow - 1, 1).getValues();
  var columnJData = grantTargetSheet.getRange(2, 10, lastRow - 1, 1).getValues();
  var columnPData = grantTargetSheet.getRange(2, 16, lastRow - 1, 1).getValues();
  var columnOData = grantTargetSheet.getRange(2, 15, lastRow - 1, 1).getValues();

  Logger.log("Starting to check each row in Column K.");

  // Loop through each row and check Column K for the specified text
  for (var i = 0; i < columnKData.length; i++) {
    // Get the current values of the cells in the row
    var cellK = columnKData[i][0];  // Value in Column K
    var cellP = columnPData[i][0];  // Value in Column P
    var cellJ = columnJData[i][0];  // Value in Column J
    var cellO = columnOData[i][0];  // Value in Column O

    // Check if Column K contains "Baseline SkillsFuture Funding (Baseline)"
    if (!(cellK.includes("Baseline") || cellK === "Error")) {
      // Perform the swap: K <-> M and J <-> L
      Logger.log("Swapping values for row " + (i + 2));

      grantTargetSheet.getRange(i + 2, 11).setValue(cellP); // Set Column K to P
      grantTargetSheet.getRange(i + 2, 16).setValue(cellK); // Set Column P to K
      grantTargetSheet.getRange(i + 2, 10).setValue(cellO); // Set Column J to O
      grantTargetSheet.getRange(i + 2, 15).setValue(cellJ); // Set Column O to J
    }
  }

  Logger.log("Completed checking and swapping rows.");
}

function updateGrantSpreadsheet() {
  // Open the spreadsheet and target sheet
  var grantSpreadsheet = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?gid=0#gid=0');
  var grantTargetSheet = grantSpreadsheet.getSheetByName('All Grants');
  
  // Get all data from the sheet
  var dataRange = grantTargetSheet.getDataRange();
  var data = dataRange.getValues();
  
  // Loop through each row of data (starting from row 2 to skip headers)
  for (var i = 1; i < data.length; i++) {
    Logger.log(data[i][14])
    // Check if column O (14th column, zero-based index is 13) is empty
    if (!data[i][14]) {
      // Replace column O and P (15th and 16th columns) with "NA"
      data[i][14] = "NA";
      data[i][15] = "NA";
      
      // Replace columns Q, R, S (17th, 18th, and 19th columns) with "N/A"
      data[i][16] = "N/A";
      data[i][17] = "N/A";
      data[i][18] = "N/A";
    }
  }
  
  // Write the updated data back to the sheet
  dataRange.setValues(data);
}