/**
 * Fetches an aging report from QuickBooks Online and writes it to a Google Sheet with pagination support.
 */
function fetchAndWriteAgingReport() {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const AGING_ENDPOINT = "/v3/company/{company_id}/reports/AgedReceivableDetail"; // Correct endpoint
  const COMPANY_ID = "1292117680"; // Replace with your QuickBooks Online Company ID
  const url = `${BASE_URL}${AGING_ENDPOINT.replace("{company_id}", COMPANY_ID)}`;

  // Get the OAuth2 service
  const service = getService();

  if (service.hasAccess()) {
    try {
      Logger.log("Building request to fetch aging report...");

      const params = {
        date_macro: "This Month",
        aging_period_length: 7,
        num_periods: 9,
        max_results: 100 // QuickBooks' maximum batch size
      };

      let startPosition = 1;
      let allRows = [];
      let hasMorePages = true;

      while (hasMorePages) {
        const queryString = Object.keys(params)
          .map(key => `${key}=${encodeURIComponent(params[key])}`)
          .join("&") + `&start_position=${startPosition}`;

        Logger.log(`Sending request to: ${url}?${queryString}`);
        const response = UrlFetchApp.fetch(`${url}?${queryString}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${service.getAccessToken()}`,
            Accept: "application/json"
          },
          muteHttpExceptions: true
        });

        const statusCode = response.getResponseCode();
        const responseText = response.getContentText();
        Logger.log(`Response status code: ${statusCode}`);
        Logger.log(`Response body: ${responseText}`);

        if (statusCode !== 200) {
          Logger.log(`Error: Received non-200 status code (${statusCode}).`);
          break;
        }

        const result = JSON.parse(responseText);
        const rows = result.Rows ? result.Rows.Row || [] : [];
        allRows = allRows.concat(rows);

        Logger.log(`Fetched ${rows.length} rows in this batch.`);
        if (rows.length < params.max_results) {
          hasMorePages = false; // No more pages to fetch
        } else {
          startPosition += params.max_results; // Move to the next page
        }
      }

      Logger.log(`Total rows fetched: ${allRows.length}`);
      if (allRows.length === 0) {
        Logger.log("No data found for the aging report.");
        return;
      }

      // Write aging report to the sheet
      writeAgingReportToSheet(allRows);
    } catch (error) {
      Logger.log(`Error fetching aging report: ${error.message}`);
      Logger.log(`Stack trace: ${error.stack}`);
    }
  } else {
    Logger.log("Access token is not available. Reauthorize the app.");
  }
}

/**
 * Writes the aging report data to a Google Sheet named "QB Aging Report".
 * @param {Array} rows - The rows from the aging report response.
 */
function writeAgingReportToSheet(rows) {
  Logger.log("Writing aging report data to the 'QB Aging Report' sheet...");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("QB Aging Report");

  // If the sheet doesn't exist, create it
  if (!sheet) {
    Logger.log("'QB Aging Report' sheet not found. Creating a new sheet...");
    sheet = ss.insertSheet("QB Aging Report");
  } else {
    Logger.log("Clearing existing data in the 'QB Aging Report' sheet...");
    sheet.clear();
  }

  // Add headers
  const headers = [
    "Vendor", 
    "Doc Numbers", 
    "Outstanding Amount", 
    "Current", 
    "1-7 Days", 
    "8-14 Days", 
    "15-21 Days", 
    "22-28 Days", 
    "29-35 Days", 
    "36-42 Days", 
    "43-49 Days", 
    "50-56+ Days", 
    "Total Amount"
  ];
  Logger.log("Adding headers to the sheet...");
  sheet.appendRow(headers);

  // Combine data for each vendor
  const vendorData = {};

  rows.forEach((row, index) => {
    Logger.log(`Processing row ${index + 1}...`);

    if (row.Rows && row.Rows.Row) {
      row.Rows.Row.forEach(detail => {
        const detailData = detail.ColData || [];
        const vendorName = detailData[3]?.value || "N/A"; // Extract Vendor Name
        const docNumber = detailData[2]?.value || "N/A"; // Extract DocNumber
        const openBalance = parseFloat(detailData.slice(-1)[0]?.value || "0.00"); // Extract open balance

        // Period amounts (indices may need adjustment based on structure)
        const amounts = detailData.slice(5, 12).map(data => parseFloat(data?.value || "0.00"));

        if (!vendorData[vendorName]) {
          vendorData[vendorName] = {
            docNumbers: [],
            outstandingAmount: 0,
            periodAmounts: Array(8).fill(0),
            totalAmount: 0
          };
        }

        // Add data to the vendor
        vendorData[vendorName].docNumbers.push(docNumber);
        vendorData[vendorName].outstandingAmount += openBalance;
        vendorData[vendorName].periodAmounts = vendorData[vendorName].periodAmounts.map(
          (amount, idx) => amount + (amounts[idx] || 0)
        );
      });
    }
  });

  // Write combined data to the sheet
  Object.entries(vendorData).forEach(([vendorName, data]) => {
    const sheetRow = [
      vendorName,
      data.docNumbers.join("\n"), // Combine all doc numbers with newline separator
      data.outstandingAmount.toFixed(2),
      ...data.periodAmounts.map(amount => amount.toFixed(2)), // Period amounts
      data.outstandingAmount.toFixed(2) // Total amount (same as outstandingAmount)
    ];

    Logger.log(`Appending row to the sheet: ${JSON.stringify(sheetRow)}`);
    sheet.appendRow(sheetRow);
  });

  Logger.log("Aging report successfully written to the 'QB Aging Report' sheet.");
}
