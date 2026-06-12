/**
 * SSG API client for course operations
 * Converted from Python core/courses modules
 */

import { 
  AddRunInfo as BaseAddRunInfo, 
  EditRunInfo as BaseEditRunInfo, 
  DeleteRunInfo as BaseDeleteRunInfo, 
  CourseRunResponse, 
  CourseSessionResponse,
  OptionalSelector,
  SSGApiResponse 
} from '../models/course-runs';
import { 
  AddRunInfo,
  AddCourseRunPayload,
  AddCourseRunResponse,
  AddCourseRunUtils
} from '../models/add-course-run';
import {
  EditRunInfo,
  DeleteRunInfo,
  EditDeleteCourseRunUtils
} from '../models/edit-delete-course-run';
import { HttpClient, HTTPRequestBuilder, HttpMethod, handleRequest } from '../utils/http-utils';
import { Cryptography } from '../utils/cryptography';
import { SSGCredentials } from '../services/credentials-service';

export class SSGCourseAPI {
  private httpClient: HttpClient;
  private baseUrl: string;
  private credentials: SSGCredentials;

  constructor(baseUrl: string, credentials: SSGCredentials) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // No longer using Bearer token - using certificate-based authentication
    this.httpClient = new HttpClient(baseUrl, headers);
  }

  /**
   * View course run by run ID
   * Equivalent to Python ViewCourseRun class
   */
  async viewCourseRun(
    runId: string, 
    includeExpired: OptionalSelector = OptionalSelector.NO
  ): Promise<SSGApiResponse<CourseRunResponse>> {
    try {
      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/courses/courseRuns/id/${runId}`)
        .withMethod(HttpMethod.GET)
        .withHeader('accept', 'application/json')
        .withHeader('Content-Type', 'application/json');

      // Add certificate authentication
      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Add query parameter based on includeExpired
      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      const config = builder.build();
      return await handleRequest<CourseRunResponse>(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'VIEW_COURSE_RUN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * Search course runs by course reference number (course code)
   * Calls GET /courses/courseRuns/reference
   */
  async searchCourseRunsByCode(
    courseReferenceNumber: string,
    options: { page?: number; pageSize?: number; includeExpired?: boolean; uen?: string } = {}
  ): Promise<SSGApiResponse<any>> {
    try {
      const { page = 0, pageSize = 40, includeExpired = false, uen } = options;

      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, '/courses/courseRuns/reference')
        .withMethod(HttpMethod.GET)
        .withParam('uen', uen || this.credentials.uen || '')
        .withParam('courseReferenceNumber', courseReferenceNumber)
        .withParam('pageSize', String(pageSize))
        .withParam('page', String(page))
        .withParam('includeExpiredCourses', String(includeExpired));

      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      const config = builder.build();
      return await handleRequest<any>(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'SEARCH_COURSE_RUNS_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * Add/publish course run
   * Equivalent to Python AddCourseRun class
   */
  async addCourseRun(
    runInfo: AddRunInfo,
    includeExpired: OptionalSelector = OptionalSelector.NO
  ): Promise<SSGApiResponse<AddCourseRunResponse>> {
    try {
      if (!this.credentials.encryptionKey) {
        throw new Error('Encryption key is required for adding course runs');
      }

      if (!this.credentials.uen) {
        throw new Error('UEN is required for adding course runs');
      }

      // Validate the run info
      const validation = AddCourseRunUtils.validateAddRunInfo(runInfo);
      if (validation.errors.length > 0) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, '/courses/courseRuns/publish')
        .withMethod(HttpMethod.POST)
        .withHeader('Content-Type', 'application/json');

      // Add certificate authentication
      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Add query parameter
      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      // Create and clean the payload
      const payload = AddCourseRunUtils.toPayload(runInfo, this.credentials.uen);
      const cleanedPayload = AddCourseRunUtils.removeNullFields(payload, ['runs']);
      
      // Encrypt the payload
      const encryptedPayload = Cryptography.encryptJSON(this.credentials.encryptionKey, cleanedPayload);
      
      builder.withBody(encryptedPayload);

      const config = builder.build();
      return await handleRequest<AddCourseRunResponse>(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'ADD_COURSE_RUN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * Edit course run
   * Equivalent to Python EditCourseRun class
   */
  async editCourseRun(
    runId: string,
    runInfo: EditRunInfo,
    includeExpired: OptionalSelector = OptionalSelector.NO
  ): Promise<SSGApiResponse<any>> {
    try {
      if (!this.credentials.encryptionKey) {
        throw new Error('Encryption key is required for editing course runs');
      }

      // Validate the run info
      const validation = EditDeleteCourseRunUtils.validateEditRunInfo(runInfo);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/courses/courseRuns/edit/${runId}`)
        .withMethod(HttpMethod.POST);

      // Add certificate authentication
      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Add query parameter
      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      // Convert to payload and encrypt
      const payload = EditDeleteCourseRunUtils.toEditPayload(runInfo, this.credentials.uen);
      console.log('🔄 Transformed payload for SSG API:', JSON.stringify(payload, null, 2));
      
      console.log('🔐 Encryption key available:', !!this.credentials.encryptionKey);
      console.log('🔐 Encryption key length:', this.credentials.encryptionKey ? this.credentials.encryptionKey.length : 0);
      
      try {
        const encryptedPayload = Cryptography.encryptJSON(this.credentials.encryptionKey, payload);
        console.log('🔐 Payload encrypted successfully, length:', encryptedPayload.length);
        console.log('🔐 Encrypted payload sample:', encryptedPayload.substring(0, 100) + '...');
        
        builder.withBody(encryptedPayload);
      } catch (encryptionError) {
        console.error('❌ Encryption failed:', encryptionError);
        throw new Error(`Payload encryption failed: ${encryptionError instanceof Error ? encryptionError.message : 'Unknown error'}`);
      }

      const config = builder.build();
      return await handleRequest(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'EDIT_COURSE_RUN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * Update ONLY the linkCourseRunTrainer for a course run.
   * 1. Views the existing course run from SSG to get current dates/venue/etc.
   * 2. Fails if SSG view returns no data — does not proceed with empty fields.
   * 3. Submits a full edit payload so no existing fields are zeroed out.
   */
  async editCourseRunTrainerOnly(
    runId: string,
    runInfo: EditRunInfo,
    includeExpired: OptionalSelector = OptionalSelector.NO
  ): Promise<SSGApiResponse<any>> {
    try {
      if (!this.credentials.encryptionKey) {
        throw new Error('Encryption key is required for editing course runs');
      }

      // Step 1 — fetch existing run data from SSG (required — fail if unavailable)
      const viewRes = await this.viewCourseRun(runId, includeExpired);
      // SSG returns error as {} (empty object) on success — only treat as error if it has a code/message
      const hasViewError = viewRes.error && (viewRes.error.code || viewRes.error.message);
      if (hasViewError || !viewRes.data) {
        return {
          error: {
            code: 'VIEW_COURSE_RUN_FAILED',
            message: `viewCourseRun failed for ${runId}: ${viewRes.error?.message || 'no data returned'}`,
          },
          status: viewRes.status || 0,
        };
      }
      // SSG response: data.course.run (run is nested under course, not top-level)
      const existingRun = (viewRes.data as any)?.course?.run ?? {};

      console.log(`🔍 SSG view existingRun for ${runId}:`, JSON.stringify(existingRun, null, 2));

      // Step 2 — replace SSG trainer list with our local trainers
      const mergedTrainers = (runInfo.linkCourseRunTrainer || []).map(t =>
        EditDeleteCourseRunUtils.trainerToPayload(t)
      );

      // Step 3 — build full payload using existing SSG data
      // SSG view response uses flat date integers (courseStartDate, registrationOpeningDate)
      // but edit payload expects nested objects (courseDates.start, registrationDates.opening)
      // modeOfTraining may be returned as a string "1" or an object {code, description} — normalise to string code
      const rawMode = existingRun.modeOfTraining;
      const modeOfTraining = typeof rawMode === 'object' && rawMode !== null
        ? rawMode.code ?? rawMode
        : rawMode ?? '1';

      // scheduleInfoType: pass through as-is if present, else use safe default
      const scheduleInfoType = existingRun.scheduleInfoType ?? { code: '01', description: 'Description' };

      const payload = {
        course: {
          courseReferenceNumber: runInfo.courseReferenceNumber,
          trainingProvider: { uen: this.credentials.uen },
          run: {
            action: 'update',
            registrationDates: {
              opening: existingRun.registrationOpeningDate ?? 0,
              closing: existingRun.registrationClosingDate ?? 0,
            },
            courseDates: {
              start: existingRun.courseStartDate ?? 0,
              end: existingRun.courseEndDate ?? 0,
            },
            scheduleInfoType,
            scheduleInfo: existingRun.scheduleInfo ?? '',
            venue: existingRun.venue ?? { block: '', street: '', floor: '', unit: '', building: '', postalCode: '', room: '', wheelChairAccess: false },
            modeOfTraining,
            courseAdminEmail: existingRun.courseAdminEmail ?? '',
            courseVacancy: existingRun.courseVacancy ?? { code: 'A', description: 'Available' },
            file: { Name: '', content: '' },
            linkCourseRunTrainer: mergedTrainers,
          },
        },
      };

      console.log('🎓 Trainer-only payload for SSG API:', JSON.stringify(payload, null, 2));

      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/courses/courseRuns/edit/${runId}`)
        .withMethod(HttpMethod.POST);

      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      const encryptedPayload = Cryptography.encryptJSON(this.credentials.encryptionKey, payload);
      builder.withBody(encryptedPayload);

      const config = builder.build();
      return await handleRequest(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'EDIT_COURSE_RUN_TRAINER_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        status: 0,
      };
    }
  }

  /**
   * Add sessions to course run - SEPARATE method for session addition
   * Uses the specialized toAddSessionPayload function
   */
  async addSessionsToCourseRun(
    runId: string,
    runInfo: EditRunInfo,
    includeExpired: OptionalSelector = OptionalSelector.NO
  ): Promise<SSGApiResponse<any>> {
    try {
      if (!this.credentials.encryptionKey) {
        throw new Error('Encryption key is required for adding sessions to course runs');
      }

      // Validate the run info for session addition
      const validation = EditDeleteCourseRunUtils.validateAddSessionInfo(runInfo, runInfo.sessions || []);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/courses/courseRuns/edit/${runId}`)
        .withMethod(HttpMethod.POST);

      // Add certificate authentication
      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Add query parameter
      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      // Use the specialized session addition payload transformer
      const payload = EditDeleteCourseRunUtils.toAddSessionPayload(runInfo, this.credentials.uen);
      console.log('🔄 Transformed ADD SESSION payload for SSG API:', JSON.stringify(payload, null, 2));
      
      console.log('🔐 Encryption key available:', !!this.credentials.encryptionKey);
      console.log('🔐 Encryption key length:', this.credentials.encryptionKey ? this.credentials.encryptionKey.length : 0);
      
      try {
        const encryptedPayload = Cryptography.encryptJSON(this.credentials.encryptionKey, payload);
        console.log('🔐 ADD SESSION payload encrypted successfully, length:', encryptedPayload.length);
        console.log('🔐 Encrypted ADD SESSION payload sample:', encryptedPayload.substring(0, 100) + '...');
        
        builder.withBody(encryptedPayload);
      } catch (encryptionError) {
        console.error('❌ ADD SESSION encryption failed:', encryptionError);
        throw new Error(`ADD SESSION payload encryption failed: ${encryptionError instanceof Error ? encryptionError.message : 'Unknown error'}`);
      }

      const config = builder.build();
      return await handleRequest(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'ADD_SESSION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * Delete sessions from course run - SEPARATE method for session deletion
   * Uses the specialized toDeleteSessionPayload function
   */
  async deleteSessionsFromCourseRun(
    runId: string,
    runInfo: EditRunInfo,
    sessionsToDelete: any[],
    includeExpired: OptionalSelector = OptionalSelector.NO
  ): Promise<SSGApiResponse<any>> {
    try {
      if (!this.credentials.encryptionKey) {
        throw new Error('Encryption key is required for deleting sessions from course runs');
      }

      // Validate the run info for session deletion
      const validation = EditDeleteCourseRunUtils.validateDeleteSessionInfo(runInfo, sessionsToDelete);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/courses/courseRuns/edit/${runId}`)
        .withMethod(HttpMethod.POST);

      // Add certificate authentication
      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Add query parameter
      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      // Use the specialized session deletion payload transformer
      const payload = EditDeleteCourseRunUtils.toDeleteSessionPayload(runInfo, sessionsToDelete, this.credentials.uen);
      console.log('🔄 Transformed DELETE SESSION payload for SSG API:', JSON.stringify(payload, null, 2));
      
      console.log('🔐 Encryption key available:', !!this.credentials.encryptionKey);
      console.log('🔐 Encryption key length:', this.credentials.encryptionKey ? this.credentials.encryptionKey.length : 0);
      
      try {
        const encryptedPayload = Cryptography.encryptJSON(this.credentials.encryptionKey, payload);
        console.log('🔐 DELETE SESSION payload encrypted successfully, length:', encryptedPayload.length);
        console.log('🔐 Encrypted DELETE SESSION payload sample:', encryptedPayload.substring(0, 100) + '...');
        
        builder.withBody(encryptedPayload);
      } catch (encryptionError) {
        console.error('❌ DELETE SESSION encryption failed:', encryptionError);
        throw new Error(`DELETE SESSION payload encryption failed: ${encryptionError instanceof Error ? encryptionError.message : 'Unknown error'}`);
      }

      const config = builder.build();
      return await handleRequest(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'DELETE_SESSION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * Update sessions from course run - SEPARATE method for session update
   * Uses the specialized toUpdateSessionPayload function
   */
  async updateSessionsFromCourseRun(
    runId: string,
    runInfo: EditRunInfo,
    sessionsToUpdate: any[],
    includeExpired: OptionalSelector = OptionalSelector.NO
  ): Promise<SSGApiResponse<any>> {
    try {
      if (!this.credentials.encryptionKey) {
        throw new Error('Encryption key is required for updating sessions from course runs');
      }

      // Validate the run info for session update
      const validation = EditDeleteCourseRunUtils.validateUpdateSessionInfo(runInfo, sessionsToUpdate);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/courses/courseRuns/edit/${runId}`)
        .withMethod(HttpMethod.POST);

      // Add certificate authentication
      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Add query parameter
      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      // Use the specialized session update payload transformer
      const payload = EditDeleteCourseRunUtils.toUpdateSessionPayload(runInfo, sessionsToUpdate, this.credentials.uen);
      console.log('🔄 Transformed UPDATE SESSION payload for SSG API:', JSON.stringify(payload, null, 2));
      
      console.log('🔐 Encryption key available:', !!this.credentials.encryptionKey);
      console.log('🔐 Encryption key length:', this.credentials.encryptionKey ? this.credentials.encryptionKey.length : 0);
      
      try {
        const encryptedPayload = Cryptography.encryptJSON(this.credentials.encryptionKey, payload);
        console.log('🔐 UPDATE SESSION payload encrypted successfully, length:', encryptedPayload.length);
        console.log('🔐 Encrypted UPDATE SESSION payload sample:', encryptedPayload.substring(0, 100) + '...');
        
        builder.withBody(encryptedPayload);
      } catch (encryptionError) {
        console.error('❌ UPDATE SESSION encryption failed:', encryptionError);
        throw new Error(`UPDATE SESSION payload encryption failed: ${encryptionError instanceof Error ? encryptionError.message : 'Unknown error'}`);
      }

      const config = builder.build();
      return await handleRequest(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'UPDATE_SESSION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * Delete course run
   * Equivalent to Python DeleteCourseRun class
   */
  async deleteCourseRun(
    runId: string,
    runInfo: DeleteRunInfo,
    includeExpired: OptionalSelector = OptionalSelector.NO
  ): Promise<SSGApiResponse<any>> {
    try {
      if (!this.credentials.encryptionKey) {
        throw new Error('Encryption key is required for deleting course runs');
      }

      // Validate the run info
      const validation = EditDeleteCourseRunUtils.validateDeleteRunInfo(runInfo);
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/courses/courseRuns/edit/${runId}`)
        .withMethod(HttpMethod.POST);

      // Add certificate authentication
      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Add query parameter
      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      // Convert to payload and encrypt
      const payload = EditDeleteCourseRunUtils.toDeletePayload(runInfo, this.credentials.uen);
      const encryptedPayload = Cryptography.encryptJSON(this.credentials.encryptionKey, payload);
      
      builder.withBody(encryptedPayload);

      const config = builder.build();
      return await handleRequest(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'DELETE_COURSE_RUN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * View course sessions
   * Equivalent to Python ViewCourseSessions class
   */
  async viewCourseSessions(
    courseReferenceNumber: string,
    courseRunId: string,
    includeExpired: OptionalSelector = OptionalSelector.NO,
    month?: number,
    year?: number
  ): Promise<SSGApiResponse<CourseSessionResponse>> {
    try {
      const builder = new HTTPRequestBuilder()
        .withEndpoint(this.baseUrl, `/courses/runs/${courseRunId}/sessions`)
        .withMethod(HttpMethod.GET)
        .withHeader('accept', 'application/json')
        .withHeader('Content-Type', 'application/json');

      // Add certificate authentication
      if (this.credentials.certificateContent && this.credentials.privateKeyContent) {
        builder.withCertificate(this.credentials.certificateContent, this.credentials.privateKeyContent);
      }

      // Add required query parameters
      builder.withParam('uen', this.credentials.uen);
      builder.withParam('courseReferenceNumber', courseReferenceNumber);

      // Add query parameter for expired courses
      switch (includeExpired) {
        case OptionalSelector.YES:
          builder.withParam('includeExpiredCourses', 'true');
          break;
        case OptionalSelector.NO:
          builder.withParam('includeExpiredCourses', 'false');
          break;
      }

      // Add month and year as sessionMonth parameter in MMYYYY format
      if (month !== undefined && year !== undefined && month >= 1 && month <= 12 && year >= 1900 && year <= 9999) {
        const formattedMonth = month < 10 ? `0${month}` : month.toString();
        const sessionMonth = `${formattedMonth}${year}`;
        builder.withParam('sessionMonth', sessionMonth);
      }

      const config = builder.build();
      return await handleRequest<CourseSessionResponse>(this.httpClient, config);
    } catch (error) {
      return {
        error: {
          code: 'VIEW_COURSE_SESSIONS_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        status: 0
      };
    }
  }

  /**
   * Update encryption key and other credentials
   */
  updateCredentials(credentials: SSGCredentials): void {
    this.credentials = credentials;
  }

  /**
   * Get current UEN
   */
  getCurrentUEN(): string {
    return this.credentials.uen;
  }

  /**
   * Validates and cleans payload by removing null/undefined fields
   */
  private validateAndCleanPayload(payload: any): any {
    return this.removeNullFields(payload);
  }

  /**
   * Recursively removes null and undefined fields from an object
   */
  private removeNullFields(obj: any): any {
    if (obj === null || obj === undefined) {
      return undefined;
    }

    if (Array.isArray(obj)) {
      return obj
        .map(item => this.removeNullFields(item))
        .filter(item => item !== undefined);
    }

    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const cleanedValue = this.removeNullFields(value);
        if (cleanedValue !== undefined) {
          cleaned[key] = cleanedValue;
        }
      }
      return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    }

    return obj;
  }
}

// Factory function to create SSG API client
export const createSSGCourseAPI = (
  baseUrl: string,
  credentials: SSGCredentials
): SSGCourseAPI => {
  return new SSGCourseAPI(baseUrl, credentials);
};

// Export specific course operation functions for convenience
export class CourseOperations {
  private api: SSGCourseAPI;

  constructor(api: SSGCourseAPI) {
    this.api = api;
  }

  async getCourseRun(runId: string, includeExpired?: OptionalSelector) {
    return this.api.viewCourseRun(runId, includeExpired);
  }

  async getCourseRunsByCode(
    courseReferenceNumber: string,
    options?: { page?: number; pageSize?: number; includeExpired?: boolean; uen?: string }
  ) {
    return this.api.searchCourseRunsByCode(courseReferenceNumber, options);
  }

  async createCourseRun(runInfo: AddRunInfo, includeExpired?: OptionalSelector) {
    return this.api.addCourseRun(runInfo, includeExpired);
  }

  async updateCourseRun(runId: string, runInfo: EditRunInfo, includeExpired?: OptionalSelector) {
    return this.api.editCourseRun(runId, runInfo, includeExpired);
  }

  async removeCourseRun(runId: string, runInfo: DeleteRunInfo, includeExpired?: OptionalSelector) {
    return this.api.deleteCourseRun(runId, runInfo, includeExpired);
  }

  async getCourseSessions(
    courseReferenceNumber: string, 
    courseRunId: string, 
    includeExpired?: OptionalSelector
  ) {
    return this.api.viewCourseSessions(courseReferenceNumber, courseRunId, includeExpired);
  }
}