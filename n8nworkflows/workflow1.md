{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        -176,
        592
      ],
      "id": "78d65570-71d2-4440-b48f-ebb23fa96532",
      "name": "When clicking ‘Execute workflow’"
    },
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "triggerAtHour": 2
            }
          ]
        }
      },
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.3,
      "position": [
        -176,
        784
      ],
      "id": "5c7bdf63-1827-44f2-8d1d-f5424fbba1ad",
      "name": "Schedule Trigger"
    },
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "40923ee9-2c5e-4417-921e-d7b098355124",
        "responseMode": "lastNode",
        "options": {}
      },
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [
        -176,
        432
      ],
      "id": "99b65196-4925-48cc-8f1b-9a1053856dee",
      "name": "Webhook",
      "webhookId": "40923ee9-2c5e-4417-921e-d7b098355124"
    },
    {
      "parameters": {
        "documentId": {
          "__rl": true,
          "value": "14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k",
          "mode": "list",
          "cachedResultName": "Tertiary Infotech Finance Management System (FMS)",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?usp=drivesdk"
        },
        "sheetName": {
          "__rl": true,
          "value": 964641380,
          "mode": "list",
          "cachedResultName": "All Course Runs",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit#gid=964641380"
        },
        "options": {}
      },
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4.7,
      "position": [
        160,
        624
      ],
      "id": "c382a6c4-d7e0-4354-919b-c7b7579d2ead",
      "name": "Get All Course Run(s) Data",
      "executeOnce": true,
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "j47Jb3rHdAbNhh4d",
          "name": "Google Sheets OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "documentId": {
          "__rl": true,
          "value": "14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k",
          "mode": "list",
          "cachedResultName": "Tertiary Infotech Finance Management System (FMS)",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?usp=drivesdk"
        },
        "sheetName": {
          "__rl": true,
          "value": 1598735005,
          "mode": "list",
          "cachedResultName": "SFC Stagnant Report",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit#gid=1598735005"
        },
        "options": {
          "outputFormatting": {
            "values": {
              "general": "UNFORMATTED_VALUE",
              "date": "FORMATTED_STRING"
            }
          }
        }
      },
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4.7,
      "position": [
        640,
        624
      ],
      "id": "2476011a-3aad-4054-8b93-021158d4b1e4",
      "name": "Check And Append For All Course Run(s) (Confirmed)",
      "executeOnce": true,
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "j47Jb3rHdAbNhh4d",
          "name": "Google Sheets OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "f701e85e-31f8-4ff6-bc78-3daa8d280094",
              "name": "Individual NRIC",
              "value": "={{ $json[\"Individual NRIC\"] }}",
              "type": "string"
            },
            {
              "id": "35d204ab-dfee-43be-8e5f-798b314e0bc1",
              "name": "Individual Name",
              "value": "={{ $json[\"Individual Name\"] }}",
              "type": "string"
            },
            {
              "id": "77055cf4-a1a3-458d-9114-e40b60cb089c",
              "name": "Course Reference Number",
              "value": "={{ $json[\"Course Reference Number\"] }}",
              "type": "string"
            },
            {
              "id": "160536b1-a17c-4671-9dcc-d2b16ac04c73",
              "name": "Course Name",
              "value": "={{ $json[\"Course Name\"] }}",
              "type": "string"
            },
            {
              "id": "60396e63-7993-46a9-a921-7218d8a7f1f0",
              "name": "Course Start Date",
              "value": "={{\n  (() => {\n    const d = $json[\"Course Start Date\"];\n    if (!d) return \"\";\n\n    const [month, day, year] = d.split(\"/\");\n    return `${year}-${month}-${day}`;\n  })()\n}}",
              "type": "string"
            },
            {
              "id": "c1d54b64-41f5-4bd4-8b66-783e9f71d137",
              "name": "Claim Id",
              "value": "={{ $json[\"Claim Id\"] }}",
              "type": "number"
            },
            {
              "id": "07c08044-0f17-4a45-92de-5014456d0dd5",
              "name": "Claim Amount",
              "value": "={{ Number($json[\"Claim Amount\"]) }}",
              "type": "number"
            },
            {
              "id": "4cacb4d6-e7cd-4d49-bee1-869c2b32feb6",
              "name": "Disbursement Date",
              "value": "={{\n  (() => {\n    const d = $json[\"Disbursement Date\"];\n    if (!d) return \"\";\n\n    // Already ISO\n    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(d)) return d;\n\n    const parts = d.split(\"/\");\n    if (parts.length !== 3) return \"\";\n\n    let [a, b, year] = parts.map(p => p.trim());\n\n    let day, month;\n\n    // If first part > 12 → DD/MM/YYYY\n    if (parseInt(a, 10) > 12) {\n      day = a;\n      month = b;\n    } \n    // If second part > 12 → MM/DD/YYYY\n    else if (parseInt(b, 10) > 12) {\n      month = a;\n      day = b;\n    } \n    // Fallback (assume MM/DD/YYYY)\n    else {\n      month = a;\n      day = b;\n    }\n\n    return `${year}-${month.padStart(2, \"0\")}-${day.padStart(2, \"0\")}`;\n  })()\n}}",
              "type": "string"
            },
            {
              "id": "3ebc7b5f-c508-439f-bb3b-439847313101",
              "name": "Payout Request ID",
              "value": "={{ $json[\"Payout Request ID\"] }}",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        848,
        624
      ],
      "id": "db530ef7-7c06-497f-ba80-164d4b41404f",
      "name": "Get Claim Relevant Information"
    },
    {
      "parameters": {
        "operation": "update",
        "documentId": {
          "__rl": true,
          "value": "14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k",
          "mode": "list",
          "cachedResultName": "Tertiary Infotech Finance Management System (FMS)",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?usp=drivesdk"
        },
        "sheetName": {
          "__rl": true,
          "value": 964641380,
          "mode": "list",
          "cachedResultName": "All Course Runs",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit#gid=964641380"
        },
        "columns": {
          "mappingMode": "defineBelow",
          "value": {
            "Enrolment ID": "={{ $json[\"Enrolment ID\"] }}",
            "SFC Claim ID": "={{ $json[\"Claim Id\"] }}",
            "SFC Amount": "={{ \"=\" + $json[\"Claim Amount\"] }}",
            "SFC Payment Date": "={{ $json[\"Disbursement Date\"] }}",
            "SFC Payout Request ID": "={{ $json[\"Payout Request ID\"] }}",
            "SFC Payment Status": "Paid"
          },
          "matchingColumns": [
            "Enrolment ID"
          ],
          "schema": [
            {
              "id": "Course Run",
              "displayName": "Course Run",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Course Code",
              "displayName": "Course Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Course Title",
              "displayName": "Course Title",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Start Date",
              "displayName": "Start Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "End Date",
              "displayName": "End Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Trainee",
              "displayName": "Trainee",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Trainee Email",
              "displayName": "Trainee Email",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Trainee Contact",
              "displayName": "Trainee Contact",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Trainee ID",
              "displayName": "Trainee ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Trainee DOB",
              "displayName": "Trainee DOB",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Sponsorship Type",
              "displayName": "Sponsorship Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "UEN of Employer",
              "displayName": "UEN of Employer",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Employer Name",
              "displayName": "Employer Name",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Employer Phone Country Code",
              "displayName": "Employer Phone Country Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Employer Phone",
              "displayName": "Employer Phone",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Employer Contact Name",
              "displayName": "Employer Contact Name",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Employer Contact Email",
              "displayName": "Employer Contact Email",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Company Address",
              "displayName": "Company Address",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Enrolement Status",
              "displayName": "Enrolement Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Enrolment Response",
              "displayName": "Enrolment Response",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Enrolment ID",
              "displayName": "Enrolment ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": false
            },
            {
              "id": "Grant Appl Date",
              "displayName": "Grant Appl Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Grant Status (BL)",
              "displayName": "Grant Status (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Grant ID (BL)",
              "displayName": "Grant ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Amount (BL)",
              "displayName": "Amount (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Grant Status (MCES/SME/IBF)",
              "displayName": "Grant Status (MCES/SME/IBF)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Grant ID (MCES/SME)",
              "displayName": "Grant ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Funding Scheme Code",
              "displayName": "Funding Scheme Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Amount (MCES/SME)",
              "displayName": "Amount (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Total TG Amount",
              "displayName": "Total TG Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "TG Payment Status",
              "displayName": "TG Payment Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "SFC Claim ID",
              "displayName": "SFC Claim ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "SFC Amount",
              "displayName": "SFC Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "SFC Payment Date",
              "displayName": "SFC Payment Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "SFC Payout Request ID",
              "displayName": "SFC Payout Request ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "SFC Application ID",
              "displayName": "SFC Application ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "SFC Payment Status",
              "displayName": "SFC Payment Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "QB SFC Invoice Num",
              "displayName": "QB SFC Invoice Num",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "QB SFC Invoice Amount",
              "displayName": "QB SFC Invoice Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "QB SFC Status",
              "displayName": "QB SFC Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "TG Payment Date",
              "displayName": "TG Payment Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Financial Transaction ID (BL)",
              "displayName": "Financial Transaction ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Financial Transaction ID (MCES/SME)",
              "displayName": "Financial Transaction ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Attendance",
              "displayName": "Attendance",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Assessment",
              "displayName": "Assessment",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Fee Collection Update Status",
              "displayName": "Fee Collection Update Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Assessment ID",
              "displayName": "Assessment ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Assessment ID Date",
              "displayName": "Assessment ID Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Skill Code",
              "displayName": "Skill Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Assessment Update",
              "displayName": "Assessment Update",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "QB Invoice # (Net Fee)",
              "displayName": "QB Invoice # (Net Fee)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "QB Net Fee Amount",
              "displayName": "QB Net Fee Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Payment Type",
              "displayName": "Payment Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "QB Net Fee Status",
              "displayName": "QB Net Fee Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "QB Invoice # (Grant)",
              "displayName": "QB Invoice # (Grant)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "QB TG Status",
              "displayName": "QB TG Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Bank Reference ID (BL)",
              "displayName": "Bank Reference ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Course Fees",
              "displayName": "Course Fees",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Bank Reference ID (MCES/SME)",
              "displayName": "Bank Reference ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Course Type",
              "displayName": "Course Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Unique Course Run ID",
              "displayName": "Unique Course Run ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Invoice No.",
              "displayName": "Invoice No.",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Pay by SFC",
              "displayName": "Pay by SFC",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Terms",
              "displayName": "Terms",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Payable Fees",
              "displayName": "Payable Fees",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Invoice Creation",
              "displayName": "Invoice Creation",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Column 65",
              "displayName": "Column 65",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Column 66",
              "displayName": "Column 66",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Column 67",
              "displayName": "Column 67",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "row_number",
              "displayName": "row_number",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "number",
              "canBeUsedToMatch": true,
              "readOnly": true,
              "removed": true
            }
          ],
          "attemptToConvertTypes": false,
          "convertFieldsToString": false
        },
        "options": {}
      },
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4.7,
      "position": [
        1552,
        416
      ],
      "id": "585e2cd8-4cdb-47dd-9451-76a711e3d015",
      "name": "Update Claim ID In All Course Run",
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "j47Jb3rHdAbNhh4d",
          "name": "Google Sheets OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 3
          },
          "conditions": [
            {
              "id": "68805b8c-55f9-4f00-b5c5-5e69b37f2385",
              "leftValue": "={{ $json[\"Enrolment ID\"] }}",
              "rightValue": "",
              "operator": {
                "type": "string",
                "operation": "notEmpty",
                "singleValue": true
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [
        1296,
        448
      ],
      "id": "bd9316a6-4c46-4638-971f-197b21e99661",
      "name": "If Enrolment ID Exists"
    },
    {
      "parameters": {
        "mode": "combine",
        "advanced": true,
        "mergeByFields": {
          "values": [
            {
              "field1": "Individual NRIC",
              "field2": "Trainee ID"
            },
            {
              "field1": "Course Reference Number",
              "field2": "Course Code"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.merge",
      "typeVersion": 3.2,
      "position": [
        1072,
        432
      ],
      "id": "7b2aafd0-14fe-4c0c-8e75-fd357b1f2c83",
      "name": "Merge"
    }
  ],
  "connections": {
    "When clicking ‘Execute workflow’": {
      "main": [
        [
          {
            "node": "Get All Course Run(s) Data",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Schedule Trigger": {
      "main": [
        [
          {
            "node": "Get All Course Run(s) Data",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Webhook": {
      "main": [
        [
          {
            "node": "Get All Course Run(s) Data",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Get All Course Run(s) Data": {
      "main": [
        [
          {
            "node": "Check And Append For All Course Run(s) (Confirmed)",
            "type": "main",
            "index": 0
          },
          {
            "node": "Merge",
            "type": "main",
            "index": 1
          }
        ]
      ]
    },
    "Check And Append For All Course Run(s) (Confirmed)": {
      "main": [
        [
          {
            "node": "Get Claim Relevant Information",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Get Claim Relevant Information": {
      "main": [
        [
          {
            "node": "Merge",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Update Claim ID In All Course Run": {
      "main": [
        []
      ]
    },
    "If Enrolment ID Exists": {
      "main": [
        [
          {
            "node": "Update Claim ID In All Course Run",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Merge": {
      "main": [
        [
          {
            "node": "If Enrolment ID Exists",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {
    "When clicking ‘Execute workflow’": [
      {}
    ],
    "Webhook": [
      {
        "headers": {
          "host": "n8n.srv1231536.hstgr.cloud",
          "user-agent": "Mozilla/5.0 (compatible; Google-Apps-Script; beanserver; +https://script.google.com; id: UAEmdDd_YT3hWJ7DLmrTVwaEPT46VDapLF68)",
          "content-length": "16",
          "accept-encoding": "gzip, deflate, br",
          "content-type": "application/json",
          "x-forwarded-for": "107.178.224.100",
          "x-forwarded-host": "n8n.srv1231536.hstgr.cloud",
          "x-forwarded-port": "443",
          "x-forwarded-proto": "https",
          "x-forwarded-server": "be541a59aa23",
          "x-real-ip": "107.178.224.100"
        },
        "params": {},
        "query": {},
        "body": {
          "trigger": true
        },
        "webhookUrl": "https://n8n.srv1231536.hstgr.cloud/webhook/40923ee9-2c5e-4417-921e-d7b098355124",
        "executionMode": "production"
      }
    ]
  },
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "49e027222b8fb909d02bbbe15b1a0377042d01d62581eff8cf4cdc4b9615c685"
  }
}