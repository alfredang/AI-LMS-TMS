function processEnrolmentGrants() {
  const WEBHOOK_URL = "https://n8n.srv1231536.hstgr.cloud/webhook/7d4512e5-a21e-41cc-adb4-750e0772cc19";
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Show "Processing..." toast
  ss.toast('Enrolment & Grants...', '⏳ Processing', 3);

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ trigger: true }),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 200) {
      // Success toast (auto-dismiss in 5 seconds)
      ss.toast('Enrolment & Grants Running successfully!', '✅ Success', 10);
      Logger.log('Success: ' + response.getContentText());
    } else {
      // Error toast
      ss.toast(`n8n returned status code: ${statusCode}`, '❌ Error', 10);
      Logger.log('Error response code: ' + statusCode);
    }
  } catch (e) {
    // Exception toast
    ss.toast(`Failed to process: ${e.message}`, '❌ Error', 10);
    Logger.log('Exception: ' + e.toString());
  }
}