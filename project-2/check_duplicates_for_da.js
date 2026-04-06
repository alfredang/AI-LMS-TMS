function check_duplicates_for_da() {
  const WEBHOOK_URL = "https://n8n.srv1231536.hstgr.cloud/webhook/a79d5aee-4315-4002-aa7a-49eb30f640f9";
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Show "Processing..." toast
  ss.toast('Checking for duplicates...', '⏳ Processing', 3);

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
      ss.toast('Duplicate check completed successfully!', '✅ Success', 5);
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