// ========================================
// OPTIMIZED onEdit FUNCTION WITH FILTERS
// ========================================
function onEdit(e) {
  try {
    var sheet = e.source.getActiveSheet();
    var sheetName = sheet.getName();
    var row = e.range.getRow();
    var col = e.range.getColumn();
    
    // Skip header row
    if (row === 1) return;
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // ========================================
    // AUTOMATION 1: Detailed Data View → CREATE New Enrolment
    // ========================================
    if (sheetName === "Detailed Data View") {
      var COL_AF = 32; // Enrolment ID column
      var rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
      var enrolmentId = rowData[31]; // Col AF (0-indexed = 31)
      var formStatus = rowData[10]; // Col K (0-indexed = 10)
      
      // FILTER 1: Check if Form Status (Col K) is "Yes"
      if (!formStatus || formStatus.toString().trim().toLowerCase() !== "yes") {
        return; // Skip if not "Yes"
      }
      
      // FILTER 2: Check if Enrolment ID starts with "ENR"
      if (!enrolmentId || !enrolmentId.toString().toUpperCase().startsWith("ENR")) {
        return; // Skip if doesn't start with "ENR"
      }
      
      // SCENARIO 1: Column AF was just edited/populated AND has a value
      if (col === COL_AF && enrolmentId && enrolmentId !== "") {
        var newEnrolmentsSheet = ss.getSheetByName("New Enrolments");
        
        if (newEnrolmentsSheet) {
          // Quick check if enrolment exists (only check col O, not entire sheet)
          var newEnrolmentsLastRow = newEnrolmentsSheet.getLastRow();
          var alreadyExists = false;
          
          if (newEnrolmentsLastRow > 1) {
            var existingIds = newEnrolmentsSheet.getRange(2, 15, newEnrolmentsLastRow - 1, 1).getValues();
            for (var i = 0; i < existingIds.length; i++) {
              if (existingIds[i][0] === enrolmentId) {
                alreadyExists = true;
                break;
              }
            }
          }
          
          if (!alreadyExists) {
            createNewEnrolment(newEnrolmentsSheet, rowData);
          }
        }
      }
      // SCENARIO 2: Other column edited, but row has Enrolment ID (UPDATE)
      else if (col !== COL_AF && enrolmentId && enrolmentId !== "") {
        var newEnrolmentsSheet = ss.getSheetByName("New Enrolments");
        
        if (newEnrolmentsSheet) {
          updateNewEnrolment(newEnrolmentsSheet, rowData, enrolmentId, col);
        }
      }
    }
    
  } catch (error) {
    // Silent fail to avoid timeout issues
  }
}


// ========================================
// ENHANCED onChange - Catches ALL Batch Updates WITH FILTERS
// ========================================
function onChange(e) {
  try {
    // Shorter delay - 500ms
    Utilities.sleep(500);
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Detailed Data View");
    var newEnrolmentsSheet = ss.getSheetByName("New Enrolments");
    
    if (!sheet || !newEnrolmentsSheet) return;
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    
    // INCREASED SCAN RANGE: Check last 500 rows
    var startRow = Math.max(2, lastRow - 499);
    var numRows = lastRow - startRow + 1;
    
    // Get all recent data
    var recentData = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();
    
    // Get existing enrolment IDs from New Enrolments
    var existingEnrolments = {};
    var newEnrolmentsLastRow = newEnrolmentsSheet.getLastRow();
    
    if (newEnrolmentsLastRow > 1) {
      var existingData = newEnrolmentsSheet.getRange(2, 15, newEnrolmentsLastRow - 1, 1).getValues();
      for (var i = 0; i < existingData.length; i++) {
        if (existingData[i][0]) {
          existingEnrolments[existingData[i][0]] = true;
        }
      }
    }
    
    // Find ALL new enrolments in the scanned range
    var newEnrolmentsToCreate = [];
    
    for (var i = 0; i < recentData.length; i++) {
      var rowData = recentData[i];
      var enrolmentId = rowData[31]; // Col AF
      var formStatus = rowData[10]; // Col K
      
      // FILTER 1: Check if Form Status (Col K) is "Yes"
      if (!formStatus || formStatus.toString().trim().toLowerCase() !== "yes") {
        continue; // Skip this row
      }
      
      // FILTER 2: Check if Enrolment ID starts with "ENR"
      if (!enrolmentId || !enrolmentId.toString().toUpperCase().startsWith("ENR")) {
        continue; // Skip this row
      }
      
      if (enrolmentId && enrolmentId !== "" && !existingEnrolments[enrolmentId]) {
        newEnrolmentsToCreate.push(rowData);
        existingEnrolments[enrolmentId] = true; // Prevent duplicates in same batch
      }
    }
    
    // Create ALL found enrolments (no limit)
    if (newEnrolmentsToCreate.length > 0) {
      for (var i = 0; i < newEnrolmentsToCreate.length; i++) {
        createNewEnrolment(newEnrolmentsSheet, newEnrolmentsToCreate[i]);
      }
    }
    
  } catch (error) {
    // Silent fail
  }
}


// ========================================
// ENHANCED periodicSync - NO GRANT UPDATES
// ========================================
function periodicSync() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Detailed Data View");
    var newEnrolmentsSheet = ss.getSheetByName("New Enrolments");
    
    if (!sheet || !newEnrolmentsSheet) return;
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    
    // INCREASED: Check last 500 rows
    var startRow = Math.max(2, lastRow - 499);
    var numRows = lastRow - startRow + 1;
    
    var recentData = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();
    
    // Get existing enrolment IDs
    var existingEnrolments = {};
    var newEnrolmentsLastRow = newEnrolmentsSheet.getLastRow();
    
    if (newEnrolmentsLastRow > 1) {
      var existingData = newEnrolmentsSheet.getRange(2, 15, newEnrolmentsLastRow - 1, 1).getValues();
      for (var i = 0; i < existingData.length; i++) {
        if (existingData[i][0]) {
          existingEnrolments[existingData[i][0]] = true;
        }
      }
    }
    
    var newCount = 0;
    
    for (var i = 0; i < recentData.length; i++) {
      var rowData = recentData[i];
      var enrolmentId = rowData[31];
      var formStatus = rowData[10]; // Col K
      
      // FILTER 1: Check if Form Status (Col K) is "Yes"
      if (!formStatus || formStatus.toString().trim().toLowerCase() !== "yes") {
        continue; // Skip this row
      }
      
      // FILTER 2: Check if Enrolment ID starts with "ENR"
      if (!enrolmentId || !enrolmentId.toString().toUpperCase().startsWith("ENR")) {
        continue; // Skip this row
      }
      
      if (!enrolmentId || enrolmentId === "") {
        continue; // Skip if no enrolment ID
      }
      
      // Only create new enrolments, do not update grants
      if (!existingEnrolments[enrolmentId]) {
        createNewEnrolment(newEnrolmentsSheet, rowData);
        existingEnrolments[enrolmentId] = true;
        newCount++;
      }
    }
    
  } catch (error) {
    // Silent fail
  }
}


// ========================================
// SYNC FUNCTION - Call this after Start Processing WITH FILTERS
// ========================================
function syncNewEnrolments() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Detailed Data View");
  var newEnrolmentsSheet = ss.getSheetByName("New Enrolments");
  
  if (!sheet || !newEnrolmentsSheet) return;
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  // Check last 100 rows
  var startRow = Math.max(2, lastRow - 99);
  var numRows = lastRow - startRow + 1;
  
  var recentData = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();
  
  // Get existing enrolment IDs
  var existingEnrolments = {};
  var newEnrolmentsLastRow = newEnrolmentsSheet.getLastRow();
  
  if (newEnrolmentsLastRow > 1) {
    var existingData = newEnrolmentsSheet.getRange(2, 15, newEnrolmentsLastRow - 1, 1).getValues();
    for (var i = 0; i < existingData.length; i++) {
      if (existingData[i][0]) {
        existingEnrolments[existingData[i][0]] = true;
      }
    }
  }
  
  // Create all new enrolments
  var newCount = 0;
  for (var i = 0; i < recentData.length; i++) {
    var rowData = recentData[i];
    var enrolmentId = rowData[31];
    var formStatus = rowData[10]; // Col K
    
    // FILTER 1: Check if Form Status (Col K) is "Yes"
    if (!formStatus || formStatus.toString().trim().toLowerCase() !== "yes") {
      continue; // Skip this row
    }
    
    // FILTER 2: Check if Enrolment ID starts with "ENR"
    if (!enrolmentId || !enrolmentId.toString().toUpperCase().startsWith("ENR")) {
      continue; // Skip this row
    }
    
    if (enrolmentId && enrolmentId !== "" && !existingEnrolments[enrolmentId]) {
      createNewEnrolment(newEnrolmentsSheet, rowData);
      existingEnrolments[enrolmentId] = true;
      newCount++;
    }
  }
  
  if (newCount > 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "Created " + newCount + " new enrolments", 
      "Success", 
      3
    );
  }
}


// ========================================
// MANUAL SYNC ALL (For Processing Historical Data) WITH FILTERS
// ========================================
function manualSyncAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Detailed Data View");
  var newEnrolmentsSheet = ss.getSheetByName("New Enrolments");
  
  if (!sheet || !newEnrolmentsSheet) {
    SpreadsheetApp.getUi().alert("Required sheets not found");
    return;
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("No data to sync");
    return;
  }
  
  // Process in batches of 100 to avoid timeout
  var batchSize = 100;
  var totalProcessed = 0;
  
  for (var startRow = 2; startRow <= lastRow; startRow += batchSize) {
    var endRow = Math.min(startRow + batchSize - 1, lastRow);
    var numRows = endRow - startRow + 1;
    
    var batchData = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();
    
    // Get existing IDs
    var existingEnrolments = {};
    var newEnrolmentsLastRow = newEnrolmentsSheet.getLastRow();
    
    if (newEnrolmentsLastRow > 1) {
      var existingData = newEnrolmentsSheet.getRange(2, 15, newEnrolmentsLastRow - 1, 1).getValues();
      for (var i = 0; i < existingData.length; i++) {
        if (existingData[i][0]) {
          existingEnrolments[existingData[i][0]] = true;
        }
      }
    }
    
    for (var i = 0; i < batchData.length; i++) {
      var rowData = batchData[i];
      var enrolmentId = rowData[31];
      var formStatus = rowData[10]; // Col K
      
      // FILTER 1: Check if Form Status (Col K) is "Yes"
      if (!formStatus || formStatus.toString().trim().toLowerCase() !== "yes") {
        continue; // Skip this row
      }
      
      // FILTER 2: Check if Enrolment ID starts with "ENR"
      if (!enrolmentId || !enrolmentId.toString().toUpperCase().startsWith("ENR")) {
        continue; // Skip this row
      }
      
      if (enrolmentId && enrolmentId !== "" && !existingEnrolments[enrolmentId]) {
        createNewEnrolment(newEnrolmentsSheet, rowData);
        existingEnrolments[enrolmentId] = true;
        totalProcessed++;
      }
    }
    
    // Brief pause between batches
    Utilities.sleep(500);
  }
  
  SpreadsheetApp.getUi().alert("Manual sync complete! Processed " + totalProcessed + " new enrolments.");
}


// ========================================
// MANUAL SYNC (Last 500 Rows) WITH FILTERS
// ========================================
function manualSyncEnrolments() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Detailed Data View");
  var newEnrolmentsSheet = ss.getSheetByName("New Enrolments");
  
  if (!sheet || !newEnrolmentsSheet) {
    SpreadsheetApp.getUi().alert("Error: Required sheets not found");
    return;
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("No data to sync");
    return;
  }
  
  // Only check last 500 rows
  var startRow = Math.max(2, lastRow - 499);
  var numRows = lastRow - startRow + 1;
  
  var detailedData = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();
  
  // Get existing enrolment IDs
  var existingEnrolments = {};
  var newEnrolmentsLastRow = newEnrolmentsSheet.getLastRow();
  
  if (newEnrolmentsLastRow > 1) {
    var existingIds = newEnrolmentsSheet.getRange(2, 15, newEnrolmentsLastRow - 1, 1).getValues();
    for (var i = 0; i < existingIds.length; i++) {
      if (existingIds[i][0]) {
        existingEnrolments[existingIds[i][0]] = true;
      }
    }
  }
  
  var newCount = 0;
  
  for (var i = 0; i < detailedData.length; i++) {
    var rowData = detailedData[i];
    var enrolmentId = rowData[31]; // Col AF
    var formStatus = rowData[10]; // Col K
    
    // FILTER 1: Check if Form Status (Col K) is "Yes"
    if (!formStatus || formStatus.toString().trim().toLowerCase() !== "yes") {
      continue; // Skip this row
    }
    
    // FILTER 2: Check if Enrolment ID starts with "ENR"
    if (!enrolmentId || !enrolmentId.toString().toUpperCase().startsWith("ENR")) {
      continue; // Skip this row
    }
    
    if (enrolmentId && enrolmentId !== "" && !existingEnrolments[enrolmentId]) {
      createNewEnrolment(newEnrolmentsSheet, rowData);
      existingEnrolments[enrolmentId] = true;
      newCount++;
    }
  }
  
  SpreadsheetApp.getUi().alert("Sync complete! Created " + newCount + " new enrolments.");
}


// ========================================
// DEBUG FUNCTION - Check Last Rows
// ========================================
function debugLastRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Detailed Data View");
  
  var lastRow = sheet.getLastRow();
  var startRow = Math.max(2, lastRow - 9); // Last 10 rows
  var numRows = lastRow - startRow + 1;
  
  var data = sheet.getRange(startRow, 32, numRows, 1).getValues(); // Col AF only
  
  Logger.log("Last " + numRows + " rows, Col AF (Enrolment IDs):");
  for (var i = 0; i < data.length; i++) {
    Logger.log("Row " + (startRow + i) + ": " + data[i][0]);
  }
  
  // Also check what's in New Enrolments
  var newEnrolmentsSheet = ss.getSheetByName("New Enrolments");
  if (newEnrolmentsSheet) {
    var newEnrolmentsLastRow = newEnrolmentsSheet.getLastRow();
    if (newEnrolmentsLastRow > 1) {
      var existingIds = newEnrolmentsSheet.getRange(2, 15, newEnrolmentsLastRow - 1, 1).getValues();
      Logger.log("Existing enrolments in New Enrolments: " + existingIds.length);
      Logger.log("Last 5 enrolment IDs:");
      for (var i = Math.max(0, existingIds.length - 5); i < existingIds.length; i++) {
        Logger.log("  " + existingIds[i][0]);
      }
    }
  }
}


// ========================================
// FUNCTION 1: Create New Enrolment (NO GRANT DATA)
// ========================================
function createNewEnrolment(targetSheet, rowData) {
  // Extract and transform data from Detailed Data View
  
  // Course Title - Remove everything before and including " - "
  var rawTitle = rowData[1] || ""; // Col B (Event Title)
  var courseTitle = cleanTitle(rawTitle);
  
  // Start Date - Convert mm/dd/yyyy hh:mm:ss to yyyy-mm-dd
  var startDate = formatDate(rowData[2], "mm/dd/yyyy"); // Col C
  
  // End Date - Convert mm/dd/yyyy hh:mm:ss to yyyy-mm-dd
  var endDate = formatDate(rowData[3], "mm/dd/yyyy"); // Col D
  
  // Trainee DOB - Convert dd/mm/yyyy to yyyy-mm-dd
  var traineeDOB = formatDate(rowData[14], "dd/mm/yyyy"); // Col O
  
  // Build the row to append (NO GRANT DATA - Cols Q-W left empty)
  var dataToAppend = [
    rowData[7],         // A: Course Run (Col H)
    rowData[16],        // B: Course Code (Col Q)
    courseTitle,        // C: Course Title (Col B - cleaned)
    startDate,          // D: Start Date (Col C - formatted)
    endDate,            // E: End Date (Col D - formatted)
    rowData[15],        // F: Trainee (Col P)
    rowData[0],         // G: Trainee Email (Col A)
    rowData[19],        // H: Trainee Contact (Col T)
    rowData[13],        // I: Trainee ID (Col N)
    traineeDOB,         // J: Trainee DOB (Col O - formatted)
    rowData[20],        // K: Sponsorship Type (Col U)
    rowData[21],        // L: UEN of Employer (Col V)
    rowData[22],        // M: Employer Name (Col W)
    rowData[32],        // N: Enrolment Status (Col AG)
    rowData[31],        // O: Enrolment ID (Col AF)
    "",                 // P: Grant Appl Date (empty)
    "",                 // Q: Grant Status (BL) - REMOVED
    "",                 // R: Grant ID (BL) - REMOVED
    "",                 // S: Amount (BL) - REMOVED
    "",                 // T: Grant Status (MCEs/SMEs) - REMOVED
    "",                 // U: Grant ID (MCES/SME) - REMOVED
    "",                 // V: Amount (MCES/SME) - REMOVED
    "",                 // W: Total TG Amount - REMOVED
    "",                 // X: TG Payment Status (empty)
    "",                 // Y: SFC Claim ID (empty)
    "",                 // Z: SFC Amount (empty)
    "",                 // AA: SFC Payment Date (empty)
    "",                 // AB: SFC Payout Request ID (empty)
    "",                 // AC: SFC Payment Status (empty)
    "",                 // AD: QB SFC Status (empty)
    "",                 // AE: TG Payment Date (empty)
    "",                 // AF: Financial Transaction ID (empty)
    "",                 // AG: Attendance (empty)
    "",                 // AH: Assessment (empty)
    "",                 // AI: QB Invoice # (Net Fee) (empty - filled by Invoice Creation)
    "",                 // AJ: QB Net Fee Amount Payment Type (empty)
    "",                 // AK: QB Net Fee Status (empty)
    "",                 // AL: QB Invoice # (Grant) (empty - filled by Invoice Creation)
    "",                 // AM: QB TG Status (empty)
    "",                 // AN: Bank Reference ID (BL) (empty)
    "",                 // AO: Course Fees (empty)
    "",                 // AP: Bank Reference ID (MCES/SME) (empty)
    ""                  // AQ: Course Type (empty)
  ];
  
  targetSheet.appendRow(dataToAppend);
}


// ========================================
// FUNCTION 2: Update Existing Enrolment (NO GRANT UPDATES)
// ========================================
function updateNewEnrolment(targetSheet, rowData, enrolmentId, changedCol) {
  // Find the row with matching Enrolment ID (col O in New Enrolments)
  var newEnrolmentsLastRow = targetSheet.getLastRow();
  var rowToUpdate = -1;
  
  if (newEnrolmentsLastRow > 1) {
    var existingIds = targetSheet.getRange(2, 15, newEnrolmentsLastRow - 1, 1).getValues();
    for (var i = 0; i < existingIds.length; i++) {
      if (existingIds[i][0] === enrolmentId) {
        rowToUpdate = i + 2; // +2 because: 0-indexed array + skip header
        break;
      }
    }
  }
  
  if (rowToUpdate === -1) return;
  
  // Map changed columns from Detailed Data View to New Enrolments (NO GRANT COLUMNS)
  var updateMap = {
    1: {col: 7, value: rowData[0]},                                    // Col A → Trainee Email (G)
    2: {col: 3, value: cleanTitle(rowData[1])},                        // Col B → Course Title (C)
    3: {col: 4, value: formatDate(rowData[2], "mm/dd/yyyy")},          // Col C → Start Date (D)
    4: {col: 5, value: formatDate(rowData[3], "mm/dd/yyyy")},          // Col D → End Date (E)
    8: {col: 1, value: rowData[7]},                                    // Col H → Course Run (A)
    14: {col: 9, value: rowData[13]},                                  // Col N → Trainee ID (I)
    15: {col: 10, value: formatDate(rowData[14], "dd/mm/yyyy")},       // Col O → Trainee DOB (J)
    16: {col: 6, value: rowData[15]},                                  // Col P → Trainee (F)
    17: {col: 2, value: rowData[16]},                                  // Col Q → Course Code (B)
    20: {col: 8, value: rowData[19]},                                  // Col T → Trainee Contact (H)
    21: {col: 11, value: rowData[20]},                                 // Col U → Sponsorship Type (K)
    22: {col: 12, value: rowData[21]},                                 // Col V → UEN of Employer (L)
    23: {col: 13, value: rowData[22]},                                 // Col W → Employer Name (M)
    33: {col: 14, value: rowData[32]}                                  // Col AG → Enrolment Status (N)
  };
  
  // If the changed column is in our map, update it
  if (updateMap[changedCol]) {
    targetSheet.getRange(rowToUpdate, updateMap[changedCol].col).setValue(updateMap[changedCol].value);
  }
}


// ========================================
// HELPER FUNCTIONS
// ========================================

// Format date based on input format
function formatDate(dateValue, inputFormat) {
  if (!dateValue) return "";
  
  var date;
  
  // If it's already a Date object
  if (dateValue instanceof Date) {
    date = dateValue;
  } 
  // If it's a string
  else if (typeof dateValue === 'string') {
    // Remove time portion if exists (everything after space)
    var dateOnly = dateValue.split(' ')[0];
    
    if (inputFormat === "mm/dd/yyyy") {
      // Parse mm/dd/yyyy
      var parts = dateOnly.split('/');
      if (parts.length === 3) {
        date = new Date(parts[2], parts[0] - 1, parts[1]);
      }
    } else if (inputFormat === "dd/mm/yyyy") {
      // Parse dd/mm/yyyy
      var parts = dateOnly.split('/');
      if (parts.length === 3) {
        date = new Date(parts[2], parts[1] - 1, parts[0]);
      }
    }
  }
  
  if (!date || isNaN(date.getTime())) return dateValue; // Return original if parsing failed
  
  // Format to yyyy-mm-dd
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  
  return year + '-' + month + '-' + day;
}

// Clean course title - remove everything before and including " - "
function cleanTitle(title) {
  if (!title) return "";
  
  var dashIndex = title.indexOf(" - ");
  if (dashIndex > -1) {
    return title.substring(dashIndex + 3).trim();
  }
  
  return title;
}