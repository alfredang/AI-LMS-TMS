// ====== CONFIGURATION ======
const SHEET_ID = '15Krv9IPm_d0xNdQfdWGl_cjW25CF9XNJCsqz9EGY7Qg';
const SHEET_NAME = 'Course Info For Enrolment Form';
// const N8N_WEBHOOK_URL = 'https://n8n.srv923061.hstgr.cloud/webhook/course-form'; // <-- replace with your actual webhook URL

// ====== Serve the HTML page ======
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Course Selection Form')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ====== Provide course data to the frontend ======
function getCourses() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getRange('A2:B').getValues();
  return data
    .filter(r => r[0] && r[1])
    .map(r => ({ code: r[0], name: r[1], label: `${r[1]} — ${r[0]}` }));
}

// ====== Handle form submission ======
// function submitForm(data) {
//   // 1️⃣ Option A – Send to n8n webhook
//   const options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify(data)
//   };
//   UrlFetchApp.fetch(N8N_WEBHOOK_URL, options);

//   // 2️⃣ Option B – (Alternative) Save to the same sheet
//   const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Form Responses');
//   sheet.appendRow([new Date(), data.name, data.courseCode, data.courseTitle, data.email]);

//   return '✅ Form submitted successfully!';
// }
