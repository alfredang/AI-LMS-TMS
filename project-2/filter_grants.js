/**
 * Doesn't Seems Like It Is Used By The Admin
 * Activated Upon "View Unpaid Grants" Button,
 * Using "Check Unpaid Grants" Sheet In FMS
 */
function filterConcludedGrants() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName("Concluded Data");
  const outputSheetName = "Check Unpaid Grants";

  // Check or create the output sheet
  let outputSheet = ss.getSheetByName(outputSheetName);
  if (!outputSheet) {
    outputSheet = ss.insertSheet(outputSheetName);
  } else {
    outputSheet.clearContents(); // Clear existing content
  }

  // Define headers to display in the filtered sheet
  const outputHeaders = [
    "Grant ID", "Enrolment ID", "Trainee Name", "Sponsorship Type", "Employer",
    "Scheme", "Funding Component", "Estimated Grant Amount", "Paid Grant Amount", 
    "Status", "Course Run", "Course (TGS)", "Course Titlte", "Start Date", "End Date"
  ];

  // Write headers starting from column D
  outputSheet.getRange(1, 4, 1, outputHeaders.length).setValues([outputHeaders]);

  // Retrieve all data from source sheet
  const data = sourceSheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  // Map columns to indexes
  const indexMap = {
    enrolmentId: headers.indexOf("Enrolment ID"),
    traineeName: headers.indexOf("Trainee Name (as on government ID)"),
    sponsorshipType: headers.indexOf("Sponsorship Type *"),
    employer: headers.indexOf("Employer UEN (mandatory if sponsorship type = employer)"),
    scheme1: headers.indexOf("Funding Scheme Description 1"),
    scheme2: headers.indexOf("Funding Scheme Description 2"),
    fundingComponent1: headers.indexOf("Funding Component Description 1"),
    fundingComponent2: headers.indexOf("Funding Component Description 2"),
    estimatedGrant1: headers.indexOf("Estimated Amount 1"),
    estimatedGrant2: headers.indexOf("Estimated Amount 2"),
    paidGrant1: headers.indexOf("Paid Amount 1"),
    paidGrant2: headers.indexOf("Paid Amount 2"),
    grantStatus1: headers.indexOf("Grant ID 1 Status"),
    grantStatus2: headers.indexOf("Grant Status 2"),
    grantId1: headers.indexOf("Grant ID 1"),
    grantId2: headers.indexOf("Grant ID 2"),
    courseRun: headers.indexOf("Course Run ID"),
    courseTGS: headers.indexOf("TGS Course Code"),
    courseTitle: headers.indexOf("Event Title"),
    startDate: headers.indexOf("Start Date & Time"),
    endDate: headers.indexOf("End Date & Time"),
  };

  const cutOffDate = new Date();
  cutOffDate.setDate(cutOffDate.getDate() - 14); // Current date - 14 days

  const filteredData = [];

  // Process rows based on criteria
  rows.forEach((row) => {
    const endDate = new Date(row[indexMap.endDate]);
    const isConcluded = row[headers.indexOf("Event Status")] === "Concluded";

    if (isConcluded && endDate <= cutOffDate) {
      // Check Grant 1 conditions
      if (row[indexMap.grantStatus1] === "Grant Processing" && row[indexMap.paidGrant1] === "N/A") {
        filteredData.push([
          row[indexMap.grantId1],
          row[indexMap.enrolmentId],
          row[indexMap.traineeName],
          row[indexMap.sponsorshipType],
          row[indexMap.employer],
          row[indexMap.scheme1],
          row[indexMap.fundingComponent1],
          row[indexMap.estimatedGrant1],
          row[indexMap.paidGrant1],
          row[indexMap.grantStatus1],
          row[indexMap.courseRun],
          row[indexMap.courseTGS],
          row[indexMap.courseTitle],
          row[indexMap.startDate],
          row[indexMap.endDate],
        ]);
      }
      // Check Grant 2 conditions
      if (row[indexMap.grantStatus2] === "Grant Processing" && row[indexMap.paidGrant2] === "N/A") {
        filteredData.push([
          row[indexMap.grantId2],
          row[indexMap.enrolmentId],
          row[indexMap.traineeName],
          row[indexMap.sponsorshipType],
          row[indexMap.employer],
          row[indexMap.scheme2],
          row[indexMap.fundingComponent2],
          row[indexMap.estimatedGrant2],
          row[indexMap.paidGrant2],
          row[indexMap.grantStatus2],
          row[indexMap.courseRun],
          row[indexMap.courseTGS],
          row[indexMap.courseTitle],
          row[indexMap.startDate],
          row[indexMap.endDate],
        ]);
      }
    }
  });

  // Write filtered data starting from row 2, column D
  if (filteredData.length > 0) {
    outputSheet.getRange(2, 4, filteredData.length, outputHeaders.length).setValues(filteredData);
  } else {
    outputSheet.getRange(2, 4).setValue("No matching records found");
  }

  // SpreadsheetApp.getUi().alert("Filtered grant data has been written to the 'Filtered Grants' sheet.");
}