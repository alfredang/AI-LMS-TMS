import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { google, drive_v3 } from 'googleapis';

// Helper function for database queries
const query = (text: string, params?: any[]) => pool.query(text, params);

interface CourseRunSaveRequest {
    courseRunData: any;
    courseRunId: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        return res.status(200).end();
    }

    // Set CORS headers for actual request
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { courseRunData, courseRunId }: CourseRunSaveRequest = req.body;

        if (!courseRunData || !courseRunId) {
            return res.status(400).json({ 
                error: 'Missing required fields: courseRunData and courseRunId' 
            });
        }

        console.log('📊 Saving course run to database:', {
            courseRunId,
            hasData: !!courseRunData.data,
            hasResult: !!courseRunData.result,
            hasCourse: !!courseRunData.data?.course || !!courseRunData.result?.course,
            responseStructure: courseRunData.data ? 'data structure' : courseRunData.result ? 'result structure' : 'unknown'
        });

        // Extract course run details from webhook response
        // Handle both 'data' and 'result' property structures
        const dataWrapper = courseRunData.result || courseRunData.data || courseRunData;
        const course = dataWrapper?.course;
        const courseRun = dataWrapper?.course?.run;
        
        if (!course || !courseRun) {
            console.error('❌ Missing course or run data');
            console.log('📋 Available top-level keys:', Object.keys(courseRunData));
            console.log('📋 Data wrapper keys:', dataWrapper ? Object.keys(dataWrapper) : 'no wrapper');
            return res.status(400).json({ 
                error: 'No course or course run data found in webhook response',
                debug: {
                    hasCourse: !!course,
                    hasCourseRun: !!courseRun,
                    topLevelKeys: Object.keys(courseRunData),
                    wrapperKeys: dataWrapper ? Object.keys(dataWrapper) : null,
                    courseRunData: courseRunData
                }
            });
        }

        // Get course information
        const courseReferenceNumber = course.referenceNumber;

        if (!courseReferenceNumber) {
            console.error('❌ Missing reference number');
            return res.status(400).json({ 
                error: 'Course reference number not found in API response'
            });
        }

        console.log('🔍 Looking for course with reference number:', courseReferenceNumber);

        // First, find the course record by course_code
        let courseRecord;
        try {
            courseRecord = await query(
                `SELECT id FROM course WHERE course_code = $1`,
                [courseReferenceNumber]
            );
            console.log('📋 Course query result:', courseRecord.rows.length > 0 ? 'Found' : 'Not found');
        } catch (dbError) {
            console.error('❌ Database query error:', dbError);
            return res.status(500).json({ 
                error: 'Database query failed',
                details: dbError instanceof Error ? dbError.message : 'Unknown database error'
            });
        }

        let courseId: string;

        if (courseRecord.rows.length === 0) {
            console.log('📝 Creating new course record for:', courseReferenceNumber);
            // Create new course record
            try {
                const newCourse = await query(
                    `INSERT INTO course (
                        course_code, 
                        title,
                        created_at,
                        updated_at
                    ) VALUES ($1, $2, NOW(), NOW()) RETURNING id`,
                    [
                        courseReferenceNumber,
                        course.title || 'Unknown Course'
                    ]
                );
                courseId = newCourse.rows[0].id;
                console.log('✅ Created new course record:', courseId);
            } catch (createError) {
                console.error('❌ Error creating course:', createError);
                return res.status(500).json({ 
                    error: 'Failed to create course record',
                    details: createError instanceof Error ? createError.message : 'Unknown error'
                });
            }
        } else {
            courseId = courseRecord.rows[0].id;
            console.log('📋 Using existing course record:', courseId);
        }

        // Check if course run already exists
        console.log('🔍 Checking if course run exists...');
        let existingCourseRun;
        try {
            existingCourseRun = await query(
                `SELECT id FROM course_run WHERE course_run_id = $1 AND course_id = $2`,
                [courseRunId, courseId]
            );
        } catch (checkError) {
            console.error('❌ Error checking existing course run:', checkError);
            return res.status(500).json({ 
                error: 'Failed to check existing course run',
                details: checkError instanceof Error ? checkError.message : 'Unknown error'
            });
        }

        if (existingCourseRun.rows.length > 0) {
            console.log('⚠️ Course run already exists:', existingCourseRun.rows[0].id);
            return res.status(200).json({
                success: true,
                message: 'Course run already exists in database',
                data: {
                    courseRunId: existingCourseRun.rows[0].id,
                    ssgCourseRunId: courseRunId,
                    courseId: courseId,
                    courseCode: courseReferenceNumber,
                    status: 'already_exists'
                }
            });
        }

        // Extract digital attendance ID from qrCodeLink
        const qrCodeLink = courseRun.qrCodeLink || '';
        let digitalAttendanceId = '';
        if (qrCodeLink) {
            const baseUrl = 'https://www.myskillsfuture.gov.sg/api/take-attendance/';
            if (qrCodeLink.startsWith(baseUrl)) {
                digitalAttendanceId = qrCodeLink.replace(baseUrl, '');
            }
        }

        // Format dates from YYYYMMDD to YYYY-MM-DD format
        const formatDate = (dateNumber: number) => {
            if (!dateNumber) return null;
            try {
                const dateStr = dateNumber.toString();
                if (dateStr.length === 8) {
                    const year = dateStr.substring(0, 4);
                    const month = dateStr.substring(4, 6);
                    const day = dateStr.substring(6, 8);
                    return `${year}-${month}-${day}`;
                }
                return null;
            } catch (error) {
                console.warn('Invalid date format:', dateNumber);
                return null;
            }
        };

        const startDate = formatDate(courseRun.courseStartDate);
        const endDate = formatDate(courseRun.courseEndDate);

        // Extract trainer information if available
        let trainerName = '';
        let trainerEmail = '';
        let trainerId: string | null = null;
        
        if (courseRun.linkCourseRunTrainer && courseRun.linkCourseRunTrainer.length > 0) {
            const trainer = courseRun.linkCourseRunTrainer[0]?.trainer;
            if (trainer) {
                trainerName = trainer.name || '';
                trainerEmail = trainer.email || '';

                // Check if trainer exists in database by email
                if (trainerEmail) {
                    console.log('🔍 Checking if trainer exists:', trainerEmail);
                    try {
                        const existingTrainer = await query(
                            `SELECT u.id, u.email, u.full_name 
                             FROM app_user u
                             INNER JOIN user_role_map urm ON u.id = urm.user_id
                             WHERE u.email = $1 AND urm.role = 'Trainer'`,
                            [trainerEmail]
                        );

                        if (existingTrainer.rows.length > 0) {
                            trainerId = existingTrainer.rows[0].id;
                            console.log('✅ Found existing trainer user:', trainerId);
                            
                            // Check if trainer_profile exists
                            const trainerProfile = await query(
                                `SELECT user_id FROM trainer_profile WHERE user_id = $1`,
                                [trainerId]
                            );
                            
                            if (trainerProfile.rows.length === 0) {
                                // Create trainer_profile
                                console.log('📝 Creating trainer_profile for existing user:', trainerId);
                                await query(
                                    `INSERT INTO trainer_profile (
                                        user_id,
                                        tel,
                                        gender,
                                        trainer_type,
                                        status
                                    ) VALUES ($1, $2, $3, $4, $5)`,
                                    [
                                        trainerId,
                                        '',                    // Empty tel for now
                                        'Prefer not to say',   // Default gender
                                        'ACLP',                // Default trainer type
                                        'Active'               // Default status
                                    ]
                                );
                                console.log('✅ Created trainer_profile');
                            } else {
                                console.log('✅ Trainer profile already exists');
                            }
                        } else {
                            // Create new trainer user
                            console.log('📝 Creating new trainer user:', trainerEmail);

                            // Fetch default password from Company Settings
                            let defaultPassword = 'password123'; // fallback
                            try {
                              const tpResult = await query('SELECT default_password FROM training_provider LIMIT 1');
                              if (tpResult.rows.length > 0 && tpResult.rows[0].default_password) {
                                defaultPassword = tpResult.rows[0].default_password;
                              }
                            } catch (e) { /* column may not exist */ }

                            // Hash the default password for password_hash column
                            const hashedPassword = await bcrypt.hash(defaultPassword, 10);

                            const newTrainer = await query(
                                `INSERT INTO app_user (
                                    email,
                                    password,
                                    password_hash,
                                    full_name,
                                    created_at,
                                    updated_at
                                ) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
                                [
                                    trainerEmail,
                                    defaultPassword,    // Plain text password
                                    hashedPassword,     // Hashed password
                                    trainerName || 'Trainer'
                                ]
                            );

                            trainerId = newTrainer.rows[0].id;
                            console.log('✅ Created new trainer user:', trainerId);

                            // Assign Trainer role
                            await query(
                                `INSERT INTO user_role_map (user_id, role) VALUES ($1, 'Trainer')`,
                                [trainerId]
                            );
                            console.log('✅ Assigned Trainer role to user');
                            
                            // Create trainer_profile
                            console.log('📝 Creating trainer_profile for new user:', trainerId);
                            await query(
                                `INSERT INTO trainer_profile (
                                    user_id,
                                    tel,
                                    gender,
                                    trainer_type,
                                    status
                                ) VALUES ($1, $2, $3, $4, $5)`,
                                [
                                    trainerId,
                                    '',                    // Empty tel for now
                                    'Prefer not to say',   // Default gender
                                    'ACLP',                // Default trainer type
                                    'Active'               // Default status
                                ]
                            );
                            console.log('✅ Created trainer_profile');
                        }
                    } catch (trainerError) {
                        console.error('⚠️ Error handling trainer:', trainerError);
                        console.error('⚠️ Error details:', trainerError instanceof Error ? trainerError.message : trainerError);
                        // Reset trainerId to null on error to prevent FK constraint violation
                        trainerId = null;
                        console.log('⚠️ Trainer ID reset to null due to error');
                    }
                }
            }
        }

        console.log('📅 Processing dates and trainer info:', {
            qrCodeLink,
            digitalAttendanceId,
            startDate,
            endDate,
            trainerName,
            trainerEmail,
            trainerId,
            hasValidTrainerId: !!trainerId
        });

        // Verify trainer ID exists in trainer_profile before using it (FK constraint requirement)
        if (trainerId) {
            try {
                const verifyTrainer = await query(
                    `SELECT user_id FROM trainer_profile WHERE user_id = $1`,
                    [trainerId]
                );
                if (verifyTrainer.rows.length === 0) {
                    console.warn('⚠️ Trainer profile not found in database, resetting to null:', trainerId);
                    trainerId = null;
                } else {
                    console.log('✅ Verified trainer profile exists in database:', trainerId);
                }
            } catch (verifyError) {
                console.error('⚠️ Error verifying trainer profile:', verifyError);
                trainerId = null;
            }
        }

        // Insert course run record using existing table structure
        console.log('💾 Inserting course run record...');
        console.log('💾 Will insert with trainer ID?', !!trainerId);
        let courseRunInsert;
        try {
            // Build dynamic SQL based on whether we have a valid trainer ID
            if (trainerId) {
                // Insert with trainer ID
                courseRunInsert = await query(
                    `INSERT INTO course_run (
                        id,
                        course_id,
                        course_run_id,
                        digital_attendance_id,
                        class_status,
                        start_date,
                        end_date,
                        mode_of_learning,
                        assigned_trainer_id,
                        assigned_trainer_name,
                        assigned_trainer_email,
                        created_at,
                        updated_at
                    ) VALUES (
                        gen_random_uuid(),
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
                    ) RETURNING id, assigned_trainer_id`,
                    [
                        courseId,                    // course_id
                        courseRunId,                 // course_run_id (SSG course run ID)
                        digitalAttendanceId,         // digital_attendance_id (extracted from qrCodeLink)
                        'Confirmed',                 // class_status
                        startDate,                   // start_date
                        endDate,                     // end_date
                        'Physical',                  // mode_of_learning (default to Physical/classroom)
                        trainerId,                   // assigned_trainer_id
                        trainerName,                 // assigned_trainer_name
                        trainerEmail                 // assigned_trainer_email
                    ]
                );
            } else {
                // Insert without trainer ID (only name and email)
                courseRunInsert = await query(
                    `INSERT INTO course_run (
                        id,
                        course_id,
                        course_run_id,
                        digital_attendance_id,
                        class_status,
                        start_date,
                        end_date,
                        mode_of_learning,
                        assigned_trainer_name,
                        assigned_trainer_email,
                        created_at,
                        updated_at
                    ) VALUES (
                        gen_random_uuid(),
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
                    ) RETURNING id, assigned_trainer_id`,
                    [
                        courseId,                    // course_id
                        courseRunId,                 // course_run_id (SSG course run ID)
                        digitalAttendanceId,         // digital_attendance_id (extracted from qrCodeLink)
                        'Confirmed',                 // class_status
                        startDate,                   // start_date
                        endDate,                     // end_date
                        'Physical',                  // mode_of_learning (default to Physical/classroom)
                        trainerName,                 // assigned_trainer_name
                        trainerEmail                 // assigned_trainer_email
                    ]
                );
            }
        } catch (insertError) {
            console.error('❌ Error inserting course run:', insertError);
            return res.status(500).json({ 
                error: 'Failed to insert course run record',
                details: insertError instanceof Error ? insertError.message : 'Unknown error',
                debug: {
                    courseId,
                    courseRunId,
                    digitalAttendanceId,
                    startDate,
                    endDate,
                    trainerName,
                    trainerEmail
                }
            });
        }

        const newCourseRunId = courseRunInsert.rows[0].id;
        const assignedTrainerId = courseRunInsert.rows[0].assigned_trainer_id;

        // ── Multi-trainer: insert into junction table (additive) ─────────────
        if (trainerName) {
            try {
                await query(`
                    CREATE TABLE IF NOT EXISTS course_run_trainer (
                        id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                        course_run_id UUID NOT NULL REFERENCES course_run(id) ON DELETE CASCADE,
                        trainer_id    UUID,
                        trainer_name  TEXT NOT NULL,
                        trainer_email TEXT,
                        assigned_at   TIMESTAMPTZ DEFAULT NOW()
                    )
                `);
                await query(`
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_crt_run_trainer
                        ON course_run_trainer(course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
                `);

                // Insert ALL trainers from SSG data if multiple exist
                const ssgTrainers = courseRun.linkCourseRunTrainer || [];
                for (const trainerLink of ssgTrainers) {
                    const t = trainerLink?.trainer;
                    if (t?.name) {
                        // Try to resolve trainer ID by email
                        let tid = null;
                        if (t.email) {
                            const lookup = await query(
                                `SELECT u.id FROM app_user u
                                 JOIN trainer_profile tp ON tp.user_id = u.id
                                 WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
                                [t.email]
                            );
                            if (lookup.rows.length > 0) tid = lookup.rows[0].id;
                        }
                        await query(
                            `INSERT INTO course_run_trainer (course_run_id, trainer_id, trainer_name, trainer_email)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'))
                             DO NOTHING`,
                            [newCourseRunId, tid, t.name, t.email || null]
                        );
                    }
                }
                console.log('✅ Trainers inserted into junction table');
            } catch (junctionError) {
                console.warn('⚠️ Failed to insert into junction table (non-fatal):', junctionError);
            }
        }

        console.log('✅ Course run saved successfully:', {
            courseRunId: newCourseRunId,
            ssgCourseRunId: courseRunId,
            courseId: courseId,
            courseCode: courseReferenceNumber,
            digitalAttendanceId: digitalAttendanceId,
            trainerId: assignedTrainerId,
            trainerName: trainerName,
            trainerEmail: trainerEmail,
            startDate: startDate,
            endDate: endDate,
            modeOfLearning: 'Physical'
        });

        // --- Auto-share courseware Google Drive folder with the assigned trainer ---
        if (trainerEmail) {
            try {
                const coursewareRes = await query(
                    `SELECT courseware_link FROM course WHERE id = $1 AND courseware_link IS NOT NULL AND courseware_link LIKE '%drive.google.com%'`,
                    [courseId]
                );

                if (coursewareRes.rows.length > 0 && coursewareRes.rows[0].courseware_link) {
                    const coursewareLink = coursewareRes.rows[0].courseware_link;
                    let folderId: string | null = null;

                    if (coursewareLink.includes('folders/')) {
                        const parts = coursewareLink.split('folders/');
                        if (parts.length > 1) folderId = parts[1].split('?')[0].split('/')[0];
                    } else if (coursewareLink.includes('id=')) {
                        folderId = new URL(coursewareLink).searchParams.get('id');
                    }

                    if (folderId) {
                        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
                        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
                        const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

                        if (clientId && clientSecret && refreshToken) {
                            const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:9876');
                            oauth2Client.setCredentials({ refresh_token: refreshToken });
                            const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: oauth2Client });

                            try {
                                await drive.permissions.create({
                                    fileId: folderId,
                                    sendNotificationEmail: false,
                                    requestBody: { role: 'reader', type: 'user', emailAddress: trainerEmail }
                                });
                                console.log(`📂 Auto-shared courseware folder with trainer ${trainerEmail}`);
                            } catch (shareErr: any) {
                                if (shareErr.message?.includes('already exists')) {
                                    console.log(`📂 Trainer ${trainerEmail} already has access to courseware folder.`);
                                } else {
                                    console.warn(`⚠️ Could not share courseware folder with ${trainerEmail}: ${shareErr.message}`);
                                }
                            }
                        }
                    }
                }
            } catch (shareError) {
                console.warn('⚠️ Auto-share courseware error (non-blocking):', shareError);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Course run saved to database successfully',
            data: {
                courseRunId: newCourseRunId,
                ssgCourseRunId: courseRunId,
                courseId: courseId,
                courseCode: courseReferenceNumber,
                digitalAttendanceId: digitalAttendanceId,
                trainerId: assignedTrainerId,
                trainerName: trainerName,
                trainerEmail: trainerEmail,
                startDate: startDate,
                endDate: endDate,
                modeOfLearning: 'Physical',
                status: 'newly_created'
            }
        });

    } catch (error) {
        console.error('❌ Error saving course run to database:', error);
        return res.status(500).json({
            error: 'Internal server error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}