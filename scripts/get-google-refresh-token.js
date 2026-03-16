/**
 * One-time script to generate a Google OAuth2 refresh token
 * for uploading files to your personal Google Drive.
 *
 * Usage:
 *   node scripts/get-google-refresh-token.js
 *
 * Prerequisites:
 *   1. Create OAuth 2.0 credentials in Google Cloud Console:
 *      - APIs & Services → Credentials → + Create Credentials → OAuth 2.0 Client ID
 *      - Application type: Desktop app
 *      - Download the JSON (or note Client ID & Client Secret)
 *   2. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET below (or in your .env.local)
 *   3. Run this script — it will open a URL in your terminal
 *   4. Paste the URL in a browser, log in with your Gmail account, and authorize
 *   5. Copy the code from the redirect URL and paste it back in the terminal
 *   6. Copy the printed refresh_token into GOOGLE_REFRESH_TOKEN in .env.local
 */

const { google } = require('googleapis');
const readline = require('readline');

// ─── Fill these in before running ────────────────────────────────────────────
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// ─────────────────────────────────────────────────────────────────────────────

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first, then run:');
    console.error('    node -r dotenv/config scripts/get-google-refresh-token.js dotenv_config_path=.env.local');
    process.exit(1);
}

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // Desktop / copy-paste flow
const SCOPES = ['https://www.googleapis.com/auth/drive'];

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent screen to ensure refresh_token is returned
});

console.log('\n==============================================');
console.log('Step 1: Open this URL in your browser and sign in with your Gmail account:');
console.log('\n' + authUrl + '\n');
console.log('==============================================\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Step 2: Paste the authorization code here: ', async (code) => {
    rl.close();

    try {
        const { tokens } = await oAuth2Client.getToken(code.trim());
        console.log('\n✅  Success! Add this to your .env.local:\n');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('\nThen restart your dev server.');
    } catch (err) {
        console.error('❌  Failed to get tokens:', err.message);
    }
});
