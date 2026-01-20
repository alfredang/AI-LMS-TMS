/**
 * Add Course Run Models
 * TypeScript interfaces matching Python models for Add Course Run functionality
 */

import { 
  ModeOfTraining, 
  Vacancy, 
  OptionalSelector, 
  TrainerType, 
  IdType, 
  Salutations, 
  Role 
} from './course-runs';

/**
 * Linked SSEC EQA entry for trainer qualifications
 */
export interface LinkedSSECEQA {
  ssecEQA: string;
  description?: string;
}

/**
 * Session information for adding course runs
 */
export interface RunSessionAddInfo {
  // Mode of training for the session
  modeOfTraining: ModeOfTraining;
  
  // Session dates and times
  startDate: string; // YYYY-MM-DD format
  endDate?: string; // YYYY-MM-DD format (auto-set for certain modes)
  startTime?: string; // HH:MM format
  endTime?: string; // HH:MM format
  
  // Venue information
  block?: string;
  street?: string;
  floor: string;
  unit: string;
  building?: string;
  postalCode: string;
  room: string;
  wheelChairAccess?: OptionalSelector;
  primaryVenue?: OptionalSelector;
}

/**
 * Trainer information for adding course runs
 */
export interface RunTrainerAddInfo {
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
 * Individual course run information for adding
 */
export interface AddRunIndividualInfo {
  // Run sequence number
  sequenceNumber: number;
  
  // Registration dates
  openingRegistrationDate: string; // YYYY-MM-DD format
  closingRegistrationDate: string; // YYYY-MM-DD format
  
  // Course dates
  courseStartDate: string; // YYYY-MM-DD format
  courseEndDate: string; // YYYY-MM-DD format
  
  // Schedule information
  scheduleInfoTypeCode: string;
  scheduleInfoTypeDescription: string;
  scheduleInfo: string;
  
  // Venue information
  block?: string;
  street?: string;
  floor: string;
  unit: string;
  building?: string;
  postalCode: string;
  room: string;
  wheelChairAccess?: OptionalSelector;
  
  // Course intake details
  intakeSize?: number;
  threshold?: number;
  registeredUserCount?: number;
  
  // Course admin details
  modeOfTraining: ModeOfTraining;
  courseAdminEmail: string;
  
  // Course vacancy
  courseVacancy: Vacancy;
  
  // File details
  fileName?: string;
  fileContent?: string; // Base64 encoded file content
  
  // Sessions and trainers
  sessions: RunSessionAddInfo[];
  linkCourseRunTrainer: RunTrainerAddInfo[];
}

/**
 * Main Add Run Info containing course reference and runs
 */
export interface AddRunInfo {
  // Course reference number
  courseReferenceNumber: string;
  
  // List of runs to add
  runs: AddRunIndividualInfo[];
}

/**
 * Request payload structure for Add Course Run API
 */
export interface AddCourseRunPayload {
  course: {
    courseReferenceNumber: string;
    trainingProvider: {
      uen: string;
    };
    runs: AddRunIndividualInfo[];
  };
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Add Course Run API response
 */
export interface AddCourseRunResponse {
  data?: {
    course?: {
      courseReferenceNumber?: string;
      runs?: Array<{
        sequenceNumber?: number;
        runId?: string;
        message?: string;
      }>;
    };
  };
  error?: string;
  message?: string;
  status?: number;
}

/**
 * Utility class for Add Course Run operations
 */
export class AddCourseRunUtils {
  /**
   * Validates an individual run's required fields
   */
  static validateIndividualRun(run: AddRunIndividualInfo): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields validation
    if (!run.openingRegistrationDate) {
      errors.push('Opening registration date is required');
    }
    if (!run.closingRegistrationDate) {
      errors.push('Closing registration date is required');
    }
    if (!run.courseStartDate) {
      errors.push('Course start date is required');
    }
    if (!run.courseEndDate) {
      errors.push('Course end date is required');
    }
    if (!run.scheduleInfoTypeCode) {
      errors.push('Schedule info type code is required');
    }
    if (!run.scheduleInfoTypeDescription) {
      errors.push('Schedule info type description is required');
    }
    if (!run.scheduleInfo) {
      errors.push('Schedule info is required');
    }
    if (!run.floor) {
      errors.push('Floor is required');
    }
    if (!run.unit) {
      errors.push('Unit is required');
    }
    if (!run.postalCode) {
      errors.push('Postal code is required');
    }
    if (!run.room) {
      errors.push('Room is required');
    }
    if (!run.courseAdminEmail) {
      errors.push('Course admin email is required');
    }

    // Email format validation
    if (run.courseAdminEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(run.courseAdminEmail)) {
        errors.push('Invalid email format for course admin email');
      }
    }

    // Date validation
    if (run.openingRegistrationDate && run.closingRegistrationDate) {
      if (new Date(run.openingRegistrationDate) >= new Date(run.closingRegistrationDate)) {
        warnings.push('Opening registration date should be before closing registration date');
      }
    }

    if (run.courseStartDate && run.courseEndDate) {
      if (new Date(run.courseStartDate) > new Date(run.courseEndDate)) {
        errors.push('Course start date cannot be after course end date');
      }
    }

    return { errors, warnings };
  }

  /**
   * Validates the complete Add Run Info
   */
  static validateAddRunInfo(addRunInfo: AddRunInfo): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!addRunInfo.courseReferenceNumber) {
      errors.push('Course reference number is required');
    }

    if (!addRunInfo.runs || addRunInfo.runs.length === 0) {
      errors.push('At least one run is required');
    }

    // Validate each run
    addRunInfo.runs?.forEach((run, index) => {
      const runValidation = this.validateIndividualRun(run);
      runValidation.errors.forEach(error => {
        errors.push(`Run ${index + 1}: ${error}`);
      });
      runValidation.warnings.forEach(warning => {
        warnings.push(`Run ${index + 1}: ${warning}`);
      });
    });

    return { errors, warnings };
  }

  /**
   * Converts AddRunInfo to API payload format
   */
  static toPayload(addRunInfo: AddRunInfo, uen: string): AddCourseRunPayload {
    return {
      course: {
        courseReferenceNumber: addRunInfo.courseReferenceNumber,
        trainingProvider: {
          uen: uen
        },
        runs: addRunInfo.runs
      }
    };
  }

  /**
   * Removes null/undefined fields from an object (similar to Python remove_null_fields)
   */
  static removeNullFields(obj: any, exclude: string[] = []): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeNullFields(item, exclude));
    }

    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (exclude.includes(key)) {
          cleaned[key] = value;
        } else if (value !== null && value !== undefined && value !== '') {
          cleaned[key] = this.removeNullFields(value, exclude);
        }
      }
      return cleaned;
    }

    return obj;
  }
}