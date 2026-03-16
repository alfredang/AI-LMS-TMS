require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');

async function test() {
    console.log("Starting test...");
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const parentId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!email || !key || !parentId) {
        console.error("Missing credentials in .env.local");
        return;
    }

    if (key.includes('\\n')) {
        key = key.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.JWT({
        email: email,
        key: key,
        scopes: ['https://www.googleapis.com/auth/drive']
    });

    const drive = google.drive({ version: 'v3', auth });

    try {
        console.log(`Checking contents of parent folder: ${parentId}`);
        // Let's just list ALL folders in the parent to see what it can actually see
        const res = await drive.files.list({
            q: `'${parentId}' in parents and name contains 'TGS-2020503207' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name, mimeType, webViewLink)',
            spaces: 'drive',
        });

        console.log(`Found ${res.data.files.length} items matching 'TGS-2020503207':`);
        res.data.files.forEach(f => console.log(` - [${f.mimeType}] ${f.name} (${f.id}) -> ${f.webViewLink}`));
        
    } catch(err) {
        console.error("Error from Drive API:", err.message);
    }
}
test();
