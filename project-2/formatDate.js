function fixTGPaymentDateFormat() {
  const sheetName = "All Course Runs";   // <-- change to your actual sheet name
  const targetColumn = "AE";             // TG Payment Date column

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  // If sheet is not found — stop with a message
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Error: Sheet '" + sheetName + "' not found.");
    return;
  }

  // Convert column letter "AE" → column index number
  const columnIndex = columnLetterToNumber(targetColumn);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, columnIndex, lastRow - 1, 1);
  const values = range.getValues();

  for (let i = 0; i < values.length; i++) {
    let cellValue = values[i][0];

    if (!cellValue) continue;

    let dateObj = null;

    // Already a date
    if (Object.prototype.toString.call(cellValue) === "[object Date]" && !isNaN(cellValue)) {
      dateObj = cellValue;

    } else if (typeof cellValue === "string") {

      let cleaned = cellValue.replace(/[\/\.]/g, "-").trim();

      const dmY = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      const YmD = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

      if (dmY) {
        dateObj = new Date(`${dmY[3]}-${dmY[2]}-${dmY[1]}`);
      } else if (YmD) {
        dateObj = new Date(`${YmD[1]}-${YmD[2]}-${YmD[3]}`);
      }
    }

    if (dateObj && !isNaN(dateObj)) {
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
      const dd = String(dateObj.getDate()).padStart(2, "0");
      values[i][0] = `${yyyy}-${mm}-${dd}`;
    }
  }

  range.setValues(values);
  SpreadsheetApp.getUi().alert("TG Payment Date formatting completed!");
}


// Utility: Convert column letter → number
function columnLetterToNumber(letter) {
  let column = 0;
  for (let i = 0; i < letter.length; i++) {
    column = column * 26 + (letter.charCodeAt(i) - 64);
  }
  return column;
}
