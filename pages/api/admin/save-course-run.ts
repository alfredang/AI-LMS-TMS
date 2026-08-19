import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { getTrainingPartnerIdentifiers } from '../../../lib/trainingPartnerIdentifiers';
import { autoShareCourseResourcesWithTrainer } from '../../../lib/google-drive/drive-helpers';
import { ensureTpgTrainerColumns } from '@/lib/trainerInvitations';
import { resolveCourseIdByCode } from '../../../lib/courseCode';

// Helper function for database queries
const query = (text: string, params?: any[]) => pool.query(text, params);

interface CourseRunSaveRequest {
    courseRunData: any;
    courseRunId: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

        // Resolve the course from any code it has ever carried. A funding renewal
        // issues a NEW reference code for the same course, so a bare course_code
        // match misses it and the block below would create a duplicate course.
        let resolvedCourseId: string | null;
        try {
            resolvedCourseId = await resolveCourseIdByCode(courseReferenceNumber);
            console.log('📋 Course query result:', resolvedCourseId ? 'Found' : 'Not found');
        } catch (dbError) {
            console.error('❌ Database query error:', dbError);
            return res.status(500).json({ 
                error: 'Database query failed',
                details: dbError instanceof Error ? dbError.message : 'Unknown database error'
            });
        }

        let courseId: string;

        if (!resolvedCourseId) {
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
            courseId = resolvedCourseId;
            console.log('📋 Using existing course record:', courseId);
        }

        // Check if course run already exists
        await ensureTpgTrainerColumns(query);
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

                            const tp = await getTrainingPartnerIdentifiers();

                            // Hash the default password for password_hash column
                            const hashedPassword = await bcrypt.hash(tp.defaultPassword, 10);

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
                                    tp.defaultPassword,    // Plain text password
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
                        tpg_assigned_trainer_id,
                        tpg_assigned_trainer_name,
                        tpg_assigned_trainer_email,
                        created_at,
                        updated_at
                    ) VALUES (
                        gen_random_uuid(),
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
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
                        trainerEmail,                // assigned_trainer_email
                        trainerId,                   // tpg_assigned_trainer_id
                        trainerName,                 // tpg_assigned_trainer_name
                        trainerEmail                 // tpg_assigned_trainer_email
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
                        tpg_assigned_trainer_name,
                        tpg_assigned_trainer_email,
                        created_at,
                        updated_at
                    ) VALUES (
                        gen_random_uuid(),
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
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
                        trainerEmail,                // assigned_trainer_email
                        trainerName,                 // tpg_assigned_trainer_name
                        trainerEmail                 // tpg_assigned_trainer_email
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

        // Keep TPG trainer data on course_run only. Local trainer assignment stays in course_run_trainer.

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

        // --- Auto-share Google resources (courseware folder + trainer slides) with the assigned trainer ---
        if (trainerEmail) {
            await autoShareCourseResourcesWithTrainer(courseId, trainerEmail);
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

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
