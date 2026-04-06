/**
 * Fetches all customers from QuickBooks Online and writes them to a Google Sheet.
 */
function fetchAndWriteCustomers() {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const CUSTOMERS_ENDPOINT = "/v3/company/{company_id}/query"; // Query endpoint
  const COMPANY_ID = "1292117680"; // Replace with your QuickBooks Online Company ID

  // Build the API URL
  const url = `${BASE_URL}${CUSTOMERS_ENDPOINT.replace("{company_id}", COMPANY_ID)}`;

  // Get the OAuth2 service
  const service = getService();

  if (service.hasAccess()) {
    try {
      let allCustomers = [];
      let startPosition = 1; // Pagination starts at position 1
      let moreData = true;

      // Paginated requests to fetch all customers
      while (moreData) {
        // Define the query with pagination
        const QUERY = `SELECT * FROM Customer STARTPOSITION ${startPosition} MAXRESULTS 100`;

        const response = UrlFetchApp.fetch(`${url}?query=${encodeURIComponent(QUERY)}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${service.getAccessToken()}`,
            Accept: "application/json"
          }
        });

        // Parse the response
        const result = JSON.parse(response.getContentText());
        const customers = result.QueryResponse.Customer || [];

        // Add fetched customers to the full list
        allCustomers = allCustomers.concat(customers);

        // Check if there are more records to fetch
        moreData = customers.length === 100;
        startPosition += 100; // Move to the next page
      }

      if (allCustomers.length === 0) {
        Logger.log("No customers found.");
        return;
      }

      // Write all customers to the sheet
      writeCustomersToSheet(allCustomers);

    } catch (error) {
      Logger.log(`Error fetching customers: ${error.message}`);
    }
  } else {
    Logger.log("Access token is not available. Reauthorize the app.");
  }
}

/**
 * Writes the customer data to a Google Sheet named "QB Customer".
 * @param {Array} customers - The list of customers from the API response.
 */
function writeCustomersToSheet(customers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("QB Customer");

  // If the sheet doesn't exist, create it
  if (!sheet) {
    sheet = ss.insertSheet("QB Customer");
  } else {
    // Clear existing content
    sheet.clear();
  }

  // Add headers
  const headers = ["Customer ID", "Display Name", "Company Name", "Primary Email", "Phone", "Balance"];
  sheet.appendRow(headers);

  // Add customer data
  customers.forEach((customer) => {
    const row = [
      customer.Id,
      customer.DisplayName || "N/A",
      customer.CompanyName || "N/A",
      customer.PrimaryEmailAddr ? customer.PrimaryEmailAddr.Address : "N/A",
      customer.PrimaryPhone ? customer.PrimaryPhone.FreeFormNumber : "N/A",
      customer.Balance || "0.00"
    ];
    sheet.appendRow(row);
  });

  Logger.log(`Written ${customers.length} customers to the "QB Customer" sheet.`);
}