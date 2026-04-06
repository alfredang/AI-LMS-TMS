/**
 * Fetches a customer from QuickBooks Online based on their Display Name.
 * @param {string} displayName - The display name of the customer.
 * @returns {string|null} - The Customer ID if found, or null if not found.
 */

/**
 * Automatically triggered whenever a cell is edited in Google Sheets.
 * We only care about edits in sheet "QB Customer" and column B.
 * If column A is empty, we fetch the Customer ID from QuickBooks
 * using the display name (column B) and store it in column A.
 */
function onQBCustomerEdit(e) {
  // Safety checks
  const sheetName = "QB Customer";  // The name of the sheet to monitor
  const editedSheet = e.range.getSheet();
  if (editedSheet.getName() !== sheetName) return; // only run on the “QB Customer” sheet

  // If the edited column is not B (2), do nothing
  if (e.range.getColumn() !== 2) return; 

  // Identify row and the new display name
  const row = e.range.getRow();
  const displayName = e.range.getValue();

  // If row is 1 (header row) or the display name is empty, skip
  if (row === 1 || !displayName) return;

  // Check if column A (Customer ID) already has a value
  const sheet = e.range.getSheet();
  const existingCustId = sheet.getRange(row, 1).getValue();
  if (existingCustId) {
    // There's already a Customer ID in col A; do nothing to avoid overwriting
    return;
  }

  // If col A is blank, fetch the customer ID from QuickBooks
  const custId = fetchCustomerByDisplayName(displayName);
  if (custId) {
    // Write the ID into column A
    sheet.getRange(row, 1).setValue(custId);
  }
}


function fetchCustomerByDisplayName(displayName) {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const QUERY_ENDPOINT = "/v3/company/{company_id}/query"; // Endpoint for querying customers
  const COMPANY_ID = "1292117680"; // Replace with your QuickBooks Online Company ID

  // Escape single quotes for QuickBooks query syntax
  const escapedDisplayName = displayName.replace(/'/g, "''");

  // Construct the query using LIKE and wildcards
  const query = `SELECT * FROM Customer WHERE DisplayName LIKE '%${escapedDisplayName}%'`;
  const encodedQuery = encodeURIComponent(query);

  // Build the API URL
  const url = `${BASE_URL}${QUERY_ENDPOINT.replace("{company_id}", COMPANY_ID)}?query=${encodedQuery}`;

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

      // Parse the response
      const result = JSON.parse(response.getContentText());
      Logger.log(JSON.stringify(result, null, 2));

      // Extract customer details
      const customer = result.QueryResponse.Customer && result.QueryResponse.Customer[0];
      if (customer) {
        Logger.log(`Customer found: ${customer.DisplayName} (ID: ${customer.Id})`);
        return customer.Id; // Return the Customer ID
      } else {
        Logger.log(`No customer found with DisplayName similar to: ${displayName}`);
        return null;
      }
    } catch (error) {
      Logger.log(`Error fetching customer by DisplayName: ${error.message}`);
      Logger.log(`Query attempted: ${query}`);
      return null;
    }
  } else {
    Logger.log("Access token is not available. Reauthorize the app.");
    return null;
  }
}


function testFetchCustomerByDisplayName() {
  const displayName = "Institute of Technical Education"; // Replace with the desired display name
  const customerId = fetchCustomerByDisplayName(displayName);

  if (customerId) {
    Logger.log(`Customer ID for "${displayName}" is: ${customerId}`);
  } else {
    Logger.log(`No Customer ID found for "${displayName}".`);
  }
}
