/**
 * Entry point: Fetches the main invoice by DocNumber, then creates a grant invoice.
 * @param {string} mainDocNumber - The DocNumber of the main invoice.
 */
// function testGrantInvoiceCreation() {
//   createGrantInvoiceByMainDocNumber("TC24-1227-2");
// }

/**
 * Fetches the main invoice by DocNumber, then calls createGrantInvoice().
 */
// function createGrantInvoiceByMainDocNumber(mainDocNumber) {
//   const mainInvoice = fetchMainInvoiceByDocNumber(mainDocNumber);
//   if (!mainInvoice) {
//     Logger.log(`No main invoice found for DocNumber: ${mainDocNumber}`);
//     return;
//   }
//   createGrantInvoice(mainInvoice);
// }
function createGrantInvoiceFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Grant Invoice Creation");
  if (!sheet) {
    Logger.log('Sheet "Grant Invoice Creation" not found.');
    return;
  }

  // 1) Read the main invoice DocNumber from cell B1
  const mainDocNumber = sheet.getRange("B1").getValue();
  if (!mainDocNumber) {
    Logger.log('No main invoice number in cell B1.');
    return;
  }

  // 2) Fetch the main invoice
  const mainInvoice = fetchMainInvoiceByDocNumber(mainDocNumber);
  if (!mainInvoice) {
    Logger.log(`No main invoice found for DocNumber: ${mainDocNumber}`);
    return;
  }

  // 3) Create the grant invoice
  const result = createGrantInvoice(mainInvoice);
  if (!result || !result.Invoice) {
    Logger.log("Grant invoice creation returned null or an error.");
    sheet.getRange("D2").setValue("Error: Failed to create grant invoice.");
    return;
  }

  // 4) Clear previous content starting from column D
  sheet.getRange("D2:K50").clearContent();

  const invoice = result.Invoice;

  // --- (A) HEADER SECTION ---
  try {
    sheet.getRange("D1").setValue("Grant Invoice").setFontWeight("bold").setFontSize(14);
    sheet.getRange("D2").setValue("Invoice No.");
    sheet.getRange("E2").setValue(invoice.DocNumber);

    sheet.getRange("D3").setValue("Customer");
    sheet.getRange("E3").setValue(invoice.CustomerRef ? invoice.CustomerRef.name : "");

    sheet.getRange("D4").setValue("Invoice Date");
    sheet.getRange("E4").setValue(invoice.TxnDate).setNumberFormat("yyyy-mm-dd");

    sheet.getRange("D5").setValue("Due Date");
    sheet.getRange("E5").setValue(invoice.DueDate).setNumberFormat("yyyy-mm-dd");

    sheet.getRange("D6").setValue("Purchase Order #");
    sheet.getRange("E6").setValue(mainDocNumber);

    sheet.getRange("D7").setValue("SFC Claim ID");
    const sfcField = (invoice.CustomField || []).find(cf => cf.Name === "SFC Claim ID");
    sheet.getRange("E7").setValue(sfcField ? sfcField.StringValue : "");
  } catch (error) {
    Logger.log(`Error writing header section: ${error.message}`);
  }

  // --- (B) LINE ITEMS TABLE HEADER ---
  const headerRow = 9;
  try {
    sheet.getRange(`D${headerRow}`).setValue("#").setFontWeight("bold");
    sheet.getRange(`E${headerRow}`).setValue("Product/Service").setFontWeight("bold");
    sheet.getRange(`F${headerRow}`).setValue("Description").setFontWeight("bold");
    sheet.getRange(`G${headerRow}`).setValue("Qty").setFontWeight("bold");
    sheet.getRange(`H${headerRow}`).setValue("Rate").setFontWeight("bold");
    sheet.getRange(`I${headerRow}`).setValue("Amount (SGD)").setFontWeight("bold");
    sheet.getRange(`J${headerRow}`).setValue("GST").setFontWeight("bold");

    // Add a border around the header row
    sheet.getRange(`D${headerRow}:J${headerRow}`).setBorder(true, true, true, true, true, true);
  } catch (error) {
    Logger.log(`Error writing table headers: ${error.message}`);
  }

  // --- (C) FILL LINE ITEMS ---
  let rowIndex = headerRow + 1;
  let lineNumber = 1;

  try {
    for (let i = 0; i < invoice.Line.length; i++) {
      const line = invoice.Line[i];
      if (line.DetailType !== "SalesItemLineDetail") {
        continue;
      }

      const sid = line.SalesItemLineDetail;
      const productName = sid.ItemRef ? sid.ItemRef.name : "";
      const qty = sid.Qty || 1;
      const rate = sid.UnitPrice || 0;
      const amount = line.Amount || 0;
      const gst = "Out of Scope"; // or sid.TaxCodeRef, etc.

      // Fill table rows
      sheet.getRange(rowIndex, 4).setValue(lineNumber);       // Column D
      sheet.getRange(rowIndex, 5).setValue(productName);      // Column E
      sheet.getRange(rowIndex, 6).setValue(line.Description); // Column F
      sheet.getRange(rowIndex, 7).setValue(qty);              // Column G
      sheet.getRange(rowIndex, 8).setValue(rate).setNumberFormat('"S$"#,##0.00'); // Column H
      sheet.getRange(rowIndex, 9).setValue(amount).setNumberFormat('"S$"#,##0.00'); // Column I
      sheet.getRange(rowIndex, 10).setValue(gst);             // Column J

      rowIndex++;
      lineNumber++;
    }
  } catch (error) {
    Logger.log(`Error filling line items: ${error.message}`);
  }

  // --- (D) SUBTOTAL, TAX, TOTAL ---
  try {
    rowIndex++;
    sheet.getRange(rowIndex, 8).setValue("Subtotal:").setFontWeight("bold");
    const subtotal = invoice.Line.find(l => l.DetailType === "SubTotalLineDetail")?.Amount || invoice.TotalAmt;
    sheet.getRange(rowIndex, 9).setValue(subtotal).setNumberFormat('"S$"#,##0.00');
    rowIndex++;

    sheet.getRange(rowIndex, 8).setValue("Tax:").setFontWeight("bold");
    const taxTotal = invoice.TxnTaxDetail ? invoice.TxnTaxDetail.TotalTax : 0;
    sheet.getRange(rowIndex, 9).setValue(taxTotal).setNumberFormat('"S$"#,##0.00');
    rowIndex++;

    sheet.getRange(rowIndex, 8).setValue("Total:").setFontWeight("bold");
    sheet.getRange(rowIndex, 9).setValue(invoice.TotalAmt).setNumberFormat('"S$"#,##0.00');

    // Add borders around the total section
    sheet.getRange(headerRow, 4, rowIndex - headerRow + 1, 7).setBorder(true, true, true, true, true, true);

    // Add timestamp
    sheet.getRange("D1").setNote(`Data last updated on ${new Date()}`);
  } catch (error) {
    Logger.log(`Error calculating totals: ${error.message}`);
  }

  Logger.log("Invoice successfully written to the sheet.");
}

/**
 * Fetches the main invoice by its DocNumber from QuickBooks Online.
 * Replace COMPANY_ID with your actual QBO company ID if needed.
 */
function fetchMainInvoiceByDocNumber(mainDocNumber) {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const INVOICES_ENDPOINT = "/v3/company/{company_id}/query";
  const COMPANY_ID = "1292117680";

  const QUERY = `SELECT * FROM Invoice WHERE DocNumber = '${mainDocNumber}'`;
  const url = `${BASE_URL}${INVOICES_ENDPOINT.replace("{company_id}", COMPANY_ID)}`;
  const service = getService();

  if (!service.hasAccess()) {
    Logger.log("Access token is not available. Reauthorize the app.");
    return null;
  }

  try {
    const response = UrlFetchApp.fetch(`${url}?query=${encodeURIComponent(QUERY)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${service.getAccessToken()}`,
        Accept: "application/json"
      }
    });
    const result = JSON.parse(response.getContentText());
    if (result.QueryResponse && result.QueryResponse.Invoice && result.QueryResponse.Invoice.length > 0) {
      const mainInvoice = result.QueryResponse.Invoice[0];
      Logger.log(`Fetched main invoice: ${JSON.stringify(mainInvoice, null, 2)}`);
      return mainInvoice;
    }
  } catch (error) {
    Logger.log(`Error fetching main invoice: ${error.message}`);
  }
  return null;
}

/**
 * Creates a grant invoice in QBO based on the main invoice details.
 */
function createGrantInvoice(mainInvoice) {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const CREATE_INVOICE_ENDPOINT = "/v3/company/{company_id}/invoice";
  const COMPANY_ID = "1292117680";

  // 1) Extract the smallest GrantRef from the main invoice lines
  const grantDocNumber = extractGrantDocNumber(mainInvoice.Line);
  if (!grantDocNumber) {
    Logger.log("No grant reference found in the main invoice.");
    return null;
  }

  // 2) Parse the earliest "Course Date" from the main invoice lines, e.g. "Course Date: 2/3 Jan 2025"
  //    If none found, fallback to the main invoice's own TxnDate.
  const parsedCourseDate = extractCourseDate(mainInvoice.Line);
  const invoiceDate = parsedCourseDate || mainInvoice.TxnDate;

  // 3) Update the "Purchase Order #" custom field so it is set to the main invoice's DocNumber
  const updatedCustomFields = updatePurchaseOrderNumber(
    mainInvoice.CustomField || [],
    mainInvoice.DocNumber
  );

  // 4) Construct the new grant invoice
  const grantInvoice = {
    DocNumber: grantDocNumber,
    TxnDate: invoiceDate,
    DueDate: calculateDueDate(invoiceDate),
    CustomerRef: { value: "1405", name: "Singapore Workforce Development Agency (WSG)" },
    SalesTermRef: { value: "13" },
    GlobalTaxCalculation: "TaxExcluded",
    TxnTaxDetail: { TotalTax: 0 },
    PrintStatus: "NotSet",
    EmailStatus: "NotSet",
    BillEmail: { Address: "angch@tertiaryinfotech.com" },
    CustomField: updatedCustomFields,
    Line: deriveGrantLineItems(mainInvoice.Line, grantDocNumber)
  };

  Logger.log(`Attempting to create grant invoice: ${JSON.stringify(grantInvoice, null, 2)}`);

  const url = `${BASE_URL}${CREATE_INVOICE_ENDPOINT.replace("{company_id}", COMPANY_ID)}`;
  const service = getService();

  if (service.hasAccess()) {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${service.getAccessToken()}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        payload: JSON.stringify(grantInvoice)
      });

      const result = JSON.parse(response.getContentText());
      Logger.log("Grant Invoice Created Successfully:");
      Logger.log(JSON.stringify(result, null, 2));
      Logger.log(`Grant Invoice DocNumber: ${result.Invoice.DocNumber}`);
      return result; // Return the entire QuickBooks response
    } catch (error) {
      Logger.log(`Error creating grant invoice: ${error.message}`);
      return null;
    }
  } else {
    Logger.log("Access token is not available. Reauthorize the app.");
    return null;
  }
}

/**
 * Extracts the *smallest* Grant Ref # from lines that contain "Grant Ref #; <GRN-xxxx-xxxxx>".
 */
// function extractGrantDocNumber(lineItems) {
//   const refs = [];

//   for (const line of lineItems) {
//     if (line.Description && line.Description.includes("Grant Ref #;")) {
//       // e.g. "Grant Ref #; GRN-2412-139508"
//       const matches = line.Description.match(/Grant Ref #;\s*(GRN-\d{4}-\d+)/g);
//       if (matches) {
//         matches.forEach((m) => {
//           const docMatch = m.match(/(GRN-\d{4}-\d+)/);
//           if (docMatch) {
//             refs.push(docMatch[1]);
//           }
//         });
//       }
//     }
//   }

//   if (refs.length === 0) return null;

//   // If multiple, pick the one with the smallest numeric suffix
//   let smallestRef = refs[0];
//   let smallestNum = extractNumericPart(smallestRef);

//   for (let i = 1; i < refs.length; i++) {
//     const currentNum = extractNumericPart(refs[i]);
//     if (currentNum < smallestNum) {
//       smallestNum = currentNum;
//       smallestRef = refs[i];
//     }
//   }

//   return smallestRef;
// }

function extractGrantDocNumber(lineItems) {
  const refs = [];

  for (const line of lineItems) {
    if (line.Description && /Grant Ref #/i.test(line.Description)) {
      // Match grant references like "Grant Ref #; GRN-2501-070017"
      const matches = line.Description.match(/GRN-\d{4}-\d+/g); // Match grant refs only
      if (matches) {
        refs.push(...matches); // Collect all matches
      }
    }
  }

  if (refs.length === 0) return null;

  // Find the smallest numeric part of the reference
  let smallestRef = refs[0];
  let smallestNum = extractNumericPart(smallestRef);

  for (let i = 1; i < refs.length; i++) {
    const currentNum = extractNumericPart(refs[i]);
    if (currentNum < smallestNum) {
      smallestNum = currentNum;
      smallestRef = refs[i];
    }
  }

  return smallestRef;
}

function extractNumericPart(grnString) {
  const match = grnString.match(/GRN-\d{4}-(\d+)/);
  return match ? parseInt(match[1], 10) : Infinity;
}

// function extractNumericPart(grnString) {
//   // "GRN-2412-139508" => 139508
//   const match = grnString.match(/GRN-\d{4}-(\d+)/);
//   if (match) {
//     return parseInt(match[1], 10);
//   }
//   return Infinity;
// }

/**
 * Looks for a line containing "Course Date:" and tries to parse a date from it:
 * e.g. "Course Date: 2/3 Jan 2025 (Thurs/Fri)" => "2025-01-02"
 *
 * We'll capture the earliest day mentioned (e.g. "2" in "2/3") to form "2 Jan 2025".
 * If not found, returns null.
 */
/**
 * Looks for a line containing "Course Date:" and tries to parse a date from it:
 * e.g. "Course Date: 2/3 Jan 2025 (Thurs/Fri)" => "2025-01-02"
 *
 * We'll capture the earliest day mentioned (e.g. "2" in "2/3") to form "2 Jan 2025".
 * If not found, returns null.
 */
function extractCourseDate(lineItems) {
  let matchedDate = null;

  // Regex: "Course Date: " followed by something like "2/3 Jan 2025"
  // This picks up:
  //   group1 => "2/3"
  //   group2 => "Jan"
  //   group3 => "2025"
  const courseDateRegex = /Course Date:\s*([\d,\-\/]+)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i;

  for (const line of lineItems) {
    if (!line.Description) continue;

    const desc = line.Description;
    const match = desc.match(courseDateRegex);
    if (match) {
      // e.g. match[1] = "2/3" => earliest is 2
      //      match[2] = "Jan"
      //      match[3] = "2025"
      const dayPortion = match[1];       // "2/3"
      const monthStr = match[2];        // "Jan"
      const yearStr = match[3];         // "2025"

      // Pick the earliest numeric day from dayPortion
      let dayNum = 1;
      const dayMatches = dayPortion.match(/\d+/g); // e.g. ["2", "3"]
      if (dayMatches && dayMatches.length > 0) {
        // parse the first one (e.g. 2)
        dayNum = parseInt(dayMatches[0], 10);
      }

      // Convert month string to a month index, e.g. "Jan" => 0, "Feb" => 1, etc.
      const monthIndex = monthStrToIndex(monthStr); // "Jan" => 0
      const yearNum = parseInt(yearStr, 10);

      /**
       * Create the date in UTC with a midday hour (12:00) to avoid time-zone shifts
       * that might push it back to the previous day in .toISOString().
       */
      const dt = new Date(Date.UTC(yearNum, monthIndex, dayNum, 12));
      const isoDate = dt.toISOString().split("T")[0]; // "YYYY-MM-DD"

      Logger.log(`Parsed Course Date: ${isoDate} from line: ${desc}`);
      matchedDate = isoDate;
      break; // stop after the first match
    }
  }

  return matchedDate;
}

/**
 * Converts a 3-letter month string to a 0-based month index (0=January, 11=December).
 * Returns 0 if no match found (assume "Jan").
 */
function monthStrToIndex(mStr) {
  const lower = mStr.toLowerCase();
  switch (lower) {
    case "jan": return 0;
    case "feb": return 1;
    case "mar": return 2;
    case "apr": return 3;
    case "may": return 4;
    case "jun": return 5;
    case "jul": return 6;
    case "aug": return 7;
    case "sep": return 8;
    case "oct": return 9;
    case "nov": return 10;
    case "dec": return 11;
    default: return 0;
  }
}

/**
 * Derives the lines for the grant invoice by selecting only lines that contain "Less:",
 * converting negative amounts (or any amount) to positive, and reusing item references
 * if present. The final lines will be "SalesItemLineDetail" with a positive amount.
 */
function deriveGrantLineItems(mainLineItems, grantDocNumber) {
  const grantLineItems = [];
  let totalAmount = 0;

  mainLineItems.forEach((line) => {
    Logger.log(`Processing line: ${JSON.stringify(line, null, 2)}`);

    const desc = line.Description || "";

    // 1) Only keep lines that contain "Less:"
    if (!desc.toLowerCase().includes("less:")) {
      Logger.log(`Skipping line: ${desc}`);
      return;
    }

    // 2) Compute the absolute amount for the new invoice
    let lineAmount = line.Amount || 0;
    lineAmount = Math.abs(lineAmount);

    // If there's no amount, skip
    if (lineAmount === 0) {
      Logger.log(`Skipping line with zero amount: ${desc}`);
      return;
    }

    // 3) Build a new line item
    const newLine = {
      Id: line.Id,
      LineNum: line.LineNum,
      // Append the Grant Ref if it's not already there
      Description: appendGrantRef(desc, grantDocNumber),
      Amount: lineAmount,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: { value: "", name: "" },
        UnitPrice: lineAmount,
        Qty: 1,
        TaxCodeRef: {}
      }
    };

    // 4) If the main line was SalesItemLineDetail with a valid itemRef, reuse it
    if (line.DetailType === "SalesItemLineDetail" && line.SalesItemLineDetail) {
      const sid = line.SalesItemLineDetail;
      // If there is a valid product/service reference
      if (sid.ItemRef && sid.ItemRef.value) {
        newLine.SalesItemLineDetail.ItemRef = sid.ItemRef;
      }
      // Reuse tax code or anything else if needed
      if (sid.TaxCodeRef) {
        newLine.SalesItemLineDetail.TaxCodeRef = sid.TaxCodeRef;
      }
    } else {
      // If we get here, it means you found a line with "Less:" but no valid sales item ref
      // If you want to throw an error, you can, or skip it:
      Logger.log(`Skipping line with no valid ItemRef: ${desc}`);
      return;
    }

    // 5) Push the new line
    grantLineItems.push(newLine);
    totalAmount += lineAmount;
  });

  if (grantLineItems.length === 0) {
    Logger.log("No valid 'Less:' lines found for grant invoice.");
    throw new Error("Grant invoice cannot be created without valid 'Less:' lines.");
  }

  // 6) Add SubTotal line
  grantLineItems.push({
    Amount: totalAmount,
    DetailType: "SubTotalLineDetail",
    SubTotalLineDetail: {}
  });

  Logger.log(`Derived grant line items: ${JSON.stringify(grantLineItems, null, 2)}`);
  return grantLineItems;
}

/**
 * Appends "Grant Ref #: <docNumber>" to the description only if it is not already present
 * (either as "Grant Ref #: " or "Grant Ref #; ").
 */
function appendGrantRef(description, docNumber) {
  // If ANY "Grant Ref #;" is present, skip appending
  if (description.match(/Grant Ref #;\s*GRN-\d{4}-\d+/)) {
    return description;
  }
  return `${description}\nGrant Ref #: ${docNumber}`;
}

/**
 * Updates or injects the "Purchase Order #" custom field so it shows the *main invoice's DocNumber*.
 */
function updatePurchaseOrderNumber(customFields, mainDocNumber) {
  if (!customFields) {
    customFields = [];
  }

  let foundPOField = false;
  for (let i = 0; i < customFields.length; i++) {
    // Typically "DefinitionId" = "1" and "Name" = "Purchase Order #"
    const cf = customFields[i];
    if (cf.Name && cf.Name.toLowerCase() === "purchase order #") {
      // Overwrite it with the main invoice's doc number
      cf.StringValue = mainDocNumber;
      foundPOField = true;
      break;
    }
  }

  // If we didn't find an existing "Purchase Order #" field, we create a new one
  if (!foundPOField) {
    customFields.push({
      DefinitionId: "1", // or the correct DefinitionId for "Purchase Order #"
      Name: "Purchase Order #",
      Type: "StringType",
      StringValue: mainDocNumber
    });
  }

  return customFields;
}

/**
 * Calculates the due date (35 days after the invoiceDate) for the grant invoice.
 */
function calculateDueDate(invoiceDate) {
  const date = new Date(invoiceDate);
  date.setDate(date.getDate() + 35);
  return date.toISOString().split("T")[0];
}

/**
 * Configures the OAuth2 service. Fill in your real details.
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
