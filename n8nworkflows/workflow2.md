{
  "nodes": [
    {
      "parameters": {},
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [
        -1232,
        624
      ],
      "id": "2d3a794c-c10e-4961-8876-b7a97df5773d",
      "name": "When clicking ‘Execute workflow’"
    },
    {
      "parameters": {
        "content": "## Update Invoice for SFC\n## Please Do Not Change the workflow",
        "height": 560,
        "width": 3664
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -1296,
        256
      ],
      "typeVersion": 1,
      "id": "4532a5f5-e9e8-4be5-b859-35f6df0e8ae0",
      "name": "Sticky Note"
    },
    {
      "parameters": {
        "content": "## Disbursement Flow\n## Step 3: Update the QB (SFC)",
        "height": 96,
        "width": 384,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -848,
        256
      ],
      "typeVersion": 1,
      "id": "162df27b-eef3-4dc2-9375-28921371146d",
      "name": "Sticky Note2"
    },
    {
      "parameters": {
        "options": {}
      },
      "type": "n8n-nodes-base.splitInBatches",
      "typeVersion": 3,
      "position": [
        -608,
        432
      ],
      "id": "0790c444-614b-46d0-9e11-2df49ce5d21b",
      "name": "Loop Over Items",
      "alwaysOutputData": true
    },
    {
      "parameters": {
        "mode": "runOnceForEachItem",
        "jsCode": "// Get the current date string\nconst originalDate = $json[\"SFC Payment Date\"]; // e.g. \"24/10/2025\"\n\n// Check and transform format\nlet formattedDate = null;\nif (originalDate && originalDate.includes(\"/\")) {\n  const [day, month, year] = originalDate.split(\"/\");\n  formattedDate = `${year}-${month.padStart(2, \"0\")}-${day.padStart(2, \"0\")}`;\n}\n\n// Return single object\nreturn {\n  json: {\n    ...$json,\n    \"Disbursement Date\": formattedDate, // overwrite with new format\n  }\n};"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        -400,
        448
      ],
      "id": "1c48b555-84c7-4603-9121-8cededbb29a9",
      "name": "Code in JavaScript",
      "alwaysOutputData": true
    },
    {
      "parameters": {
        "documentId": {
          "__rl": true,
          "value": "14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k",
          "mode": "list",
          "cachedResultName": "Tertiary Infotech Finance Management System ",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?usp=drivesdk"
        },
        "sheetName": {
          "__rl": true,
          "value": 964641380,
          "mode": "list",
          "cachedResultName": "All Course Runs",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit#gid=964641380"
        },
        "filtersUI": {
          "values": [
            {
              "lookupColumn": "SFC Payment Status",
              "lookupValue": "Paid"
            }
          ]
        },
        "options": {}
      },
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4.7,
      "position": [
        -1008,
        448
      ],
      "id": "9b9de84e-899d-4758-87b4-da2e26136d90",
      "name": "Get row(s) in sheet1",
      "alwaysOutputData": true,
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
        "operation": "update",
        "documentId": {
          "__rl": true,
          "value": "14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k",
          "mode": "list",
          "cachedResultName": "Tertiary Infotech Finance Management System ",
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
            "QB SFC Status": "Paid",
            "QB SFC Invoice Num": "={{ $('If2').item.json.DocNumber }}"
          },
          "matchingColumns": [
            "QB SFC Invoice Num"
          ],
          "schema": [
            {
              "id": "Course Run",
              "displayName": "Course Run",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Code",
              "displayName": "Course Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Title",
              "displayName": "Course Title",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Start Date",
              "displayName": "Start Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "End Date",
              "displayName": "End Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee",
              "displayName": "Trainee",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee Email",
              "displayName": "Trainee Email",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee Contact",
              "displayName": "Trainee Contact",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee ID",
              "displayName": "Trainee ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee DOB",
              "displayName": "Trainee DOB",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Sponsorship Type",
              "displayName": "Sponsorship Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "UEN of Employer",
              "displayName": "UEN of Employer",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Name",
              "displayName": "Employer Name",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Phone Country Code",
              "displayName": "Employer Phone Country Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Phone",
              "displayName": "Employer Phone",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Contact Name",
              "displayName": "Employer Contact Name",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Contact Email",
              "displayName": "Employer Contact Email",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Company Address",
              "displayName": "Company Address",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Enrolement Status",
              "displayName": "Enrolement Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Enrolment Response",
              "displayName": "Enrolment Response",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Enrolment ID",
              "displayName": "Enrolment ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant Appl Date",
              "displayName": "Grant Appl Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant Status (BL)",
              "displayName": "Grant Status (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant ID (BL)",
              "displayName": "Grant ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Amount (BL)",
              "displayName": "Amount (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant Status (MCES/SME/IBF)",
              "displayName": "Grant Status (MCES/SME/IBF)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant ID (MCES/SME)",
              "displayName": "Grant ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Funding Scheme Code",
              "displayName": "Funding Scheme Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Amount (MCES/SME)",
              "displayName": "Amount (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Total TG Amount",
              "displayName": "Total TG Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "TG Payment Status",
              "displayName": "TG Payment Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Claim ID",
              "displayName": "SFC Claim ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Amount",
              "displayName": "SFC Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payment Date",
              "displayName": "SFC Payment Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payout Request ID",
              "displayName": "SFC Payout Request ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Application ID",
              "displayName": "SFC Application ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payment Status",
              "displayName": "SFC Payment Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB SFC Invoice Num",
              "displayName": "QB SFC Invoice Num",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": false
            },
            {
              "id": "QB SFC Status",
              "displayName": "QB SFC Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": false
            },
            {
              "id": "TG Payment Date",
              "displayName": "TG Payment Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Financial Transaction ID (BL)",
              "displayName": "Financial Transaction ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Financial Transaction ID (MCES/SME)",
              "displayName": "Financial Transaction ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Attendance",
              "displayName": "Attendance",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment",
              "displayName": "Assessment",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Fee Collection Update Status",
              "displayName": "Fee Collection Update Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment ID",
              "displayName": "Assessment ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment ID Date",
              "displayName": "Assessment ID Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Skill Code",
              "displayName": "Skill Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment Update",
              "displayName": "Assessment Update",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Invoice # (Net Fee)",
              "displayName": "QB Invoice # (Net Fee)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Net Fee Amount",
              "displayName": "QB Net Fee Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Payment Type",
              "displayName": "Payment Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Net Fee Status",
              "displayName": "QB Net Fee Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Invoice # (Grant)",
              "displayName": "QB Invoice # (Grant)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB TG Status",
              "displayName": "QB TG Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Bank Reference ID (BL)",
              "displayName": "Bank Reference ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Fees",
              "displayName": "Course Fees",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Bank Reference ID (MCES/SME)",
              "displayName": "Bank Reference ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Type",
              "displayName": "Course Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Unique Course Run ID",
              "displayName": "Unique Course Run ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Invoice No.",
              "displayName": "Invoice No.",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Pay by SFC",
              "displayName": "Pay by SFC",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Terms",
              "displayName": "Terms",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Payable Fees",
              "displayName": "Payable Fees",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Invoice Creation",
              "displayName": "Invoice Creation",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Column 65",
              "displayName": "Column 65",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Column 66",
              "displayName": "Column 66",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Column 67",
              "displayName": "Column 67",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
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
        2192,
        464
      ],
      "id": "9b97261e-e3bc-455b-bbe7-4603d1362f09",
      "name": "Update row in sheet3",
      "retryOnFail": true,
      "maxTries": 5,
      "waitBetweenTries": 3000,
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
            "version": 2
          },
          "conditions": [
            {
              "id": "b04e3dc6-7006-4292-be99-47bf50845126",
              "leftValue": "={{ $json.Balance }}",
              "rightValue": 0,
              "operator": {
                "type": "number",
                "operation": "notEquals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {
          "ignoreCase": false
        }
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        1504,
        464
      ],
      "id": "10e3b0f2-5ca8-4906-b0c2-c7ff8a4997dc",
      "name": "If2",
      "alwaysOutputData": false,
      "executeOnce": false
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 2
          },
          "conditions": [
            {
              "id": "61b3dbe6-c117-4ffe-b53a-26e10417fd27",
              "leftValue": "={{ $json[\"QB SFC Invoice Num\"] }}",
              "rightValue": "",
              "operator": {
                "type": "string",
                "operation": "notEmpty",
                "singleValue": true
              }
            },
            {
              "id": "d9053971-ddd0-4087-b10c-4173c4c09ba3",
              "leftValue": "={{ $json[\"QB SFC Status\"] }}",
              "rightValue": "Paid",
              "operator": {
                "type": "string",
                "operation": "notEquals"
              }
            },
            {
              "id": "c9685183-57f4-4dee-962d-95570c010873",
              "leftValue": "={{ $json[\"SFC Payout Request ID\"] }}",
              "rightValue": "",
              "operator": {
                "type": "number",
                "operation": "notEmpty",
                "singleValue": true
              }
            },
            {
              "id": "130021eb-ad47-4900-9405-af309e405ef2",
              "leftValue": "={{ $json[\"QB SFC Invoice Num\"] }}",
              "rightValue": "NA",
              "operator": {
                "type": "string",
                "operation": "notEquals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        -832,
        448
      ],
      "id": "8d55cc5f-fba8-4456-b717-ec6e7bdf7e74",
      "name": "If3"
    },
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "weeks",
              "triggerAtDay": [
                6
              ],
              "triggerAtHour": 5,
              "triggerAtMinute": null
            }
          ]
        }
      },
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [
        -1232,
        464
      ],
      "id": "2cebe42f-6ac7-458b-b945-e6f6cd0bd639",
      "name": "Schedule Trigger1"
    },
    {
      "parameters": {
        "operation": "update",
        "documentId": {
          "__rl": true,
          "value": "14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k",
          "mode": "list",
          "cachedResultName": "Tertiary Infotech Finance Management System ",
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
            "QB SFC Invoice Num": "={{ $json.DocNumber }}",
            "QB SFC Status": "Unpaid"
          },
          "matchingColumns": [
            "QB SFC Invoice Num"
          ],
          "schema": [
            {
              "id": "Course Run",
              "displayName": "Course Run",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Code",
              "displayName": "Course Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Title",
              "displayName": "Course Title",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Start Date",
              "displayName": "Start Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "End Date",
              "displayName": "End Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee",
              "displayName": "Trainee",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee Email",
              "displayName": "Trainee Email",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee Contact",
              "displayName": "Trainee Contact",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee ID",
              "displayName": "Trainee ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee DOB",
              "displayName": "Trainee DOB",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Sponsorship Type",
              "displayName": "Sponsorship Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "UEN of Employer",
              "displayName": "UEN of Employer",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Name",
              "displayName": "Employer Name",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Phone Country Code",
              "displayName": "Employer Phone Country Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Phone",
              "displayName": "Employer Phone",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Contact Name",
              "displayName": "Employer Contact Name",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Contact Email",
              "displayName": "Employer Contact Email",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Company Address",
              "displayName": "Company Address",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Enrolement Status",
              "displayName": "Enrolement Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Enrolment Response",
              "displayName": "Enrolment Response",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Enrolment ID",
              "displayName": "Enrolment ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant Appl Date",
              "displayName": "Grant Appl Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant Status (BL)",
              "displayName": "Grant Status (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant ID (BL)",
              "displayName": "Grant ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Amount (BL)",
              "displayName": "Amount (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant Status (MCES/SME/IBF)",
              "displayName": "Grant Status (MCES/SME/IBF)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant ID (MCES/SME)",
              "displayName": "Grant ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Funding Scheme Code",
              "displayName": "Funding Scheme Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Amount (MCES/SME)",
              "displayName": "Amount (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Total TG Amount",
              "displayName": "Total TG Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "TG Payment Status",
              "displayName": "TG Payment Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Claim ID",
              "displayName": "SFC Claim ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Amount",
              "displayName": "SFC Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payment Date",
              "displayName": "SFC Payment Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payout Request ID",
              "displayName": "SFC Payout Request ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Application ID",
              "displayName": "SFC Application ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payment Status",
              "displayName": "SFC Payment Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB SFC Invoice Num",
              "displayName": "QB SFC Invoice Num",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": false
            },
            {
              "id": "QB SFC Status",
              "displayName": "QB SFC Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": false
            },
            {
              "id": "TG Payment Date",
              "displayName": "TG Payment Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Financial Transaction ID (BL)",
              "displayName": "Financial Transaction ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Financial Transaction ID (MCES/SME)",
              "displayName": "Financial Transaction ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Attendance",
              "displayName": "Attendance",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment",
              "displayName": "Assessment",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Fee Collection Update Status",
              "displayName": "Fee Collection Update Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment ID",
              "displayName": "Assessment ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment ID Date",
              "displayName": "Assessment ID Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Skill Code",
              "displayName": "Skill Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment Update",
              "displayName": "Assessment Update",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Invoice # (Net Fee)",
              "displayName": "QB Invoice # (Net Fee)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Net Fee Amount",
              "displayName": "QB Net Fee Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Payment Type",
              "displayName": "Payment Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Net Fee Status",
              "displayName": "QB Net Fee Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Invoice # (Grant)",
              "displayName": "QB Invoice # (Grant)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB TG Status",
              "displayName": "QB TG Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Bank Reference ID (BL)",
              "displayName": "Bank Reference ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Fees",
              "displayName": "Course Fees",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Bank Reference ID (MCES/SME)",
              "displayName": "Bank Reference ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Type",
              "displayName": "Course Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Unique Course Run ID",
              "displayName": "Unique Course Run ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Invoice No.",
              "displayName": "Invoice No.",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Pay by SFC",
              "displayName": "Pay by SFC",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Terms",
              "displayName": "Terms",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Payable Fees",
              "displayName": "Payable Fees",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Invoice Creation",
              "displayName": "Invoice Creation",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Column 65",
              "displayName": "Column 65",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Column 66",
              "displayName": "Column 66",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Column 67",
              "displayName": "Column 67",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
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
        1712,
        384
      ],
      "id": "199b91e2-b250-4476-9429-68305e73b125",
      "name": "Update row in sheet6",
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
            "version": 2
          },
          "conditions": [
            {
              "id": "2c93fda7-12dc-492e-998d-fd6b1c0840c3",
              "leftValue": "={{ $('Code in JavaScript').item.json[\"QB TG Status\"] }}",
              "rightValue": "Paid",
              "operator": {
                "type": "string",
                "operation": "equals",
                "name": "filter.operator.equals"
              }
            },
            {
              "id": "371a4ee5-1bc3-47f2-b8f4-fc2186dd0996",
              "leftValue": "={{ $('Code in JavaScript').item.json[\"QB Net Fee Status\"] }}",
              "rightValue": "Paid",
              "operator": {
                "type": "string",
                "operation": "equals",
                "name": "filter.operator.equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        1712,
        576
      ],
      "id": "76fc24c5-cf53-4cdf-a9ff-b6a4a8d2e538",
      "name": "If5"
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
            "Enrolment ID": "={{ $('Code in JavaScript').item.json[\"Enrolment ID\"] }}",
            "Trainee Contact": "={{ 'xxxx' + $('Code in JavaScript').item.json[\"Trainee Contact\"].toString().slice(-4) }}",
            "Trainee ID": "={{ 'x'.repeat(5) + $('Code in JavaScript').item.json[\"Trainee ID\"].toString().slice(5) }}",
            "Trainee DOB": "={{ $('Code in JavaScript').item.json[\"Trainee DOB\"].toString().slice(0, 4) + '-xx-xx' }}"
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
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Code",
              "displayName": "Course Code",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Title",
              "displayName": "Course Title",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Start Date",
              "displayName": "Start Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "End Date",
              "displayName": "End Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee",
              "displayName": "Trainee",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Trainee Email",
              "displayName": "Trainee Email",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
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
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "UEN of Employer",
              "displayName": "UEN of Employer",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Employer Name",
              "displayName": "Employer Name",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Enrolement Status",
              "displayName": "Enrolement Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
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
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant Status (BL)",
              "displayName": "Grant Status (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant ID (BL)",
              "displayName": "Grant ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Amount (BL)",
              "displayName": "Amount (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant Status (MCEs/SMEs",
              "displayName": "Grant Status (MCEs/SMEs",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Grant ID (MCES/SME)",
              "displayName": "Grant ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Amount (MCES/SME)",
              "displayName": "Amount (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Total TG Amount",
              "displayName": "Total TG Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "TG Payment Status",
              "displayName": "TG Payment Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Claim ID",
              "displayName": "SFC Claim ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Amount",
              "displayName": "SFC Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payment Date",
              "displayName": "SFC Payment Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payout Request ID",
              "displayName": "SFC Payout Request ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "SFC Payment Status",
              "displayName": "SFC Payment Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB SFC Status",
              "displayName": "QB SFC Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "TG Payment Date",
              "displayName": "TG Payment Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Financial Transaction ID (BL)",
              "displayName": "Financial Transaction ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Attendance",
              "displayName": "Attendance",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Assessment",
              "displayName": "Assessment",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Invoice # (Net Fee)",
              "displayName": "QB Invoice # (Net Fee)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Net Fee Amount",
              "displayName": "QB Net Fee Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Payment Type",
              "displayName": "Payment Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Net Fee Status",
              "displayName": "QB Net Fee Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB Invoice # (Grant)",
              "displayName": "QB Invoice # (Grant)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "QB TG Status",
              "displayName": "QB TG Status",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Bank Reference ID (BL)",
              "displayName": "Bank Reference ID (BL)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Fees",
              "displayName": "Course Fees",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Bank Reference ID (MCES/SME)",
              "displayName": "Bank Reference ID (MCES/SME)",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Course Type",
              "displayName": "Course Type",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
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
        1984,
        656
      ],
      "id": "7579b725-59da-4fe7-b872-865e10f4ec24",
      "name": "Update row in sheet7",
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "j47Jb3rHdAbNhh4d",
          "name": "Google Sheets OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "resource": "invoice",
        "operation": "getAll",
        "filters": {
          "query": "=WHERE DocNumber = '{{ $json[\"QB SFC Invoice Num\"] }}'"
        }
      },
      "type": "n8n-nodes-base.quickbooks",
      "typeVersion": 1,
      "position": [
        -224,
        448
      ],
      "id": "44ade75a-720e-41ae-8d81-06247116edfc",
      "name": "Get many invoices1",
      "credentials": {
        "quickBooksOAuth2Api": {
          "id": "vMXrXRFNl32Q3GDw",
          "name": "QuickBooks Online OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "resource": "payment",
        "operation": "create",
        "CustomerRef": "1405",
        "TotalAmt": "={{ $('Code in JavaScript').item.json[\"SFC Amount\"] }}",
        "additionalFields": {
          "TxnDate": "={{ $('Code in JavaScript').item.json[\"SFC Payment Date\"] }}"
        }
      },
      "type": "n8n-nodes-base.quickbooks",
      "typeVersion": 1,
      "position": [
        752,
        368
      ],
      "id": "cc71ce82-5542-4886-8a82-8048174d2f25",
      "name": "Create a payment",
      "executeOnce": true,
      "alwaysOutputData": true,
      "credentials": {
        "quickBooksOAuth2Api": {
          "id": "vMXrXRFNl32Q3GDw",
          "name": "QuickBooks Online OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "resource": "payment",
        "paymentId": "={{ $json.Id }}"
      },
      "type": "n8n-nodes-base.quickbooks",
      "typeVersion": 1,
      "position": [
        928,
        368
      ],
      "id": "932de541-1deb-4673-b1d4-e11bf4e24015",
      "name": "Get a payment",
      "executeOnce": false,
      "alwaysOutputData": true,
      "credentials": {
        "quickBooksOAuth2Api": {
          "id": "vMXrXRFNl32Q3GDw",
          "name": "QuickBooks Online OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "method": "POST",
        "url": "=https://quickbooks.api.intuit.com/v3/company/1292117680/payment",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "quickBooksOAuth2Api",
        "sendHeaders": true,
        "specifyHeaders": "json",
        "jsonHeaders": "={\n  \"Accept\": \"application/json\",\n  \"Content-Type\": \"application/json\"\n}",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"SyncToken\": \"{{ $json.SyncToken }}\", \n  \"sparse\": false, \n  \"Line\": [\n    {\n      \"Amount\": {{ $json.UnappliedAmt }},\n      \"LinkedTxn\": [\n        {\n          \"TxnId\": \"{{ $('Get many invoices1').item.json.Id }}\",\n          \"TxnType\": \"Invoice\"\n        }\n      ]\n    }\n  ], \n  \"CustomerRef\": {\n    \"value\": \"{{ $('Get many invoices1').item.json.CustomerRef.value }}\"\n  }, \n  \"Id\": \"{{ $json.Id }}\",\n  \"TotalAmt\": {{ $json.UnappliedAmt }},\n  \"TxnDate\": \"{{ $json.TxnDate }}\",\n  \"PaymentMethodRef\": {\n    \"value\": \"7\"\n  },\n  \"PaymentRefNum\": \"{{ $('Code in JavaScript').item.json[\"SFC Payout Request ID\"] }}\",\n  \"DepositToAccountRef\": {\n    \"value\": \"12\"\n  }\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        1104,
        368
      ],
      "id": "3f154e2d-225d-497a-85e4-171d922bf047",
      "name": "Update Payment2",
      "alwaysOutputData": true,
      "credentials": {
        "quickBooksOAuth2Api": {
          "id": "vMXrXRFNl32Q3GDw",
          "name": "QuickBooks Online OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "resource": "invoice",
        "invoiceId": "={{ $json.Payment.Line[0].LinkedTxn[0].TxnId }}"
      },
      "type": "n8n-nodes-base.quickbooks",
      "typeVersion": 1,
      "position": [
        1296,
        464
      ],
      "id": "1d5382d4-4966-405f-90bc-fdcb9c4a79d9",
      "name": "Get an invoice3",
      "alwaysOutputData": true,
      "credentials": {
        "quickBooksOAuth2Api": {
          "id": "vMXrXRFNl32Q3GDw",
          "name": "QuickBooks Online OAuth (Sales Account)"
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
            "version": 2
          },
          "conditions": [
            {
              "id": "7693b789-c8b0-4d64-a260-0416bbe53fa5",
              "leftValue": "={{ $json.Balance }}",
              "rightValue": 0,
              "operator": {
                "type": "number",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        -48,
        448
      ],
      "id": "61ea21f5-4d7e-4db4-b1e4-ab1fd4fe5f03",
      "name": "If6"
    },
    {
      "parameters": {
        "operation": "append",
        "documentId": {
          "__rl": true,
          "value": "14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k",
          "mode": "list",
          "cachedResultName": "Tertiary Infotech Finance Management System ",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit?usp=drivesdk"
        },
        "sheetName": {
          "__rl": true,
          "value": 126507673,
          "mode": "list",
          "cachedResultName": "QB SFC Update Report",
          "cachedResultUrl": "https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit#gid=126507673"
        },
        "columns": {
          "mappingMode": "defineBelow",
          "value": {
            "Invoice Number": "={{ $json.DocNumber }}",
            "Remark": "SFC does not update in QB because this Invoice has been updated to Paid"
          },
          "matchingColumns": [],
          "schema": [
            {
              "id": "Enrolment ID",
              "displayName": "Enrolment ID",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Invoice Number",
              "displayName": "Invoice Number",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": false
            },
            {
              "id": "SFC Amount",
              "displayName": "SFC Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Invoice Balance Amount",
              "displayName": "Invoice Balance Amount",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
              "removed": true
            },
            {
              "id": "Remark",
              "displayName": "Remark",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true
            },
            {
              "id": "Date",
              "displayName": "Date",
              "required": false,
              "defaultMatch": false,
              "display": true,
              "type": "string",
              "canBeUsedToMatch": true,
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
        128,
        272
      ],
      "id": "baf2c177-0a86-4421-bc20-96e936ccee19",
      "name": "Record Error",
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "j47Jb3rHdAbNhh4d",
          "name": "Google Sheets OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "return items;"
      },
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        320,
        272
      ],
      "id": "19c5a0b9-a668-4ac2-a996-bc74f320098e",
      "name": "Continue Loop"
    },
    {
      "parameters": {
        "amount": 1
      },
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [
        240,
        464
      ],
      "id": "3db212d6-e9e5-46e6-ad79-60115fb1aedb",
      "name": "Wait",
      "webhookId": "936d0a8e-0a31-4d8c-96d3-fba54e29b3d0"
    },
    {
      "parameters": {
        "content": "Filter and get records to update",
        "height": 80,
        "width": 150,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -848,
        368
      ],
      "typeVersion": 1,
      "id": "8262a5fe-432c-44d2-9860-35cce24660cc",
      "name": "Sticky Note3"
    },
    {
      "parameters": {
        "content": "Format Date to match QB standard",
        "height": 80,
        "width": 150,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -416,
        368
      ],
      "typeVersion": 1,
      "id": "3f63e786-005e-48b3-8521-65969cf56d16",
      "name": "Sticky Note4"
    },
    {
      "parameters": {
        "content": "Create payment and update payment link to target invoice to update balance",
        "height": 80,
        "width": 230,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        448,
        592
      ],
      "typeVersion": 1,
      "id": "193a3c0d-0dcf-4e4c-88ee-10bbf9e7d63b",
      "name": "Sticky Note7"
    },
    {
      "parameters": {
        "content": "Check if invoice still have balance after update SFC",
        "height": 80,
        "width": 150,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        1504,
        384
      ],
      "typeVersion": 1,
      "id": "fbe3527c-5c2b-471c-8192-d6b9661a382a",
      "name": "Sticky Note8"
    },
    {
      "parameters": {
        "content": "Update SFC Invoice Status to Unpaid",
        "height": 80,
        "width": 166,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        1712,
        304
      ],
      "typeVersion": 1,
      "id": "6b1982d8-80a8-4d69-9041-17e1ae888132",
      "name": "Sticky Note11"
    },
    {
      "parameters": {
        "content": "Update SFC Invoice Status to Paid",
        "height": 80,
        "width": 166,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        1712,
        704
      ],
      "typeVersion": 1,
      "id": "d1657661-21e8-4ae1-bfaf-57bd7576912a",
      "name": "Sticky Note12"
    },
    {
      "parameters": {
        "content": "If both TC and GRN invoice are paid",
        "height": 80,
        "width": 150,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        1888,
        464
      ],
      "typeVersion": 1,
      "id": "efc75caf-a442-4698-8782-1fe6cfa4c3ee",
      "name": "Sticky Note13"
    },
    {
      "parameters": {
        "content": "Mask personal data",
        "height": 80,
        "width": 150,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        2128,
        672
      ],
      "typeVersion": 1,
      "id": "a1ac39c1-a004-46ba-ae79-48a7e507868a",
      "name": "Sticky Note14"
    },
    {
      "parameters": {
        "content": "Update QB SFC Statis to Paid",
        "height": 80,
        "width": 150,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        2192,
        384
      ],
      "typeVersion": 1,
      "id": "586c5cf5-31bf-40d3-a50a-d668a115a931",
      "name": "Sticky Note15"
    },
    {
      "parameters": {
        "resource": "payment",
        "operation": "create",
        "CustomerRef": "2917",
        "TotalAmt": "={{ $('Code in JavaScript').item.json[\"SFC Amount\"] }}",
        "additionalFields": {
          "TxnDate": "={{ $('Code in JavaScript').item.json[\"SFC Payment Date\"] }}"
        }
      },
      "type": "n8n-nodes-base.quickbooks",
      "typeVersion": 1,
      "position": [
        752,
        560
      ],
      "id": "14833c59-21d0-449e-8c89-4d51098834de",
      "name": "Create a payment1",
      "executeOnce": true,
      "alwaysOutputData": true,
      "credentials": {
        "quickBooksOAuth2Api": {
          "id": "vMXrXRFNl32Q3GDw",
          "name": "QuickBooks Online OAuth (Sales Account)"
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
            "version": 2
          },
          "conditions": [
            {
              "id": "29bfc235-0bd2-4732-b448-0ca17709d3ac",
              "leftValue": "={{ $('Get many invoices1').item.json.CustomerRef.value }}",
              "rightValue": "2917",
              "operator": {
                "type": "string",
                "operation": "notEquals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        512,
        464
      ],
      "id": "41e659d8-4495-4d6c-955f-fd632835c62c",
      "name": "If"
    },
    {
      "parameters": {
        "resource": "payment",
        "paymentId": "={{ $json.Id }}"
      },
      "type": "n8n-nodes-base.quickbooks",
      "typeVersion": 1,
      "position": [
        928,
        560
      ],
      "id": "2c16b55e-ea69-4293-9410-2e684f7ed8ec",
      "name": "Get a payment1",
      "executeOnce": false,
      "alwaysOutputData": true,
      "credentials": {
        "quickBooksOAuth2Api": {
          "id": "vMXrXRFNl32Q3GDw",
          "name": "QuickBooks Online OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "method": "POST",
        "url": "=https://quickbooks.api.intuit.com/v3/company/1292117680/payment",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "quickBooksOAuth2Api",
        "sendHeaders": true,
        "specifyHeaders": "json",
        "jsonHeaders": "={\n  \"Accept\": \"application/json\",\n  \"Content-Type\": \"application/json\"\n}",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"SyncToken\": \"{{ $json.SyncToken }}\", \n  \"sparse\": false, \n  \"Line\": [\n    {\n      \"Amount\": {{ $json.UnappliedAmt }},\n      \"LinkedTxn\": [\n        {\n          \"TxnId\": \"{{ $('Get many invoices1').item.json.Id }}\",\n          \"TxnType\": \"Invoice\"\n        }\n      ]\n    }\n  ], \n  \"CustomerRef\": {\n    \"value\": \"{{ $('Get many invoices1').item.json.CustomerRef.value }}\"\n  }, \n  \"Id\": \"{{ $json.Id }}\",\n  \"TotalAmt\": {{ $json.UnappliedAmt }},\n  \"TxnDate\": \"{{ $json.TxnDate }}\",\n  \"PaymentMethodRef\": {\n    \"value\": \"7\"\n  },\n  \"PaymentRefNum\": \"{{ $('Code in JavaScript').item.json[\"SFC Payout Request ID\"] }}\",\n  \"DepositToAccountRef\": {\n    \"value\": \"12\"\n  }\n}",
        "options": {}
      },
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        1104,
        560
      ],
      "id": "59c0afa9-f56a-4ced-ab5d-23a3a9ce29a6",
      "name": "Update Payment",
      "alwaysOutputData": true,
      "credentials": {
        "quickBooksOAuth2Api": {
          "id": "vMXrXRFNl32Q3GDw",
          "name": "QuickBooks Online OAuth (Sales Account)"
        }
      }
    },
    {
      "parameters": {
        "content": "## This is New QB SFC Invoice update workflow based on the new Invoice generation method which have 3 invoices for an enrolment (TC Invoice, SFC Invoice, Grant Invoice)\n\n## For Old TC Invoice update (means the TC Invoci)",
        "height": 224,
        "width": 528,
        "color": 4
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -1056,
        -32
      ],
      "typeVersion": 1,
      "id": "72b638ec-e4ca-4355-9463-f19d1be3a3b4",
      "name": "Sticky Note1"
    },
    {
      "parameters": {
        "content": "Author: Liu Zhen\nDate: 20 Jan",
        "height": 80,
        "width": 150,
        "color": 4
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        -1296,
        -32
      ],
      "typeVersion": 1,
      "id": "c39816c3-e8d0-4a3f-9a06-718a4065127a",
      "name": "Sticky Note5"
    },
    {
      "parameters": {
        "content": "Record the Error if the invoice is already fully paid",
        "height": 80,
        "width": 214,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        160,
        176
      ],
      "typeVersion": 1,
      "id": "08c42de0-3971-46f0-9abf-267c6c37aa55",
      "name": "Sticky Note6"
    },
    {
      "parameters": {
        "content": "Update Invoices for WSQ case",
        "height": 80,
        "width": 230,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        848,
        288
      ],
      "typeVersion": 1,
      "id": "9b77d250-3e29-40f8-84c2-81dba7de602f",
      "name": "Sticky Note17"
    },
    {
      "parameters": {
        "content": "Update Invoices for IBF case",
        "height": 80,
        "width": 230,
        "color": 5
      },
      "type": "n8n-nodes-base.stickyNote",
      "position": [
        864,
        720
      ],
      "typeVersion": 1,
      "id": "daad5321-0638-4fc0-a67b-3b884230171a",
      "name": "Sticky Note18"
    }
  ],
  "connections": {
    "When clicking ‘Execute workflow’": {
      "main": [
        [
          {
            "node": "Get row(s) in sheet1",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Loop Over Items": {
      "main": [
        [],
        [
          {
            "node": "Code in JavaScript",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Code in JavaScript": {
      "main": [
        [
          {
            "node": "Get many invoices1",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Get row(s) in sheet1": {
      "main": [
        [
          {
            "node": "If3",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Update row in sheet3": {
      "main": [
        [
          {
            "node": "Loop Over Items",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "If2": {
      "main": [
        [
          {
            "node": "Update row in sheet6",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "If5",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "If3": {
      "main": [
        [
          {
            "node": "Loop Over Items",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Schedule Trigger1": {
      "main": [
        [
          {
            "node": "Get row(s) in sheet1",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Update row in sheet6": {
      "main": [
        [
          {
            "node": "Update row in sheet3",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "If5": {
      "main": [
        [
          {
            "node": "Update row in sheet7",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Update row in sheet3",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Update row in sheet7": {
      "main": [
        [
          {
            "node": "Update row in sheet3",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Get many invoices1": {
      "main": [
        [
          {
            "node": "If6",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Create a payment": {
      "main": [
        [
          {
            "node": "Get a payment",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Get a payment": {
      "main": [
        [
          {
            "node": "Update Payment2",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Update Payment2": {
      "main": [
        [
          {
            "node": "Get an invoice3",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Get an invoice3": {
      "main": [
        [
          {
            "node": "If2",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "If6": {
      "main": [
        [
          {
            "node": "Record Error",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Wait",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Record Error": {
      "main": [
        [
          {
            "node": "Continue Loop",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Continue Loop": {
      "main": [
        [
          {
            "node": "Loop Over Items",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wait": {
      "main": [
        [
          {
            "node": "If",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Create a payment1": {
      "main": [
        [
          {
            "node": "Get a payment1",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "If": {
      "main": [
        [
          {
            "node": "Create a payment",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Create a payment1",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Get a payment1": {
      "main": [
        [
          {
            "node": "Update Payment",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Update Payment": {
      "main": [
        [
          {
            "node": "Get an invoice3",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "pinData": {},
  "meta": {
    "templateCredsSetupCompleted": true,
    "instanceId": "49e027222b8fb909d02bbbe15b1a0377042d01d62581eff8cf4cdc4b9615c685"
  }
}