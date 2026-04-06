function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sheetsToClear = [
      "Cancel Enrolment",
      "Tracking Cancelled Class Enrolment And Invoice"
    ];

    sheetsToClear.forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;

      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();

      // Only clear if there is data beyond header
      if (lastRow > 1 && lastCol > 0) {
        sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
      }
    });

    return ContentService
      .createTextOutput(JSON.stringify({
        status: "success",
        message: "Sheets cleared successfully"
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: "error",
        message: err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
