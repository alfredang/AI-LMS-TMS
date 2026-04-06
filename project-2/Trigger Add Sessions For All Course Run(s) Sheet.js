function trigger_add_sessions_for_all_course_run_sheet() {
  const WEBHOOK_URL = "https://n8n.srv1231536.hstgr.cloud/webhook/22488c3c-604c-40b0-8c59-7de4e7b35e18";
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Show "Processing..." toast
  ss.toast('Trigger Add Sessions For All Course Run(s) Sheet Is Running...', '⏳ Processing', 3);

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
      ss.toast('Trigger Add Sessions For All Course Run(s) Sheet Running successfully!', '✅ Success', 5);
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
