function fetchPaymentTerms() {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const QUERY_ENDPOINT = `/v3/company/{company_id}/query`;
  const COMPANY_ID = "1292117680"; // Replace with your QuickBooks Company ID
  const QUERY = `SELECT * FROM Term`;
  const url = `${BASE_URL}${QUERY_ENDPOINT.replace("{company_id}", COMPANY_ID)}?query=${encodeURIComponent(QUERY)}&minorversion=65`;

  // Get the OAuth2 service
  const service = getService();

  if (service.hasAccess()) {
    try {
      // Make the API request
      const response = UrlFetchApp.fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${service.getAccessToken()}`,
          Accept: "application/json"
        }
      });

      // Parse and process the response
      const result = JSON.parse(response.getContentText());
      if (result.QueryResponse && result.QueryResponse.Term) {
        const terms = result.QueryResponse.Term;
        Logger.log("Payment Terms:");
        terms.forEach(term => {
          Logger.log(`Name: ${term.Name}`);
          Logger.log(`ID: ${term.Id}`);
          Logger.log(`Type: ${term.Type || "N/A"}`); // Type of term (e.g., standard or custom)
          Logger.log(`Due Days: ${term.DueDays || "N/A"}`); // Number of days due
          Logger.log("---");
        });
      } else {
        Logger.log("No payment terms found.");
      }
    } catch (error) {
      Logger.log(`Error fetching payment terms: ${error.message}`);
    }
  } else {
    Logger.log("Access token is not available. Reauthorize the app.");
  }
}
