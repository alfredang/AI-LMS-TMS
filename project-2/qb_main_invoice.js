// /**
//  * Main function to process invoices.
//  */
// /**
//  * Main function to process invoices.
//  */
// function processInvoices() {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const sheet = ss.getSheetByName('Invoice Creation');

//   // Get rows that are "Ready to Invoice" = "Yes"
//   const rowsToInvoice = getInvoiceSheetData(sheet);
//   if (!rowsToInvoice.length) {
//     Logger.log("No rows found with 'Ready to Invoice' = 'Yes'.");
//     return;
//   }

//   // Find the index of the "Invoice Status" column
//   const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
//   const invoiceStatusColIndex = headers.indexOf("Invoice Status") + 1; // Convert to 1-based index

//   if (invoiceStatusColIndex === 0) {
//     throw new Error('Column "Invoice Status" not found.');
//   }

//   // Loop over each row and create the invoice in QuickBooks
//   rowsToInvoice.forEach(rowObj => {
//     const payload = buildInvoicePayloadFromRow(rowObj.rowData, rowObj.headers);

//     // Post the invoice to QuickBooks
//     const result = sendInvoiceToQuickBooks(payload);

//     // Log and update the "Invoice Status" column
//     let statusMessage = "";

//     if (result.error) {
//       // Handle API errors or exceptions
//       statusMessage = `Error: ${result.error}`;
//       Logger.log(`Error for Row ${rowObj.originalRowIndex}: ${statusMessage}`);
//     } else if (result.Fault) {
//       // Handle QuickBooks API errors
//       const faultDetails = result.Fault.Error.map(err => `${err.Message} (${err.Detail})`).join("; ");
//       statusMessage = `Error: ${faultDetails}`;
//       Logger.log(`Fault for Row ${rowObj.originalRowIndex}: ${statusMessage}`);
//     } else {
//       // Successful response
//       const statusCode = result.status || "200";
//       statusMessage = `Success: Invoice Created (Status: ${statusCode})`;
//       Logger.log(`Success for Row ${rowObj.originalRowIndex}: ${statusMessage}`);
//     }

//     // Write the status message into the "Invoice Status" column
//     sheet.getRange(rowObj.originalRowIndex, invoiceStatusColIndex).setValue(statusMessage);
//   });
// }

// /**
//  * Retrieves and structures data from the "Invoice Creation" sheet,
//  * filtering rows where column "Ready to Invoice" is "Yes".
//  *
//  * @param {Sheet} sheet - The Google Sheets sheet object.
//  * @return {Array<Object>} Array of objects with {rowData, headers, originalRowIndex}.
//  */
// function getInvoiceSheetData(sheet) {
//   const dataRange = sheet.getDataRange();
//   const values = dataRange.getValues();
//   if (!values.length) return [];

//   // First row is headers
//   const headers = values[0];
//   const rows = values.slice(1); // data rows

//   // Find the column index for "Ready to Invoice"
//   const readyColIndex = headers.indexOf("Ready to Invoice");
//   if (readyColIndex === -1) {
//     throw new Error('Column "Ready to Invoice" not found.');
//   }

//   // Build objects for each row and filter by "Yes"
//   const filteredRows = rows
//     .map((rowArray, i) => {
//       const readyValue = rowArray[readyColIndex];
//       return {
//         rowData: rowArray,           
//         headers,                     
//         originalRowIndex: i + 2,     // +2 because row 1 is headers, and array index is 0-based
//         readyValue
//       };
//     })
//     .filter(obj => {
//       // Only rows with "Yes"
//       return obj.readyValue && obj.readyValue.toString().trim().toLowerCase() === "yes";
//     });

//   Logger.log(`Number of rows ready to invoice: ${filteredRows.length}`);
//   return filteredRows;
// }

// /**
//  * Build an Invoice payload object (the JSON) given row data from the sheet.
//  * The `headers` array lets us map each column by name.
//  */
// function buildInvoicePayloadFromRow(row, headers) {
//   // Helper: getVal() finds the column index by name, returns the cell value
//   const getVal = (colName) => {
//     const idx = headers.indexOf(colName);
//     return (idx !== -1) ? row[idx] : "";
//   };

//   // Payment Term Mapping
//   const paymentTermsMap = {
//     "120 Days Term": "6",
//     "14 Days Term": "16",
//     "15 Days Term": "9",
//     "20 days SFC/WSQ": "10",
//     "25 Days SFC": "12",
//     "30 Days Term": "3",
//     "35 Days Term": "13",
//     "45 Days Term": "5",
//     "60 Days Term": "7",
//     "7 Days": "14",
//     "COD": "15",
//     "Due on receipt": "1"
//   };

//   // 1) Extract needed fields from the row
//   const invoiceNo = getVal("Invoice No.");
//   const terms = getVal("Terms");
//   // const invoiceDateRaw = getVal("Invoice Date");
//   const purchaseOrderRaw = getVal("Purchase Order #");
//   const traineeName = getVal("Trainee Name (as on government ID)");
//   const tgsCode = getVal("TGS Course Code");
//   const sponsorshipType = getVal("Sponsorship Type *");
//   const traineeEmail = getVal("Trainee Email");
//   const startDateTime = getVal("Start Date & Time");
//   const endDateTime = getVal("End Date & Time");
//   const courseRunId = getVal("Course Run ID");
//   const traineeID = getVal("Trainee ID *");
//   const eventTitle = getVal("Event Title");
//   const payBySFC = getVal("Pay by SFC");
//   const employerName = getVal("Employer Name"); // Added for employer invoices
//   const billingEmail = getVal("Billing Email");

//   Logger.log(`Processing row: Employer Name from sheet: ${employerName}`);

//   // Grants
//   const grantId1 = getVal("Grant ID 1");
//   const fundingSchemeCode1 = getVal("Funding Scheme Code 1");
//   const estimatedAmt1 = getVal("Estimated Amount 1");
//   const grantId2 = getVal("Grant ID 2");
//   const fundingSchemeCode2 = getVal("Funding Scheme Code 2");
//   const estimatedAmt2 = getVal("Estimated Amount 2");

//   // 2) Pre-process some fields
//   let purchaseOrder = purchaseOrderRaw ? String(purchaseOrderRaw).replace(/^#/, "") : "";
//   // const invDateObj = (invoiceDateRaw instanceof Date) ? invoiceDateRaw : new Date(invoiceDateRaw);
//   // const invoiceDate = `${invDateObj.getFullYear()}-${String(invDateObj.getMonth() + 1).padStart(2, "0")}-${String(invDateObj.getDate()).padStart(2, "0")}`;
//   // const dueDate = calculateDueDate(invDateObj, terms);

//   // Determine SalesTermRef based on Terms
//   const salesTermRef = paymentTermsMap[terms] || null;
//   if (!salesTermRef) {
//     Logger.log(`Warning: No matching payment term ID found for term '${terms}'.`);
//   } else {
//     Logger.log(`Mapped payment term '${terms}' to ID '${salesTermRef}'.`);
//   }

//   // 3) Build the main line description
//   const mainLineDescription = (
//     `${eventTitle}\n` +
//     `(${tgsCode})\n` +
//     `Participant Name: ${traineeName}\n` +
//     `NRIC: ${anonymizeNRIC(traineeID)}\n` +
//     `Course Date: ${buildCourseDateString(startDateTime, endDateTime)}\n` +
//     `Course Run: ${courseRunId}`
//   );

//   // 4) Fetch the item from QuickBooks by TGS Code
//   let itemData = fetchItemFromSKU(tgsCode);

//   // The main line's amount is typically UnitPrice * Qty
//   const fullCourseAmt = itemData.unitPrice;

//   // 5) Build the main line
//   const mainLine = {
//     LineNum: 1,
//     Description: mainLineDescription,
//     Amount: fullCourseAmt,
//     DetailType: "SalesItemLineDetail",
//     SalesItemLineDetail: {
//       ItemRef: {
//         value: itemData.itemRefValue,
//         name: itemData.itemRefName
//       },
//       UnitPrice: fullCourseAmt,
//       Qty: 1,
//       TaxCodeRef: { value: "45" }
//     }
//   };

//   // 6) Build grant lines (negative amounts)
//   const grantLines = [];
//   const gl1 = buildGrantLineItem(2, grantId1, fundingSchemeCode1, estimatedAmt1);
//   if (gl1) grantLines.push(gl1);
//   const gl2 = buildGrantLineItem(grantLines.length + 2, grantId2, fundingSchemeCode2, estimatedAmt2);
//   if (gl2) grantLines.push(gl2);

//   // 7) Build tax detail if needed
//   const taxOnLine1 = 0.09 * fullCourseAmt;
//   const txnTaxDetail = {
//     TotalTax: taxOnLine1,
//     TaxLine: [
//       {
//         Amount: taxOnLine1,
//         DetailType: "TaxLineDetail",
//         TaxLineDetail: {
//           TaxRateRef: { value: "49" },
//           PercentBased: true,
//           TaxPercent: 9,
//           NetAmountTaxable: fullCourseAmt
//         }
//       }
//     ]
//   };

//   // 8) Net amount calculation (after grants and tax)
//   const netAmount = fullCourseAmt + taxOnLine1 + grantLines.reduce((sum, line) => sum + line.Amount, 0);

//   // 9) Conditional line for "Pay by SFC"
//   const sfcLine = payBySFC && payBySFC !== "NIL" && netAmount > 0 ? {
//     LineNum: grantLines.length + 3,
//     Description: `To Less SkillsFuture Credit: $${netAmount.toFixed(2)}`,
//     DetailType: "DescriptionOnly"
//   } : null;

//   // Add CustomerMemo if applicable
//   const customerMemo = payBySFC && payBySFC !== "NIL" && netAmount > 0 ? {
//     value: `Payment:\nSkillsFuture Credit Claimable Amount: $${netAmount.toFixed(2)}`
//   } : null;

//   // 10) Handle sponsorship type
//   let customerRef = { value: "1569" }; // Default for individual sponsorship
//   let billAddr = null;

//   if (sponsorshipType === "Employer" && employerName) {
//     const employerCustomerId = lookupEmployerCustomerId(employerName); // Lookup Employer ID
//     if (employerCustomerId) {
//       customerRef = { value: employerCustomerId };
//       Logger.log(`CustomerRef being added to payload for employer: ${JSON.stringify(customerRef)}`);
//     } else {
//       Logger.log(`No Customer ID found for Employer Name '${employerName}'`);
//     }
//   } else {
//     billAddr = {
//       Id: "22973",
//       Line1: traineeName
//     };
//     Logger.log("Using default BillAddr for individual sponsorship.");
//   }


//   // Combine emails
//   const emailAddresses = [traineeEmail];
//   if (billingEmail) {
//     emailAddresses.push(billingEmail);
//   }

//   // 11) Build final invoice object
//   const invoiceObj = {
//     AllowIPNPayment: false,
//     AllowOnlinePayment: false,
//     AllowOnlineCreditCardPayment: false,
//     AllowOnlineACHPayment: false,
//     CustomField: [
//       {
//         DefinitionId: "1",
//         Name: "Purchase Order #",
//         Type: "StringType",
//         StringValue: purchaseOrder
//       }
//     ],
//     DocNumber: invoiceNo,
//     ...(billAddr ? { BillAddr: billAddr } : {}),
//     // TxnDate: invoiceDate,
//     CurrencyRef: { value: "SGD", name: "Singapore Dollar" },
//     ExchangeRate: 1,
//     ShipAddr: {
//       Id: null,
//       Line1: null
//     },
//     Line: [
//       mainLine,
//       ...grantLines,
//       ...(sfcLine ? [sfcLine] : [])
//     ],
//     TxnTaxDetail: txnTaxDetail,
//     CustomerRef: customerRef,
//     ...(salesTermRef ? { SalesTermRef: { value: salesTermRef } } : {}),
//     // DueDate: dueDate,
//     GlobalTaxCalculation: "TaxExcluded",
//     PrintStatus: "NotSet",
//     EmailStatus: "NotSet",
//     BillEmail: { Address: emailAddresses.join(",") },
//     ...(customerMemo ? { CustomerMemo: customerMemo } : {})
//   };

//   Logger.log(`Final invoice payload: ${JSON.stringify(invoiceObj, null, 2)}`);

//   // Return final payload
//   return invoiceObj;
// }


// /**
//  * Looks up the employer's customer ID from the "QB Customer" sheet.
//  * @param {string} employerName - The name of the employer to look up.
//  * @returns {string|null} - The corresponding Customer ID if found, or null if not found.
//  */
// function lookupEmployerCustomerId(employerName) {
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const customerSheet = ss.getSheetByName("QB Customer");

//   if (!customerSheet) {
//     Logger.log("Error: 'QB Customer' sheet not found.");
//     return null;
//   }

//   const dataRange = customerSheet.getDataRange();
//   const data = dataRange.getValues(); // Retrieve all data from the sheet
//   const headers = data[0]; // Assume the first row contains headers

//   // Find column indexes for "Display Name" and "Customer ID"
//   const displayNameIndex = headers.indexOf("Display Name");
//   const customerIdIndex = headers.indexOf("Customer ID");

//   if (displayNameIndex === -1 || customerIdIndex === -1) {
//     Logger.log("Error: 'Display Name' or 'Customer ID' column not found in 'QB Customer' sheet.");
//     return null;
//   }

//   // Search for the employer name in the "Display Name" column
//   for (let i = 1; i < data.length; i++) {
//     const row = data[i];
//     if (row[displayNameIndex] === employerName) {
//       Logger.log(`Found Customer ID '${row[customerIdIndex]}' for Employer Name '${employerName}'`);
//       return row[customerIdIndex];
//     }
//   }

//   Logger.log(`No Customer ID found for Employer Name '${employerName}'`);
//   return null; // Return null if no match is found
// }




// /**
//  * Sends the invoice payload to QuickBooks.
//  * Returns the JSON response from QuickBooks.
//  */
// function sendInvoiceToQuickBooks(payload) {
//   const BASE_URL = "https://quickbooks.api.intuit.com";
//   // Replace with your actual company ID
//   const CREATE_INVOICE_ENDPOINT = `/v3/company/${COMPANY_ID}/invoice?minorversion=65`;
//   const url = BASE_URL + CREATE_INVOICE_ENDPOINT;

//   const service = getService(); // your OAuth2 function
//   if (!service.hasAccess()) {
//     throw new Error("No OAuth access. Please reauthorize.");
//   }

//   try {

//     Logger.log("Sending invoice payload:\n" + JSON.stringify(payload, null, 2));

//     const response = UrlFetchApp.fetch(url, {
//       method: "post",
//       headers: {
//         Authorization: `Bearer ${service.getAccessToken()}`,
//         Accept: "application/json",
//         "Content-Type": "application/json"
//       },
//       payload: JSON.stringify(payload),
//       muteHttpExceptions: true
//     });

//     const statusCode = response.getResponseCode();
//     const content = response.getContentText();
//     const result = JSON.parse(content);

//     if (statusCode >= 200 && statusCode < 300) {
//       Logger.log("Invoice created successfully in QuickBooks!");
//     } else {
//       Logger.log(`Error creating invoice. Status: ${statusCode}\nBody: ${content}`);
//     }
//     return result;

//   } catch (err) {
//     Logger.log(`Exception in sendInvoiceToQuickBooks: ${err.message}`);
//     return { error: err.message };
//   }
// }

// function fetchItemFromSKU(tgsCode) {
//   // const tgsCode = "xxxx";

//   if (!tgsCode) {
//     Logger.log("No TGS code provided.");
//     return null;
//   }
  
//   // Define QuickBooks Query endpoint
//   const baseUrl = "https://quickbooks.api.intuit.com";
//   const companyId = "1292117680"; // Replace with your QuickBooks company ID
//   const endpoint = `/v3/company/${companyId}/query`;
//   const query = `SELECT * FROM Item WHERE SKU = '${tgsCode}'`;
//   const url = `${baseUrl}${endpoint}?query=${encodeURIComponent(query)}&minorversion=65`;
  
//   Logger.log(`Constructed URL: ${url}`);

//   const service = getService(); // your OAuth2 function
//   if (!service.hasAccess()) {
//     Logger.log("No OAuth access. Please reauthorize.");
//     return null;
//   }

//   try {
//     Logger.log("Sending request to QuickBooks...");
//     const response = UrlFetchApp.fetch(url, {
//       method: "GET",
//       headers: {
//         Authorization: `Bearer ${service.getAccessToken()}`,
//         Accept: "application/json"
//       },
//       muteHttpExceptions: true
//     });
    
//     Logger.log(`Response status: ${response.getResponseCode()}`);
//     Logger.log(`Response body: ${response.getContentText()}`);
    
//     const result = JSON.parse(response.getContentText());
    
//     if (response.getResponseCode() !== 200) {
//       Logger.log("Error fetching item. Response body: " + response.getContentText());
//       return null;
//     }
    
//     if (!result.QueryResponse || !result.QueryResponse.Item || result.QueryResponse.Item.length === 0) {
//       Logger.log("No items found for the provided SKU.");
//       return null;
//     }
    
//     // Assume the first match
//     const qbItem = result.QueryResponse.Item[0];
//     Logger.log("First matched item: " + JSON.stringify(qbItem, null, 2));
    
//     return {
//       itemRefValue: qbItem.Id,
//       itemRefName: qbItem.Name,
//       unitPrice: qbItem.UnitPrice || 0
//     };
    
//   } catch (err) {
//     Logger.log("Exception in fetchItemFromSKU: " + err.message);
//     return null;
//   }
// }

// function anonymizeNRIC(nric) {
//   if (!nric) return "(XXXXX)";
//   const last4 = nric.slice(-4);
//   return "XXXXX" + last4;
// }

// function buildCourseDateString(startDateTime, endDateTime) {
//   if (!startDateTime || !endDateTime) return "";
  
//   const start = new Date(startDateTime);
//   const end   = new Date(endDateTime);
  
//   // Build arrays to help format day-of-week, month names, etc.
//   const daysOfWeek = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
//   const months     = ["Jan","Feb","Mar","Apr","May","Jun",
//                       "Jul","Aug","Sep","Oct","Nov","Dec"];
  
//   // Basic date/time info
//   const startDay   = start.getDate();
//   const startDOW   = daysOfWeek[start.getDay()];
//   const startMonth = months[start.getMonth()];
//   const startYear  = start.getFullYear();
  
//   const endDay   = end.getDate();
//   const endDOW   = daysOfWeek[end.getDay()];
//   const endMonth = months[end.getMonth()];
//   const endYear  = end.getFullYear();
  
//   // Check if start/end are the same day
//   if (startYear === endYear && startMonth === endMonth && startDay === endDay) {
//     // Single-day
//     return `${startDay} ${startMonth} ${startYear} (${startDOW})`;
//   }
  
//   // If same month/year but different days, show "11/12 Jan 2025 (Sat/Sun)"
//   if (startYear === endYear && startMonth === endMonth) {
//     // 2-day range, e.g. "11/12 Jan 2025 (Sat/Sun)" 
//     // but could be 3 days if there's more than 1 day difference
//     const dayDiff = endDay - startDay;
//     if (dayDiff === 1) {
//       // exactly 2 days
//       return `${startDay}/${endDay} ${startMonth} ${startYear} (${startDOW}/${endDOW})`;
//     } else {
//       // more than 2 days in the same month
//       return `${startDay}-${endDay} ${startMonth} ${startYear} (${startDOW}/${endDOW})`;
//     }
//   }
  
//   // Different months or years => "11-13 Jan 2025 (Sat/Mon)"
//   // Adjust as needed if you want to show the second month if it's truly different (e.g. Jan/Feb).
//   // For simplicity, we'll still do "11-${endDay} ${startMonth} ${startYear}" if year is same.
//   if (startYear === endYear) {
//     return `${startDay}-${endDay} ${startMonth} ${startYear} (${startDOW}/${endDOW})`;
//   }
  
//   // If the year is different, you might do something like:
//   return `${startDay} ${startMonth} ${startYear} (${startDOW}) - ${endDay} ${endMonth} ${endYear} (${endDOW})`;
// }

// function buildGrantLineItem(grantIndex, grantId, fundingSchemeCode, estimatedAmount) {
//   // If blank or zero, skip returning anything.
//   if (!grantId || !fundingSchemeCode || !estimatedAmount) {
//     return null;
//   }

//   // Decide the itemRef
//   let itemRefValue = '';
//   let itemRefName = '';
//   if (fundingSchemeCode.toLowerCase() === 'baseline') {
//     itemRefValue = '687';
//     itemRefName  = 'WSQ funding (Baseline)';
//   } 
  
//   else if (fundingSchemeCode.toLowerCase().includes('mces')) {
//     itemRefValue = '686';
//     itemRefName  = 'WSQ funding (Mid-Career Enhanced Subsidy)';
//   } 

//   else if (fundingSchemeCode.toLowerCase().includes('etss')) {
//     itemRefValue = '1440';
//     itemRefName  = 'WSQ funding (Enhanced Training Support for SMEs)';
//   }   
  
//   else {
//     // fallback if new code? 
//     itemRefValue = '687'; 
//     itemRefName  = 'WSQ funding (Baseline)';
//   }

//   const description = `Less: WSQ funding (${itemRefName.replace('WSQ funding (', '').replace(')', '')})\nGrant Ref #; ${grantId}`;

//   // Convert to number in case it’s a string
//   const negativeAmount = -1 * Number(estimatedAmount);

//   return {
//     // "Id": String(grantIndex), // only assign ID when updating a new row
//     "LineNum": grantIndex,
//     "Description": description,
//     "Amount": negativeAmount,
//     "DetailType": "SalesItemLineDetail",
//     "SalesItemLineDetail": {
//       "ItemRef": {
//         "value": itemRefValue,
//         "name": itemRefName
//       },
//       "UnitPrice": negativeAmount,
//       "Qty": 1,
//       "TaxCodeRef": {
//         "value": "18"
//       }
//     }
//   };
// }
