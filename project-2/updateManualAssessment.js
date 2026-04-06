function updateManualAssessment() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const webhookUrl = "https://n8n.srv1231536.hstgr.cloud/webhook/a5f9c22b-2b3f-4de7-96f4-e64dfd9f97b8";

  // Show "Processing..." toast
  ss.toast('Processing assessment updates...', '⏳ Processing', 3);

  const options = {
    method: "get",
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(webhookUrl, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 200) {
      // Success toast (auto-dismiss in 5 seconds)
      ss.toast('Assessment updates sent successfully!', '✅ Success', 5);
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