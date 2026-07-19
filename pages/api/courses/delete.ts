import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import fs from 'fs';
import path from 'path';

// CORS headers function
const setCorsHeaders = (res: NextApiResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

// Helper function to safely delete file
const deleteFile = (filePath: string) => {
    if (!filePath) return;
    
    try {
        // Convert relative path to absolute path
        const absolutePath = path.join(process.cwd(), 'public', filePath.startsWith('/') ? filePath.slice(1) : filePath);
        
        if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
            console.log(`✅ Deleted file: ${absolutePath}`);
        } else {
            console.log(`⚠️ File not found: ${absolutePath}`);
        }
    } catch (error) {
        console.error(`❌ Error deleting file ${filePath}:`, error);
    }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Set CORS headers
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'DELETE') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }

    try {
        const { courseId } = req.query;

        if (!courseId || typeof courseId !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Course ID is required'
            });
        }

        console.log(`🗑️ Starting deletion process for course: ${courseId}`);

        // First, get all file paths associated with the course
        const getFilesQuery = `
            SELECT 
                image_url,
                lesson_plan_url,
                learner_guide_url,
                facilitator_guide_url,
                slides_url,
                trainer_slides_url,
                activities_url,
                assessment_plan_url
            FROM course
            WHERE id = $1
        `;

        const filesResult = await pool.query(getFilesQuery, [courseId]);
        
        if (filesResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        const courseFiles = filesResult.rows[0];

        // Get assessment files for this course
        const assessmentFilesQuery = `
            SELECT file_url 
            FROM assessment 
            WHERE course_id = $1 AND file_url IS NOT NULL
        `;

        const assessmentFilesResult = await pool.query(assessmentFilesQuery, [courseId]);

        // Start transaction
        await pool.query('BEGIN');

        try {
            // Delete related records first (foreign key constraints)
            
            // Delete grant applications
            await pool.query('DELETE FROM grant_application WHERE course_id = $1', [courseId]);
            
            // Delete enrollments
            await pool.query('DELETE FROM enrollment WHERE course_id = $1', [courseId]);
            
            // Delete calendar events
            await pool.query('DELETE FROM calendar_event WHERE course_id = $1', [courseId]);
            
            // Delete course run assessments
            await pool.query(`
                DELETE FROM course_run_assessment 
                WHERE course_run_id IN (
                    SELECT id FROM course_run WHERE course_id = $1
                )
            `, [courseId]);

            // Delete course runs
            await pool.query('DELETE FROM course_run WHERE course_id = $1', [courseId]);

            // Delete subtopics (linked to learning units)
            await pool.query(`
                DELETE FROM subtopic 
                WHERE learning_unit_id IN (
                    SELECT id FROM learning_unit WHERE course_id = $1
                )
            `, [courseId]);

            // Delete learning units
            await pool.query('DELETE FROM learning_unit WHERE course_id = $1', [courseId]);

            // Delete assessments
            await pool.query('DELETE FROM assessment WHERE course_id = $1', [courseId]);

            // Finally, delete the course
            const deleteResult = await pool.query('DELETE FROM course WHERE id = $1', [courseId]);

            if (deleteResult.rowCount === 0) {
                throw new Error('Course not found or already deleted');
            }

            // Commit transaction
            await pool.query('COMMIT');

            console.log(`✅ Course ${courseId} deleted from database successfully`);

            // Delete associated files
            const filesToDelete = [
                courseFiles.image_url,
                courseFiles.lesson_plan_url,
                courseFiles.learner_guide_url,
                courseFiles.facilitator_guide_url,
                courseFiles.slides_url,
                courseFiles.trainer_slides_url,
                courseFiles.activities_url,
                courseFiles.assessment_plan_url,
                ...assessmentFilesResult.rows.map(row => row.file_url)
            ].filter(Boolean); // Remove null/undefined values

            console.log(`🗂️ Found ${filesToDelete.length} files to delete`);

            // Delete each file
            filesToDelete.forEach(deleteFile);

            res.status(200).json({
                success: true,
                message: 'Course and associated files deleted successfully',
                deletedFilesCount: filesToDelete.length
            });

        } catch (error) {
            // Rollback transaction on error
            await pool.query('ROLLBACK');
            throw error;
        }

    } catch (error: any) {
        console.error('❌ Delete course API error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete course',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}