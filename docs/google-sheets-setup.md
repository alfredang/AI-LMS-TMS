# Google Sheets API Integration Setup Guide

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project:
   - Click on the project dropdown at the top
   - Click "NEW PROJECT"
   - Name it (e.g., "AI-LMS-TMS")
   - Click "CREATE"

3. Enable the Google Sheets API:
   - In the search bar, search for "Google Sheets API"
   - Click on it
   - Click "ENABLE"

## Step 2: Create Service Account

1. Go to **APIs & Services** → **Credentials**
2. Click **"Create Credentials"** → **"Service Account"**
3. Fill in the form:
   - Service account name: `finance-sync`
   - Click "CREATE AND CONTINUE"
4. Grant role: Select **"Editor"** (for full access)
5. Click "CONTINUE" → "DONE"

## Step 3: Get Service Account Key

1. Go back to **APIs & Services** → **Credentials**
2. Under "Service Accounts", click on the account you just created
3. Go to **"Keys"** tab
4. Click **"Add Key"** → **"Create new key"**
5. Select **"JSON"** → **"CREATE"**
6. A JSON file will download - keep this safe!

The JSON file contains (example):
```json
{
  "type": "service_account",
  "project_id": "ai-lms-tms-123456",
  "private_key_id": "abcd1234...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "finance-sync@ai-lms-tms-123456.iam.gserviceaccount.com",
  "client_id": "123456789",
  ...
}
```

## Step 4: Configure Environment Variables

Add to `.env.local`:

```env
# From the JSON file you downloaded:
GOOGLE_PROJECT_ID=ai-lms-tms-123456
GOOGLE_PRIVATE_KEY_ID=abcd1234...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEF\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CLIENT_EMAIL=finance-sync@ai-lms-tms-123456.iam.gserviceaccount.com
GOOGLE_CLIENT_ID=123456789

# Your Google Sheet URL: https://docs.google.com/spreadsheets/d/{THIS_ID}/edit
GOOGLE_SHEET_ID=14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k

# Random secret for cron jobs
CRON_SECRET=super_secret_random_string_here

# API base URL
NEXT_PUBLIC_API_URL=http://localhost:3000
```

**Important:** When copying `GOOGLE_PRIVATE_KEY`, include the newline characters (`\n`).

## Step 5: Share Google Sheet with Service Account

1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/14IjSXJ0pHG23evfULhrLJEFXXsegx3hBNJoNSgRcp1k/edit
2. Click **"Share"**
3. Add the email: `finance-sync@ai-lms-tms-123456.iam.gserviceaccount.com` (from the JSON file)
4. Give it **"Viewer"** access
5. Click **"Share"**

## Step 6: Create Database Tables

Run the migration file:

```bash
psql $DATABASE_URL < database/15-finance-tables.sql
```

Or manually run the SQL from `database/15-finance-tables.sql` in your database client.

## Step 7: Install Required Package

```bash
npm install googleapis
```

If not already installed.

## Step 8: Test the Sync

### Manual Sync (POST request):

```bash
curl -X POST http://localhost:3000/api/training-provider/sync-google-sheets
```

Expected response:
```json
{
  "message": "Sync completed",
  "results": [
    { "sheet": "Course Run", "status": "success", "count": 10 },
    { "sheet": "Trainee", "status": "success", "count": 15 },
    ...
  ],
  "timestamp": "2026-04-02T10:30:00Z"
}
```

### Verify Data in Database:

```bash
psql $DATABASE_URL
SELECT COUNT(*) FROM finance_course_runs;
SELECT COUNT(*) FROM finance_trainees;
-- etc.
```

## Step 9: Set Up Automatic Syncing (Every Second/Minute)

### Option A: Using EasyCron (Free, Recommended)

1. Go to [EasyCron.com](https://www.easycron.com/)
2. Click **"Add a cron job"**
3. Fill in:
   - **Cron expression**: `* * * * * *` (every 1 second) or `*/30 * * * * *` (every 30 seconds)
   - **URL**: `https://your-deployed-app.com/api/training-provider/cron-sync-google-sheets`
   - **Method**: POST
   - **Header**: Add `x-cron-secret: super_secret_random_string_here`
4. Click **"Create"**

### Option B: Using Vercel Crons (if deployed on Vercel)

In `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/training-provider/cron-sync-google-sheets",
      "schedule": "* * * * * *"
    }
  ]
}
```

### Option C: Using Node-Cron (Local Development)

Create `lib/scheduler.ts`:

```typescript
import cron from 'node-cron';
import fetch from 'node-fetch';

export function initializeScheduler() {
  // Every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const response = await fetch('http://localhost:3000/api/training-provider/sync-google-sheets', {
        method: 'POST',
      });
      const data = await response.json();
      console.log('✓ Auto-sync completed:', data);
    } catch (error) {
      console.error('✗ Auto-sync failed:', error);
    }
  });
}
```

Then in your app initialization.

## Step 10: Verify Sheet Tab Names

Make sure your Google Sheet tab names exactly match:
- "Course Run"
- "Trainee"
- "Trainer"
- "Enrollment"
- "SFC"
- "Assessment"
- "Invoice"

The sync will skip any sheets that don't match these names exactly.

## Troubleshooting

### "GOOGLE_SHEET_ID not configured"
- Make sure `GOOGLE_SHEET_ID` is in `.env.local`
- Restart your development server after adding env vars

### "Invalid Credentials"
- Check `GOOGLE_PRIVATE_KEY` includes literal newlines: `\n`
- Verify service account email has access to the sheet
- Check JSON file wasn't corrupted when copying

### "No data found"
- Verify sheet tab names exactly match (case-sensitive)
- Make sure data starts from row 1 (headers in row 1, data from row 2)
- Check Google Sheet is shared with service account

### "Column not found"
- Update Google Sheet column headers to match table headers we defined
- Or modify the sync script to map different column names

## Sheet Column Headers Expected

### Course Run
- Course Run, Course Code, Course Title, Start Date, End Date

### Trainee
- Name, Email, Contact No, NRIC, Date of Birth, Sponsorship Type

### Trainer
- UEN, Company Name, Contact No., Name, Email

### Enrollment
- Enrollment Status, Enrollment ID, Grant Application Date, Grant Status (BL), Grant ID (BL), Amount (BL), Grant Status (MCES/SME/IBF), Grant ID (MCES/SME), Funding Scheme Code, Amount (MCES/SME), Total TG Amount, TG Payment Status

### SFC
- SFC Claim ID, SFC Amount, SFC Payment Date, SFC Payout Request ID, SFC Application ID, SFC Payment Status (QB SFC Status), QB SFC Invoice Num, TG Payment Date, Financial Transaction ID (BL), Financial Transaction ID (MCES/SME)

### Assessment
- Assessment Score, Fee Collection Update Status, Assessment ID, Assessment Date, Skill Code, Assessment Update, QB Invoice # (Net Fee), QB Net Fee Amount, Payment Type, QB Net Fee Status, QB Invoice # (Grant), QB TG Status, Bank Reference ID (BL), Bank Reference ID (MCES/SME), Course Type

### Invoice
- Invoice No., Paid by SFC, Terms, Payable Fees, Invoice Creation

## Next Steps

After setup:
1. Test manual sync: `curl -X POST http://localhost:3000/api/training-provider/sync-google-sheets`
2. Set up automatic syncing using one of the options above
3. Update the FinanceLayout tables to fetch data from the database instead of showing "No data available"
4. Add pagination, filtering, and search functionality

