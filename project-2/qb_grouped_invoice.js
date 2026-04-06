/**
 * Main function to process grouped invoices and create grant invoices.
 */
function processGroupedInvoices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Invoice Creation");

  // 1) Get rows that are "Ready to Invoice" = "Yes"
  const rowsToInvoice = getInvoiceSheetData(sheet);
  if (!rowsToInvoice.length) {
    Logger.log("No rows found with 'Ready to Invoice' = 'Yes'.");
    return;
  }

  // 2) Find the relevant column indexes
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const invoiceStatusColIndex = headers.indexOf("Invoice Status") + 1; // 1-based
  const grantInvoiceNoColIndex = headers.indexOf("Grant Invoice No.") + 1; // 1-based

  if (invoiceStatusColIndex === 0) {
    throw new Error('Column "Invoice Status" not found.');
  }

  if (grantInvoiceNoColIndex === 0) {
    throw new Error('Column "Grant Invoice No." not found.');
  }

  // 3) Group rows by "Invoice No."
  const invoiceNoGroups = groupRowsByInvoiceNo(rowsToInvoice);

  // 4) Process each invoice group
  Object.keys(invoiceNoGroups).forEach(invoiceNo => {
    const rowGroup = invoiceNoGroups[invoiceNo];

    // Create the main invoice for the group
    let mainInvoiceResult = null;
    if (rowGroup.length === 1) {
      const payload = buildInvoicePayloadFromRow(rowGroup[0].rowData, rowGroup[0].headers);
      mainInvoiceResult = sendInvoiceToQuickBooks(payload);
    } else {
      const payload = buildGroupedInvoicePayloadFromRows(rowGroup);
      mainInvoiceResult = sendInvoiceToQuickBooks(payload);
    }

    // Process each row in the group to create individual grant invoices
    rowGroup.forEach(rowObj => {
      let statusMessage = "";

      if (mainInvoiceResult.error) {
        statusMessage = `Error: ${mainInvoiceResult.error}`;
        Logger.log(`Error for Row ${rowObj.originalRowIndex}: ${statusMessage}`);
      } else if (mainInvoiceResult.Fault) {
        const faultDetails = mainInvoiceResult.Fault.Error.map(err => `${err.Message} (${err.Detail})`).join("; ");
        statusMessage = `Error: ${faultDetails}`;
        Logger.log(`Fault for Row ${rowObj.originalRowIndex}: ${statusMessage}`);
      } else {
        const mainInvoice = mainInvoiceResult.Invoice;

        // Pass headers explicitly
        const grantInvoiceResult = createGrantInvoiceFromRow(rowObj.rowData, rowObj.headers, mainInvoice);

        if (grantInvoiceResult && grantInvoiceResult.Invoice) {
          const grantInvoice = grantInvoiceResult.Invoice;

          // Write the grant invoice number to the corresponding column
          sheet.getRange(rowObj.originalRowIndex, grantInvoiceNoColIndex).setValue(grantInvoice.DocNumber);
          Logger.log(`Grant Invoice Created: DocNumber=${grantInvoice.DocNumber}`);
        } else {
          Logger.log(`Grant Invoice creation failed for Row ${rowObj.originalRowIndex}`);
        }

        statusMessage = `Success: Main Invoice Created (DocNumber: ${mainInvoice.DocNumber})`;
      }

      // Update the "Invoice Status" column
      sheet.getRange(rowObj.originalRowIndex, invoiceStatusColIndex).setValue(statusMessage);
    });
  });
}


/**
 * Groups row objects by their "Invoice No." column.
 * @param {Array<Object>} rowObjects - The array of row objects from getInvoiceSheetData.
 * @return {Object} - An object with keys = invoiceNo, values = arrays of row objects.
 */
function groupRowsByInvoiceNo(rowObjects) {
  const groups = {};
  if (!rowObjects.length) return groups;

  const headers = rowObjects[0].headers;
  const invoiceNoIndex = headers.indexOf("Invoice No.");
  if (invoiceNoIndex === -1) {
    throw new Error('Column "Invoice No." not found.');
  }

  rowObjects.forEach(obj => {
    const invoiceNo = obj.rowData[invoiceNoIndex];
    if (!groups[invoiceNo]) {
      groups[invoiceNo] = [];
    }
    groups[invoiceNo].push(obj);
  });
  return groups;
}
/**
 * Builds a single invoice payload from multiple row objects that share the same "Invoice No."
 * We reuse your existing buildInvoicePayloadFromRow(), but we combine line items from each row.
 */
function buildGroupedInvoicePayloadFromRows(rowGroup) {
  // 1) We'll pick the first row's data for top-level fields (invoice no, purchase order, etc.)
  const firstRowObj = rowGroup[0];
  const headers = firstRowObj.headers;
  const getVal = (colName, rowData = firstRowObj.rowData) => {
    const idx = headers.indexOf(colName);
    return (idx !== -1) ? rowData[idx] : "";
  };

  // 2) Check that all rows share the same TGS Code
  const tgsCodeIndex = headers.indexOf("TGS Course Code");
  const allTgsCodes = rowGroup.map(obj => obj.rowData[tgsCodeIndex]).filter(Boolean);
  const uniqueCodes = [...new Set(allTgsCodes)];
  if (uniqueCodes.length > 1) {
    // For simplicity, throw an error or log a warning
    throw new Error(`Grouped rows have different TGS Codes: ${uniqueCodes.join(", ")}`);
  }

  // 3) Basic top-level fields from the first row
  const invoiceNo = getVal("Invoice No.");
  const payBySFC = getVal("Pay by SFC");
  const sponsorshipType = getVal("Sponsorship Type *");
  const traineeEmail = getVal("Trainee Email");
  const employerName = getVal("Employer Name");
  const billingEmail = getVal("Billing Email");
  const terms = getVal("Terms");
  const purchaseOrderRaw = getVal("Purchase Order #");
  const salesTermRef = mapPaymentTerm(terms);
  let purchaseOrder = purchaseOrderRaw ? String(purchaseOrderRaw).replace(/^#/, "") : "";

  // 4) We also fetch the item from QBO by TGS code (shared by all rows)
  const tgsCode = uniqueCodes[0];
  let itemData = fetchItemFromSKU(tgsCode);
  if (!itemData) {
    itemData = { itemRefValue: "1230", itemRefName: "Default Course", unitPrice: 0 };
  }

  // 5) Build the participant list for the main line description
  let participantLines = [];
  rowGroup.forEach((obj, i) => {
    const name = getVal("Trainee Name (as on government ID)", obj.rowData);
    const nric = anonymizeNRIC(getVal("Trainee ID *", obj.rowData));
    participantLines.push(`${i+1}. ${name} (${nric})`);
  });

  // Also assume the course date & run from the first row
  const firstStartDate = getVal("Start Date & Time");
  const firstEndDate = getVal("End Date & Time");
  const courseRunId = getVal("Course Run ID");
  const eventTitle = getVal("Event Title");

  const mainDescription =
    `Course Name: ${eventTitle}\n` +
    `(${tgsCode})\n` +
    `Participant Name:\n${participantLines.join("\n")}\n` +
    `Course Date: ${buildCourseDateString(firstStartDate, firstEndDate)}\n` +
    `(Course Run ${courseRunId})`;

  // 6) Main line: Qty = number of rows
  const rowCount = rowGroup.length;
  const mainLine = {
    LineNum: 1,
    Description: mainDescription,
    Amount: itemData.unitPrice * rowCount,
    DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: {
      ItemRef: {
        value: itemData.itemRefValue,
        name: itemData.itemRefName
      },
      UnitPrice: itemData.unitPrice,
      Qty: rowCount,
      TaxCodeRef: { value: "45" }
    }
  };

  // 7) Consolidate Grants
  const grantMap = {};
  rowGroup.forEach((obj, idx) => {
    const g1 = {
      grantId: getVal("Grant ID 1", obj.rowData),
      code: getVal("Funding Scheme Code 1", obj.rowData),
      amt: getVal("Estimated Amount 1", obj.rowData)
    };
    const g2 = {
      grantId: getVal("Grant ID 2", obj.rowData),
      code: getVal("Funding Scheme Code 2", obj.rowData),
      amt: getVal("Estimated Amount 2", obj.rowData)
    };
    [g1,g2].forEach(g => {
      if (g.grantId && g.code && g.amt) {
        const { itemRefValue, itemRefName } = mapFundingItemRef(g.code);
        const key = itemRefValue; // group by itemRef
        if (!grantMap[key]) {
          grantMap[key] = {
            itemRefValue,
            itemRefName,
            count: 0,
            amtEach: Number(g.amt),
            grantIds: []
          };
        }
        grantMap[key].count += 1;
        grantMap[key].grantIds.push(g.grantId);
      }
    });
  });

  // 7b) Sort the itemRef keys so "687" (Baseline) is always first
  //     That way, lines for Baseline appear right after the main line.
  const sortedGrantKeys = Object.keys(grantMap).sort((a, b) => {
    // '687' is baseline
    if (a === '687' && b !== '687') return -1; // a first
    if (b === '687' && a !== '687') return 1;  // b first
    // fallback to ascending numeric
    return a.localeCompare(b);
  });

  // 7c) Build negative lines from this sorted data
  const grantLines = sortedGrantKeys.map((key, idx2) => {
    const data = grantMap[key];
    const negativeAmt = -1 * (data.amtEach * data.count);
    let references = data.grantIds.map((id, i) => `${i+1}. ${id}`).join("\n");
    const desc = `Less: WSQ funding (${data.itemRefName.replace('WSQ funding (','').replace(')','')})\nGrant Ref #;\n${references}`;

    return {
      LineNum: idx2 + 2, // e.g. 2,3,4...
      Description: desc,
      Amount: negativeAmt,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: {
          value: data.itemRefValue,
          name: data.itemRefName
        },
        UnitPrice: -(data.amtEach),
        Qty: data.count,
        TaxCodeRef: { value: "18" }
      }
    };
  });

  // 8) Tax detail: 9% on main line
  const mainTax = 0.09 * (itemData.unitPrice * rowCount);
  const txnTaxDetail = {
    TotalTax: mainTax,
    TaxLine: [
      {
        Amount: mainTax,
        DetailType: "TaxLineDetail",
        TaxLineDetail: {
          TaxRateRef: { value: "49" },
          PercentBased: true,
          TaxPercent: 9,
          NetAmountTaxable: itemData.unitPrice * rowCount
        }
      }
    ]
  };

  // 9) Evaluate netAmount & "Pay by SFC"
  const netAmount = (itemData.unitPrice * rowCount) + mainTax + grantLines.reduce((sum, ln) => sum + ln.Amount, 0);
  const sfcLine = payBySFC && payBySFC !== "NIL" && netAmount > 0 ? {
    LineNum: grantLines.length + 2 + 1,
    Description: `To Less SkillsFuture Credit: $${netAmount.toFixed(2)}`,
    DetailType: "DescriptionOnly"
  } : null;
  const customerMemo = payBySFC && payBySFC !== "NIL" && netAmount > 0
    ? { value: `Payment:\nSkillsFuture Credit Claimable Amount: $${netAmount.toFixed(2)}` }
    : null;

  // 10) Sponsorship logic
  let customerRef = { value: "1569" };
  let billAddr = null;
  if (sponsorshipType === "Employer" && employerName) {
    const employerCustomerId = lookupEmployerCustomerId(employerName);
    if (employerCustomerId) {
      customerRef = { value: employerCustomerId };
      Logger.log(`CustomerRef for grouped employer: ${JSON.stringify(customerRef)}`);
    }
  } else {
    billAddr = { Id: "22973", Line1: getVal("Trainee Name (as on government ID)") };
  }

  // Combine emails
  let emailAddresses = [];
  if (billingEmail) {
    emailAddresses.push(billingEmail); // Add billing email first if present
  }
  if (traineeEmail) {
    emailAddresses.push(traineeEmail); // Add trainee email(s) after
  }

  // 11) Final invoice object
  const invoiceObj = {
    AllowIPNPayment: false,
    AllowOnlinePayment: false,
    AllowOnlineCreditCardPayment: false,
    AllowOnlineACHPayment: false,
    CustomField: [
      {
        DefinitionId: "1",
        Name: "Purchase Order #",
        Type: "StringType",
        StringValue: purchaseOrder
      }
    ],
    DocNumber: invoiceNo,
    ...(billAddr ? { BillAddr: billAddr } : {}),
    CurrencyRef: { value: "SGD", name: "Singapore Dollar" },
    ExchangeRate: 1,
    ShipAddr: { Id: null, Line1: null },
    Line: [
      mainLine,
      ...grantLines,
      ...(sfcLine ? [sfcLine] : [])
    ],
    TxnTaxDetail: txnTaxDetail,
    CustomerRef: customerRef,
    ...(salesTermRef ? { SalesTermRef: { value: salesTermRef } } : {}),
    GlobalTaxCalculation: "TaxExcluded",
    PrintStatus: "NotSet",
    EmailStatus: "NotSet",
    BillEmail: { Address: emailAddresses.join(",") },
    ...(customerMemo ? { CustomerMemo: customerMemo } : {})
  };

  Logger.log(`Final grouped invoice (Invoice No: ${invoiceNo}) with ${rowCount} participants:\n${JSON.stringify(invoiceObj, null, 2)}`);
  return invoiceObj;
}

/**
 * Minimal helper for payment terms.
 * Reuses your existing paymentTermsMap logic.
 */
function mapPaymentTerm(termString) {
  const paymentTermsMap = {
    "120 Days Term": "6",
    "14 Days Term": "16",
    "15 Days Term": "9",
    "20 days SFC/WSQ": "10",
    "25 Days SFC": "12",
    "30 Days Term": "3",
    "35 Days Term": "13",
    "45 Days Term": "5",
    "60 Days Term": "7",
    "7 Days": "14",
    "COD": "15",
    "Due on receipt": "1"
  };
  return paymentTermsMap[termString] || null;
}

/**
 * Decide the itemRef for a funding scheme code (Baseline, MCES, ETSS, etc.).
 * Reuses your logic from buildGrantLineItem but returns { itemRefValue, itemRefName } only.
 */
function mapFundingItemRef(code) {
  const lower = code.toLowerCase();
  if (lower === 'baseline') {
    return { itemRefValue: '687', itemRefName: 'WSQ funding (Baseline)' };
  } else if (lower.includes('mces')) {
    return { itemRefValue: '686', itemRefName: 'WSQ funding (Mid-Career Enhanced Subsidy)' };
  } else if (lower.includes('etss')) {
    return { itemRefValue: '1440', itemRefName: 'WSQ funding (Enhanced Training Support for SMEs)' };
  } else {
    return { itemRefValue: '687', itemRefName: 'WSQ funding (Baseline)' };
  }
}

/** The rest of your code: lookupEmployerCustomerId, 
 *  sendInvoiceToQuickBooks, fetchItemFromSKU, anonymizeNRIC, 
 *  buildCourseDateString, buildGrantLineItem
 *  remain exactly the same as in your script, shown below:
 */

// The rest is unchanged...
function lookupEmployerCustomerId(employerName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const customerSheet = ss.getSheetByName("QB Customer");

  if (!customerSheet) {
    Logger.log("Error: 'QB Customer' sheet not found.");
    return null;
  }

  const dataRange = customerSheet.getDataRange();
  const data = dataRange.getValues(); // Retrieve all data from the sheet
  const headers = data[0]; // Assume the first row contains headers

  // Find column indexes for "Display Name" and "Customer ID"
  const displayNameIndex = headers.indexOf("Display Name");
  const customerIdIndex = headers.indexOf("Customer ID");

  if (displayNameIndex === -1 || customerIdIndex === -1) {
    Logger.log("Error: 'Display Name' or 'Customer ID' column not found in 'QB Customer' sheet.");
    return null;
  }

  // Search for the employer name in the "Display Name" column
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[displayNameIndex] === employerName) {
      Logger.log(`Found Customer ID '${row[customerIdIndex]}' for Employer Name '${employerName}'`);
      return row[customerIdIndex];
    }
  }

  Logger.log(`No Customer ID found for Employer Name '${employerName}'`);
  return null; // Return null if no match is found
}

function sendInvoiceToQuickBooks(payload) {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  // Replace with your actual company ID
  const CREATE_INVOICE_ENDPOINT = `/v3/company/${COMPANY_ID}/invoice?minorversion=75`; // to change to version 75 in anticipation of API reworks
  const url = BASE_URL + CREATE_INVOICE_ENDPOINT;

  const service = getService(); // your OAuth2 function
  if (!service.hasAccess()) {
    throw new Error("No OAuth access. Please reauthorize.");
  }

  try {

    Logger.log("Sending invoice payload:\n" + JSON.stringify(payload, null, 2));

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      headers: {
        Authorization: `Bearer ${service.getAccessToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const content = response.getContentText();
    const result = JSON.parse(content);

    if (statusCode >= 200 && statusCode < 300) {
      Logger.log("Invoice created successfully in QuickBooks!");
    } else {
      Logger.log(`Error creating invoice. Status: ${statusCode}\nBody: ${content}`);
    }
    return result;

  } catch (err) {
    Logger.log(`Exception in sendInvoiceToQuickBooks: ${err.message}`);
    return { error: err.message };
  }
}

function fetchItemFromSKU(tgsCode) {
  // const tgsCode = "xxxx";

  if (!tgsCode) {
    Logger.log("No TGS code provided.");
    return null;
  }
  
  // Define QuickBooks Query endpoint
  const baseUrl = "https://quickbooks.api.intuit.com";
  const companyId = "1292117680"; // Replace with your QuickBooks company ID
  const endpoint = `/v3/company/${companyId}/query`;
  const query = `SELECT * FROM Item WHERE SKU = '${tgsCode}'`;
  const url = `${baseUrl}${endpoint}?query=${encodeURIComponent(query)}&minorversion=75`;
  
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

function anonymizeNRIC(nric) {
  if (!nric) return "(XXXXX)";
  const last4 = nric.slice(-4);
  return "XXXXX" + last4;
}

function buildCourseDateString(startDateTime, endDateTime) {
  if (!startDateTime || !endDateTime) return "";
  
  const start = new Date(startDateTime);
  const end   = new Date(endDateTime);
  
  const daysOfWeek = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months     = ["Jan","Feb","Mar","Apr","May","Jun",
                      "Jul","Aug","Sep","Oct","Nov","Dec"];
  
  const startDay   = start.getDate();
  const startDOW   = daysOfWeek[start.getDay()];
  const startMonth = months[start.getMonth()];
  const startYear  = start.getFullYear();
  
  const endDay   = end.getDate();
  const endDOW   = daysOfWeek[end.getDay()];
  const endMonth = months[end.getMonth()];
  const endYear  = end.getFullYear();
  
  // Check if start and end are on the same day
  if (startYear === endYear && startMonth === endMonth && startDay === endDay) {
    return `${startDay} ${startMonth} ${startYear} (${startDOW})`;
  }
  
  // If the same month/year but different days
  if (startYear === endYear && startMonth === endMonth) {
    return `${startDay}-${endDay} ${startMonth} ${startYear} (${startDOW}/${endDOW})`;
  }
  
  // If different months within the same year
  if (startYear === endYear) {
    return `${startDay} ${startMonth} (${startDOW}) - ${endDay} ${endMonth} ${startYear} (${endDOW})`;
  }
  
  // If different years
  return `${startDay} ${startMonth} ${startYear} (${startDOW}) - ${endDay} ${endMonth} ${endYear} (${endDOW})`;
}

function buildGrantLineItem(grantIndex, grantId, fundingSchemeCode, estimatedAmount) {
  // If blank or zero, skip returning anything.
  if (!grantId || !fundingSchemeCode || !estimatedAmount) {
    return null;
  }

  // Decide the itemRef
  let itemRefValue = '';
  let itemRefName = '';
  if (fundingSchemeCode.toLowerCase() === 'baseline') {
    itemRefValue = '687';
    itemRefName  = 'WSQ funding (Baseline)';
  } 
  
  else if (fundingSchemeCode.toLowerCase().includes('mces')) {
    itemRefValue = '686';
    itemRefName  = 'WSQ funding (Mid-Career Enhanced Subsidy)';
  } 

  else if (fundingSchemeCode.toLowerCase().includes('etss')) {
    itemRefValue = '1440';
    itemRefName  = 'WSQ funding (Enhanced Training Support for SMEs)';
  }   
  
  else {
    // fallback if new code? 
    itemRefValue = '687'; 
    itemRefName  = 'WSQ funding (Baseline)';
  }

  const description = `Less: WSQ funding (${itemRefName.replace('WSQ funding (', '').replace(')', '')})\nGrant Ref #; ${grantId}`;

  // Convert to number in case it’s a string
  const negativeAmount = -1 * Number(estimatedAmount);

  return {
    // "Id": String(grantIndex), // only assign ID when updating a new row
    "LineNum": grantIndex,
    "Description": description,
    "Amount": negativeAmount,
    "DetailType": "SalesItemLineDetail",
    "SalesItemLineDetail": {
      "ItemRef": {
        "value": itemRefValue,
        "name": itemRefName
      },
      "UnitPrice": negativeAmount,
      "Qty": 1,
      "TaxCodeRef": {
        "value": "18"
      }
    }
  };
}

function buildGrantInvoiceLineItem(grantIndex, grantId, fundingSchemeCode, estimatedAmount) {
  // If blank or zero, skip returning anything.
  if (!grantId || !fundingSchemeCode || !estimatedAmount) {
    return null;
  }

  // Decide the itemRef
  let itemRefValue = '';
  let itemRefName = '';
  if (fundingSchemeCode.toLowerCase() === 'baseline') {
    itemRefValue = '687';
    itemRefName  = 'WSQ funding (Baseline)';
  } 
  
  else if (fundingSchemeCode.toLowerCase().includes('mces')) {
    itemRefValue = '686';
    itemRefName  = 'WSQ funding (Mid-Career Enhanced Subsidy)';
  } 

  else if (fundingSchemeCode.toLowerCase().includes('etss')) {
    itemRefValue = '1440';
    itemRefName  = 'WSQ funding (Enhanced Training Support for SMEs)';
  }   
  
  else {
    // fallback if new code? 
    itemRefValue = '687'; 
    itemRefName  = 'WSQ funding (Baseline)';
  }

  const description = `Less: WSQ funding (${itemRefName.replace('WSQ funding (', '').replace(')', '')})\nGrant Ref #; ${grantId}`;

  // Convert to number in case it’s a string
  const negativeAmount = 1 * Number(estimatedAmount);

  return {
    // "Id": String(grantIndex), // only assign ID when updating a new row
    "LineNum": grantIndex,
    "Description": description,
    "Amount": negativeAmount,
    "DetailType": "SalesItemLineDetail",
    "SalesItemLineDetail": {
      "ItemRef": {
        "value": itemRefValue,
        "name": itemRefName
      },
      "UnitPrice": negativeAmount,
      "Qty": 1,
      "TaxCodeRef": {
        "value": "18"
      }
    }
  };
}

function getInvoiceSheetData(sheet) {
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  if (!values.length) return [];

  // First row is headers
  const headers = values[0];
  const rows = values.slice(1); // data rows

  // Find the column index for "Ready to Invoice"
  const readyColIndex = headers.indexOf("Ready to Invoice");
  if (readyColIndex === -1) {
    throw new Error('Column "Ready to Invoice" not found.');
  }

  // Build objects for each row and filter by "Yes"
  const filteredRows = rows
    .map((rowArray, i) => {
      const readyValue = rowArray[readyColIndex];
      return {
        rowData: rowArray,           
        headers,                     
        originalRowIndex: i + 2,     // +2 because row 1 is headers, and array index is 0-based
        readyValue
      };
    })
    .filter(obj => {
      // Only rows with "Yes"
      return obj.readyValue && obj.readyValue.toString().trim().toLowerCase() === "yes";
    });

  Logger.log(`Number of rows ready to invoice: ${filteredRows.length}`);
  return filteredRows;
}

/**
 * Build an Invoice payload object (the JSON) given row data from the sheet.
 * The `headers` array lets us map each column by name.
 */
function buildInvoicePayloadFromRow(row, headers) {
  // Helper: getVal() finds the column index by name, returns the cell value
  const getVal = (colName) => {
    const idx = headers.indexOf(colName);
    return (idx !== -1) ? row[idx] : "";
  };

  // Payment Term Mapping
  const paymentTermsMap = {
    "120 Days Term": "6",
    "14 Days Term": "16",
    "15 Days Term": "9",
    "20 days SFC/WSQ": "10",
    "25 Days SFC": "12",
    "30 Days Term": "3",
    "35 Days Term": "13",
    "45 Days Term": "5",
    "60 Days Term": "7",
    "7 Days": "14",
    "COD": "15",
    "Due on receipt": "1"
  };

  // 1) Extract needed fields from the row
  const invoiceNo = getVal("Invoice No.");
  const terms = getVal("Terms");
  // const invoiceDateRaw = getVal("Invoice Date");
  const purchaseOrderRaw = getVal("Purchase Order #");
  const traineeName = getVal("Trainee Name (as on government ID)");
  const tgsCode = getVal("TGS Course Code");
  const sponsorshipType = getVal("Sponsorship Type *");
  const traineeEmail = getVal("Trainee Email");
  const startDateTime = getVal("Start Date & Time");
  const endDateTime = getVal("End Date & Time");
  const courseRunId = getVal("Course Run ID");
  const traineeID = getVal("Trainee ID *");
  const eventTitle = getVal("Event Title");
  const payBySFC = getVal("Pay by SFC");
  const employerName = getVal("Employer Name"); // Added for employer invoices
  const billingEmail = getVal("Billing Email");

  Logger.log(`Processing row: Employer Name from sheet: ${employerName}`);

  // Grants
  const grantId1 = getVal("Grant ID 1");
  const fundingSchemeCode1 = getVal("Funding Scheme Code 1");
  const estimatedAmt1 = getVal("Estimated Amount 1");
  const grantId2 = getVal("Grant ID 2");
  const fundingSchemeCode2 = getVal("Funding Scheme Code 2");
  const estimatedAmt2 = getVal("Estimated Amount 2");

  // 2) Pre-process some fields
  let purchaseOrder = purchaseOrderRaw ? String(purchaseOrderRaw).replace(/^#/, "") : "";
  // const invDateObj = (invoiceDateRaw instanceof Date) ? invoiceDateRaw : new Date(invoiceDateRaw);
  // const invoiceDate = `${invDateObj.getFullYear()}-${String(invDateObj.getMonth() + 1).padStart(2, "0")}-${String(invDateObj.getDate()).padStart(2, "0")}`;
  // const dueDate = calculateDueDate(invDateObj, terms);

  // Determine SalesTermRef based on Terms
  const salesTermRef = paymentTermsMap[terms] || null;
  if (!salesTermRef) {
    Logger.log(`Warning: No matching payment term ID found for term '${terms}'.`);
  } else {
    Logger.log(`Mapped payment term '${terms}' to ID '${salesTermRef}'.`);
  }

  // 3) Build the main line description
  const mainLineDescription = (
    `Course Name: ${eventTitle}\n` +
    `(${tgsCode})\n` +
    `Participant Name: ${traineeName}\n` +
    `NRIC: ${anonymizeNRIC(traineeID)}\n` +
    `Course Date: ${buildCourseDateString(startDateTime, endDateTime)}\n` +
    `Course Run: ${courseRunId}`
  );

  // 4) Fetch the item from QuickBooks by TGS Code
  let itemData = fetchItemFromSKU(tgsCode);

  // The main line's amount is typically UnitPrice * Qty
  const fullCourseAmt = itemData.unitPrice;

  // 5) Build the main line
  const mainLine = {
    LineNum: 1,
    Description: mainLineDescription,
    Amount: fullCourseAmt,
    DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: {
      ItemRef: {
        value: itemData.itemRefValue,
        name: itemData.itemRefName
      },
      UnitPrice: fullCourseAmt,
      Qty: 1,
      TaxCodeRef: { value: "45" }
    }
  };

  // 6) Build grant lines (negative amounts)
  const grantLines = [];
  const gl1 = buildGrantLineItem(2, grantId1, fundingSchemeCode1, estimatedAmt1);
  if (gl1) grantLines.push(gl1);
  const gl2 = buildGrantLineItem(grantLines.length + 2, grantId2, fundingSchemeCode2, estimatedAmt2);
  if (gl2) grantLines.push(gl2);

  // 7) Build tax detail if needed
  const taxOnLine1 = 0.09 * fullCourseAmt;
  const txnTaxDetail = {
    TotalTax: taxOnLine1,
    TaxLine: [
      {
        Amount: taxOnLine1,
        DetailType: "TaxLineDetail",
        TaxLineDetail: {
          TaxRateRef: { value: "49" },
          PercentBased: true,
          TaxPercent: 9,
          NetAmountTaxable: fullCourseAmt
        }
      }
    ]
  };

  // 8) Net amount calculation (after grants and tax)
  const netAmount = fullCourseAmt + taxOnLine1 + grantLines.reduce((sum, line) => sum + line.Amount, 0);

  // 9) Conditional line for "Pay by SFC"
  const sfcLine = payBySFC && payBySFC !== "NIL" && netAmount > 0 ? {
    LineNum: grantLines.length + 3,
    Description: `To Less SkillsFuture Credit: $${netAmount.toFixed(2)}`,
    DetailType: "DescriptionOnly"
  } : null;

  // Add CustomerMemo if applicable
  const customerMemo = payBySFC && payBySFC !== "NIL" && netAmount > 0 ? {
    value: `Payment:\nSkillsFuture Credit Claimable Amount: $${netAmount.toFixed(2)}`
  } : null;

  // 10) Handle sponsorship type
  let customerRef = { value: "1569" }; // Default for individual sponsorship
  let billAddr = null;

  if (sponsorshipType === "Employer" && employerName) {
    const employerCustomerId = lookupEmployerCustomerId(employerName); // Lookup Employer ID
    if (employerCustomerId) {
      customerRef = { value: employerCustomerId };
      Logger.log(`CustomerRef being added to payload for employer: ${JSON.stringify(customerRef)}`);
    } else {
      Logger.log(`No Customer ID found for Employer Name '${employerName}'`);
    }
  } else {
    billAddr = {
      Id: "22973",
      Line1: traineeName
    };
    Logger.log("Using default BillAddr for individual sponsorship.");
  }


  // Combine emails
  const emailAddresses = [traineeEmail];
  if (billingEmail) {
    emailAddresses.push(billingEmail);
  }

  // 11) Build final invoice object
  const invoiceObj = {
    AllowIPNPayment: false,
    AllowOnlinePayment: false,
    AllowOnlineCreditCardPayment: false,
    AllowOnlineACHPayment: false,
    CustomField: [
      {
        DefinitionId: "1",
        Name: "Purchase Order #",
        Type: "StringType",
        StringValue: purchaseOrder
      }
    ],
    DocNumber: invoiceNo,
    ...(billAddr ? { BillAddr: billAddr } : {}),
    // TxnDate: invoiceDate,
    CurrencyRef: { value: "SGD", name: "Singapore Dollar" },
    ExchangeRate: 1,
    ShipAddr: {
      Id: null,
      Line1: null
    },
    Line: [
      mainLine,
      ...grantLines,
      ...(sfcLine ? [sfcLine] : [])
    ],
    TxnTaxDetail: txnTaxDetail,
    CustomerRef: customerRef,
    ...(salesTermRef ? { SalesTermRef: { value: salesTermRef } } : {}),
    // DueDate: dueDate,
    GlobalTaxCalculation: "TaxExcluded",
    PrintStatus: "NotSet",
    EmailStatus: "NotSet",
    BillEmail: { Address: emailAddresses.join(",") },
    ...(customerMemo ? { CustomerMemo: customerMemo } : {})
  };

  Logger.log(`Final invoice payload: ${JSON.stringify(invoiceObj, null, 2)}`);

  // Return final payload
  return invoiceObj;
}

function createGrantInvoiceFromRow(rowData, headers, mainInvoice) {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const CREATE_INVOICE_ENDPOINT = "/v3/company/{company_id}/invoice";
  const COMPANY_ID = "1292117680";

  if (!mainInvoice) {
    Logger.log("Main invoice is required to create a grant invoice.");
    return null;
  }

  // Extract necessary fields from the row using headers
  const getVal = (colName) => {
    const idx = headers.indexOf(colName);
    return (idx !== -1) ? rowData[idx] : "";
  };

  const grantId1 = getVal("Grant ID 1");
  const grantId2 = getVal("Grant ID 2");
  const fundingSchemeCode1 = getVal("Funding Scheme Code 1");
  const fundingSchemeCode2 = getVal("Funding Scheme Code 2");
  const updatedCustomFields = updatePurchaseOrderNumber(
    mainInvoice.CustomField || [],
    mainInvoice.DocNumber
  );
  
  // Convert amounts to positive values
  const estimatedAmount1 = Math.abs(parseFloat(getVal("Estimated Amount 1")) || 0);
  const estimatedAmount2 = Math.abs(parseFloat(getVal("Estimated Amount 2")) || 0);

  // Use the smallest grant ID for the grant invoice number
  const grantId = grantId1 || grantId2;
  if (!grantId) {
    Logger.log("No grant ID found for the row. Skipping grant invoice creation.");
    return null;
  }

  // Build grant line items for the row
  const grantLines = [];
  const gl1 = buildGrantInvoiceLineItem(1, grantId1, fundingSchemeCode1, estimatedAmount1);
  if (gl1) grantLines.push(gl1);
  const gl2 = buildGrantInvoiceLineItem(2, grantId2, fundingSchemeCode2, estimatedAmount2);
  if (gl2) grantLines.push(gl2);

  // Calculate the invoice date and due date
  const parsedCourseDate = extractCourseDate(mainInvoice.Line); // Extract course date from main invoice
  const invoiceDate = parsedCourseDate || mainInvoice.TxnDate; // Use course date or fallback to TxnDate
  const dueDate = calculateDueDate(invoiceDate);

  // Construct the grant invoice payload
  const grantInvoice = {
    DocNumber: `${grantId}`, // Grant invoice number based on the smallest grant ID
    TxnDate: invoiceDate,
    DueDate: dueDate,
    CustomerRef: { value: "1405", name: "Singapore Workforce Development Agency (WSG)" },
    SalesTermRef: { value: "13" },
    GlobalTaxCalculation: "TaxExcluded",
    TxnTaxDetail: { TotalTax: 0 },
    PrintStatus: "NotSet",
    EmailStatus: "NotSet",
    BillEmail: { Address: "angch@tertiaryinfotech.com" },
    Line: grantLines, // Grant lines specific to this row
    CustomField: updatedCustomFields,
  };

  Logger.log(`Creating grant invoice for row:\n${JSON.stringify(grantInvoice, null, 2)}`);

  // Send the grant invoice to QuickBooks
  const url = `${BASE_URL}${CREATE_INVOICE_ENDPOINT.replace("{company_id}", COMPANY_ID)}`;
  const service = getService();

  if (service.hasAccess()) {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${service.getAccessToken()}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        payload: JSON.stringify(grantInvoice),
        muteHttpExceptions: true,
      });

      const result = JSON.parse(response.getContentText());
      if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
        Logger.log("Grant Invoice Created Successfully");
        return result; // Return the response object
      } else {
        Logger.log(`Error creating grant invoice: ${response.getContentText()}`);
        return null;
      }
    } catch (error) {
      Logger.log(`Exception creating grant invoice: ${error.message}`);
      return null;
    }
  } else {
    Logger.log("Access token is not available. Please reauthorize the app.");
    return null;
  }
}



