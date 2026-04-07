/**
 * Edit/Delete Course Run Models
 * TypeScript interfaces matching Python models for Edit/Delete Course Run functionality
 */

import { 
  ModeOfTraining, 
  CourseVacancy, 
  OptionalSelector, 
  TrainerType, 
  IdType, 
  Salutations, 
  Role 
} from './course-runs';
import { LinkedSSECEQA } from './add-course-run';

/**
 * Session information for editing course runs
 */
export interface RunSessionEditInfo {
  sessionId?: string; // Course session ID for existing sessions
  modeOfTraining?: ModeOfTraining;
  
  // Session dates and times
  startDate?: string; // YYYY-MM-DD format
  endDate?: string; // YYYY-MM-DD format
  startTime?: string; // HH:MM format
  endTime?: string; // HH:MM format
  
  // Action for session (add, update, delete)
  action?: string;
  
  // Venue information (all optional for editing)
  block?: string;
  street?: string;
  floor?: string;
  unit?: string;
  building?: string;
  postalCode?: string;
  room?: string;
  wheelChairAccess?: OptionalSelector;
  primaryVenue?: OptionalSelector;
  
  // Session-specific venue fields (flat structure from frontend)
  sessionBlock?: string;
  sessionStreet?: string;
  sessionFloor?: string;
  sessionUnit?: string;
  sessionBuilding?: string;
  sessionPostalCode?: string;
  sessionRoom?: string;
}

/**
 * Trainer information for editing course runs
 */
export interface RunTrainerEditInfo {
  // Trainer type and basic info
  trainerTypeCode: TrainerType;
  trainerTypeDescription: string;
  
  // For existing trainers
  trainerIdNumber?: string;
  
  // For new trainers
  trainerIndexNumber?: number;
  trainerUniqueId?: string;
  trainerName?: string;
  trainerEmail?: string;
  
  // ID information
  idType?: IdType;
  
  // Trainer profile
  trainerRoles?: Role[];
  inTrainingProviderProfile?: OptionalSelector;
  experience?: string;
  linkedInURL?: string;
  domainAreaOfPractice?: string;
  salutationId?: Salutations;
  
  // Photo information
  photoName?: string;
  photoContent?: string; // Base64 encoded file content
  
  // Qualifications
  linkedSSECEQAs?: LinkedSSECEQA[];
}

/**
 * Course run information for editing
 */
export interface EditRunInfo {
  // Course reference and run identification
  courseReferenceNumber: string;
  sequenceNumber?: number;
  
  // Registration dates (optional for editing)
  openingRegistrationDate?: string; // YYYY-MM-DD format
  closingRegistrationDate?: string; // YYYY-MM-DD format
  
  // Course dates (optional for editing)
  courseStartDate?: string; // YYYY-MM-DD format
  courseEndDate?: string; // YYYY-MM-DD format
  
  // Schedule information (optional for editing)
  scheduleInfoTypeCode?: string;
  scheduleInfoTypeDescription?: string;
  scheduleInfo?: string;
  
  // Venue information (optional for editing)
  block?: string;
  street?: string;
  floor?: string;
  unit?: string;
  building?: string;
  postalCode?: string;
  room?: string;
  wheelChairAccess?: OptionalSelector;
  
  // Course intake details (optional for editing)
  intakeSize?: number;
  threshold?: number;
  registeredUserCount?: number;
  
  // Course admin details (optional for editing)
  modeOfTraining?: ModeOfTraining;
  courseAdminEmail?: string;
  
  // Course vacancy (optional for editing)
  courseVacancy?: CourseVacancy;
  
  // File details (optional for editing)
  fileName?: string;
  fileContent?: string; // Base64 encoded file content
  
  // Sessions and trainers (optional for editing)
  sessions?: RunSessionEditInfo[];
  linkCourseRunTrainer?: RunTrainerEditInfo[];
}

/**
 * Course run information for deletion (minimal required fields)
 */
export interface DeleteRunInfo {
  // Course reference number is the only required field for deletion
  courseReferenceNumber: string;
}

/**
 * Edit/Delete Course Run request wrapper
 */
export interface EditDeleteCourseRunRequest {
  action: 'update' | 'delete';
  runId: string; // Course Run ID
  includeExpiredCourses?: boolean;
  runInfo: EditRunInfo | DeleteRunInfo;
}

/**
 * Utility class for Edit/Delete Course Run operations
 */
export class EditDeleteCourseRunUtils {
  /**
   * Validate edit run info
   */
  static validateEditRunInfo(runInfo: EditRunInfo): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Course reference number is always required
    if (!runInfo.courseReferenceNumber || runInfo.courseReferenceNumber.trim().length === 0) {
      errors.push('Course reference number is required');
    }

    // Email validation if provided
    if (runInfo.courseAdminEmail && !this.isValidEmail(runInfo.courseAdminEmail)) {
      errors.push('Invalid email format for course admin email');
    }

    // Date validation if provided
    if (runInfo.openingRegistrationDate && runInfo.closingRegistrationDate) {
      const openingDate = new Date(runInfo.openingRegistrationDate);
      const closingDate = new Date(runInfo.closingRegistrationDate);
      if (openingDate >= closingDate) {
        errors.push('Opening registration date must be before closing registration date');
      }
    }

    if (runInfo.courseStartDate && runInfo.courseEndDate) {
      const startDate = new Date(runInfo.courseStartDate);
      const endDate = new Date(runInfo.courseEndDate);
      if (startDate > endDate) {
        errors.push('Course start date must be before or equal to course end date');
      }
    }

    // Intake validation if provided
    if (runInfo.intakeSize !== undefined && runInfo.threshold !== undefined && runInfo.registeredUserCount !== undefined) {
      const maxCapacity = runInfo.intakeSize + runInfo.threshold;
      if (runInfo.registeredUserCount > maxCapacity) {
        errors.push('Registered user count cannot exceed intake size + threshold');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate delete run info
   */
  static validateDeleteRunInfo(runInfo: DeleteRunInfo): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Course reference number is required
    if (!runInfo.courseReferenceNumber || runInfo.courseReferenceNumber.trim().length === 0) {
      errors.push('Course reference number is required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate delete session info
   * CRITICAL: This validates session deletion, NOT course run deletion
   */
  static validateDeleteSessionInfo(runInfo: EditRunInfo, sessionsToDelete: any[]): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Course reference number is required
    if (!runInfo.courseReferenceNumber || runInfo.courseReferenceNumber.trim().length === 0) {
      errors.push('Course reference number is required');
    }

    // Sessions array must not be empty
    if (!sessionsToDelete || sessionsToDelete.length === 0) {
      errors.push('At least one session must be specified for deletion');
    }

    // Validate each session
    if (sessionsToDelete && sessionsToDelete.length > 0) {
      sessionsToDelete.forEach((session, index) => {
        if (!session.sessionId && !session.id) {
          errors.push(`Session ${index + 1}: Session ID is required for deletion`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate add session info
   * CRITICAL: This validates session addition, NOT course run deletion
   */
  static validateAddSessionInfo(runInfo: EditRunInfo, sessionsToAdd: any[]): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Course reference number is required
    if (!runInfo.courseReferenceNumber || runInfo.courseReferenceNumber.trim().length === 0) {
      errors.push('Course reference number is required');
    }

    // Sessions array must not be empty
    if (!sessionsToAdd || sessionsToAdd.length === 0) {
      errors.push('At least one session must be specified for addition');
    }

    // Validate each session
    if (sessionsToAdd && sessionsToAdd.length > 0) {
      sessionsToAdd.forEach((session, index) => {
        // For new sessions, we don't require a session ID (backend will generate it)
        // But we do require other essential fields
        if (!session.startDate) {
          errors.push(`Session ${index + 1}: Start date is required`);
        }
        if (!session.endDate) {
          errors.push(`Session ${index + 1}: End date is required`);
        }
        if (!session.startTime) {
          errors.push(`Session ${index + 1}: Start time is required`);
        }
        if (!session.endTime) {
          errors.push(`Session ${index + 1}: End time is required`);
        }
        if (!session.modeOfTraining) {
          errors.push(`Session ${index + 1}: Mode of training is required`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate update session info
   * CRITICAL: This validates session update, NOT course run deletion
   */
  static validateUpdateSessionInfo(runInfo: EditRunInfo, sessionsToUpdate: any[]): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Course reference number is required
    if (!runInfo.courseReferenceNumber || runInfo.courseReferenceNumber.trim().length === 0) {
      errors.push('Course reference number is required');
    }

    // Sessions array must not be empty
    if (!sessionsToUpdate || sessionsToUpdate.length === 0) {
      errors.push('At least one session must be specified for update');
    }

    // Validate each session
    if (sessionsToUpdate && sessionsToUpdate.length > 0) {
      sessionsToUpdate.forEach((session, index) => {
        // For update sessions, we REQUIRE a session ID
        if (!session.sessionId && !session.id) {
          errors.push(`Session ${index + 1}: Session ID is required for update`);
        }
        // Validate other essential fields
        if (!session.startDate) {
          errors.push(`Session ${index + 1}: Start date is required`);
        }
        if (!session.endDate) {
          errors.push(`Session ${index + 1}: End date is required`);
        }
        if (!session.startTime) {
          errors.push(`Session ${index + 1}: Start time is required`);
        }
        if (!session.endTime) {
          errors.push(`Session ${index + 1}: End time is required`);
        }
        if (!session.modeOfTraining) {
          errors.push(`Session ${index + 1}: Mode of training is required`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert edit run info to API payload (matching Python EditRunInfo.payload())
   */
  static toEditPayload(runInfo: EditRunInfo, uen: string): any {
    const run: any = {
      action: "update"
    };

    // Add optional fields only if they are provided
    if (runInfo.sequenceNumber !== undefined) run.sequenceNumber = runInfo.sequenceNumber;
    
    // Registration dates - ALWAYS include for update according to schema
    run.registrationDates = {};
    if (runInfo.openingRegistrationDate) {
      const dateStr = runInfo.openingRegistrationDate.replace(/-/g, '');
      run.registrationDates.opening = parseInt(dateStr);
    } else {
      run.registrationDates.opening = 0; // Default value if not provided
    }
    if (runInfo.closingRegistrationDate) {
      const dateStr = runInfo.closingRegistrationDate.replace(/-/g, '');
      run.registrationDates.closing = parseInt(dateStr);
    } else {
      run.registrationDates.closing = 0; // Default value if not provided
    }

    // Course dates - ALWAYS include for update according to schema
    run.courseDates = {};
    if (runInfo.courseStartDate) {
      const dateStr = runInfo.courseStartDate.replace(/-/g, '');
      run.courseDates.start = parseInt(dateStr);
    } else {
      run.courseDates.start = 0; // Default value if not provided
    }
    if (runInfo.courseEndDate) {
      const dateStr = runInfo.courseEndDate.replace(/-/g, '');
      run.courseDates.end = parseInt(dateStr);
    } else {
      run.courseDates.end = 0; // Default value if not provided
    }

    // Schedule info - REQUIRED for update according to schema
    if (runInfo.scheduleInfoTypeCode || runInfo.scheduleInfoTypeDescription) {
      run.scheduleInfoType = {};
      if (runInfo.scheduleInfoTypeCode) run.scheduleInfoType.code = runInfo.scheduleInfoTypeCode;
      if (runInfo.scheduleInfoTypeDescription) run.scheduleInfoType.description = runInfo.scheduleInfoTypeDescription;
    }
    if (runInfo.scheduleInfo) run.scheduleInfo = runInfo.scheduleInfo;

    // Venue info - ALWAYS include venue object (required for session additions)
    const venue: any = {};
    const allVenueFields = ['block', 'street', 'floor', 'unit', 'building', 'postalCode', 'room'];
    
    allVenueFields.forEach(field => {
      if (runInfo[field as keyof EditRunInfo] !== undefined && runInfo[field as keyof EditRunInfo] !== null) {
        venue[field] = runInfo[field as keyof EditRunInfo];
      } else {
        venue[field] = ""; // Include empty string if not provided
      }
    });

    // Handle wheelChairAccess separately
    if (runInfo.wheelChairAccess !== undefined) {
      const wheelChairValue = String(runInfo.wheelChairAccess);
      venue.wheelChairAccess = wheelChairValue === OptionalSelector.YES || wheelChairValue === 'true';
    } else {
      venue.wheelChairAccess = false; // Default value
    }
    
    run.venue = venue; // Always include venue

    // Course admin details - ALWAYS include
    if (runInfo.modeOfTraining) run.modeOfTraining = runInfo.modeOfTraining;
    run.courseAdminEmail = runInfo.courseAdminEmail || ""; // Always include, default to empty string

    // Course vacancy - ALWAYS include
    run.courseVacancy = runInfo.courseVacancy || {
      code: "A",
      description: "Available"
    };

    // Intake details
    if (runInfo.intakeSize !== undefined) run.intakeSize = runInfo.intakeSize;
    if (runInfo.threshold !== undefined) run.threshold = runInfo.threshold;
    if (runInfo.registeredUserCount !== undefined) run.registeredUserCount = runInfo.registeredUserCount;

    // File details - always include file object according to working example
    run.file = {
      Name: runInfo.fileName || "",
      content: runInfo.fileContent || ""
    };

    // Sessions - Use simple array format (as specified in requirements)
    if (runInfo.sessions && runInfo.sessions.length > 0) {
      run.sessions = runInfo.sessions.map((session) => {
        return EditDeleteCourseRunUtils.sessionToPayload(session);
      });
    }

    // Trainers - Use array format to match Python implementation
    if (runInfo.linkCourseRunTrainer && runInfo.linkCourseRunTrainer.length > 0) {
      run.linkCourseRunTrainer = runInfo.linkCourseRunTrainer.map(trainer => 
        EditDeleteCourseRunUtils.trainerToPayload(trainer)
      );
    }

    const payload = {
      course: {
        courseReferenceNumber: runInfo.courseReferenceNumber,
        trainingProvider: {
          uen: uen
        },
        run: run
      }
    };

    // Remove null fields like Python implementation
    return EditDeleteCourseRunUtils.removeNullFields(payload);
  }

  /**
   * Convert add session info to API payload - SEPARATE function for adding sessions
   */
  static toAddSessionPayload(runInfo: EditRunInfo, uen: string): any {
    console.log('🔄 Building ADD session payload with runInfo:', JSON.stringify(runInfo, null, 2));
    
    const run: any = {
      action: "update" // Always "update" for session operations
    };

    // Registration dates - Use actual data from SSG API response
    run.registrationDates = {};
    if (runInfo.openingRegistrationDate && runInfo.openingRegistrationDate !== '') {
      const dateStr = runInfo.openingRegistrationDate.replace(/-/g, '');
      run.registrationDates.opening = parseInt(dateStr);
      console.log('✅ Set opening registration date:', run.registrationDates.opening);
    } else {
      run.registrationDates.opening = 0;
      console.log('⚠️ No opening registration date provided, using 0');
    }
    
    if (runInfo.closingRegistrationDate && runInfo.closingRegistrationDate !== '') {
      const dateStr = runInfo.closingRegistrationDate.replace(/-/g, '');
      run.registrationDates.closing = parseInt(dateStr);
      console.log('✅ Set closing registration date:', run.registrationDates.closing);
    } else {
      run.registrationDates.closing = 0;
      console.log('⚠️ No closing registration date provided, using 0');
    }

    // Course dates - Use actual data from SSG API response
    run.courseDates = {};
    if (runInfo.courseStartDate && runInfo.courseStartDate !== '') {
      const dateStr = runInfo.courseStartDate.replace(/-/g, '');
      run.courseDates.start = parseInt(dateStr);
      console.log('✅ Set course start date:', run.courseDates.start);
    } else {
      run.courseDates.start = 0;
      console.log('⚠️ No course start date provided, using 0');
    }
    
    if (runInfo.courseEndDate && runInfo.courseEndDate !== '') {
      const dateStr = runInfo.courseEndDate.replace(/-/g, '');
      run.courseDates.end = parseInt(dateStr);
      console.log('✅ Set course end date:', run.courseDates.end);
    } else {
      run.courseDates.end = 0;
      console.log('⚠️ No course end date provided, using 0');
    }

    // Schedule info
    run.scheduleInfoType = {
      code: runInfo.scheduleInfoTypeCode || "01",
      description: runInfo.scheduleInfoTypeDescription || "New Info Type Description"
    };

    // Venue info - Use actual data from SSG API response
    const venue: any = {};
    const allVenueFields = ['block', 'street', 'floor', 'unit', 'building', 'postalCode', 'room'];
    
    allVenueFields.forEach(field => {
      const value = runInfo[field as keyof EditRunInfo];
      if (value !== undefined && value !== null && value !== '') {
        venue[field] = value;
        console.log(`✅ Set venue ${field}:`, value);
      } else {
        venue[field] = "";
        console.log(`⚠️ No venue ${field} provided, using empty string`);
      }
    });

    // Handle wheelChairAccess
    if (runInfo.wheelChairAccess !== undefined) {
      const wheelChairValue = String(runInfo.wheelChairAccess);
      venue.wheelChairAccess = wheelChairValue === OptionalSelector.YES || wheelChairValue === 'true';
      console.log('✅ Set wheelchair access:', venue.wheelChairAccess);
    } else {
      venue.wheelChairAccess = false;
      console.log('⚠️ No wheelchair access provided, using false');
    }
    
    run.venue = venue;

    // Course admin email - Use actual data from SSG API response
    if (runInfo.courseAdminEmail && runInfo.courseAdminEmail !== '') {
      run.courseAdminEmail = runInfo.courseAdminEmail;
      console.log('✅ Set course admin email:', runInfo.courseAdminEmail);
    } else {
      run.courseAdminEmail = "";
      console.log('⚠️ No course admin email provided, using empty string');
    }

    // Course vacancy - Use actual data from SSG API response
    if (runInfo.courseVacancy && runInfo.courseVacancy.code) {
      run.courseVacancy = {
        code: runInfo.courseVacancy.code,
        description: runInfo.courseVacancy.description || "Available"
      };
      console.log('✅ Set course vacancy:', run.courseVacancy);
    } else {
      run.courseVacancy = {
        code: "A",
        description: "Available"
      };
      console.log('⚠️ No course vacancy provided, using default');
    }

    // File details
    run.file = {
      Name: runInfo.fileName || "",
      content: runInfo.fileContent || ""
    };

    // Sessions - Only add sessions for session addition
    if (runInfo.sessions && runInfo.sessions.length > 0) {
      run.sessions = runInfo.sessions.map((session) => {
        const sessionPayload = EditDeleteCourseRunUtils.sessionToPayload(session);
        // Ensure action is "add" for new sessions
        sessionPayload.action = "add";
        return sessionPayload;
      });
      console.log('✅ Added sessions:', run.sessions.length);
    }

    const payload = {
      course: {
        courseReferenceNumber: runInfo.courseReferenceNumber,
        trainingProvider: {
          uen: uen
        },
        run: run
      }
    };

    console.log('🔄 Final ADD session payload:', JSON.stringify(payload, null, 2));
    return EditDeleteCourseRunUtils.removeNullFields(payload);
  }



  /**
   * Convert update session info to API payload - SEPARATE function for updating sessions
   * CRITICAL: This is for updating SESSIONS within a course run, NOT for updating the entire course run
   * The run action must be "update" and session action must be "update" with sessionId
   */
  static toUpdateSessionPayload(runInfo: EditRunInfo, sessionsToUpdate: any[], uen: string): any {
    console.log('🔄 Building UPDATE session payload with runInfo:', JSON.stringify(runInfo, null, 2));
    
    const run: any = {
      action: "update" // CRITICAL: Must be "update" for session operations
    };

    // Registration dates - Use actual data from SSG API response (SAME as add/delete sessions)
    run.registrationDates = {};
    if (runInfo.openingRegistrationDate && runInfo.openingRegistrationDate !== '') {
      const dateStr = runInfo.openingRegistrationDate.replace(/-/g, '');
      run.registrationDates.opening = parseInt(dateStr);
      console.log('✅ UPDATE: Set opening registration date:', run.registrationDates.opening);
    } else {
      run.registrationDates.opening = 0;
      console.log('⚠️ UPDATE: No opening registration date provided, using 0');
    }
    
    if (runInfo.closingRegistrationDate && runInfo.closingRegistrationDate !== '') {
      const dateStr = runInfo.closingRegistrationDate.replace(/-/g, '');
      run.registrationDates.closing = parseInt(dateStr);
      console.log('✅ UPDATE: Set closing registration date:', run.registrationDates.closing);
    } else {
      run.registrationDates.closing = 0;
      console.log('⚠️ UPDATE: No closing registration date provided, using 0');
    }

    // Course dates - Use actual data from SSG API response (SAME as add/delete sessions)
    run.courseDates = {};
    if (runInfo.courseStartDate && runInfo.courseStartDate !== '') {
      const dateStr = runInfo.courseStartDate.replace(/-/g, '');
      run.courseDates.start = parseInt(dateStr);
      console.log('✅ UPDATE: Set course start date:', run.courseDates.start);
    } else {
      run.courseDates.start = 0;
      console.log('⚠️ UPDATE: No course start date provided, using 0');
    }
    
    if (runInfo.courseEndDate && runInfo.courseEndDate !== '') {
      const dateStr = runInfo.courseEndDate.replace(/-/g, '');
      run.courseDates.end = parseInt(dateStr);
      console.log('✅ UPDATE: Set course end date:', run.courseDates.end);
    } else {
      run.courseDates.end = 0;
      console.log('⚠️ UPDATE: No course end date provided, using 0');
    }

    // Schedule info
    run.scheduleInfoType = {
      code: runInfo.scheduleInfoTypeCode || "01",
      description: runInfo.scheduleInfoTypeDescription || "Description"
    };

    // Venue info - Use actual data from SSG API response (SAME as add/delete sessions)
    const venue: any = {};
    const allVenueFields = ['block', 'street', 'floor', 'unit', 'building', 'postalCode', 'room'];
    
    allVenueFields.forEach(field => {
      const value = runInfo[field as keyof EditRunInfo];
      if (value !== undefined && value !== null && value !== '') {
        venue[field] = value;
        console.log(`✅ UPDATE: Set venue ${field}:`, value);
      } else {
        venue[field] = "";
        console.log(`⚠️ UPDATE: No venue ${field} provided, using empty string`);
      }
    });

    // Handle wheelChairAccess
    if (runInfo.wheelChairAccess !== undefined) {
      const wheelChairValue = String(runInfo.wheelChairAccess);
      venue.wheelChairAccess = wheelChairValue === OptionalSelector.YES || wheelChairValue === 'true';
      console.log('✅ UPDATE: Set wheelchair access:', venue.wheelChairAccess);
    } else {
      venue.wheelChairAccess = false;
      console.log('⚠️ UPDATE: No wheelchair access provided, using false');
    }
    
    run.venue = venue;

    // Course admin email - Use actual data from SSG API response (SAME as add/delete sessions)
    if (runInfo.courseAdminEmail && runInfo.courseAdminEmail !== '') {
      run.courseAdminEmail = runInfo.courseAdminEmail;
      console.log('✅ UPDATE: Set course admin email:', runInfo.courseAdminEmail);
    } else {
      run.courseAdminEmail = "";
      console.log('⚠️ UPDATE: No course admin email provided, using empty string');
    }

    // Course vacancy - Use actual data from SSG API response (SAME as add/delete sessions)
    if (runInfo.courseVacancy && runInfo.courseVacancy.code) {
      run.courseVacancy = {
        code: runInfo.courseVacancy.code,
        description: runInfo.courseVacancy.description || "Available"
      };
      console.log('✅ UPDATE: Set course vacancy:', run.courseVacancy);
    } else {
      run.courseVacancy = {
        code: "A",
        description: "Available"
      };
      console.log('⚠️ UPDATE: No course vacancy provided, using default');
    }

    // File details
    run.file = {
      Name: runInfo.fileName || "",
      content: runInfo.fileContent || ""
    };

    // Sessions - Map each session for update with "update" action and sessionId
    run.sessions = sessionsToUpdate.map(session => ({
      action: "update",  // CRITICAL: Session action is "update"
      sessionId: session.sessionId || session.id, // REQUIRED for update
      startDate: session.startDate ? String(session.startDate).replace(/-/g, '') : "",
      endDate: session.endDate ? String(session.endDate).replace(/-/g, '') : "",
      startTime: session.startTime || "",
      endTime: session.endTime || "",
      modeOfTraining: session.modeOfTraining || "",
      venue: {
        block: session.venue?.block || session.sessionBlock || "",
        street: session.venue?.street || session.sessionStreet || "",
        floor: session.venue?.floor || session.sessionFloor || "",
        unit: session.venue?.unit || session.sessionUnit || "",
        building: session.venue?.building || session.sessionBuilding || "",
        postalCode: session.venue?.postalCode || session.sessionPostalCode || "",
        room: session.venue?.room || session.sessionRoom || ""
      }
    }));

    const payload = {
      course: {
        courseReferenceNumber: runInfo.courseReferenceNumber,
        trainingProvider: {
          uen: uen
        },
        run: run
      }
    };

    console.log('🔄 Final UPDATE session payload:', JSON.stringify(payload, null, 2));
    return EditDeleteCourseRunUtils.removeNullFields(payload);
  }

  /**
   * Remove null/undefined/empty fields from object (matching Python remove_null_fields)
   * Special handling for numbered object structures like sessions and trainers
   */
  private static removeNullFields(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      const filtered = obj.filter(item => item !== null && item !== undefined);
      return filtered.map(item => EditDeleteCourseRunUtils.removeNullFields(item));
    }

    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined) {
          if (typeof value === 'object' && !Array.isArray(value)) {
            const cleaned = EditDeleteCourseRunUtils.removeNullFields(value);
            // For numbered objects (sessions, trainers), keep even if they have some empty fields
            if (Object.keys(cleaned).length > 0 || /^\d+$/.test(key)) {
              result[key] = cleaned;
            }
          } else if (Array.isArray(value)) {
            const cleaned = EditDeleteCourseRunUtils.removeNullFields(value);
            if (cleaned.length > 0) {
              result[key] = cleaned;
            }
          } else {
            result[key] = value;
          }
        }
      }
      return result;
    }

    return obj;
  }

  /**
   * Convert delete run info to API payload (matching Python DeleteRunInfo.payload())
   */
  static toDeletePayload(runInfo: DeleteRunInfo, uen: string): any {
    return {
      course: {
        courseReferenceNumber: runInfo.courseReferenceNumber,
        trainingProvider: {
          uen: uen
        },
        run: {
          action: "delete"
        }
      }
    };
  }

  /**
   * Convert session deletion info to payload format - SAME structure as add sessions but with "delete" action
   * CRITICAL: This is for deleting SESSIONS within a course run, NOT for deleting the entire course run
   * The run action must be "update" and session action must be "delete"
   */
  static toDeleteSessionPayload(runInfo: EditRunInfo, sessionsToDelete: any[], uen: string): any {
    console.log('🔄 Building DELETE session payload with runInfo:', JSON.stringify(runInfo, null, 2));
    
    const run: any = {
      action: "update" // CRITICAL: Must be "update" for session operations, NOT "delete"
    };

    // Registration dates - Use actual data from SSG API response (SAME as add sessions)
    run.registrationDates = {};
    if (runInfo.openingRegistrationDate && runInfo.openingRegistrationDate !== '') {
      const dateStr = runInfo.openingRegistrationDate.replace(/-/g, '');
      run.registrationDates.opening = parseInt(dateStr);
      console.log('✅ DELETE: Set opening registration date:', run.registrationDates.opening);
    } else {
      run.registrationDates.opening = 0;
      console.log('⚠️ DELETE: No opening registration date provided, using 0');
    }
    
    if (runInfo.closingRegistrationDate && runInfo.closingRegistrationDate !== '') {
      const dateStr = runInfo.closingRegistrationDate.replace(/-/g, '');
      run.registrationDates.closing = parseInt(dateStr);
      console.log('✅ DELETE: Set closing registration date:', run.registrationDates.closing);
    } else {
      run.registrationDates.closing = 0;
      console.log('⚠️ DELETE: No closing registration date provided, using 0');
    }

    // Course dates - Use actual data from SSG API response (SAME as add sessions)
    run.courseDates = {};
    if (runInfo.courseStartDate && runInfo.courseStartDate !== '') {
      const dateStr = runInfo.courseStartDate.replace(/-/g, '');
      run.courseDates.start = parseInt(dateStr);
      console.log('✅ DELETE: Set course start date:', run.courseDates.start);
    } else {
      run.courseDates.start = 0;
      console.log('⚠️ DELETE: No course start date provided, using 0');
    }
    
    if (runInfo.courseEndDate && runInfo.courseEndDate !== '') {
      const dateStr = runInfo.courseEndDate.replace(/-/g, '');
      run.courseDates.end = parseInt(dateStr);
      console.log('✅ DELETE: Set course end date:', run.courseDates.end);
    } else {
      run.courseDates.end = 0;
      console.log('⚠️ DELETE: No course end date provided, using 0');
    }

    // Schedule info
    run.scheduleInfoType = {
      code: runInfo.scheduleInfoTypeCode || "01",
      description: runInfo.scheduleInfoTypeDescription || "Description"
    };

    // Venue info - Use actual data from SSG API response (SAME as add sessions)
    const venue: any = {};
    const allVenueFields = ['block', 'street', 'floor', 'unit', 'building', 'postalCode', 'room'];
    
    allVenueFields.forEach(field => {
      const value = runInfo[field as keyof EditRunInfo];
      if (value !== undefined && value !== null && value !== '') {
        venue[field] = value;
        console.log(`✅ DELETE: Set venue ${field}:`, value);
      } else {
        venue[field] = "";
        console.log(`⚠️ DELETE: No venue ${field} provided, using empty string`);
      }
    });

    // Handle wheelChairAccess
    if (runInfo.wheelChairAccess !== undefined) {
      const wheelChairValue = String(runInfo.wheelChairAccess);
      venue.wheelChairAccess = wheelChairValue === OptionalSelector.YES || wheelChairValue === 'true';
      console.log('✅ DELETE: Set wheelchair access:', venue.wheelChairAccess);
    } else {
      venue.wheelChairAccess = false;
      console.log('⚠️ DELETE: No wheelchair access provided, using false');
    }
    
    run.venue = venue;

    // Course admin email - Use actual data from SSG API response (SAME as add sessions)
    if (runInfo.courseAdminEmail && runInfo.courseAdminEmail !== '') {
      run.courseAdminEmail = runInfo.courseAdminEmail;
      console.log('✅ DELETE: Set course admin email:', runInfo.courseAdminEmail);
    } else {
      run.courseAdminEmail = "";
      console.log('⚠️ DELETE: No course admin email provided, using empty string');
    }

    // Course vacancy - Use actual data from SSG API response (SAME as add sessions)
    if (runInfo.courseVacancy && runInfo.courseVacancy.code) {
      run.courseVacancy = {
        code: runInfo.courseVacancy.code,
        description: runInfo.courseVacancy.description || "Available"
      };
      console.log('✅ DELETE: Set course vacancy:', run.courseVacancy);
    } else {
      run.courseVacancy = {
        code: "A",
        description: "Available"
      };
      console.log('⚠️ DELETE: No course vacancy provided, using default');
    }

    // File details
    run.file = {
      Name: runInfo.fileName || "",
      content: runInfo.fileContent || ""
    };

    // Sessions - Map each session for deletion with "delete" action
    run.sessions = sessionsToDelete.map(session => ({
      action: "delete",  // CRITICAL: Session action is "delete"
      sessionId: session.sessionId || session.id,
      startDate: session.startDate ? String(session.startDate) : "",
      endDate: session.endDate ? String(session.endDate) : "",
      startTime: session.startTime || "",
      endTime: session.endTime || "",
      modeOfTraining: session.modeOfTraining || "",
      venue: {
        block: session.venue?.block || session.sessionBlock || "",
        street: session.venue?.street || session.sessionStreet || "",
        floor: session.venue?.floor || session.sessionFloor || "",
        unit: session.venue?.unit || session.sessionUnit || "",
        building: session.venue?.building || session.sessionBuilding || "",
        postalCode: session.venue?.postalCode || session.sessionPostalCode || "",
        room: session.venue?.room || session.sessionRoom || ""
      }
    }));

    const payload = {
      course: {
        courseReferenceNumber: runInfo.courseReferenceNumber,
        trainingProvider: {
          uen: uen
        },
        run: run
      }
    };

    console.log('🔄 Final DELETE session payload:', JSON.stringify(payload, null, 2));
    return EditDeleteCourseRunUtils.removeNullFields(payload);
  }

  /**
   * Convert session info to payload format
   */
  private static sessionToPayload(session: RunSessionEditInfo): any {
    const payload: any = {
      action: session.action || "update"  // Use session's action if provided, default to "update"
    };

    if (session.sessionId) payload.sessionId = session.sessionId;
    
    // Convert dates from YYYY-MM-DD to YYYYMMDD format as STRINGS (matching Python strftime)
    if (session.startDate) {
      payload.startDate = session.startDate.replace(/-/g, '');
    }
    if (session.endDate) {
      payload.endDate = session.endDate.replace(/-/g, '');
    }
    if (session.startTime) payload.startTime = session.startTime;
    if (session.endTime) payload.endTime = session.endTime;
    if (session.modeOfTraining) payload.modeOfTraining = session.modeOfTraining;

    // Handle session venue — priority: nested session.venue > sessionFloor/sessionUnit > flat floor/unit
    const venue: any = {};
    let hasSessionVenueInfo = false;

    // 1. Nested venue object (e.g. { venue: { floor, unit, room, postalCode, ... } })
    const nestedVenue = (session as any).venue;
    if (nestedVenue && typeof nestedVenue === 'object') {
      const venueFields = ['block', 'street', 'floor', 'unit', 'building', 'postalCode', 'room', 'wheelChairAccess'];
      venueFields.forEach(field => {
        if (nestedVenue[field] !== undefined && nestedVenue[field] !== null && nestedVenue[field] !== '') {
          venue[field] = nestedVenue[field];
          hasSessionVenueInfo = true;
        }
      });
    }

    // 2. Prefixed session-specific fields (sessionFloor, sessionUnit, etc.)
    if (!hasSessionVenueInfo) {
      const sessionVenueMapping: Record<string, string> = {
        sessionBlock: 'block', sessionStreet: 'street',
        sessionFloor: 'floor', sessionUnit: 'unit',
        sessionBuilding: 'building', sessionPostalCode: 'postalCode', sessionRoom: 'room'
      };
      Object.entries(sessionVenueMapping).forEach(([sessionField, venueField]) => {
        const val = session[sessionField as keyof RunSessionEditInfo];
        if (val !== undefined && val !== null) { venue[venueField] = val; hasSessionVenueInfo = true; }
      });
    }

    // 3. Flat venue fields directly on session
    if (!hasSessionVenueInfo) {
      ['block', 'street', 'floor', 'unit', 'building', 'postalCode', 'room', 'wheelChairAccess'].forEach(field => {
        const val = session[field as keyof RunSessionEditInfo];
        if (val !== undefined && val !== null) { venue[field] = val; hasSessionVenueInfo = true; }
      });
    }

    if (hasSessionVenueInfo) {
      payload.venue = venue;
    }

    return payload;
  }

  /**
   * Convert trainer info to payload format
   */
  private static trainerToPayload(trainer: RunTrainerEditInfo): any {
    const trainerData: any = {
      // Photo is required according to working example - always include even if empty
      photo: {
        name: trainer.photoName || "",
        content: trainer.photoContent || ""
      },
      trainerType: {
        code: trainer.trainerTypeCode,
        description: trainer.trainerTypeDescription
      }
    };

    // Map trainer identification according to schema
    if (trainer.trainerIdNumber) trainerData.idNumber = trainer.trainerIdNumber;  // trainerIdNumber -> idNumber
    if (trainer.trainerIndexNumber !== undefined) trainerData.indexNumber = trainer.trainerIndexNumber;  // trainerIndexNumber -> indexNumber
    if (trainer.trainerUniqueId) trainerData.id = trainer.trainerUniqueId;  // trainerUniqueId -> id

    // Basic info
    if (trainer.trainerName) trainerData.name = trainer.trainerName;  // trainerName -> name
    if (trainer.trainerEmail) trainerData.email = trainer.trainerEmail;  // trainerEmail -> email
    
    // ID Type object structure according to schema
    if (trainer.idType) {
      trainerData.idType = {
        code: trainer.idType,
        description: this.getIdTypeDescription(trainer.idType)
      };
    }

    // Roles array structure according to schema
    if (trainer.trainerRoles && trainer.trainerRoles.length > 0) {
      trainerData.roles = trainer.trainerRoles.map(roleId => ({
        role: {
          id: parseInt(roleId),
          description: this.getRoleDescription(roleId)
        }
      }));
    }

    // Profile info
    if (trainer.inTrainingProviderProfile !== undefined) trainerData.inTrainingProviderProfile = trainer.inTrainingProviderProfile;
    if (trainer.domainAreaOfPractice) trainerData.domainAreaOfPractice = trainer.domainAreaOfPractice;
    if (trainer.experience) trainerData.experience = trainer.experience;
    if (trainer.linkedInURL) trainerData.linkedInURL = trainer.linkedInURL;
    if (trainer.salutationId !== undefined) trainerData.salutationId = trainer.salutationId;

    // Qualifications
    if (trainer.linkedSSECEQAs && trainer.linkedSSECEQAs.length > 0) {
      trainerData.linkedSsecEQAs = trainer.linkedSSECEQAs;
    }

    // Wrap trainer data in trainer object according to schema
    return {
      trainer: trainerData
    };
  }

  /**
   * Get ID type description from code
   */
  private static getIdTypeDescription(code: string): string {
    const idTypeMap: Record<string, string> = {
      'SP': 'Singapore Pink Identification Card',
      'SB': 'Singapore Blue Identification Card', 
      'SO': 'FIN/Work Permit',
      'FP': 'Foreign Passport',
      'OT': 'Others'
    };
    return idTypeMap[code] || 'Others';
  }

  /**
   * Get role description from ID
   */
  private static getRoleDescription(roleId: string): string {
    const roleMap: Record<string, string> = {
      '1': 'Trainer',
      '2': 'Assessor'
    };
    return roleMap[roleId] || 'Trainer';
  }

  /**
   * Validate email format
   */
  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}