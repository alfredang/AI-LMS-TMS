import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

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
            hasCourse: !!courseRunData.data?.course,
            hasDoubleNestedCourse: !!courseRunData.data?.data?.course,
            hasRun: !!courseRunData.data?.course?.run,
            hasDoubleNestedRun: !!courseRunData.data?.data?.course?.run,
            responseStructure: courseRunData.data ? Object.keys(courseRunData.data) : 'no data property'
        });

        // Extract course run details from SSG API response
        // Handle both single and double-nested data structures
        const actualData = courseRunData.data?.data || courseRunData.data;
        const course = actualData?.course;
        const courseRun = actualData?.course?.run;
        
        if (!course || !courseRun) {
            console.error('❌ Missing course or run data');
            console.log('📋 Available data keys at top level:', Object.keys(courseRunData.data || {}));
            console.log('📋 Available data keys at nested level:', courseRunData.data?.data ? Object.keys(courseRunData.data.data) : 'no nested data');
            console.log('📋 Full data object structure:', {
                topLevel: courseRunData.data,
                nestedLevel: courseRunData.data?.data
            });
            return res.status(400).json({ 
                error: 'No course or course run data found in API response',
                debug: {
                    hasCourse: !!course,
                    hasCourseRun: !!courseRun,
                    topLevelKeys: Object.keys(courseRunData.data || {}),
                    nestedLevelKeys: courseRunData.data?.data ? Object.keys(courseRunData.data.data) : null,
                    actualDataUsed: actualData
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
        
        if (courseRun.linkCourseRunTrainer && courseRun.linkCourseRunTrainer.length > 0) {
            const trainer = courseRun.linkCourseRunTrainer[0]?.trainer;
            if (trainer) {
                trainerName = trainer.name || '';
                trainerEmail = trainer.email || '';
            }
        }

        console.log('📅 Processing dates and trainer info:', {
            qrCodeLink,
            digitalAttendanceId,
            startDate,
            endDate,
            trainerName,
            trainerEmail
        });

        // Insert course run record using existing table structure
        console.log('💾 Inserting course run record...');
        let courseRunInsert;
        try {
            courseRunInsert = await query(
                `INSERT INTO course_run (
                    id,
                    course_id,
                    course_run_id,
                    digital_attendance_id,
                    class_status,
                    start_date,
                    end_date,
                    assigned_trainer_name,
                    assigned_trainer_email,
                    created_at,
                    updated_at
                ) VALUES (
                    gen_random_uuid(),
                    $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
                ) RETURNING id`,
                [
                    courseId,                    // course_id
                    courseRunId,                 // course_run_id (SSG course run ID)
                    digitalAttendanceId,         // digital_attendance_id (extracted from qrCodeLink)
                    'Confirmed',                 // class_status
                    startDate,                   // start_date
                    endDate,                     // end_date
                    trainerName,                 // assigned_trainer_name
                    trainerEmail                 // assigned_trainer_email
                ]
            );
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

        console.log('✅ Course run saved successfully:', {
            courseRunId: newCourseRunId,
            ssgCourseRunId: courseRunId,
            courseId: courseId,
            courseCode: courseReferenceNumber,
            digitalAttendanceId: digitalAttendanceId,
            trainerName: trainerName,
            trainerEmail: trainerEmail,
            startDate: startDate,
            endDate: endDate
        });

        return res.status(200).json({
            success: true,
            message: 'Course run saved to database successfully',
            data: {
                courseRunId: newCourseRunId,
                ssgCourseRunId: courseRunId,
                courseId: courseId,
                courseCode: courseReferenceNumber,
                digitalAttendanceId: digitalAttendanceId,
                trainerName: trainerName,
                trainerEmail: trainerEmail,
                startDate: startDate,
                endDate: endDate,
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