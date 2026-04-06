function updateCourseDropdown() {
  // === CONFIGURATION ===
  const FORM_ID = '1ylhC-ATX4hPDiG4N_3KBjFpB2ERbAb1Rde4dNZuCTy0'; // Google Form ID
  const COURSE_SHEET_ID = '14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k'; // Sheet ID
  const COURSE_SHEET_NAME = 'Course Info For Enrolment Form'; // Tab name
  const QUESTION_TITLE = 'Course Name'; // Must match Form question title exactly

  // === OPEN BOTH FORM AND COURSE SHEET ===
  const form = FormApp.openById(FORM_ID);
  const courseSheet = SpreadsheetApp.openById(COURSE_SHEET_ID).getSheetByName(COURSE_SHEET_NAME);

  // === READ COURSE DATA (Code + Name) ===
  const data = courseSheet.getRange('A2:B').getValues();
  const choices = data
    .filter(row => row[0] && row[1]) // Skip rows with missing data
    .map(row => `${row[1]} — ${row[0]}`); // "Course Title — Code"

  // === FIND THE QUESTION IN THE FORM ===
  const items = form.getItems(FormApp.ItemType.LIST);
  const courseItem = items.find(i => i.getTitle() === QUESTION_TITLE);

  if (courseItem) {
    courseItem.asListItem().setChoiceValues(choices);
    Logger.log(`✅ Updated ${choices.length} course options from '${COURSE_SHEET_NAME}' sheet.`);
  } else {
    Logger.log(`⚠️ Question titled "${QUESTION_TITLE}" not found in the form.`);
  }
}
