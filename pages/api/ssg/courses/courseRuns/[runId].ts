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
import pool from '../../../../../lib/db';
import { getSSGCredentialsService } from '../../../../../lib/ssg/services/credentials-service';
import { EditRunInfo, DeleteRunInfo, EditDeleteCourseRunUtils } from '../../../../../lib/ssg/models/edit-delete-course-run';
import { OptionalSelector } from '../../../../../lib/ssg/models/course-runs';
import { createSSGCourseAPI } from '../../../../../lib/ssg/api/course-api';
import { pushTrainerToTpgForRun, resolveRunTrainerEditPayloads } from '../../../../../lib/ssg/pushTrainerToTpgForRun';

/** Resolve the run's trainer edit-payloads (with NRIC) so a session edit can re-send them. */
async function runTrainerPayloads(ssgRunId: string): Promise<any[] | undefined> {
  try {
    const uuid = (await pool.query<{ id: string }>(`SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`, [ssgRunId])).rows[0]?.id;
    if (!uuid) return undefined;
    const p = await resolveRunTrainerEditPayloads(uuid);
    return p.length ? p : undefined;
  } catch { return undefined; }
}

/**
 * SSG's /courses/courseRuns/edit REPLACES the run object, and our session-level payloads
 * (add/update/delete-sessions) omit `linkCourseRunTrainer` — so SSG WIPES the run's trainer on
 * any session op. Re-assert the locally-assigned trainer back onto TPG afterwards so a
 * reschedule/cancel/add-session never silently drops the trainer. Best-effort; never throws.
 */
async function reassertTpgTrainer(ssgRunId: string): Promise<{ status: string; message?: string } | null> {
  try {
    const r = await pool.query<{ id: string }>(`SELECT id FROM course_run WHERE course_run_id = $1 LIMIT 1`, [ssgRunId]);
    const uuid = r.rows[0]?.id;
    if (!uuid) return { status: 'skipped', message: 'local run not found' };
    const res = await pushTrainerToTpgForRun(uuid);
    return { status: res.status, message: res.message };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

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
      const delTrainers = await runTrainerPayloads(runId);
      const result = await apiClient.deleteSessionsFromCourseRun(runId, runInfo, sessionsToDelete, includeExpired, delTrainers);

      if (result.error) {
        console.log('❌ SSG API error during session deletion:', result.error);
        return res.status(result.status || 500).json(result.error);
      }

      console.log('✅ SSG API session deletion success:', result.data);
      const tpgTrainerReassert = await reassertTpgTrainer(runId);
      console.log('🔁 TPG trainer re-assert after session deletion:', tpgTrainerReassert);
      return res.status(200).json({ ...result.data, tpgTrainerReassert });

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
      const addTrainers = await runTrainerPayloads(runId);
      const result = await apiClient.addSessionsToCourseRun(runId, sessionAddRunInfo, includeExpired, addTrainers);

      if (result.error) {
        console.log('❌ SSG API error during session addition:', result.error);
        return res.status(result.status || 500).json(result.error);
      }

      console.log('✅ SSG API session addition success:', result.data);
      const tpgTrainerReassert = await reassertTpgTrainer(runId);
      console.log('🔁 TPG trainer re-assert after session addition:', tpgTrainerReassert);
      return res.status(200).json({ ...result.data, tpgTrainerReassert });

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

      // Use updateSessionsFromCourseRun method specifically for session update.
      // Include the run's trainer(s) so SSG doesn't drop them on this edit.
      const updTrainers = await runTrainerPayloads(runId);
      const result = await apiClient.updateSessionsFromCourseRun(runId, sessionUpdateRunInfo, sessionsToUpdate, includeExpired, updTrainers);

      if (result.error) {
        console.log('❌ SSG API error during session update:', result.error);
        return res.status(result.status || 500).json(result.error);
      }

      console.log('✅ SSG API session update success:', result.data);
      // SSG wiped the trainer (omitted linkCourseRunTrainer) — restore it.
      const tpgTrainerReassert = await reassertTpgTrainer(runId);
      console.log('🔁 TPG trainer re-assert after session update:', tpgTrainerReassert);
      return res.status(200).json({ ...result.data, tpgTrainerReassert });

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

      if (!Array.isArray(linkCourseRunTrainer)) {
        return res.status(400).json({
          error: 'linkCourseRunTrainer must be an array'
        });
      }

      // Empty array is valid — used by the Remove TPG Trainer flow to clear all trainers on a course run.
      // Non-empty arrays must validate each trainer entry.
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

      // Fetch existing course run data from SSG as the AUTHORITATIVE source for
      // dates, venue, and scheduleInfo. The client's `ssgApiResponse.data.course.run`
      // may be stale or missing fields — which caused SSG to reject the update with
      // "Opening registration date must be before closing registration date" when
      // the client payload defaulted registrationDates to {opening: 0, closing: 0}.
      //
      // SSG's viewCourseRun response shape is `data.course.run` — note the previous
      // version of this code incorrectly read `data.run.venue`, so `existingVenue`
      // was always empty regardless of whether the SSG fetch succeeded.
      console.log('📥 Fetching existing course run data from SSG for dates + venue...');
      let existingVenue: any = {};
      let existingSsgRun: any = null;
      try {
        const existingCourseRun = await apiClient.viewCourseRun(runId, includeExpired);
        if (!existingCourseRun.error) {
          // Correct shape: data.course.run (not data.run)
          existingSsgRun = (existingCourseRun.data as any)?.course?.run || null;
          existingVenue = existingSsgRun?.venue || {};
          console.log('📍 Existing SSG run snapshot:', JSON.stringify({
            registrationOpeningDate: existingSsgRun?.registrationOpeningDate,
            registrationClosingDate: existingSsgRun?.registrationClosingDate,
            courseStartDate: existingSsgRun?.courseStartDate,
            courseEndDate: existingSsgRun?.courseEndDate,
            venue: existingVenue,
          }, null, 2));
        } else {
          console.log('⚠️ Could not fetch existing course run data from SSG — falling back to client payload');
        }
      } catch (fetchErr) {
        console.log('⚠️ Error fetching existing course run data, proceeding with request body data:', fetchErr);
      }

      // Transform the request to match the exact nested structure expected by SSG API.
      // Prefer SSG's own snapshot fields when present — only fall back to client
      // payload if the SSG fetch failed.
      const runData = requestData.course.run;
      const trainerData = requestData.course.run.linkCourseRunTrainer;

      // Authoritative date resolvers. SSG returns dates as flat integers in
      // YYYYMMDD form (e.g. 20260410). Client may send them as `registrationDates.opening`
      // (nested). Prefer SSG's flat values; fall back to client nested; then 0.
      let resolvedOpeningReg = existingSsgRun?.registrationOpeningDate
        || runData.registrationDates?.opening
        || 0;
      let resolvedClosingReg = existingSsgRun?.registrationClosingDate
        || runData.registrationDates?.closing
        || 0;
      const resolvedStartDate = existingSsgRun?.courseStartDate
        || runData.courseDates?.start
        || 0;
      const resolvedEndDate = existingSsgRun?.courseEndDate
        || runData.courseDates?.end
        || 0;

      // Validate course dates BEFORE hitting SSG — if missing, nothing we can do.
      if (!resolvedStartDate || !resolvedEndDate) {
        console.error('❌ Cannot assign trainer: SSG-side course dates are missing', {
          resolvedStartDate, resolvedEndDate, runId,
        });
        return res.status(400).json({
          error: {
            code: 'MISSING_SSG_DATES',
            message: `Cannot assign trainer to course run ${runId}: SSG does not have valid course start/end dates for this run. Please ensure the course run is fully published on TPGateway, then try again.`,
          },
        });
      }

      // Auto-correct broken registration dates. Known SSG quirk: a course run
      // can have both opening and closing registration dates set to the same
      // day (or even empty), and SSG will reject its OWN data on edit with
      // "Opening registration date must be before closing registration date".
      //
      // Since we're doing action="update" anyway, we fix the dates in the
      // outbound payload: default opening to the course start date, closing
      // to course start + 1 day. This lets us push through a trainer assignment
      // without forcing the admin to hand-edit dates on TPGateway first.
      const addOneDayYYYYMMDD = (yyyymmdd: number | string): number => {
        const s = String(yyyymmdd);
        if (s.length !== 8) return Number(yyyymmdd) || 0;
        const y = parseInt(s.slice(0, 4), 10);
        const m = parseInt(s.slice(4, 6), 10);
        const d = parseInt(s.slice(6, 8), 10);
        const date = new Date(Date.UTC(y, m - 1, d));
        date.setUTCDate(date.getUTCDate() + 1);
        const yy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(date.getUTCDate()).padStart(2, '0');
        return parseInt(`${yy}${mm}${dd}`, 10);
      };

      if (!resolvedOpeningReg || !resolvedClosingReg || Number(resolvedOpeningReg) >= Number(resolvedClosingReg)) {
        const originalOpening = resolvedOpeningReg;
        const originalClosing = resolvedClosingReg;
        // Default: open registration on the course start date, close it one day later.
        // This is a safe minimal window that satisfies SSG's "opening < closing" rule
        // without assuming anything about the real-world registration window.
        resolvedOpeningReg = Number(resolvedStartDate);
        resolvedClosingReg = addOneDayYYYYMMDD(resolvedStartDate);
        console.warn(`⚠️ SSG registration dates invalid for run ${runId} — auto-correcting`, {
          originalOpening, originalClosing,
          newOpening: resolvedOpeningReg, newClosing: resolvedClosingReg,
          reason: 'opening >= closing or missing',
        });
      }
      
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
              opening: resolvedOpeningReg,
              closing: resolvedClosingReg
            },
            courseDates: {
              start: resolvedStartDate,
              end: resolvedEndDate
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

      // Helper: SSG sends dates as flat YYYYMMDD integers (or strings). EditRunInfo
      // expects YYYY-MM-DD strings. Normalise either shape.
      const toIsoDate = (val: any): string | undefined => {
        if (!val) return undefined;
        const s = String(val);
        if (s.length === 8 && /^\d{8}$/.test(s)) {
          return s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        }
        return s;
      };

      // Build the sessions filter: include ONLY sessions that have not yet
      // started (session startDate > today). This avoids SSG errors on past
      // sessions — when SSG receives an edit payload that references sessions
      // whose startDate is in the past, its run-level validation can reject
      // the whole request. By omitting past sessions from the payload, SSG
      // leaves them untouched and only re-validates the future ones.
      //
      // Edge case: if all sessions are in the past (or there are no sessions
      // at all), we simply omit the `sessions` field from editRunInfo, which
      // matches the previous behaviour — SSG leaves sessions untouched.
      const todayYYYYMMDD = (() => {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');
        return parseInt(`${y}${m}${d}`, 10);
      })();

      const existingSsgSessions: any[] = Array.isArray(existingSsgRun?.sessions)
        ? existingSsgRun.sessions
        : [];

      const futureSsgSessions = existingSsgSessions.filter((s: any) => {
        const raw = s?.startDate;
        if (!raw) return false;
        const asNum = Number(String(raw).replace(/-/g, ''));
        return Number.isFinite(asNum) && asNum > todayYYYYMMDD;
      });

      console.log(`📅 Sessions filter for run ${runId}: total=${existingSsgSessions.length}, future=${futureSsgSessions.length}, today=${todayYYYYMMDD}`);

      // Build RunSessionEditInfo entries for the future sessions. Each one
      // preserves all existing fields from SSG unchanged — we're not trying
      // to mutate the sessions, just pass-through the subset SSG is allowed
      // to re-validate. action="update" on each means "no-op update, just
      // re-sync". toEditPayload will serialise these into the payload.
      const mappedFutureSessions: any[] | undefined = futureSsgSessions.length > 0
        ? futureSsgSessions.map((s: any) => {
            const startDate = toIsoDate(s.startDate);
            const endDate = toIsoDate(s.endDate);
            return {
              sessionId: s.sessionId || s.id,
              startDate,
              endDate,
              startTime: s.startTime,
              endTime: s.endTime,
              modeOfTraining: typeof s.modeOfTraining === 'object'
                ? s.modeOfTraining?.code
                : s.modeOfTraining,
              action: 'update',
              // Pass-through venue — SSG will keep these unchanged, no
              // surprise mutations from partial venue data.
              block: s?.venue?.block,
              street: s?.venue?.street,
              floor: s?.venue?.floor,
              unit: s?.venue?.unit,
              building: s?.venue?.building,
              postalCode: s?.venue?.postalCode,
              room: s?.venue?.room,
              wheelChairAccess: s?.venue?.wheelChairAccess,
            };
          })
        : undefined;

      // Create flat EditRunInfo structure that will produce the nested structure we want
      const editRunInfo: EditRunInfo = {
        courseReferenceNumber: requestData.course.courseReferenceNumber,

        // Dates sourced from SSG (preferred) or client fallback — already validated above.
        openingRegistrationDate: toIsoDate(resolvedOpeningReg),
        closingRegistrationDate: toIsoDate(resolvedClosingReg),
        courseStartDate: toIsoDate(resolvedStartDate),
        courseEndDate: toIsoDate(resolvedEndDate),

        // Only pass future sessions — past sessions cause SSG run-level
        // validation errors. Omitted entirely when no future sessions exist
        // (toEditPayload drops undefined/empty arrays via the check at
        // edit-delete-course-run.ts:448).
        sessions: mappedFutureSessions,

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

      // For empty trainer arrays (Remove TPG Trainer flow), use editCourseRunTrainerOnly —
      // it always serializes linkCourseRunTrainer even when empty, while the regular editCourseRun
      // path (via toPayload) drops the field if the array is empty (edit-delete-course-run.ts:455),
      // making removal impossible. editCourseRunTrainerOnly also re-fetches existing SSG data so
      // it doesn't zero out other fields.
      const result = trainersArray.length === 0
        ? await apiClient.editCourseRunTrainerOnly(runId, editRunInfo, includeExpired)
        : await apiClient.editCourseRun(runId, editRunInfo, includeExpired);

      if (result.error && (result.error.code || result.error.message)) {
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