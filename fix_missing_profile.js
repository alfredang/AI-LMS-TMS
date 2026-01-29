
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function fixProfile() {
    const client = await pool.connect();
    try {
        // Get the most recent user
        const userRes = await client.query('SELECT id, email, full_name FROM app_user ORDER BY created_at DESC LIMIT 1');
        if (userRes.rows.length === 0) {
            console.log('❌ No users found to fix.');
            return;
        }

        const user = userRes.rows[0];
        console.log(`Checking user: ${user.full_name} (${user.email}) - ID: ${user.id}`);

        // Check if profile exists
        const checkRes = await client.query('SELECT id FROM training_provider WHERE id = $1', [user.id]);

        if (checkRes.rows.length > 0) {
            console.log('✅ Profile already exists for this user.');
        } else {
            console.log('⚠️ Profile missing. Creating default Training Provider profile...');

            const insertQuery = `
        INSERT INTO training_provider (
          id, 
          company_name, 
          company_shortname, 
          uen, 
          company_address, 
          contact_person_name, 
          contact_tel, 
          color_scheme,
          gst_register,
          sync_google_calendar,
          sync_ms_calendar,
          integrate_google_drive,
          integrate_ms_onedrive,
          auto_send_proforma_invoice,
          auto_send_confirm_email,
          auto_send_invoice,
          auto_send_receipt,
          auto_send_certificate,
          auto_send_thankyou_email,
          auto_mask_sensitive_data,
          auto_delete_after_six_months,
          enable_otp_login,
          enable_default_otp,
          enable_leaderboard,
          enable_point_sys
        ) VALUES (
          $1, 
          $2, 
          $3, 
          $4, 
          $5, 
          $6, 
          $7, 
          $8,
          false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false
        )
      `;

            const values = [
                user.id,
                `${user.full_name}'s Training Company`,
                'MyCompany',
                'UEN123456789',
                '123 Tech Park Drive',
                user.full_name,
                '91234567',
                '#3B82F6'
            ];

            await client.query(insertQuery, values);
            console.log('✅ Successfully created default Training Provider profile!');
        }

    } catch (err) {
        console.error('❌ Error fixing profile:', err);
    } finally {
        client.release();
        pool.end();
    }
}

fixProfile();
