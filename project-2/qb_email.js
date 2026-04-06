const DEFAULT_CC_EMAILS = [
  "lakshaya@tertiaryinfotech.com",
  "leepeng@tertiaryinfotech.com",
  "kongweng@tertiaryinfotech.com",
  "tansc@tertiaryinfotech.com",
  "sylvia@tertiaryinfotech.com"
].join(",");

/*************************************************************
 * 1) Main Function to Process & Send Invoice Emails         *
 *************************************************************/
function processInvoiceEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Invoice Creation");
  if (!sheet) {
    Logger.log(`Sheet "Invoice Creation" not found.`);
    return;
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  if (values.length < 2) {
    Logger.log("No data rows found.");
    return;
  }

  const headers = values[0];
  const rows = values.slice(1);

  // Identify column indexes by name
  const readyToEmailIdx    = headers.indexOf("Ready to Email");
  const emailTypeIdx       = headers.indexOf("Email Type");
  const invoiceNoIdx       = headers.indexOf("Invoice No.");
  const emailStatusIdx     = headers.indexOf("Email Status"); // to log results
  const recipientEmailIdx  = headers.indexOf("Billing Email"); // optional
  const courseCodeIDx = headers.indexOf("TGS Course Code");

  if (readyToEmailIdx < 0 || emailTypeIdx < 0 || invoiceNoIdx < 0) {
    Logger.log("Required columns not found. Must have 'Ready to Email','Email Type','Invoice No.'");
    return;
  }

  rows.forEach((row, i) => {
    const rowIndex = i + 2; // account for headers
    const readyVal = row[readyToEmailIdx];
    const emailType = row[emailTypeIdx];         // e.g. "Not Grant","Yes Grant","SFC","SFC Claim"
    const docNumber = row[invoiceNoIdx];         // QBO docNumber
    const sheetRecipient = (recipientEmailIdx >= 0) ? row[recipientEmailIdx] : "";
    const courseCode = row[courseCodeIDx];

    // Check "Ready to Email" == "Yes"
    if (!readyVal || readyVal.toString().trim().toLowerCase() !== "yes") {
      return;  // skip
    }
    // Must have docNumber & emailType
    if (!docNumber || !emailType) {
      Logger.log(`Row ${rowIndex}: Missing DocNumber or EmailType; skipping.`);
      return;
    }

    // 1) Fetch the invoice from QBO
    const invoiceData = fetchInvoiceByDocNumber(docNumber);
    if (!invoiceData) {
      Logger.log(`Row ${rowIndex}: Could not retrieve invoice for DocNumber=${docNumber}`);
      return;
    }

    // 2) Build email subject/body from your text-based type
    const { subject, body } = buildEmailTemplateTextBased(invoiceData, emailType, courseCode);

    // 3) Determine final "to" and "cc" addresses
    let toAddress = "";
    let ccAddress = "";
    if (sheetRecipient) {
      // Use the one from the sheet
      toAddress = sheetRecipient;
    } else {
      // Fallback to BillEmail in QBO
      const billEmailStr = invoiceData.BillEmail?.Address || "";
      if (!billEmailStr) {
        Logger.log(`Row ${rowIndex}: No BillEmail found in invoice or sheet. Cannot send email.`);
        return;
      }
      // If multiple addresses separated by commas, first is "to", rest is "cc"
      const parts = billEmailStr.split(",").map(s => s.trim()).filter(Boolean);
      if (parts.length === 0) {
        Logger.log(`Row ${rowIndex}: BillEmail is empty after splitting. Skipping.`);
        return;
      }
      toAddress = parts[0];
      if (parts.length > 1) {
        ccAddress = parts.slice(1).join(",");
      }
    }

    // 4) Send invoice PDF
    const sendResult = sendInvoicePdfCustom(docNumber, toAddress, subject, body, ccAddress);

    // 5) Update "Email Status" column
    if (emailStatusIdx >= 0) {
      let statusMsg = sendResult.success
        ? `Successful! Email draft to be sent to ${toAddress}${ccAddress ? " cc: " + ccAddress : ""}`
        : `Error sending email: ${sendResult.error || ""}`;
      sheet.getRange(rowIndex, emailStatusIdx + 1).setValue(statusMsg);
    }
  });
}

/*************************************************************
 * 2) Fetch Invoice Data by DocNumber from QBO
 *************************************************************/
function fetchInvoiceByDocNumber(docNumber) {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const INVOICES_ENDPOINT = "/v3/company/{company_id}/query";
  const COMPANY_ID = "1292117680";

  const url = BASE_URL + INVOICES_ENDPOINT.replace("{company_id}", COMPANY_ID);
  const service = getService();  // Your OAuth2 function
  if (!service.hasAccess()) {
    Logger.log("Access token is not available. Reauthorize the app.");
    return null;
  }

  try {
    const query = `SELECT * FROM Invoice WHERE DocNumber = '${docNumber}'`;
    const response = UrlFetchApp.fetch(`${url}?query=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${service.getAccessToken()}`,
        Accept: "application/json"
      }
    });
    const result = JSON.parse(response.getContentText());
    const invoices = result.QueryResponse.Invoice;
    if (!invoices || !invoices.length) {
      Logger.log(`No invoice found for DocNumber=${docNumber}`);
      return null;
    }
    return invoices[0];
  } catch (err) {
    Logger.log(`Error fetching invoice: ${err.message}`);
    return null;
  }
}

/*************************************************************
 * 3) Build the Email Subject/Body from 4 text-based types   *
 *************************************************************/
function buildEmailTemplateTextBased(invoiceData, emailType, courseCode) {
  const docNumber   = invoiceData.DocNumber || "(UnknownDoc)";
  const totalAmount = invoiceData.TotalAmt   || 0;

  // 1) Event Title from line[0].SalesItemLineDetail.ItemRef.name
  let eventTitle = "(No Title)";
  let courseDate = "(No Date)";
  if (invoiceData.Line && invoiceData.Line.length > 0) {
    // Check itemRef name
    eventTitle = invoiceData.Line[0].SalesItemLineDetail?.ItemRef?.name || eventTitle;
    // Attempt to parse course date from line[0].Description
    const desc = invoiceData.Line[0].Description || "";
    courseDate = parseCourseDateFromLineDescription(desc);
  }

  let subject = "";
  let body = "";

  // Force emailType lowercased to match your text-based approach
  const et = emailType.toString().trim().toLowerCase();

  // 3 conditions
  // 1. If no grants at all use full payment template
  // 2. if have grants, use yes grant template
  // 3. if pay by SFC =/= NIL, use SFC template

  switch (et) {
    case "individual - full payment": // full payment
      subject = `Invoice ${docNumber}: ${eventTitle}, ${courseDate}`;
      body =
        `<p>Dear Sir/Madam,</p>
        <p>Attached is <strong>Invoice ${docNumber}</strong>, for payment of the nett fee of <strong>$${totalAmount}</strong>.</p>
        <p>Payment may be made by one of the following methods:</p>
        <ol>
          <li>PayNow to UEN: <strong>201200696W</strong>
            <em>(Please indicate your name and/or invoice numbers as a reference when making the PayNow payment.)</em></li>
          <li>Bank: DBS Singapore (SWIFT: <strong>DBSS SGSG</strong>)<br>
            <ul>
              <li>Account Type: <strong>Current Account</strong></li>
              <li>Account Name: <strong>Tertiary Infotech Academy Pte. Ltd.</strong></li>
              <li>Account Number: <strong>066-902050-3</strong></li>
            </ul>
          </li>
        </ol>
        <p>Thanks!</p>
        <p>Best Regards,<br>Tertiary Courses SG Team</p>
        <p>Please email us the screenshot of your payment details, for our finance team to check the payment status.</p>`;
      break;

    case "individual - grant": // grant
      subject = `Invoice ${docNumber}: ${eventTitle}, ${courseDate}`;
      body =
        `<p>Dear Sir/Madam,</p>
        <p>We have applied for the training grant on your behalf. Attached is <strong>Invoice ${docNumber}</strong>, 
        for the nett fee of <strong>$${totalAmount}</strong> after deducting the grant subsidy, for payment.</p>
        <p>Payment may be made by one of the following methods:</p>
        <ol>
          <li>PayNow to UEN: <strong>201200696W</strong>
            <em>(Please indicate your name and/or invoice numbers as a reference when making the PayNow payment.)</em>
          <li>Bank: DBS Singapore (SWIFT: <strong>DBSS SGSG</strong>)<br>
            <ul></li>
              <li>Account Type: <strong>Current Account</strong></li>
              <li>Account Name: <strong>Tertiary Infotech Academy Pte. Ltd.</strong></li>
              <li>Account Number: <strong>066-902050-3</strong></li>
            </ul>
          </li>
        </ol>
        <p>Please email us the screenshot of your payment details for our finance team to check the status.</p>
        <p>Thanks!</p>
        <p>Best Regards,<br>Tertiary Courses SG Team</p>`;
      break;

    case "individual - sfc":
      subject = `Invoice ${docNumber}: ${eventTitle}, ${courseDate}`;
      body =
        `<p>Dear Sir/Madam,</p>
        <p>We have applied for the training grant on your behalf. Attached is <strong>Invoice ${docNumber}</strong>, 
        for the nett fee of <strong>$${totalAmount}</strong> after deducting the grant subsidy, 
        for payment using SkillsFuture Credit (SFC).</p>
        <p>Please upload this invoice as your supporting document for your SFC claim submission.<br>
        Link to claim SFC: <a href="https://www.myskillsfuture.gov.sg/">https://www.myskillsfuture.gov.sg/</a></p>
        <p>Course Name: ${eventTitle}</p>
        <p>Course Code: ${courseCode}</p>
        <p>Course Run Date: ${courseDate}</p>
        <p>Total Course Fee on Invoice: <strong>$${totalAmount}</strong></p>
        <p>Amount Of Credit To Claim: $${totalAmount}</p>
        <p><em>(Note that The $4,000 Additional SFC (Mid-Career Support) cannot be used for this course.)</em></p>
        <p>Please email us your screenshot of your claim ID.</p>
        <p><strong>(No Additional payment is required if you are paying using SkillsFuture Credit)</strong></p>
        <p>Thanks!</p>
        <p>Best Regards,<br>Tertiary Courses SG Team</p>`;
      break;

    case "employer - e invoice":
      subject = `Invoice ${docNumber}: ${eventTitle}, ${courseDate}`;
      body =
        `<p>Dear Sir/Madam,</p>
        <p>We have applied for the training grant on behalf of the sponsoring employer. Attached is <strong>Invoice ${docNumber}</strong> 
        for the nett fee of <strong>$${totalAmount}</strong> after deducting the grant subsidy, for payment.</p>
        <p>We will submit this e-invoice via <strong>Vendors@Gov</strong> after course completion.</p>
        <p>Please let us know if the invoice is not in order.</p>
        <p>Thanks!</p>
        <p>Best Regards,<br>Tertiary Courses SG Team</p>`;
      break;

    case "employer - grant":
      subject = `Invoice ${docNumber}: ${eventTitle}, ${courseDate}`;
      body =
        `<p>Dear Sir/Madam,</p>
        <p>We have applied for the training grant on behalf of the sponsoring employer. Attached is <strong>Invoice ${docNumber}</strong>, 
        for the nett fee of <strong>$${totalAmount}</strong> after deducting the grant subsidy, for payment.</p>
        <p>Payment may be made by one of the following methods:</p>
        <ol>
          <li>PayNow to UEN: <strong>201200696W</strong><br>
            <em>(Please indicate your name and/or invoice numbers as a reference when making the PayNow payment.)</em>
          </li>
          <li>Bank: DBS Singapore (SWIFT: <strong>DBSS SGSG</strong>)<br>
            <ul>
              <li>Account Type: <strong>Current Account</strong></li>
              <li>Account Name: <strong>Tertiary Infotech Academy Pte. Ltd.</strong></li>
              <li>Account Number: <strong>066-902050-3</strong></li>
            </ul>
          </li>
        </ol>
        <p>Please let us know once payment has been made for our finance team to check the status.</p>
        <p>Thanks!</p>
        <p>Best Regards,<br>Tertiary Courses SG Team</p>`;
      break;

    case "psea":
      subject = `Invoice ${docNumber}: ${eventTitle}, ${courseDate}`;
      body =
        `<p>Dear Sir/Madam,</p>
        <p>We have applied for the training grant on your behalf. Attached is <strong>Invoice ${docNumber}</strong>, 
        for the nett fee of <strong>$${totalAmount}</strong> after deducting the grant subsidy, for payment using your PSEA.</p>
        <p>Please refer to the screenshot below, it shows ${eventTitle} is eligible for PSEA.</p>
        <p>You are required  to fill in PSEA Adhoc Application FormSG with your personal SingPass Account, to notify MOE PSEA of your PSEA withdrawal request.  MOE PSEA team will then notify training providers of the application status via email, about 2 weeks after trainee's submission, depending when the form is submitted.</p>
        <p>Hence, please submit the PSEA Adhoc Application FormSG as soon as possible.  If we do not receive MOE PSEA notification of your PSEA Withdrawal application before commencement of the class, you will have to pay the nett fee by PayNow, PayNow to UEN: <strong>201200696W.</strong></p>
        <p><strong>PSEA Withdrawal Instructions</strong></p>
        <p>Please log into PSEA Adhoc Application FormSG with your personal SingPass Account, to notify MOE PSEA of your PSEA withdrawal request, via this link, http://go.gov.sg/psea-withdrawal-tps</p>
        <p><strong>Instruction to filling form:</strong></p>
        <p><strong>Part 1</strong></p>
        <p>Institution Name: Tertiary Infotech Pte. Ltd.<br>
        Course/Fee Description: ${eventTitle}<br>
        Course Code:  ${courseCode}<br>
        Usage category: SSG-PDEV<br>
        Course/Fee Amount: $${totalAmount}<br>
        </p>
        <p><strong>Part 2</strong></p>
        <p>
        - Please remember to Click on the checkbox to give authorization.</p>
        <p>
        - Provide your email address & contact, if you are using your personal PSEA account
        </p>
        <p>Please submit your PSEA withdrawal request form, http://go.gov.sg/psea-withdrawal-tps, as soon as possible and <strong>email us the screenshot of your PSEA withdrawal submission ID.</strong>  Thank you.
        Please be reminded that if we do not receive MOE PSEA notification of your PSEA Withdrawal application before commencement of the class, you will have to pay the nett fee by PayNow.
        </p>
        <p>Thanks!</p>
        <p>Best Regards,<br>Tertiary Courses SG Team</p>`;
      break;            


    default:
      subject = `Invoice ${docNumber}`;
      body =
        `<p>Dear Sir/Madam,</p>
        <p>Here is your invoice <strong>${docNumber}</strong>.</p>
        <p>Best Regards,<br>Tertiary Courses SG Team</p>`;
      break;
  }

  return { subject, body };
  // TODO: Add in general contact email and phone number for enquiries to the email templates
}

/**************************************************************
 * 4) Helper to parse "Course Date: ..." from line description*
 *************************************************************/
function parseCourseDateFromLineDescription(desc) {
  const dateLabel = "Course Date:";
  let idx = desc.indexOf(dateLabel);
  if (idx === -1) return "(No Date Found)";

  // start after "Course Date:"
  let startPos = idx + dateLabel.length;

  // from there, find either "\n" or "(Course Run"
  let end1 = desc.indexOf("\n", startPos);
  if (end1 === -1) end1 = desc.length;

  let end2 = desc.indexOf("(Course Run", startPos);
  if (end2 === -1) end2 = desc.length;

  let endPos = Math.min(end1, end2);
  let raw = desc.substring(startPos, endPos).trim();
  if (!raw) return "(No Date Found)";
  return raw;
}

/*************************************************************
 * 5) Save Invoice Email as Draft w/ Custom Subject/Body, plus optional CC
 *************************************************************/
function saveInvoiceAsDraft(docNumber, toEmail, subject, htmlBody, ccEmails, pdfBlob) {
  try {
    // Combine default CC emails with provided CC emails
    const finalCcEmails = ccEmails ? `${ccEmails},${DEFAULT_CC_EMAILS}` : DEFAULT_CC_EMAILS;

    // Create a draft with HTML content
    const draft = GmailApp.createDraft(
      toEmail,
      subject,
      "", // Plain text body (optional; leave empty if only sending HTML)
      {
        htmlBody: htmlBody, // Use the formatted HTML body
        attachments: [pdfBlob],
        cc: finalCcEmails // Add combined CC addresses
      }
    );
    Logger.log(`Draft created for DocNumber ${docNumber}: ${draft.getId()}`);
    return { success: true, draftId: draft.getId() };
  } catch (err) {
    Logger.log(`Error saving email as draft: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/*************************************************************
 * Updated: Send Invoice PDF w/ Custom Subject/Body as Draft
 *************************************************************/
function sendInvoicePdfCustom(docNumber, toEmail, subject, body, ccEmails) {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const PDF_ENDPOINT = "/v3/company/{company_id}/invoice/{invoice_id}/pdf";
  const COMPANY_ID = "1292117680";

  const service = getService();
  if (!service.hasAccess()) {
    Logger.log("No OAuth access. Reauthorize the app.");
    return { success: false, error: "No OAuth access" };
  }

  // 1) Query the invoice to get its ID
  const invoiceObj = fetchInvoiceByDocNumber(docNumber);
  if (!invoiceObj) {
    return { success: false, error: `No invoice found with DocNumber=${docNumber}` };
  }
  const invoiceId = invoiceObj.Id;

  // 2) Get PDF
  const pdfUrl = `${BASE_URL}${PDF_ENDPOINT.replace("{company_id}", COMPANY_ID).replace("{invoice_id}", invoiceId)}`;
  try {
    const pdfResponse = UrlFetchApp.fetch(pdfUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${service.getAccessToken()}`,
        Accept: "application/pdf"
      }
    });
    if (pdfResponse.getResponseCode() !== 200) {
      Logger.log(`Failed to fetch PDF for Invoice ID: ${invoiceId}`);
      return { success: false, error: "Could not fetch PDF." };
    }
    const pdfBlob = pdfResponse.getBlob().setName(`Invoice-${docNumber}.pdf`);

    // Combine CC emails with the default CC list
    const finalCcEmails = ccEmails ? `${ccEmails},${DEFAULT_CC_EMAILS}` : DEFAULT_CC_EMAILS;

    // Save email as a draft instead of sending it
    return saveInvoiceAsDraft(docNumber, toEmail, subject, body, finalCcEmails, pdfBlob);

  } catch (err) {
    Logger.log(`Error fetching or saving PDF as draft: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/*************************************************************
 * 6) (Optional) Original minimal send function
 *************************************************************/
function sendInvoicePdfByDocNumber(docNumber, recipientEmail) {
  const BASE_URL = "https://quickbooks.api.intuit.com";
  const QUERY_ENDPOINT = "/v3/company/{company_id}/query";
  const PDF_ENDPOINT   = "/v3/company/{company_id}/invoice/{invoice_id}/pdf";
  const COMPANY_ID     = "1292117680";

  const service = getService();
  if (!service.hasAccess()) {
    Logger.log("Access token is not available. Reauthorize the app.");
    return;
  }

  try {
    // Step 1: Query the invoice by DocNumber
    const queryUrl = `${BASE_URL}${QUERY_ENDPOINT.replace("{company_id}", COMPANY_ID)}`;
    const query    = `SELECT * FROM Invoice WHERE DocNumber = '${docNumber}'`;
    const queryResponse = UrlFetchApp.fetch(`${queryUrl}?query=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${service.getAccessToken()}`,
        Accept: "application/json"
      }
    });

    const queryResult = JSON.parse(queryResponse.getContentText());
    const invoices = queryResult.QueryResponse.Invoice;
    if (!invoices || invoices.length === 0) {
      Logger.log(`No invoice found with DocNumber: ${docNumber}`);
      return;
    }
    const invoiceId = invoices[0].Id;
    Logger.log(`Invoice ID for DocNumber ${docNumber}: ${invoiceId}`);

    // Step 2: Fetch the invoice PDF
    const pdfUrl = `${BASE_URL}${PDF_ENDPOINT.replace("{company_id}", COMPANY_ID).replace("{invoice_id}", invoiceId)}`;
    const pdfResponse = UrlFetchApp.fetch(pdfUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${service.getAccessToken()}`,
        Accept: "application/pdf"
      }
    });
    if (pdfResponse.getResponseCode() !== 200) {
      Logger.log(`Failed to fetch PDF for Invoice ID: ${invoiceId}`);
      return;
    }

    // Get the PDF as a blob
    const pdfBlob = pdfResponse.getBlob().setName(`Invoice-${docNumber}.pdf`);

    // Step 3: Send the PDF via email
    const subject = `The Invoice ${docNumber}`;
    const body = `Dear recipient,\n\nPlease find attached the invoice PDF for your reference.\n\nBest regards,\nYour Company`;

    GmailApp.sendEmail(recipientEmail, subject, body, { attachments: [pdfBlob] });
    Logger.log(`Invoice PDF for DocNumber ${docNumber} sent to ${recipientEmail}.`);
  } catch (error) {
    Logger.log(`Error fetching or sending the invoice PDF: ${error.message}`);
  }
}

/**
 * Test function to manually send a single invoice email.
 * Specify the DocNumber, EmailType ("Not Grant","Yes Grant","SFC","SFC Claim"), 
 * and a custom email recipient. The script will fetch the invoice details,
 * build the subject/body, and send the PDF as an attachment.
 */
function testSendInvoiceEmailManually() {
  // 1) Define your test parameters
  const docNumber   = "TC25-0117-09";        // Example DocNumber in QBO
  const emailType   = "PSEA";         // e.g. "individual - full payment, individual - grant, individual - sfc, employer - e invoice, employer - grant"
  const recipient   = "leepeng@tertiaryinfotech.com"; // Replace with your email to test

  // 2) Fetch the invoice from QBO
  const invoiceData = fetchInvoiceByDocNumber(docNumber);
  if (!invoiceData) {
    Logger.log(`Could not find invoice for docNumber = ${docNumber}.`);
    return;
  }

  // 3) Build the email subject and body from your text-based template
  const { subject, body } = buildEmailTemplateTextBased(invoiceData, emailType);

  // 4) If you'd like to CC addresses found in BillEmail, you can parse them:
  //    e.g. let ccAddress = "";
  //    if invoiceData.BillEmail?.Address has multiple addresses, parse them and choose which to CC.
  //    For now, we'll omit CC logic or set ccAddress = "" to skip.
  const ccAddress = "";

  // 5) Send the invoice PDF using the custom subject & body
  const sendResult = sendInvoicePdfCustom(docNumber, recipient, subject, body, ccAddress);

  // 6) Log the outcome
  if (sendResult.success) {
    Logger.log(`Successfully saved as draft: DocNumber=${docNumber} to ${recipient}.`);
  } else {
    Logger.log(`Error emailing DocNumber=${docNumber}: ${sendResult.error}`);
  }
}

/*
Additional Emails to add in to be CC-ed:
leepeng@tertiaryinfotech.com
kongweng@tertiaryinfotech.com
tansc@tertiaryinfotech.com
 */

