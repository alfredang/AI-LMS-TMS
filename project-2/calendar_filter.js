/**
 * Runs when a user selects cells in the range A1:Z37 or A39:Z75 of the Dashboard sheet.
 * Highlights the selected cells, reverts previously selected cells to a custom color,
 * and writes the corresponding date values from the Calendar Mirror sheet to AB1 or a range in the Dashboard sheet.
 *
 * @param {Object} e - The event object from the onSelectionChange trigger.
 */
function onSelectionChange(e) {
  const frontendSheetName = "Dashboard"; // The sheet with the UI calendar
  const mirrorSheetName = "Calendar Mirror"; // The mirrored sheet with valid dates
  const rangesToWatch = [
    { startRow: 1, endRow: 37, startCol: 1, endCol: 26 }, // A1:Z37
    { startRow: 39, endRow: 75, startCol: 1, endCol: 26 }, // A39:Z75
  ];
  const dashboardSheetName = "Dashboard"; // Target sheet for date values
  const targetCell = "AB1"; // Starting cell for date values

  const sheet = e.range.getSheet();

  // Check if the edited sheet is the frontend calendar sheet
  if (sheet.getName() !== frontendSheetName) return;

  const selectedRange = e.range;
  const selectedRows = selectedRange.getRow();
  const selectedCols = selectedRange.getColumn();
  const selectedNumRows = selectedRange.getNumRows();
  const selectedNumCols = selectedRange.getNumColumns();

  // Check if the selected range falls within any monitored range
  const isInWatchedRange = rangesToWatch.some(range =>
    selectedRows + selectedNumRows - 1 >= range.startRow &&
    selectedRows <= range.endRow &&
    selectedCols + selectedNumCols - 1 >= range.startCol &&
    selectedCols <= range.endCol
  );

  if (!isInWatchedRange) return;

  // Get the Calendar Mirror sheet
  const mirrorSheet = e.source.getSheetByName(mirrorSheetName);
  if (!mirrorSheet) {
    Logger.log(`Sheet "${mirrorSheetName}" not found.`);
    return;
  }

  // Revert previously selected cells to the custom color
  const previousRangesJSON = PropertiesService.getScriptProperties().getProperty("previousRanges");
  if (previousRangesJSON) {
    const previousRanges = JSON.parse(previousRangesJSON); // Parse stored ranges as JSON
    previousRanges.forEach((range) => {
      const { sheetName, row, col } = range;
      const prevCell = e.source.getSheetByName(sheetName).getRange(row, col);
      // prevCell.setBackground("#004561"); // Custom color
    });
  }

  // Highlight the currently selected cells and collect their date values
  const selectedDates = [];
  const selectedCellRanges = [];

  selectedRange.getValues().forEach((rowValues, rowIndex) => {
    rowValues.forEach((value, colIndex) => {
      const mirrorRow = selectedRange.getRow() + rowIndex;
      const mirrorCol = selectedRange.getColumn() + colIndex;

      // Highlight the selected cell
      const currentCell = sheet.getRange(mirrorRow, mirrorCol);
      // currentCell.setBackground("orange");

      // Add to selected ranges
      selectedCellRanges.push({ sheetName: frontendSheetName, row: mirrorRow, col: mirrorCol });

      // Get the corresponding date value
      const mirrorValue = mirrorSheet.getRange(mirrorRow, mirrorCol).getValue();
      if (mirrorValue instanceof Date) {
        // Format the date to YYYY-MM-DD
        const formattedDate = Utilities.formatDate(mirrorValue, Session.getScriptTimeZone(), "yyyy-MM-dd");
        selectedDates.push(formattedDate);
      }
    });
  });

  // Store the current selected cell ranges as the previous ranges
  PropertiesService.getScriptProperties().setProperty("previousRanges", JSON.stringify(selectedCellRanges));

  // Write the selected dates to the target cell or range
  const dashboardSheet = e.source.getSheetByName(dashboardSheetName);
  if (!dashboardSheet) {
    Logger.log(`Sheet "${dashboardSheetName}" not found.`);
    return;
  }

  if (selectedDates.length > 1) {
    // Write all dates as a comma-separated list in AB1
    dashboardSheet.getRange(targetCell).setValue(selectedDates.join(", "));
  } else if (selectedDates.length === 1) {
    // Write a single date to AB1
    dashboardSheet.getRange(targetCell).setValue(selectedDates[0]);
  } else {
    // Clear the target cell if no dates are found
    dashboardSheet.getRange(targetCell).clearContent();
  }

  Logger.log(`Selected dates: ${selectedDates}`);
}
