function new_cancel_enrolment() {
  const WEBHOOK_URL = "https://n8n.srv1231536.hstgr.cloud/webhook/b31b3b68-cf82-4c53-9779-dbf28cde4c22";
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Show "Processing..." toast
  ss.toast('Running Cancel Enrolment...', '⏳ Processing', 3);

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
      ss.toast('Cancel Enrolment Running successfully!', '✅ Success', 5);
      Logger.log('Success: ' + response.getContentText());
    } else {
      // Error toast
      ss.toast(`n8n returned status code: ${statusCode}`, '❌ Error', 5);
      Logger.log('Error response code: ' + statusCode);
    }
  } catch (e) {
    // Exception toast
    ss.toast(`Failed to process: ${e.message}`, '❌ Error', 5);
    Logger.log('Exception: ' + e.toString());
  }
}