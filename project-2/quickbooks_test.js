/**
 * Fetches invoices from QuickBooks Online based on specific search criteria.
 * Modify the QUERY constant to customize the search parameters.
 */
function fetchInvoicesByCriteria() {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const INVOICES_ENDPOINT = "/v3/company/{company_id}/query"; // Query endpoint
  const COMPANY_ID = "1292117680"; // Replace with your QuickBooks Online Company ID

  // Define the search query (customize this to search by desired criteria)
  const QUERY = "SELECT * FROM Invoice WHERE DocNumber = 'TC24-0417-9'"; // Example: Search by Document Number

  // Build the API URL
  const url = `${BASE_URL}${INVOICES_ENDPOINT.replace("{company_id}", COMPANY_ID)}`;

  // Get the OAuth2 service
  const service = getService();

  if (service.hasAccess()) {
    try {
      // Make the API request
      const response = UrlFetchApp.fetch(`${url}?query=${encodeURIComponent(QUERY)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${service.getAccessToken()}`,
          Accept: "application/json"
        }
      });

      // Parse and log the response
      const result = JSON.parse(response.getContentText());
      Logger.log(JSON.stringify(result, null, 2));

      // Process the fetched invoices
      processInvoicesTest(result.QueryResponse.Invoice);
    } catch (error) {
      Logger.log(`Error fetching invoices: ${error.message}`);
    }
  } else {
    Logger.log("Access token is not available. Reauthorize the app.");
  }
}

/**
 * Processes the fetched invoices (example function).
 * @param {Array} invoices - The list of invoices from the API response.
 */
function processInvoicesTest(invoices) {
  if (!invoices || invoices.length === 0) {
    Logger.log("No invoices found.");
    return;
  }

  invoices.forEach((invoice) => {
    Logger.log(`Invoice ID: ${invoice.Id}`);
    Logger.log(`Customer Name: ${invoice.CustomerRef.name}`);
    Logger.log(`Total Amount: ${invoice.TotalAmt}`);
    Logger.log(`Due Date: ${invoice.DueDate}`);
    Logger.log(`Line Items: ${JSON.stringify(invoice.Line, null, 2)}`);
    Logger.log(`Tax Details: ${JSON.stringify(invoice.TxnTaxDetail, null, 2)}`);
    Logger.log(`Balance: ${invoice.Balance}`);
  });
}

/**
 * Configures the OAuth2 service (assumes this function exists from your previous script).
 */
function getService() {
  return OAuth2.createService("Quickbooks")
    .setAuthorizationBaseUrl(BASE_AUTH_URL)
    .setTokenUrl(TOKEN_URL)
    .setClientId(CLIENT_ID)
    .setClientSecret(CLIENT_SECRET)
    .setScope(API_SCOPE)
    .setPropertyStore(PropertiesService.getScriptProperties());
}