import { NextApiRequest, NextApiResponse } from 'next';
import multer, { StorageEngine } from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';
import { sanitizeGoogleLink } from '../../../lib/utils/sanitizeGoogleLink';

// Configure multer for file uploads
const storage: StorageEngine = multer.diskStorage({
  destination: (req: any, file: any, cb: any) => {
    let uploadPath = 'public/uploads';
    
    // Determine upload path based on field name
    switch (file.fieldname) {
      case 'courseImage':
        uploadPath = 'public/uploads/images';
        break;
      case 'lessonPlan':
      case 'assessmentPlan':
        uploadPath = 'public/uploads/plans';
        break;
      case 'learnerGuide':
      case 'facilitatorGuide':
        uploadPath = 'public/uploads/guides';
        break;
      case 'learnerSlides':
      case 'trainerSlides':
        uploadPath = 'public/uploads/slides';
        break;
      case 'writtenAssessment':
      case 'practicalPerformanceAssessment':
      case 'assessmentFiles':
        uploadPath = 'public/uploads/assessments';
        break;
      default:
        // Check if it's a dynamic assessment file field name
        if (file.fieldname.startsWith('assessmentFile_')) {
          uploadPath = 'public/uploads/assessments';
        } else {
          uploadPath = 'public/uploads';
        }
    }
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req: any, file: any, cb: any) => {
    // Create unique filename
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${cleanName}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req: any, file: any, cb: any) => {
    // Accept common document types and images for course image
    const allowedTypes = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Allowed types: ${allowedTypes.join(', ')}`));
    }
  }
});

// Middleware to handle multipart/form-data
// Use upload.any() to accept dynamic field names for assessment files
const uploadMiddleware = upload.any();

interface CourseData {
  title: string;
  imageUrl: string;
  courseCode: string;
  tscTitle: string;
  tscCode: string;
  trainingHours: number;
  assessmentHours: number;
  modeOfLearning: string;
  courseType: string;
  learningOutcomes: string;
  trainerSlidesUrl?: string;
  writtenAssessmentLink?: string;
  practicalPerformanceAssessmentLink?: string;
  courseLink?: string;
  assessmentRecordLink?: string;
  assessmentSummaryRecordUrl?: string;
  assessmentMethods?: Record<string, { enabled: boolean; link: string }>;
  isGamified: boolean;
  learningUnits: Array<{
    title: string;
    position: number;
    subtopics: Array<{
      title: string;
      position: number;
    }>;
  }>;
  assessments: Array<{
    id: string;
    title: string;
    category: string;
    fileName?: string;
  }>;
  resourceLinks?: Array<{ id: string; topicId: string; type: string; title: string; url: string; instructions?: string }>;
}

export default function handler(req: NextApiRequest & { files?: any }, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return; // Preflight request handled
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Use multer middleware
  uploadMiddleware(req as any, res as any, async (err: any) => {
    if (err) {
      console.error('❌ File upload error:', err);
      return res.status(400).json({ 
        success: false, 
        message: 'File upload failed', 
        error: err.message 
      });
    }

    try {
      // Parse the course data from form
      const courseData: CourseData = JSON.parse(req.body.courseData || '{}');
      
      console.log('📝 Received course data:', {
        title: courseData.title,
        courseCode: courseData.courseCode,
        learningUnits: courseData.learningUnits?.length || 0,
        assessments: courseData.assessments?.length || 0
      });
      
      if (!courseData.title || !courseData.courseCode) {
        return res.status(400).json({
          success: false,
          message: 'Course title and code are required'
        });
      }

      const files = req.files as any[];
      console.log('📁 Received files:', files?.map(f => f.fieldname) || []);
      
      // Convert files array to object for easier access
      const filesByFieldname: { [key: string]: any } = {};
      if (files) {
        files.forEach(file => {
          if (!filesByFieldname[file.fieldname]) {
            filesByFieldname[file.fieldname] = [];
          }
          filesByFieldname[file.fieldname].push(file);
        });
      }
      
      console.log('📝 Course data:', courseData);
      console.log('📎 Trainer slides info:', {
        hasTrainerSlidesFile: !!(filesByFieldname?.trainerSlides),
        trainerSlidesUrl: courseData.trainerSlidesUrl,
        finalValue: filesByFieldname?.trainerSlides ? `/uploads/slides/${filesByFieldname.trainerSlides[0].filename}` : courseData.trainerSlidesUrl || null
      });

      // Begin database transaction
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');

        // 1. Insert course
        const courseInsertQuery = `
          INSERT INTO course (
            title, image_url, course_code, tsc_title, tsc_code,
            training_hours, assessment_hours, mode_of_learning, course_type,
            learning_outcomes, is_gamified, learner_guide_url, slides_url,
            lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url,
            written_assessment_link, practical_performance_assessment_link,
            courseware_link, assessment_record_link, assessment_summary_record_url, resource_links
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
          RETURNING id
        `;

        const courseValues = [
          courseData.title,
          filesByFieldname?.courseImage ? `/uploads/images/${filesByFieldname.courseImage[0].filename}` : (courseData.imageUrl || null),
          courseData.courseCode,
          courseData.tscTitle || null,
          courseData.tscCode || null,
          courseData.trainingHours || 0,
          courseData.assessmentHours || 0,
          courseData.modeOfLearning || 'Physical',
          courseData.courseType || 'Non-WSQ',
          courseData.learningOutcomes || null,
          courseData.isGamified || false,
          filesByFieldname?.learnerGuide ? `/uploads/guides/${filesByFieldname.learnerGuide[0].filename}` : null,
          filesByFieldname?.learnerSlides ? `/uploads/slides/${filesByFieldname.learnerSlides[0].filename}` : null,
          filesByFieldname?.lessonPlan ? `/uploads/plans/${filesByFieldname.lessonPlan[0].filename}` : null,
          filesByFieldname?.assessmentPlan ? `/uploads/plans/${filesByFieldname.assessmentPlan[0].filename}` : null,
          filesByFieldname?.facilitatorGuide ? `/uploads/guides/${filesByFieldname.facilitatorGuide[0].filename}` : null,
          filesByFieldname?.trainerSlides ? `/uploads/slides/${filesByFieldname.trainerSlides[0].filename}` : courseData.trainerSlidesUrl || null,
          filesByFieldname?.writtenAssessment ? `/uploads/assessments/${filesByFieldname.writtenAssessment[0].filename}` : sanitizeGoogleLink(courseData.writtenAssessmentLink) || null,
          filesByFieldname?.practicalPerformanceAssessment ? `/uploads/assessments/${filesByFieldname.practicalPerformanceAssessment[0].filename}` : sanitizeGoogleLink(courseData.practicalPerformanceAssessmentLink) || null,
          courseData.courseLink || null,
          courseData.assessmentRecordLink || null,
          courseData.assessmentSummaryRecordUrl || null,
          courseData.resourceLinks ? JSON.stringify(courseData.resourceLinks) : null,
        ];

        console.log('🔍 About to execute course insert with values:', courseValues);
        console.log('🔍 SQL Query:', courseInsertQuery);

        const courseResult = await client.query(courseInsertQuery, courseValues);
        const courseId = courseResult.rows[0].id;
        console.log('✅ Course created with ID:', courseId);

        // Safely attempt to set assessment_methods column
        // This column may not exist if the migration hasn't been run yet
        // Use SAVEPOINT so a failure doesn't abort the entire transaction
        if (courseData.assessmentMethods) {
          try {
            const sanitizedMethods = Object.fromEntries(
              Object.entries(courseData.assessmentMethods).map(([key, method]) => [
                key,
                { ...method, link: sanitizeGoogleLink(method.link) },
              ])
            );
            await client.query('SAVEPOINT set_assessment_methods');
            await client.query(
              'UPDATE course SET assessment_methods = $1 WHERE id = $2',
              [JSON.stringify(sanitizedMethods), courseId]
            );
            await client.query('RELEASE SAVEPOINT set_assessment_methods');
          } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT set_assessment_methods');
            console.log('⚠️ Could not set assessment_methods (column may not exist yet)');
          }
        }

        // 2. Insert learning units and subtopics
        if (courseData.learningUnits && courseData.learningUnits.length > 0) {
          for (const unit of courseData.learningUnits) {
            const unitInsertQuery = `
              INSERT INTO learning_unit (course_id, title, position)
              VALUES ($1, $2, $3)
              RETURNING id
            `;
            
            const unitResult = await client.query(unitInsertQuery, [
              courseId, 
              unit.title, 
              unit.position
            ]);
            
            const unitId = unitResult.rows[0].id;
            console.log('✅ Learning unit created:', unit.title);
            
            // Insert subtopics for this unit
            if (unit.subtopics && unit.subtopics.length > 0) {
              for (const subtopic of unit.subtopics) {
                const subtopicInsertQuery = `
                  INSERT INTO subtopic (learning_unit_id, title, position)
                  VALUES ($1, $2, $3)
                `;
                
                await client.query(subtopicInsertQuery, [
                  unitId,
                  subtopic.title,
                  subtopic.position
                ]);
                console.log('✅ Subtopic created:', subtopic.title);
              }
            }
          }
        }

        // 3. Insert assessments
        if (courseData.assessments && courseData.assessments.length > 0) {
          // Get all assessment files - both legacy format and new ID-based format
          const legacyAssessmentFiles = filesByFieldname?.assessmentFiles || [];
          
          // Get assessment files with IDs (new format)
          const assessmentFilesById: { [key: string]: any } = {};
          Object.keys(filesByFieldname).forEach(fieldname => {
            if (fieldname.startsWith('assessmentFile_')) {
              const assessmentId = fieldname.replace('assessmentFile_', '');
              assessmentFilesById[assessmentId] = filesByFieldname[fieldname][0]; // Take first file for each ID
            }
          });
          
          console.log('📁 Assessment files by ID:', Object.keys(assessmentFilesById));
          console.log('📁 Legacy assessment files count:', legacyAssessmentFiles.length);
          
          for (let i = 0; i < courseData.assessments.length; i++) {
            const assessment = courseData.assessments[i];
            
            // Try to get file by assessment ID first, then fall back to legacy indexing
            let assessmentFile = null;
            if (assessment.id && assessmentFilesById[assessment.id]) {
              assessmentFile = assessmentFilesById[assessment.id];
              console.log(`📁 Using ID-based file for assessment ${assessment.id}:`, assessmentFile.filename);
            } else if (legacyAssessmentFiles[i]) {
              assessmentFile = legacyAssessmentFiles[i];
              console.log(`📁 Using legacy indexed file for assessment ${i}:`, assessmentFile.filename);
            }
            
            // Log the file object to understand its structure
            if (assessmentFile) {
              console.log('📁 Assessment file object:', {
                filename: assessmentFile.filename,
                originalname: assessmentFile.originalname,
                path: assessmentFile.path,
                destination: assessmentFile.destination
              });
            }
            
            const assessmentInsertQuery = `
              INSERT INTO assessment (course_id, title, category, status, file_url)
              VALUES ($1, $2, $3, $4, $5)
            `;
            
            // Use the actual saved filename (with timestamp) instead of original name
            const fileUrl = assessmentFile 
              ? `/uploads/assessments/${assessmentFile.filename}` 
              : null;
              
            await client.query(assessmentInsertQuery, [
              courseId,
              assessment.title,
              assessment.category,
              'Published',
              fileUrl
            ]);
            console.log('✅ Assessment created:', assessment.title);
          }
        }

        await client.query('COMMIT');
        console.log('✅ Transaction committed successfully');

        res.status(201).json({
          success: true,
          message: 'Course created successfully',
          data: {
            courseId,
            title: courseData.title,
            courseCode: courseData.courseCode
          }
        });

      } catch (dbError) {
        console.error('❌ Database error details:', {
          message: dbError instanceof Error ? dbError.message : 'Unknown error',
          stack: dbError instanceof Error ? dbError.stack : 'No stack trace',
          error: dbError
        });
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('❌ Course creation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create course',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}

// Disable Next.js body parser for this endpoint
export const config = {
  api: {
    bodyParser: false,
  },
};