import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { sanitizeGoogleLink } from '../../../lib/utils/sanitizeGoogleLink';
import { recordCourseChanges } from '../../../lib/courseChangeLog';
import { IncomingForm, File as FormidableFile } from 'formidable';
import fs from 'fs';
import path from 'path';

// Configure formidable
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper function to validate UUID format
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

// Helper function to check if courseId exists in database
const checkCourseExists = async (courseId: string): Promise<boolean> => {
  try {
    const result = await pool.query('SELECT id FROM course WHERE id = $1', [courseId]);
    return result.rows.length > 0;
  } catch (error) {
    return false;
  }
};

interface CourseData {
  id?: string;
  title: string;
  imageUrl: string;
  courseCode: string;
  newCourseCode?: string;
  courseDuration?: number; // Add this to match Course interface
  tscTitle: string;
  tscCode: string;
  trainingHours: number;
  assessmentHours: number;
  modeOfLearning: string | string[]; // Accept both formats
  courseType: string;
  learningOutcomes: string;
  isGamified: boolean;
  courseFee?: number;
  taxPercent?: number;
  scheduleId?: string;
  courseFeesExcludeGst?: string | number;
  courseFeesIncludeGst?: string | number;
  afterNormalFunding?: string | number;
  afterMcesFunding?: string | number;
  isUtapEligible?: boolean;
  renewedStatus?: string;
  trainerSlidesUrl?: string; // For Google Slides links
  activitiesUrl?: string; // Link to hands-on lab worksheets / activities folder
  lessonPlanUrl?: string;
  learnerGuideUrl?: string;
  facilitatorGuideUrl?: string;
  assessmentPlanUrl?: string;
  slidesUrl?: string;
  courseLink?: string;
  brochureLink?: string;
  skillsfutureLink?: string;
  assessmentRecordLink?: string;
  assessmentSummaryRecordUrl?: string;
  fundingValidity?: string;
  /** Start of the funding validity window — stored on course_code_history.valid_from of the code in force. */
  fundingValidityStart?: string | null;
  numOfTrainers?: number;
  trainersList?: string;
  trainersEmailList?: string;
  writtenAssessmentLink?: string;
  practicalPerformanceAssessmentLink?: string;
  assessmentMethods?: Record<string, { enabled: boolean; link: string }>;
  learningUnits: {
    id?: string;
    title: string;
    position: number;
    subtopics: {
      id?: string;
      title: string;
      position: number;
    }[];
  }[];
  assessments: {
    id?: string;
    title: string;
    category: string;
    fileUrl?: string;
    status?: string;
    action?: 'create' | 'update' | 'delete';
  }[];
  resourceLinks?: Array<{ id: string; topicId: string; type: string; title: string; url: string; instructions?: string }>;
}

// Ensure upload directories exist
const ensureUploadDirs = () => {
  const dirs = [
    'public/uploads/images',
    'public/uploads/plans',
    'public/uploads/guides',
    'public/uploads/slides',
    'public/uploads/assessments'
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

const saveUploadedFile = async (file: FormidableFile, subfolder: string): Promise<string> => {
  const uploadDir = path.join('public/uploads', subfolder);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const timestamp = Date.now();
  const originalName = file.originalFilename || 'unnamed';
  const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileName = `${timestamp}-${cleanName}`;
  const filePath = path.join(uploadDir, fileName);
  
  // Move file from temp location to final location
  fs.copyFileSync(file.filepath, filePath);
  fs.unlinkSync(file.filepath); // Clean up temp file
  
  return `/uploads/${subfolder}/${fileName}`;
};

// Helper function to delete old files
const deleteOldFile = (fileUrl: string): void => {
  try {
    if (!fileUrl) return;
    console.log(`      🔍 deleteOldFile called with: ${fileUrl}`);
    
    // Normalize URL -> disk path under public/
    const relativePath = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
    const fullPath = path.resolve(process.cwd(), 'public', relativePath);
    console.log(`      📁 Resolved path: ${fullPath}`);
    console.log(`      📋 File exists check: ${fs.existsSync(fullPath)}`);
    
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`      ✅ Successfully deleted: ${fullPath}`);
    } else {
      console.log(`      ⚠️ File not found (skip): ${fullPath}`);
    }
  } catch (error) {
    console.error(`      ❌ Error deleting file ${fileUrl}:`, error);
  }
};

// Helper function to get assessment file URL from database
const getAssessmentFileUrl = async (client: any, assessmentId: string, courseId: string): Promise<string | null> => {
  try {
    const result = await client.query(
      'SELECT file_url FROM assessment WHERE id = $1 AND course_id = $2',
      [assessmentId, courseId]
    );
    return result.rows.length > 0 ? result.rows[0].file_url : null;
  } catch (error) {
    console.error('❌ Error getting assessment file URL:', error);
    return null;
  }
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  console.log('🔄 Starting course update process...');
  console.log('Request method:', req.method);
  console.log('Request query:', req.query);
  console.log('🔍 Headers content-type:', req.headers['content-type']);

  try {
    const { courseId } = req.query;
    
    if (!courseId || typeof courseId !== 'string') {
      console.log('❌ No course ID provided or invalid format');
      return res.status(400).json({ 
        success: false, 
        message: 'Course ID is required and must be a string' 
      });
    }

    console.log('🔍 Validating course ID:', courseId);

    // Check if courseId is in valid UUID format
    if (!isValidUUID(courseId)) {
      console.log('❌ Invalid UUID format for course ID:', courseId);
      
      // Check if it's in the temporary format (course_timestamp)
      if (courseId.startsWith('course_')) {
        console.log('🔄 Course ID appears to be a temporary frontend ID');
        return res.status(400).json({ 
          success: false, 
          message: 'Course must be created before it can be updated. Please save the course first to generate a proper course ID.',
          error: 'TEMPORARY_COURSE_ID'
        });
      }
      
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid course ID format. Course ID must be a valid UUID.',
        error: 'INVALID_UUID_FORMAT'
      });
    }

    // Check if course exists in database
    console.log('🔍 Checking if course exists in database...');
    const courseExists = await checkCourseExists(courseId);
    if (!courseExists) {
      console.log('❌ Course not found in database:', courseId);
      return res.status(404).json({ 
        success: false, 
        message: 'Course not found. Please check the course ID.',
        error: 'COURSE_NOT_FOUND'
      });
    }

    console.log('✅ Course ID validated successfully:', courseId);
    console.log('🔄 Updating course:', courseId);

    // Ensure upload directories exist
    ensureUploadDirs();

    console.log('📝 Parsing form data with formidable...');

    // Parse form data
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
      allowEmptyFiles: true, // Allow empty files to prevent FormidableError
      minFileSize: 0, // Explicitly set minimum file size to 0 bytes
    });

    console.log('🔍 Form created, starting parse...');
    
    let fields, files;
    try {
      [fields, files] = await form.parse(req);
    } catch (parseError) {
      console.error('❌ Form parsing failed:', parseError);
      return res.status(400).json({ 
        success: false, 
        message: 'Failed to parse form data',
        error: parseError instanceof Error ? parseError.message : 'Unknown parsing error'
      });
    }
    
    console.log('✅ Form parsing completed');
    console.log('📄 Fields received:', Object.keys(fields));
    console.log('📁 Files received:', Object.keys(files));
    console.log('🔍 DETAILED FORM DATA ANALYSIS:');
    const courseDataField = Array.isArray(fields.courseData) ? fields.courseData[0] : fields.courseData;
    console.log('  - courseData length:', courseDataField ? String(courseDataField).length : 'missing');
    console.log('  - assessmentFilesToDelete present:', !!fields.assessmentFilesToDelete);
    if (fields.assessmentFilesToDelete) {
      console.log('  - assessmentFilesToDelete type:', typeof fields.assessmentFilesToDelete);
      console.log('  - assessmentFilesToDelete value:', fields.assessmentFilesToDelete);
    }
    
    const courseDataStr = Array.isArray(fields.courseData) ? fields.courseData[0] : fields.courseData;
    console.log('📊 Raw course data string length:', courseDataStr?.length || 0);
    
    if (!courseDataStr) {
      console.log('❌ No courseData found in form fields');
      return res.status(400).json({ message: 'Course data is required' });
    }
    
    let courseData: CourseData;
    try {
      courseData = JSON.parse(courseDataStr);
    } catch (jsonError) {
      console.error('❌ JSON parsing failed:', jsonError);
      console.log('📝 Raw courseData string:', courseDataStr);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid JSON in course data',
        error: jsonError instanceof Error ? jsonError.message : 'JSON parse error'
      });
    }

    console.log('📊 Course data to update:', {
      title: courseData.title,
      assessments: courseData.assessments?.length || 0,
      learningUnits: courseData.learningUnits?.length || 0,
      modeOfLearning: courseData.modeOfLearning
    });

    // Validate required fields
    if (!courseData.title) {
      return res.status(400).json({ 
        success: false, 
        message: 'Course title is required' 
      });
    }
    
    if (!courseData.tscTitle) {
      console.log('⚠️ Missing tscTitle, using default');
      courseData.tscTitle = courseData.title; // Use title as fallback
    }
    
    if (!courseData.tscCode) {
      console.log('⚠️ Missing tscCode, using default');
      courseData.tscCode = courseData.courseCode; // Use courseCode as fallback
    }

    // Handle modeOfLearning conversion (array to string)
    const modeOfLearning = Array.isArray(courseData.modeOfLearning) 
      ? courseData.modeOfLearning[0] || 'Physical'
      : courseData.modeOfLearning || 'Physical';

    console.log('🔄 Converted modeOfLearning:', modeOfLearning);

    // Defer all file deletions until after successful DB commit
    const pendingFileDeletions: string[] = [];

    // Handle old file deletion
    const oldFileUrlsStr = Array.isArray(fields.oldFileUrls) ? fields.oldFileUrls[0] : fields.oldFileUrls;
    if (oldFileUrlsStr) {
      try {
        const oldFileUrls = JSON.parse(oldFileUrlsStr);
        console.log('🗑️ Old files to delete:', oldFileUrls);
        
        Object.entries(oldFileUrls).forEach(([fileType, fileUrl]) => {
          if (typeof fileUrl === 'string') {
            deleteOldFile(fileUrl);
          }
        });
      } catch (error) {
        console.error('❌ Error parsing old file URLs:', error);
      }
    }

    // Parse assessmentFilesToDelete (sent by client) -> defer deletion
    console.log('\n🗑️ ASSESSMENT FILE DELETION CHECK:');
    const assessmentFilesToDeleteStr = Array.isArray(fields.assessmentFilesToDelete) ? fields.assessmentFilesToDelete[0] : fields.assessmentFilesToDelete;
    console.log('  - assessmentFilesToDeleteStr:', assessmentFilesToDeleteStr);
    
    if (assessmentFilesToDeleteStr) {
      try {
        const urls = JSON.parse(String(assessmentFilesToDeleteStr)) as string[];
        console.log('  - Parsed assessment files to delete:', urls);
        if (Array.isArray(urls)) {
          for (const url of urls) {
            if (url && url.includes('/uploads/')) {
              pendingFileDeletions.push(url);
              console.log(`  - Marked for deletion: ${url}`);
            }
          }
        }
      } catch (error) {
        console.error('  ❌ Failed to parse assessmentFilesToDelete:', error);
      }
    } else {
      console.log('  - No assessment files to delete');
    }

    // Build map of uploaded assessment files keyed by assessmentId:
    // Expect fields named like "assessmentFile_<assessmentId>"
    const assessmentFilesMap: Record<string, FormidableFile> = {};
    console.log('\n📁 ASSESSMENT FILE MAPPING:');
    for (const [key, value] of Object.entries(files)) {
      if (!key.startsWith('assessmentFile_')) continue;
      const assessmentId = key.replace('assessmentFile_', '');
      const fileAny = Array.isArray(value) ? value[0] : value;
      if (fileAny && (fileAny as any).filepath) {
        assessmentFilesMap[assessmentId] = fileAny as FormidableFile;
        console.log(`  - Mapped file for assessment ${assessmentId}: ${(fileAny as any).originalFilename}`);
      }
    }
    console.log(`  - Total assessment files mapped: ${Object.keys(assessmentFilesMap).length}`);

    // Handle file uploads and get new URLs
    const fileUrls: { [key: string]: string } = {};

    if (files.courseImage) {
      const file = Array.isArray(files.courseImage) ? files.courseImage[0] : files.courseImage;
      if (file.size > 0) { // Only process non-empty files
        fileUrls.imageUrl = await saveUploadedFile(file, 'images');
      }
    }

    if (files.lessonPlan) {
      const file = Array.isArray(files.lessonPlan) ? files.lessonPlan[0] : files.lessonPlan;
      if (file.size > 0) { // Only process non-empty files
        fileUrls.lessonPlanUrl = await saveUploadedFile(file, 'plans');
      }
    }

    if (files.learnerGuide) {
      const file = Array.isArray(files.learnerGuide) ? files.learnerGuide[0] : files.learnerGuide;
      if (file.size > 0) { // Only process non-empty files
        fileUrls.learnerGuideUrl = await saveUploadedFile(file, 'guides');
      }
    }

    if (files.facilitatorGuide) {
      const file = Array.isArray(files.facilitatorGuide) ? files.facilitatorGuide[0] : files.facilitatorGuide;
      if (file.size > 0) { // Only process non-empty files
        fileUrls.facilitatorGuideUrl = await saveUploadedFile(file, 'guides');
      }
    }

    if (files.assessmentPlan) {
      const file = Array.isArray(files.assessmentPlan) ? files.assessmentPlan[0] : files.assessmentPlan;
      if (file.size > 0) { // Only process non-empty files
        fileUrls.assessmentPlanUrl = await saveUploadedFile(file, 'plans');
      }
    }

    if (files.learnerSlides) {
      const file = Array.isArray(files.learnerSlides) ? files.learnerSlides[0] : files.learnerSlides;
      if (file.size > 0) { // Only process non-empty files
        fileUrls.slidesUrl = await saveUploadedFile(file, 'slides');
      }
    }

    if (files.trainerSlides) {
      const file = Array.isArray(files.trainerSlides) ? files.trainerSlides[0] : files.trainerSlides;
      if (file.size > 0) { // Only process non-empty files
        fileUrls.trainerSlidesUrl = await saveUploadedFile(file, 'slides');
      }
    }

    if (files.writtenAssessment) {
      const file = Array.isArray(files.writtenAssessment) ? files.writtenAssessment[0] : files.writtenAssessment;
      if (file.size > 0) {
        fileUrls.writtenAssessmentLink = await saveUploadedFile(file, 'assessments');
      }
    }

    if (files.practicalPerformanceAssessment) {
      const file = Array.isArray(files.practicalPerformanceAssessment) ? files.practicalPerformanceAssessment[0] : files.practicalPerformanceAssessment;
      if (file.size > 0) {
        fileUrls.practicalPerformanceAssessmentLink = await saveUploadedFile(file, 'assessments');
      }
    }

    // Handle assessment files
    const assessmentFiles = files.assessmentFiles;
    const assessmentFileUrls: string[] = [];
    
    if (assessmentFiles) {
      const filesArray = Array.isArray(assessmentFiles) ? assessmentFiles : [assessmentFiles];
      for (const file of filesArray) {
        const url = await saveUploadedFile(file, 'assessments');
        assessmentFileUrls.push(url);
      }
    }

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      console.log('✅ Database transaction started');

      // 0. Record what is about to change, for the Course Change Control log.
      // Runs BEFORE the UPDATE because it reads the pre-update values to compute
      // the "from" side of each change. Best-effort: a SAVEPOINT keeps a failure
      // here (e.g. the table not yet migrated) from aborting the whole save --
      // losing an audit row is acceptable, losing the user's edit is not.
      try {
        await client.query('SAVEPOINT before_change_log');
        const authUser = (req as any).authUser;
        await recordCourseChanges(
          client,
          courseId,
          courseData,
          // Service callers have no app_user row, so attributing the change to
          // their id would violate the FK; record them by name only.
          authUser?.isService
            ? { userName: 'System' }
            : { userId: authUser?.id || null },
        );
        await client.query('RELEASE SAVEPOINT before_change_log');
      } catch (logError) {
        await client.query('ROLLBACK TO SAVEPOINT before_change_log');
        console.error('⚠️ Course change log skipped:', (logError as Error).message);
      }

      // 1. Update course basic information
      console.log('🔄 Updating course basic information...');
      const updateCourseQuery = `
        UPDATE course
        SET 
          title = $1,
          image_url = $2,
          course_code = $3,
          tsc_title = $4,
          tsc_code = $5,
          training_hours = $6,
          assessment_hours = $7,
          mode_of_learning = $8,
          course_type = $9,
          learning_outcomes = $10,
          lesson_plan_url = COALESCE($11, lesson_plan_url),
          learner_guide_url = COALESCE($12, learner_guide_url),
          facilitator_guide_url = COALESCE($13, facilitator_guide_url),
          assessment_plan_url = COALESCE($14, assessment_plan_url),
          slides_url = COALESCE($15, slides_url),
          trainer_slides_url = COALESCE($16, trainer_slides_url),
          is_gamified = $17,
          course_fee = $18,
          tax_percent = $19,
          schedule_id = $20,
          course_fees_exclude_gst = $21,
          course_fees_include_gst = $22,
          after_normal_funding = $23,
          after_mces_funding = $24,
          is_utap_eligible = $25,
          renewed_status = $26,
          written_assessment_link = $27,
          practical_performance_assessment_link = $28,
          courseware_link = $29,
          brochure_link = $30,
          skillsfuture_link = $31,
          assessment_record_link = $32,
          assessment_summary_record_url = $33,
          funding_validity = $34,
          num_of_trainers = $35,
          trainers_list = $36,
          trainers_email_list = $37,
          activities_url = COALESCE($38, activities_url),
          -- The code issued at funding renewal. course_code above keeps the
          -- ORIGINAL code so history stays traceable.
          --
          -- A BLANK value leaves the existing code alone rather than clearing it.
          -- Treating blank as "erase" cost us a live code: a client that did not
          -- load the field sent '', which NULLIF turned into NULL and silently
          -- wiped a renewal on save. Clearing a renewed code is not something the
          -- course editor ever needs to do, so blank means "not supplied".
          new_course_code = CASE WHEN NULLIF(btrim(COALESCE($40::text, '')), '') IS NULL
                                 THEN new_course_code
                                 ELSE btrim($40::text) END,
          updated_at = now()
        WHERE id = $39
        RETURNING id
      `;

      const courseResult = await client.query(updateCourseQuery, [
        courseData.title,
        fileUrls.imageUrl || courseData.imageUrl, // Use uploaded file URL if available, otherwise keep existing
        courseData.courseCode,
        courseData.tscTitle || courseData.title,
        courseData.tscCode || courseData.courseCode,
        courseData.trainingHours,
        courseData.assessmentHours,
        modeOfLearning, // Use converted value
        courseData.courseType,
        courseData.learningOutcomes,
        fileUrls.lessonPlanUrl || courseData.lessonPlanUrl || null,
        fileUrls.learnerGuideUrl || courseData.learnerGuideUrl || null,
        fileUrls.facilitatorGuideUrl || courseData.facilitatorGuideUrl || null,
        fileUrls.assessmentPlanUrl || courseData.assessmentPlanUrl || null,
        fileUrls.slidesUrl || courseData.slidesUrl || null,
        fileUrls.trainerSlidesUrl || courseData.trainerSlidesUrl || null, // Use uploaded file or URL
        courseData.isGamified,
        courseData.courseFee || null,
        courseData.taxPercent || null,
        courseData.scheduleId || null,
        courseData.courseFeesExcludeGst || null,
        courseData.courseFeesIncludeGst || null,
        courseData.afterNormalFunding || null,
        courseData.afterMcesFunding || null,
        !!courseData.isUtapEligible,
        courseData.renewedStatus || null,
        sanitizeGoogleLink(fileUrls.writtenAssessmentLink || courseData.writtenAssessmentLink) || null,
        sanitizeGoogleLink(fileUrls.practicalPerformanceAssessmentLink || courseData.practicalPerformanceAssessmentLink) || null,
        courseData.courseLink ?? null,
        courseData.brochureLink ?? null,
        courseData.skillsfutureLink ?? null,
        courseData.assessmentRecordLink ?? null,
        courseData.assessmentSummaryRecordUrl || null,
        courseData.fundingValidity || null,
        courseData.numOfTrainers ?? 0,
        courseData.trainersList || null,
        courseData.trainersEmailList || null,
        fileUrls.activitiesUrl || courseData.activitiesUrl || null,
        courseId,
        courseData.newCourseCode === undefined ? null : courseData.newCourseCode
      ]);

      // Persist the funding-validity START date. It lives on the history row of
      // the code currently in force (course_code_history.valid_from), not on the
      // course table, so it is written separately from the end date above.
      if (courseData.fundingValidityStart !== undefined) {
        const start = String(courseData.fundingValidityStart || '').slice(0, 10) || null;
        const cur = await client.query(
          `SELECT COALESCE(
                    (SELECT h.code FROM public.course_code_history h WHERE h.course_id = c.id AND h.is_current LIMIT 1),
                    NULLIF(c.new_course_code, ''),
                    c.course_code
                  ) AS code
             FROM course c WHERE c.id = $1`,
          [courseId]
        );
        const currentCode = cur.rows[0]?.code;
        if (currentCode) {
          await client.query(
            `INSERT INTO public.course_code_history (course_id, code, valid_from, is_current)
             VALUES ($1, $2, $3::date, true)
             ON CONFLICT (code) DO UPDATE
                SET valid_from = EXCLUDED.valid_from,
                    is_current = true,
                    updated_at = now()`,
            [courseId, currentCode, start]
          );
        }
      }

      // Safely attempt to update assessment_methods column
      // This column may not exist if the migration hasn't been run yet
      // Use SAVEPOINT so a failure doesn't abort the entire transaction
      if (courseData.assessmentMethods) {
        try {
          // Sanitize each method's link so multi-account Google share URLs
          // (ouid / /u/<n>/) don't break for trainers and learners.
          const sanitizedMethods = Object.fromEntries(
            Object.entries(courseData.assessmentMethods).map(([key, method]) => [
              key,
              { ...method, link: sanitizeGoogleLink(method.link) },
            ])
          );
          await client.query('SAVEPOINT update_assessment_methods');
          await client.query(
            'UPDATE course SET assessment_methods = $1::jsonb WHERE id = $2',
            [JSON.stringify(sanitizedMethods), courseId]
          );
          await client.query('RELEASE SAVEPOINT update_assessment_methods');
          console.log('✅ assessment_methods updated successfully');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT update_assessment_methods');
          console.error('⚠️ Could not update assessment_methods:', e instanceof Error ? e.message : e);
        }
      }

      if (courseResult.rows.length === 0) {
        throw new Error('Course not found or update failed');
      }

      console.log('✅ Course basic info updated');

      // 2. Update learning units and subtopics (delete and recreate)
      // Delete existing subtopics first
      await client.query(`
        DELETE FROM subtopic
        WHERE learning_unit_id IN (
          SELECT id FROM learning_unit WHERE course_id = $1
        )
      `, [courseId]);

      // Delete existing learning units
      await client.query(`
        DELETE FROM learning_unit
        WHERE course_id = $1
      `, [courseId]);

      console.log('🗑️ Existing learning units and subtopics deleted');

      // Insert new learning units and subtopics, tracking old→new subtopic ID mapping
      const subtopicIdMap: { [oldId: string]: string } = {};
      for (const unit of courseData.learningUnits) {
        const unitResult = await client.query(`
          INSERT INTO learning_unit (course_id, title, position)
          VALUES ($1, $2, $3)
          RETURNING id
        `, [courseId, unit.title, unit.position]);

        const unitId = unitResult.rows[0].id;

        // Insert subtopics for this unit
        for (const subtopic of unit.subtopics) {
          const subtopicResult = await client.query(`
            INSERT INTO subtopic (learning_unit_id, title, position)
            VALUES ($1, $2, $3)
            RETURNING id
          `, [unitId, subtopic.title, subtopic.position]);

          // Map old subtopic ID to new database ID
          if (subtopic.id) {
            subtopicIdMap[subtopic.id] = subtopicResult.rows[0].id;
          }
        }
      }

      console.log(`✅ ${courseData.learningUnits.length} learning units recreated`);
      console.log('📎 Subtopic ID mapping:', subtopicIdMap);

      // Update resource_links with new subtopic IDs
      if (courseData.resourceLinks && courseData.resourceLinks.length > 0) {
        const updatedResourceLinks = courseData.resourceLinks.map(rl => ({
          ...rl,
          topicId: subtopicIdMap[rl.topicId] || rl.topicId
        }));
        await client.query(
          `UPDATE course SET resource_links = $1 WHERE id = $2`,
          [JSON.stringify(updatedResourceLinks), courseId]
        );
        console.log('✅ Resource links updated with new subtopic IDs');
      } else {
        // Clear resource_links if none provided
        await client.query(
          `UPDATE course SET resource_links = $1 WHERE id = $2`,
          [courseData.resourceLinks ? '[]' : null, courseId]
        );
      }

      // 3. Handle assessments (create, update, delete)
      console.log('\n📝 ASSESSMENT PROCESSING:');
      const createdAssessments: string[] = []; // Track newly created assessment IDs
      const deletedAssessmentIds: string[] = []; // Track deleted assessment IDs
      
      if (Array.isArray(courseData.assessments)) {
        console.log('  - Total assessments to process:', courseData.assessments.length);
        
        for (const assessment of courseData.assessments) {
          const action = assessment.action || (assessment.id ? 'update' : 'create');
          console.log(`\n  🔄 Processing assessment: ${assessment.title} (action: ${action})`);
          
          if (action === 'delete' && assessment.id) {
            console.log('    📋 DELETION: Getting current file URL...');
            // Get current file_url before deleting
            const oldUrl = await getAssessmentFileUrl(client, assessment.id, courseId);
            console.log(`    📁 Current file URL: ${oldUrl}`);
            
            // Delete the assessment row
            await client.query('DELETE FROM assessment WHERE id = $1 AND course_id = $2', [assessment.id, courseId]);
            
            // Defer file deletion until after commit
            if (oldUrl && oldUrl.includes('/uploads/')) {
              pendingFileDeletions.push(oldUrl);
              console.log(`    🗑️ Marked file for deletion: ${oldUrl}`);
            } else {
              console.log('    ⚠️ No file to delete or invalid URL');
            }
            
            deletedAssessmentIds.push(assessment.id);
            console.log(`    ✅ Assessment deleted: ${assessment.title}`);
            continue;
          }

          if (action === 'create') {
            console.log('    📋 CREATION: Inserting new assessment...');
            // Insert first (without file), then attach file if provided
            const insertRes = await client.query(
              `INSERT INTO assessment (course_id, title, category, status, file_url)
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [
                courseId,
                assessment.title || 'Untitled Assessment',
                assessment.category || 'PracticalExam',
                assessment.status || 'Published',
                null
              ]
            );
            const newId: string = insertRes.rows[0].id;
            createdAssessments.push(newId);
            console.log(`    📝 Created assessment with ID: ${newId}`);

            // If a file uploaded for this temp id or provided id, save it
            const uploadKey = assessmentFilesMap[assessment.id || ''] ? assessment.id! : (assessmentFilesMap[newId] ? newId : undefined);
            if (uploadKey && assessmentFilesMap[uploadKey]) {
              console.log(`    📁 Uploading file for assessment...`);
              const newUrl = await saveUploadedFile(assessmentFilesMap[uploadKey], 'assessments');
              await client.query(
                'UPDATE assessment SET file_url = $1 WHERE id = $2 AND course_id = $3',
                [newUrl, newId, courseId]
              );
              console.log(`    ✅ File attached: ${newUrl}`);
            } else {
              console.log('    ⚠️ No file uploaded for this assessment');
            }
            continue;
          }

          if (action === 'update' && assessment.id) {
            console.log('    📋 UPDATE: Updating existing assessment...');
            // Update title/category/status
            await client.query(
              `UPDATE assessment SET title = $1, category = $2, status = $3 WHERE id = $4 AND course_id = $5`,
              [
                assessment.title || 'Untitled Assessment',
                assessment.category || 'PracticalExam',
                assessment.status || 'Published',
                assessment.id,
                courseId
              ]
            );
            console.log(`    📝 Updated assessment metadata`);

            // If a new file uploaded for this assessment, replace old one
            if (assessmentFilesMap[assessment.id]) {
              console.log(`    📁 Replacing file for assessment...`);
              const oldUrl = await getAssessmentFileUrl(client, assessment.id, courseId);
              console.log(`    📁 Old file URL: ${oldUrl}`);
              
              const newUrl = await saveUploadedFile(assessmentFilesMap[assessment.id], 'assessments');
              await client.query(
                'UPDATE assessment SET file_url = $1 WHERE id = $2 AND course_id = $3',
                [newUrl, assessment.id, courseId]
              );
              console.log(`    📁 New file URL: ${newUrl}`);
              
              // Mark old file for deletion after commit
              if (oldUrl && oldUrl.includes('/uploads/')) {
                pendingFileDeletions.push(oldUrl);
                console.log(`    🗑️ Marked old file for deletion: ${oldUrl}`);
              }
              console.log(`    ✅ File replaced successfully`);
            } else {
              console.log(`    ⚠️ No new file uploaded for this assessment`);
            }
            continue;
          }
        }
      } else {
        console.log('  - No assessments to process');
      }

      // 4. Handle course_run_assessment table updates
      let courseRuns: any[] = [];
      
      if (createdAssessments.length > 0 || deletedAssessmentIds.length > 0) {
        // Get all course runs for this course
        const courseRunsResult = await client.query(`
          SELECT id FROM course_run 
          WHERE course_id = $1
        `, [courseId]);
        
        courseRuns = courseRunsResult.rows;
        console.log(`📚 Found ${courseRuns.length} course runs for course ${courseId}`);

        // Handle newly created assessments - add to all course runs
        if (createdAssessments.length > 0) {
          for (const courseRun of courseRuns) {
            for (const assessmentId of createdAssessments) {
              await client.query(`
                INSERT INTO course_run_assessment (
                  course_run_id,
                  assessment_id,
                  published,
                  published_at
                ) VALUES ($1, $2, $3, now())
              `, [courseRun.id, assessmentId, false]); // Default published = false
            }
          }
          console.log(`✅ Added ${createdAssessments.length} new assessments to ${courseRuns.length} course runs`);
        }

        // Handle deleted assessments - remove from all course runs
        if (deletedAssessmentIds.length > 0) {
          for (const courseRun of courseRuns) {
            for (const assessmentId of deletedAssessmentIds) {
              await client.query(`
                DELETE FROM course_run_assessment
                WHERE course_run_id = $1 AND assessment_id = $2
              `, [courseRun.id, assessmentId]);
            }
          }
          console.log(`🗑️ Removed ${deletedAssessmentIds.length} deleted assessments from ${courseRuns.length} course runs`);
        }
      }

      // Commit transaction
      await client.query('COMMIT');
      console.log('✅ Transaction committed successfully');

      // After successful commit, delete all pending files from disk
      if (pendingFileDeletions.length > 0) {
        console.log('\n🧹 EXECUTING PENDING FILE DELETIONS:');
        console.log(`  - Total files to delete: ${pendingFileDeletions.length}`);
        
        // Deduplicate URLs
        const uniqueUrls = Array.from(new Set(pendingFileDeletions));
        console.log(`  - Unique files to delete: ${uniqueUrls.length}`);
        
        let successCount = 0;
        for (const url of uniqueUrls) {
          console.log(`  🗑️ Deleting: ${url}`);
          try {
            deleteOldFile(url);
            successCount++;
          } catch (error) {
            console.error(`  ❌ Failed to delete ${url}:`, error);
          }
        }
        console.log(`  ✅ Successfully deleted ${successCount}/${uniqueUrls.length} files`);
      } else {
        console.log('  - No pending file deletions');
      }

      res.status(200).json({
        success: true,
        message: 'Course updated successfully',
        data: {
          courseId,
          updatedFiles: Object.keys(fileUrls),
          assessmentFilesUploaded: Object.keys(assessmentFilesMap).length,
          filesDeleted: pendingFileDeletions.length,
          courseRunAssessments: {
            courseRunsAffected: courseRuns.length,
            assessmentsAdded: createdAssessments.length,
            assessmentsRemoved: deletedAssessmentIds.length,
            newAssessmentIds: createdAssessments,
            deletedAssessmentIds: deletedAssessmentIds
          }
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Error updating course:', error);
    
    // Log more detailed error information
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    } else {
      console.error('Unknown error type:', typeof error, error);
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        type: typeof error
      } : undefined
    });
  }
}

export default withAuth(handler);
