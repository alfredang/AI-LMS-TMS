function fetchItemFromSKUtest() {
  const tgsCode = "TGS-2019503161";

  if (!tgsCode) {
    Logger.log("No TGS code provided.");
    return null;
  }
  
  // Define QuickBooks Query endpoint
  const baseUrl = "https://quickbooks.api.intuit.com";
  const companyId = "1292117680"; // Replace with your QuickBooks company ID
  const endpoint = `/v3/company/${companyId}/query`;
  const query = `SELECT * FROM Item WHERE SKU = '${tgsCode}'`;
  const url = `${baseUrl}${endpoint}?query=${encodeURIComponent(query)}&minorversion=65`;
  
  Logger.log(`Constructed URL: ${url}`);

  const service = getService(); // your OAuth2 function
  if (!service.hasAccess()) {
    Logger.log("No OAuth access. Please reauthorize.");
    return null;
  }

  try {
    Logger.log("Sending request to QuickBooks...");
    const response = UrlFetchApp.fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${service.getAccessToken()}`,
        Accept: "application/json"
      },
      muteHttpExceptions: true
    });
    
    Logger.log(`Response status: ${response.getResponseCode()}`);
    Logger.log(`Response body: ${response.getContentText()}`);
    
    const result = JSON.parse(response.getContentText());
    
    if (response.getResponseCode() !== 200) {
      Logger.log("Error fetching item. Response body: " + response.getContentText());
      return null;
    }
    
    if (!result.QueryResponse || !result.QueryResponse.Item || result.QueryResponse.Item.length === 0) {
      Logger.log("No items found for the provided SKU.");
      return null;
    }
    
    // Assume the first match
    const qbItem = result.QueryResponse.Item[0];
    Logger.log("First matched item: " + JSON.stringify(qbItem, null, 2));
    
    return {
      itemRefValue: qbItem.Id,
      itemRefName: qbItem.Name,
      unitPrice: qbItem.UnitPrice || 0
    };
    
  } catch (err) {
    Logger.log("Exception in fetchItemFromSKU: " + err.message);
    return null;
  }
}
