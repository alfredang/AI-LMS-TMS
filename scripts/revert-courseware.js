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
  console.log('Fetching all trainer emails...');
  const userRes = await pool.query(`
    SELECT DISTINCT u.email 
    FROM app_user u 
    JOIN trainer_profile tp ON u.id = tp.user_id 
    WHERE u.email IS NOT NULL AND u.email != ''
  `);
  // Convert to lowercase set for easy matching
  const allTrainersSet = new Set(userRes.rows.map(r => r.email.toLowerCase().trim()));
  console.log(`Tracking ${allTrainersSet.size} total trainers for cancellation.`);

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
        if (parts.length > 1) folderId = parts[1].split('?')[0].split('/')[0];
      } else if (r.courseware_link.includes('id=')) {
        folderId = new URL(r.courseware_link).searchParams.get('id');
      }
    } catch(e) {}
    if (folderId) folderIds.add(folderId);
  });

  console.log(`Found ${folderIds.size} unique courseware folders to scrub.`);
  
  const drive = getDriveClient();
  let revokedCount = 0;
  let errorCount = 0;

  for (const folderId of folderIds) {
    let permissions = [];
    try {
      const res = await drive.permissions.list({ 
        fileId: folderId, 
        fields: 'permissions(id, emailAddress, role)',
        pageSize: 100
      });
      permissions = res.data.permissions || [];
    } catch (e) {
      // Ignore folders we can't access
      continue;
    }

    let removedFromThisFolder = 0;
    for (const perm of permissions) {
      if (!perm.emailAddress) continue;
      const email = perm.emailAddress.toLowerCase();
      
      // Never revoke owner or organizer
      if (perm.role === 'owner' || perm.role === 'organizer') continue;
      
      // If it's a trainer email, revoke it completely
      if (allTrainersSet.has(email)) {
         try {
           await drive.permissions.delete({ fileId: folderId, permissionId: perm.id });
           revokedCount++;
           removedFromThisFolder++;
           await new Promise(r => setTimeout(r, 100)); // Sleep 100ms
         } catch(e) {
           console.log(`    ❌ Failed to revoke ${email}: ${e.message}`);
           errorCount++;
         }
      }
    }
    if (removedFromThisFolder > 0) {
       console.log(`🧹 Scrubbed ${removedFromThisFolder} trainer permissions from folder ${folderId}`);
    }
  }

  console.log(`\n🎉 Revert Complete! Total revoked: ${revokedCount}. Errors: ${errorCount}.`);
  process.exit(0);
}

main().catch(console.error);
