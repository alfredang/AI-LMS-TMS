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

function extractFolderId(link) {
  try {
    if (link.includes('folders/')) {
      const parts = link.split('folders/');
      if (parts.length > 1) return parts[1].split('?')[0].split('/')[0];
    } else if (link.includes('id=')) {
      return new URL(link).searchParams.get('id');
    }
  } catch(e) {}
  return null;
}

async function main() {
  console.log('Fetching all trainer emails to track who to revoke if needed...');
  const userRes = await pool.query(`
    SELECT DISTINCT u.email 
    FROM app_user u 
    JOIN trainer_profile tp ON u.id = tp.user_id 
    WHERE u.email IS NOT NULL AND u.email != ''
  `);
  const allTrainersSet = new Set(userRes.rows.map(r => r.email.toLowerCase().trim()));
  console.log(`Found ${allTrainersSet.size} total trainers in the system.`);

  console.log('Fetching all Courseware folders...');
  const allCoursesRes = await pool.query(`
    SELECT id, title, courseware_link 
    FROM course 
    WHERE courseware_link IS NOT NULL AND courseware_link != '' AND courseware_link LIKE '%drive.google.com%'
  `);

  const folderToEmails = new Map();
  allCoursesRes.rows.forEach(r => {
    const folderId = extractFolderId(r.courseware_link);
    if (folderId && !folderToEmails.has(folderId)) {
      folderToEmails.set(folderId, { title: r.title, validEmails: new Set() });
    }
  });

  console.log(`Fetching accurate course assignments from course_run...`);
  const mappingRes = await pool.query(`
    SELECT c.courseware_link, cr.assigned_trainer_email
    FROM course c
    JOIN course_run cr ON c.id = cr.course_id
    WHERE c.courseware_link IS NOT NULL 
      AND c.courseware_link != '' 
      AND c.courseware_link LIKE '%drive.google.com%'
      AND cr.assigned_trainer_email IS NOT NULL 
      AND cr.assigned_trainer_email != ''
  `);

  mappingRes.rows.forEach(r => {
    const folderId = extractFolderId(r.courseware_link);
    if (!folderId || !folderToEmails.has(folderId)) return;
    
    const emails = r.assigned_trainer_email.split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e);
    const data = folderToEmails.get(folderId);
    emails.forEach(e => data.validEmails.add(e));
  });

  console.log(`Processing ${folderToEmails.size} unique courseware folders...`);
  
  const drive = getDriveClient();
  let addedCount = 0;
  let revokedCount = 0;
  let errorCount = 0;

  for (const [folderId, data] of folderToEmails.entries()) {
    // Avoid too much console spam, only print if we have valid emails or processing
    
    let permissions = [];
    try {
      const res = await drive.permissions.list({ 
        fileId: folderId, 
        fields: 'permissions(id, emailAddress, role)',
        pageSize: 100
      });
      permissions = res.data.permissions || [];
    } catch (e) {
      errorCount++;
      continue;
    }

    const existingEmails = new Set();
    let madeChanges = false;

    // 1. Revoke unauthorized trainers
    for (const perm of permissions) {
      if (!perm.emailAddress) continue;
      const email = perm.emailAddress.toLowerCase();
      existingEmails.add(email);
      
      if (perm.role === 'owner' || perm.role === 'organizer') continue;
      
      // If this email is a recognized trainer in our system, BUT they are NOT assigned to this course
      if (allTrainersSet.has(email) && !data.validEmails.has(email)) {
         if (!madeChanges) { console.log(`\nProcessing: "${data.title}"`); madeChanges = true; }
         console.log(`  🧹 Revoking incorrect access for ${email}...`);
         try {
           await drive.permissions.delete({ fileId: folderId, permissionId: perm.id });
           revokedCount++;
           await new Promise(r => setTimeout(r, 100));
         } catch(e) {
           console.log(`    ❌ Failed to revoke: ${e.message}`);
         }
      }
    }

    // 2. Add authorized trainers that are missing
    for (const email of data.validEmails) {
      if (!existingEmails.has(email)) {
        if (!madeChanges) { console.log(`\nProcessing: "${data.title}"`); madeChanges = true; }
        console.log(`  ➕ Adding authorized access for ${email}...`);
        try {
          await drive.permissions.create({
            fileId: folderId,
            sendNotificationEmail: false,
            fields: 'id',
            requestBody: { role: 'reader', type: 'user', emailAddress: email }
          });
          addedCount++;
          await new Promise(r => setTimeout(r, 200));
        } catch(e) {
          if (e.message && e.message.includes('there is no Google account associated')) {
             console.log(`    🔄 Retrying with invitation email for ${email}...`);
             try {
               await drive.permissions.create({
                 fileId: folderId,
                 sendNotificationEmail: true,
                 fields: 'id',
                 requestBody: { role: 'reader', type: 'user', emailAddress: email }
               });
               addedCount++;
               await new Promise(r => setTimeout(r, 200));
             } catch(retryE) {
               console.log(`    ❌ Failed: ${retryE.message}`);
               errorCount++;
             }
          } else {
             console.log(`    ❌ Failed to add: ${e.message}`);
             errorCount++;
          }
        }
      }
    }
  }

  console.log(`\n🎉 Exact Mapping Complete! Added: ${addedCount}. Revoked: ${revokedCount}. Errors: ${errorCount}.`);
  process.exit(0);
}

main().catch(console.error);
