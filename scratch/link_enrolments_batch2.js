const { Client } = require('pg'); 
const client = new Client({ 
    connectionString: 'postgres://postgres:zUapKZbD9gLQISOdo0rDiwStXNR8l5dtr8HJd7tSlj7jb814ITY6V6YO9OSxAdrm@76.13.180.29:6433/postgres?sslmode=disable' 
}); 

async function runUpdate() {
    try {
        await client.connect();
        
        const updates = [
            { appId: 'CA-2604-000942', enrId: 'ENR-2604-088954' },
            { appId: 'CA-2604-000952', enrId: 'ENR-2604-088953' },
            { appId: 'CA-2604-000968', enrId: 'ENR-2604-088952' },
            { appId: 'CA-2604-000976', enrId: 'ENR-2604-088955' },
            { appId: 'CA-2604-000983', enrId: 'ENR-2604-088956' }
        ];

        let updatedCount = 0;
        for (const item of updates) {
            const res = await client.query(`
                UPDATE da_application 
                SET 
                    enrolment_id = $1, 
                    enrolment_status = 'Confirmed', 
                    auto_enrol_status = 'enroled', 
                    auto_enrol_error = NULL, 
                    updated_at = NOW() 
                WHERE application_id = $2
            `, [item.enrId, item.appId]);
            updatedCount += res.rowCount;
        }
        
        console.log(`Successfully updated ${updatedCount} record(s).`);
        
        // Verification
        const verify = await client.query(`
            SELECT id, application_id, trainee_name, enrolment_id, auto_enrol_status 
            FROM da_application 
            WHERE application_id IN (${updates.map(u => `'${u.appId}'`).join(',')})
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
