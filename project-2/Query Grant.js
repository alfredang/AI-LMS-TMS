function grantquery() {
  const WEBHOOK_URL = "https://n8n.srv1231536.hstgr.cloud/webhook/6531bbce-d780-4f72-9048-e35656a26f26";
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Show "Processing..." toast
  ss.toast('Processing Grant Query trigger...', '⏳ Processing', 3);

  const options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify({ trigger: true }),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 200) {
      // Success toast (auto-dismiss in 5 seconds)
      ss.toast('Grant Query trigger sent successfully!', '✅ Success', 5);
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