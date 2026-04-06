function sendToN8N() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1️⃣ Define your n8n webhook production URL
  const n8nWebhookUrl = "https://n8n.srv1231536.hstgr.cloud/webhook/c849d21b-1327-4eb8-9f19-3d743ec33dae";

  // 2️⃣ Get active sheet and value (assuming Course Run ID is in cell A2)
  const sheet = ss.getActiveSheet();
  const courseRunId = sheet.getRange("A2").getValue().toString().trim();

  // 3️⃣ Validate input
  if (!courseRunId) {
    ss.toast('Please enter a Course Run ID first!', '⚠️ Missing ID', 5);
    return;
  }

  // Show "Sending..." toast
  ss.toast('Sending to n8n...', '⏳ Processing', 3);

  // 4️⃣ Prepare payload
  const payload = {
    "course_run_id": courseRunId
  };

  // 5️⃣ Send POST request to n8n
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(n8nWebhookUrl, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 200) {
      // Success toast (auto-dismiss in 5 seconds)
      ss.toast(`Successfully sent Course Run ID: ${courseRunId}`, '✅ Success', 5);
    } else {
      // Error toast
      ss.toast(`n8n returned status code: ${statusCode}`, '❌ Error', 5);
    }
  } catch (e) {
    // Exception toast
    ss.toast(`Failed to send: ${e.message}`, '❌ Error', 5);
  }
}