/**
 * SSG API endpoint for editing and deleting course runs
 * POST /api/ssg/courses/courseRuns/[runId]?action=edit - Edit course run
 * POST /api/ssg/courses/courseRuns/[runId]?action=delete - Delete entire course run
 * POST /api/ssg/courses/courseRuns/[runId]?action=delete-sessions - Delete sessions within course run
 * POST /api/ssg/courses/courseRuns/[runId]?action=add-sessions - Add sessions to course run
 * POST /api/ssg/courses/courseRuns/[runId]?action=update-sessions - Update sessions within course run
 * POST /api/ssg/courses/courseRuns/[runId]?action=assign-trainer - Assign trainer to course run
 * 
 * CRITICAL SAFETY NOTE:
 * - action=delete: Deletes the ENTIRE course run (run.action = "delete")
 * - action=delete-sessions: Deletes ONLY specified sessions (run.action = "update", sessions[].action = "delete")
 * - action=add-sessions: Adds ONLY specified sessions (run.action = "update", sessions[].action = "add")
 * - action=update-sessions: Updates ONLY specified sessions (run.action = "update", sessions[].action = "update")
 * - action=assign-trainer: Assigns trainer to course run (run.action = "update", linkCourseRunTrainer[].trainer)
 * 
 * All operations use POST method and the same SSG API endpoint: /courses/courseRuns/edit/{runId}
 * The payload structure differs based on the action type.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSSGCredentialsService } from '../../../../../lib/ssg/services/credentials-service';
import { EditRunInfo, DeleteRunInfo, EditDeleteCourseRunUtils } from '../../../../../lib/ssg/models/edit-delete-course-run';
import { OptionalSelector } from '../../../../../lib/ssg/models/course-runs';
import { createSSGCourseAPI } from '../../../../../lib/ssg/api/course-api';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST for both edit and delete operations.' });
  }

  try {
    const { runId, action } = req.query;
    
    if (!runId || typeof runId !== 'string') {
      return res.status(400).json({ error: 'Course run ID is required' });
    }

    if (!action || (action !== 'edit' && action !== 'delete' && action !== 'delete-sessions' && action !== 'add-sessions' && action !== 'update-sessions' && action !== 'assign-trainer')) {
      return res.status(400).json({ error: 'Action parameter is required. Use "edit", "delete", "delete-sessions", "add-sessions", "update-sessions", or "assign-trainer".' });
    }

    const { includeExpiredCourses } = req.query;
    const includeExpired = includeExpiredCourses === 'true' ? OptionalSelector.YES : OptionalSelector.NO;

    // Get SSG credentials (using default provider for now)
    const credentialsService = getSSGCredentialsService();
    const credentials = await credentialsService.getSSGCredentials(undefined, (req.headers['x-ssg-app'] as string) || undefined);
    
    if (!credentials) {
      return res.status(404).json({ 
        error: 'SSG credentials not found. Please configure your training provider credentials.' 
      });
    }

    // Check required credentials for encryption
    if (!credentials.encryptionKey) {
      return res.status(400).json({ 
        error: 'Encryption key is required for course run operations' 
      });
    }

    if (!credentials.certificateContent || !credentials.privateKeyContent) {
      return res.status(400).json({ 
        error: 'Certificate and private key are required for SSG API authentication' 
      });
    }

    // Create API client
    const apiClient = createSSGCourseAPI(credentials.ssgApiBaseUrl, credentials);

    if (action === 'edit') {
      // Edit course run
      const runInfo: EditRunInfo = req.body;
      
      if (!runInfo) {
        return res.status(400).json({ error: 'Request body is required for editing' });
      }

      console.log('📝 Raw request body received:', JSON.stringify(runInfo, null, 2));

      // Validate the run info
      const validation = EditDeleteCourseRunUtils.validateEditRunInfo(runInfo);
      if (!validation.isValid) {
        console.log('❌ Validation failed:', validation.errors);
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: validation.errors 
        });
      }

      console.log('✅ Validation passed, sending to SSG API...');
      const result = await apiClient.editCourseRun(runId, runInfo, includeExpired);

      if (result.error) {
        console.log('❌ SSG API error:', result.error);
        return res.status(result.status || 500).json(result.error);
      }

      console.log('✅ SSG API success:', result.data);
      return res.status(200).json(result.data);

    } else if (action === 'delete') {
      // Delete course run
      const runInfo: DeleteRunInfo = req.body;
      
      if (!runInfo) {
        return res.status(400).json({ 
          data: {},
          error: {
            code: '400',
            message: 'Invalid input parameter(s).',
            details: [
              {
                field: 'body',
                message: 'Request body with courseReferenceNumber is required for deletion'
              }
            ]
          },
          meta: {},
          status: 400
        });
      }

      // Validate the run info
      const validation = EditDeleteCourseRunUtils.validateDeleteRunInfo(runInfo);
      if (!validation.isValid) {
        return res.status(400).json({ 
          data: {},
          error: {
            code: '400',
            message: 'Invalid input parameter(s).',
            details: validation.errors.map(err => ({
              field: 'validation',
              message: err
            }))
          },
          meta: {},
          status: 400
        });
      }

      const result = await apiClient.deleteCourseRun(runId, runInfo, includeExpired);

      if (result.error) {
        return res.status(result.status || 500).json({
          data: {},
          error: result.error,
          meta: {},
          status: result.status || 500
        });
      }

      // Success response - return SSG API format
      return res.status(200).json({
        data: result.data || {},
        error: {},
        meta: {},
        status: 200
      });

    } else if (action === 'delete-sessions') {
      // Delete sessions within a course run (NOT the entire course run)
      // CRITICAL: This uses edit API with session-level delete actions
      console.log('🗑️ Processing session deletion request (NOT course run deletion)');
      
      const requestData = req.body;
      
      if (!requestData) {
        return res.status(400).json({ error: 'Request body is required for session deletion' });
      }

      // Extract sessions to delete from the request
      const sessionsToDelete = requestData.sessions || [];
      
      if (!sessionsToDelete || sessionsToDelete.length === 0) {
        return res.status(400).json({ error: 'Sessions array is required for session deletion' });
      }

      // Create complete run info for session deletion (SAME structure as add sessions)
      const runInfo: EditRunInfo = {
        courseReferenceNumber: requestData.courseReferenceNumber,
        
        // Pass all date information from frontend
        openingRegistrationDate: requestData.openingRegistrationDate,
        closingRegistrationDate: requestData.closingRegistrationDate,
        courseStartDate: requestData.courseStartDate,
        courseEndDate: requestData.courseEndDate,
        
        // Schedule info
        scheduleInfoTypeCode: requestData.scheduleInfoTypeCode || "01",
        scheduleInfoTypeDescription: requestData.scheduleInfoTypeDescription || "Description",
        
        // Venue information from frontend
        block: requestData.block,
        street: requestData.street,
        floor: requestData.floor,
        unit: requestData.unit,
        building: requestData.building,
        postalCode: requestData.postalCode,
        room: requestData.room,
        wheelChairAccess: requestData.wheelChairAccess,
        
        // Course admin and vacancy info
        courseAdminEmail: requestData.courseAdminEmail,
        courseVacancy: requestData.courseVacancy,
        
        // File info
        fileName: requestData.fileName || "",
        fileContent: requestData.fileContent || ""
      };

      // Validate the session deletion request
      const validation = EditDeleteCourseRunUtils.validateDeleteSessionInfo(runInfo, sessionsToDelete);
      if (!validation.isValid) {
        console.log('❌ Session deletion validation failed:', validation.errors);
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: validation.errors 
        });
      }

      console.log('✅ Session deletion validation passed, sending to SSG API...');
      
      console.log('🔄 Complete session deletion run info:', JSON.stringify(runInfo, null, 2));
      console.log('🔄 Sessions to delete:', JSON.stringify(sessionsToDelete, null, 2));

      // Use deleteSessionsFromCourseRun method specifically for session deletion
      const result = await apiClient.deleteSessionsFromCourseRun(runId, runInfo, sessionsToDelete, includeExpired);

      if (result.error) {
        console.log('❌ SSG API error during session deletion:', result.error);
        return res.status(result.status || 500).json(result.error);
      }

      console.log('✅ SSG API session deletion success:', result.data);
      return res.status(200).json(result.data);

    } else if (action === 'add-sessions') {
      // Add sessions to a course run (NOT the entire course run)
      // CRITICAL: This uses edit API with session-level add actions
      console.log('➕ Processing session addition request (NOT course run deletion)');
      
      const requestData = req.body;
      
      if (!requestData) {
        return res.status(400).json({ error: 'Request body is required for session addition' });
      }

      // Extract sessions to add from the request
      const sessionsToAdd = requestData.sessions || [];
      
      if (!sessionsToAdd || sessionsToAdd.length === 0) {
        return res.status(400).json({ error: 'Sessions array is required for session addition' });
      }

      // Create minimal run info for session addition
      const runInfo: EditRunInfo = {
        courseReferenceNumber: requestData.courseReferenceNumber,
        scheduleInfoTypeCode: requestData.scheduleInfoTypeCode || "01",
        scheduleInfoTypeDescription: requestData.scheduleInfoTypeDescription || "Description"
      };

      // Validate the session addition request
      const validation = EditDeleteCourseRunUtils.validateAddSessionInfo(runInfo, sessionsToAdd);
      if (!validation.isValid) {
        console.log('❌ Session addition validation failed:', validation.errors);
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: validation.errors 
        });
      }

      console.log('✅ Session addition validation passed, sending to SSG API...');
      
      // Create a complete EditRunInfo structure with ALL course run data (not just sessions)
      const sessionAddRunInfo: EditRunInfo = {
        courseReferenceNumber: requestData.courseReferenceNumber,
        
        // Pass all date information from frontend
        openingRegistrationDate: requestData.openingRegistrationDate,
        closingRegistrationDate: requestData.closingRegistrationDate,
        courseStartDate: requestData.courseStartDate,
        courseEndDate: requestData.courseEndDate,
        
        // Schedule info
        scheduleInfoTypeCode: requestData.scheduleInfoTypeCode || "01",
        scheduleInfoTypeDescription: requestData.scheduleInfoTypeDescription || "New Info Type Description",
        
        // Venue information from frontend
        block: requestData.block,
        street: requestData.street,
        floor: requestData.floor,
        unit: requestData.unit,
        building: requestData.building,
        postalCode: requestData.postalCode,
        room: requestData.room,
        wheelChairAccess: requestData.wheelChairAccess,
        
        // Course admin and vacancy info
        courseAdminEmail: requestData.courseAdminEmail,
        courseVacancy: requestData.courseVacancy,
        
        // File info
        fileName: requestData.fileName || "",
        fileContent: requestData.fileContent || "",
        
        // Add sessions to the structure for addition
        sessions: sessionsToAdd.map((session: any) => ({
          ...session,
          action: "add" // Ensure the action is set to add
        }))
      };
      
      console.log('🔄 Complete session addition run info:', JSON.stringify(sessionAddRunInfo, null, 2));

      // Use addSessionsToCourseRun method specifically for session addition
      const result = await apiClient.addSessionsToCourseRun(runId, sessionAddRunInfo, includeExpired);

      if (result.error) {
        console.log('❌ SSG API error during session addition:', result.error);
        return res.status(result.status || 500).json(result.error);
      }

      console.log('✅ SSG API session addition success:', result.data);
      return res.status(200).json(result.data);

    } else if (action === 'update-sessions') {
      // Update sessions in a course run (NOT the entire course run)
      // CRITICAL: This uses edit API with session-level update actions
      console.log('🔄 Processing session update request (NOT course run deletion)');
      
      const requestData = req.body;
      
      if (!requestData) {
        return res.status(400).json({ error: 'Request body is required for session update' });
      }

      // Extract sessions to update from the request
      const sessionsToUpdate = requestData.sessions || [];
      
      if (!sessionsToUpdate || sessionsToUpdate.length === 0) {
        return res.status(400).json({ error: 'Sessions array is required for session update' });
      }

      // Create minimal run info for session update
      const runInfo: EditRunInfo = {
        courseReferenceNumber: requestData.courseReferenceNumber,
        scheduleInfoTypeCode: requestData.scheduleInfoTypeCode || "01",
        scheduleInfoTypeDescription: requestData.scheduleInfoTypeDescription || "Description"
      };

      // Validate the session update request
      const validation = EditDeleteCourseRunUtils.validateUpdateSessionInfo(runInfo, sessionsToUpdate);
      if (!validation.isValid) {
        console.log('❌ Session update validation failed:', validation.errors);
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: validation.errors 
        });
      }

      console.log('✅ Session update validation passed, sending to SSG API...');
      
      // Create a complete EditRunInfo structure with ALL course run data (not just sessions)
      const sessionUpdateRunInfo: EditRunInfo = {
        courseReferenceNumber: requestData.courseReferenceNumber,
        
        // Pass all date information from frontend
        openingRegistrationDate: requestData.openingRegistrationDate,
        closingRegistrationDate: requestData.closingRegistrationDate,
        courseStartDate: requestData.courseStartDate,
        courseEndDate: requestData.courseEndDate,
        
        // Schedule info
        scheduleInfoTypeCode: requestData.scheduleInfoTypeCode || "01",
        scheduleInfoTypeDescription: requestData.scheduleInfoTypeDescription || "Description",
        
        // Venue information from frontend
        block: requestData.block,
        street: requestData.street,
        floor: requestData.floor,
        unit: requestData.unit,
        building: requestData.building,
        postalCode: requestData.postalCode,
        room: requestData.room,
        wheelChairAccess: requestData.wheelChairAccess,
        
        // Course admin and vacancy info
        courseAdminEmail: requestData.courseAdminEmail,
        courseVacancy: requestData.courseVacancy,
        
        // File info
        fileName: requestData.fileName || "",
        fileContent: requestData.fileContent || ""
      };
      
      console.log('🔄 Complete session update run info:', JSON.stringify(sessionUpdateRunInfo, null, 2));
      console.log('🔄 Sessions to update:', JSON.stringify(sessionsToUpdate, null, 2));

      // Use updateSessionsFromCourseRun method specifically for session update
      const result = await apiClient.updateSessionsFromCourseRun(runId, sessionUpdateRunInfo, sessionsToUpdate, includeExpired);

      if (result.error) {
        console.log('❌ SSG API error during session update:', result.error);
        return res.status(result.status || 500).json(result.error);
      }

      console.log('✅ SSG API session update success:', result.data);
      return res.status(200).json(result.data);

    } else if (action === 'assign-trainer') {
      // Assign trainer to a course run
      console.log('👨‍🏫 Processing trainer assignment request');
      
      const requestData = req.body;
      
      if (!requestData) {
        return res.status(400).json({ error: 'Request body is required for trainer assignment' });
      }

      console.log('📝 Raw trainer assignment request body:', JSON.stringify(requestData, null, 2));

      // Validate the request structure (match frontend structure)
      if (!requestData.course?.run?.linkCourseRunTrainer) {
        return res.status(400).json({ 
          error: 'Invalid request structure. Expected course.run.linkCourseRunTrainer format' 
        });
      }

      const linkCourseRunTrainer = requestData.course.run.linkCourseRunTrainer;
      
      if (!Array.isArray(linkCourseRunTrainer) || linkCourseRunTrainer.length === 0) {
        return res.status(400).json({ 
          error: 'linkCourseRunTrainer must be a non-empty array' 
        });
      }

      // Validate trainer data
      for (const trainerLink of linkCourseRunTrainer) {
        if (!trainerLink.trainer?.idNumber) {
          return res.status(400).json({ 
            error: 'Trainer ID Number is required for each trainer assignment' 
          });
        }
        
        if (!trainerLink.trainer?.trainerType?.code) {
          return res.status(400).json({ 
            error: 'Trainer type code is required for each trainer assignment' 
          });
        }
      }

      console.log('✅ Trainer assignment validation passed, sending to SSG API...');

      // First, fetch the existing course run data to get complete venue information
      console.log('📥 Fetching existing course run data for venue information...');
      const existingCourseRun = await apiClient.viewCourseRun(runId, includeExpired);
      
      if (existingCourseRun.error) {
        console.log('❌ Failed to fetch existing course run data:', existingCourseRun.error);
        return res.status(existingCourseRun.status || 500).json({
          error: 'Failed to fetch existing course run data',
          details: existingCourseRun.error
        });
      }

      const existingRunData = existingCourseRun.data?.run;
      const existingVenue = existingRunData?.venue || {};

      console.log('📍 Existing venue data:', JSON.stringify(existingVenue, null, 2));

      // Transform the request to match the exact nested structure expected by SSG API
      const runData = requestData.course.run;
      const trainerData = requestData.course.run.linkCourseRunTrainer;
      
      console.log('🔍 Raw trainer data received:', JSON.stringify(trainerData, null, 2));
      console.log('🔍 Is trainer data array?', Array.isArray(trainerData));
      
      // Ensure trainerData is properly structured as an array
      let trainersArray = [];
      if (Array.isArray(trainerData)) {
        trainersArray = trainerData;
      } else if (trainerData && typeof trainerData === 'object') {
        // If it's an object, convert to array
        trainersArray = Object.values(trainerData);
      }
      
      console.log('🔍 Processed trainers array:', JSON.stringify(trainersArray, null, 2));
      
      // Create the nested structure as required by SSG API
      const ssgRequestBody = {
        course: {
          courseReferenceNumber: requestData.course.courseReferenceNumber,
          trainingProvider: {
            uen: requestData.course.trainingProvider.uen
          },
          run: {
            action: "update",
            registrationDates: {
              opening: runData.registrationDates?.opening || 0,
              closing: runData.registrationDates?.closing || 0
            },
            courseDates: {
              start: runData.courseDates?.start || 0,
              end: runData.courseDates?.end || 0
            },
            scheduleInfoType: {
              code: runData.scheduleInfoType?.code || "01",
              description: runData.scheduleInfoType?.description || "New Info Type Description"
            },
            venue: {
              block: runData.venue?.block || existingVenue.block || "",
              street: runData.venue?.street || existingVenue.street || "",
              floor: runData.venue?.floor || existingVenue.floor || "",
              unit: runData.venue?.unit || existingVenue.unit || "",
              building: runData.venue?.building || existingVenue.building || "",
              postalCode: runData.venue?.postalCode || existingVenue.postalCode || "",
              room: runData.venue?.room || existingVenue.room || "",
              wheelChairAccess: runData.venue?.wheelChairAccess !== undefined ? runData.venue.wheelChairAccess : (existingVenue.wheelChairAccess || false)
            },
            courseAdminEmail: runData.courseAdminEmail || "",
            courseVacancy: runData.courseVacancy || { code: "A", description: "Available" },
            file: {
              Name: runData.file?.Name || "",
              content: runData.file?.content || ""
            },
            linkCourseRunTrainer: trainersArray.map((trainerLink: any) => ({
              trainer: {
                photo: {
                  name: trainerLink.trainer?.photo?.name || "",
                  content: trainerLink.trainer?.photo?.content || ""
                },
                trainerType: {
                  code: trainerLink.trainer?.trainerType?.code || "1",
                  description: trainerLink.trainer?.trainerType?.description || "Existing"
                },
                idNumber: trainerLink.trainer?.idNumber || ""
              }
            }))
          }
        }
      };

      console.log('🔄 Transformed payload for SSG API:', JSON.stringify(ssgRequestBody, null, 2));

      // Create flat EditRunInfo structure that will produce the nested structure we want
      const editRunInfo: EditRunInfo = {
        courseReferenceNumber: requestData.course.courseReferenceNumber,
        
        // Convert dates back to YYYY-MM-DD format for EditRunInfo
        openingRegistrationDate: runData.registrationDates?.opening ? 
          (String(runData.registrationDates.opening).length === 8 ? 
            String(runData.registrationDates.opening).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : 
            String(runData.registrationDates.opening)) : undefined,
        closingRegistrationDate: runData.registrationDates?.closing ? 
          (String(runData.registrationDates.closing).length === 8 ? 
            String(runData.registrationDates.closing).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : 
            String(runData.registrationDates.closing)) : undefined,
        courseStartDate: runData.courseDates?.start ? 
          (String(runData.courseDates.start).length === 8 ? 
            String(runData.courseDates.start).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : 
            String(runData.courseDates.start)) : undefined,
        courseEndDate: runData.courseDates?.end ? 
          (String(runData.courseDates.end).length === 8 ? 
            String(runData.courseDates.end).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : 
            String(runData.courseDates.end)) : undefined,

        // Schedule info
        scheduleInfoTypeCode: runData.scheduleInfoType?.code || "01",
        scheduleInfoTypeDescription: runData.scheduleInfoType?.description || "New Info Type Description",

        // Venue information (merge with existing venue data)
        block: runData.venue?.block || existingVenue.block || "",
        street: runData.venue?.street || existingVenue.street || "",
        floor: runData.venue?.floor || existingVenue.floor || "",
        unit: runData.venue?.unit || existingVenue.unit || "",
        building: runData.venue?.building || existingVenue.building || "",
        postalCode: runData.venue?.postalCode || existingVenue.postalCode || "",
        room: runData.venue?.room || existingVenue.room || "",
        wheelChairAccess: runData.venue?.wheelChairAccess !== undefined ? runData.venue.wheelChairAccess : existingVenue.wheelChairAccess,

        // Course admin and vacancy
        courseAdminEmail: runData.courseAdminEmail || "",
        courseVacancy: runData.courseVacancy || { code: "A", description: "Available" },

        // File info
        fileName: runData.file?.Name || "",
        fileContent: runData.file?.content || "",

        // Trainer assignment data - use the flat structure expected by EditRunInfo
        linkCourseRunTrainer: trainersArray.map((trainerLink: any) => ({
          trainerTypeCode: trainerLink.trainer?.trainerType?.code || "1",
          trainerTypeDescription: trainerLink.trainer?.trainerType?.description || "Existing",
          trainerIdNumber: trainerLink.trainer?.idNumber || ""
        }))
      };

      // Use the standard edit course run API method
      const result = await apiClient.editCourseRun(runId, editRunInfo, includeExpired);

      if (result.error) {
        console.log('❌ SSG API error during trainer assignment:', result.error);
        return res.status(result.status || 500).json(result.error);
      }

      console.log('✅ SSG API trainer assignment success:', result.data);
      return res.status(200).json(result.data);
    }

  } catch (error) {
    console.error('Error with course run operation:', error);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}