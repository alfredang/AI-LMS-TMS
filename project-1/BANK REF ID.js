function bankRefID() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const n8nWebhookUrl = "https://n8n.srv1231536.hstgr.cloud/webhook/02a2839e-1d5c-4776-9493-544cc9775e4c";
  
  ss.toast('Triggering n8n...', '⏳ Processing', 2);
  
  try {
    UrlFetchApp.fetch(n8nWebhookUrl);
    ss.toast('n8n workflow triggered!', '✅ Success', 5);
  } catch (e) {
    ss.toast(e.message, '❌ Error', 5);
  }
}