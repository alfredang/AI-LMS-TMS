import type { Pool } from 'pg';
import type { SourceRecord } from './source';
import { assertNonFunded } from './contract';

/** Merge native MMS registrations into the existing operational Master List.
 * Email/class matching makes retries safe even after the UI replaces row IDs.
 * Never overwrite an operator's cancellation or payment/registration fields.
 */
export async function reconcileMmsRegistrations(db: Pool, source: SourceRecord, registrations: unknown[]): Promise<{ added: number; existing: number; pending: number }> {
    assertNonFunded(source.course_code);
    const counts = { added: 0, existing: 0, pending: 0 };
    if (!source.masterlist_class_id) return counts;
    if (!Array.isArray(registrations) || registrations.length > 10000) throw new Error('Invalid MMS registration response.');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mms-roster:${source.masterlist_class_id}`]);
        const header = (await client.query('SELECT * FROM masterlist_table WHERE class_id=$1 ORDER BY created_at,id LIMIT 1 FOR UPDATE', [source.masterlist_class_id])).rows[0];
        if (!header) throw new Error('Master List class was deleted during MMS reconciliation.');
        const run = source.tms_run_uuid ? (await client.query('SELECT cr.id,cr.course_id FROM course_run cr JOIN course c ON c.id=cr.course_id WHERE cr.id=$1 AND upper(btrim(c.course_code))=$2', [source.tms_run_uuid, source.course_code])).rows[0] : null;
        for (const value of registrations) {
            if (!value || typeof value !== 'object') { counts.pending++; continue; }
            const person = value as Record<string, unknown>;
            const email = String(person.email || '').trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 128) { counts.pending++; continue; }
            const existing = (await client.query('SELECT id,cancelled FROM masterlist_table WHERE class_id=ANY($1::uuid[]) AND lower(btrim(email))=$2 LIMIT 1', [source.masterlist_class_ids?.length ? source.masterlist_class_ids : [source.masterlist_class_id], email])).rows[0];
            if (run && !existing?.cancelled) {
                // An MMS registration also joins the existing LMS run when one is
                // linked. Existing profiles, passwords and withdrawal states win.
                let user = (await client.query('SELECT id FROM app_user WHERE lower(btrim(email))=$1', [email])).rows[0];
                if (!user) user = (await client.query('INSERT INTO app_user(email,full_name) VALUES($1,$2) ON CONFLICT (lower(email)) DO UPDATE SET email=app_user.email RETURNING id', [email, String(person.name || email).slice(0, 255)])).rows[0];
                await client.query("INSERT INTO user_role_map(user_id,role) VALUES($1,'Learner') ON CONFLICT DO NOTHING", [user.id]);
                await client.query('INSERT INTO learner_profile(user_id,tel) VALUES($1,$2) ON CONFLICT DO NOTHING', [user.id, String(person.phone || '').slice(0, 64)]);
                await client.query("INSERT INTO enrollment(user_id,course_id,course_run_id,enrolment_status,email) VALUES($1,$2,$3,'Registered',$4) ON CONFLICT (user_id,course_run_id) DO NOTHING", [user.id, run.course_id, run.id, email]);
            }
            if (existing) { counts.existing++; continue; }
            await client.query(`INSERT INTO masterlist_table(class_id,class_type,list_date,course_code,course_title,course_run_no,trainer,trainer_email,
                schedule_entries,class_date,venue,zoom_id,meeting_id,name,email,contact_no,magento_order_no,comments,cancelled)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,false)`,
                [source.masterlist_class_id, header.class_type, header.list_date, source.course_code, header.course_title, header.course_run_no, header.trainer, header.trainer_email,
                    JSON.stringify(header.schedule_entries || []), header.class_date, header.venue, header.zoom_id, header.meeting_id,
                    String(person.name || email).slice(0, 255), email, String(person.phone || '').slice(0, 64), String(person.order_numbers || '').slice(0, 1000), 'Registered directly in MMS; reconciled automatically.']);
            counts.added++;
        }
        await client.query('COMMIT');
        return counts;
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
}
