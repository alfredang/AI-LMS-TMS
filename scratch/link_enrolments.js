const { Client } = require('pg'); 
const client = new Client({ 
    connectionString: 'postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable' 
}); 

async function runUpdate() {
    try {
        await client.connect();
        
        const res = await client.query(`
            UPDATE da_application 
            SET 
                enrolment_id = CASE 
                    WHEN application_id = 'CA-2604-000955' THEN 'ENR-2604-083822'
                    WHEN application_id = 'CA-2604-000739' THEN 'ENR-2604-083210'
                    ELSE enrolment_id 
                END, 
                enrolment_status = 'Confirmed', 
                auto_enrol_status = 'enroled', 
                auto_enrol_error = NULL, 
                updated_at = NOW() 
            WHERE application_id IN ('CA-2604-000955', 'CA-2604-000739')
        `);
        
        console.log(`Successfully updated ${res.rowCount} record(s).`);
        
        // Let's verify right away
        const verify = await client.query(`
            SELECT id, application_id, trainee_name, enrolment_id, auto_enrol_status 
            FROM da_application 
            WHERE application_id IN ('CA-2604-000955', 'CA-2604-000739')
        `);
        console.log('Verification Results:', JSON.stringify(verify.rows, null, 2));

    } catch (err) {
        console.error('Error during update:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

runUpdate();
