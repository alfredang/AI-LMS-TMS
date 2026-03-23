const { Pool } = require('pg');
const { google } = require('googleapis');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: 'postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable'
});

function getDriveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost:9876'
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function main() {
  console.log('Fetching trainers...');
  const userRes = await pool.query(`
    SELECT DISTINCT u.email 
    FROM app_user u 
    JOIN trainer_profile tp ON u.id = tp.user_id 
    WHERE u.email IS NOT NULL AND u.email != ''
  `);
  const trainers = userRes.rows.map(r => r.email);
  console.log(`Found ${trainers.length} trainers.`);

  if (trainers.length === 0) {
    console.log('No trainers found. Exiting.');
    process.exit(0);
  }

  console.log('Fetching courses with courseware links...');
  const courseRes = await pool.query(`
    SELECT id, title, courseware_link 
    FROM course 
    WHERE courseware_link IS NOT NULL AND courseware_link != '' AND courseware_link LIKE '%drive.google.com%'
  `);

  const folderIds = new Set();
  courseRes.rows.forEach(r => {
    let folderId = null;
    try {
      if (r.courseware_link.includes('folders/')) {
        const parts = r.courseware_link.split('folders/');
        if (parts.length > 1) {
          folderId = parts[1].split('?')[0].split('/')[0];
        }
      } else if (r.courseware_link.includes('id=')) {
        folderId = new URL(r.courseware_link).searchParams.get('id');
      }
    } catch(e) {}
    
    if (folderId) {
      folderIds.add(folderId);
    }
  });

  console.log(`\nFound ${folderIds.size} unique folder IDs to process.`);
  
  const drive = getDriveClient();
  let successCount = 0;
  let errorCount = 0;

  for (const folderId of folderIds) {
    console.log(`\nProcessing folder: ${folderId}`);
    
    // Check if the folder is accessible
    try {
      await drive.files.get({ fileId: folderId, fields: 'id, name' });
    } catch (e) {
      console.log(`  ERROR: Cannot access folder ${folderId}: ${e.message}`);
      errorCount++;
      continue;
    }

    for (const email of trainers) {
      try {
        await drive.permissions.create({
          fileId: folderId,
          sendNotificationEmail: false,
          requestBody: {
            role: 'reader',
            type: 'user',
            emailAddress: email
          }
        });
        console.log(`  ✅ Added ${email} as reader.`);
        successCount++;
        await new Promise(res => setTimeout(res, 200)); 
      } catch (err) {
         if (err.message && err.message.includes('already exists')) {
            console.log(`  ✔️ ${email} already has access.`);
         } else if (err.message && err.message.includes('there is no Google account associated')) {
            console.log(`  🔄 Retrying ${email} with email invitation...`);
            try {
              await drive.permissions.create({
                fileId: folderId,
                sendNotificationEmail: true,
                requestBody: {
                  role: 'reader',
                  type: 'user',
                  emailAddress: email
                }
              });
              console.log(`  ✅ Added ${email} as reader (with invitation).`);
              successCount++;
              await new Promise(res => setTimeout(res, 200)); 
            } catch (retryErr) {
              console.error(`  ❌ Failed to add ${email} even with invitation: ${retryErr.message}`);
              errorCount++;
            }
         } else {
            console.error(`  ❌ Failed to add ${email}: ${err.message}`);
            errorCount++;
         }
      }
    }
  }

  console.log(`\n🎉 Process complete! Successfully granted ${successCount} permissions. Failed: ${errorCount}`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
