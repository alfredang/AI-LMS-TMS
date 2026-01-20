/**
 * Client-side types for SSG API
 * These are simplified versions of the server-side models for use in React components
 */

export enum OptionalSelector {
  YES = "Y",
  NO = "N"
}

export enum ModeOfTraining {
  CLASSROOM = "1",
  ELEARNING = "2",
  ON_THE_JOB = "3",
  BLENDED = "4",
  PRACTICAL = "5",
  SUPERVISION = "6",
  WORKPLACE = "7"
}

export enum Vacancy {
  AVAILABLE = "available",
  FULL = "full",
  LIMITED = "limited"
}

export enum IdType {
  SINGAPORE_BLUE = "SB",
  SINGAPORE_PINK = "SP", 
  FIN_WORK_PERMIT = "SO",
  OTHERS = "OT"
}

export enum Salutations {
  MR = "1",
  MS = "2", 
  MRS = "3",
  MDM = "4",
  DR = "5",
  PROF = "6"
}

export enum Role {
  TRAINER = "T",
  ASSESSOR = "A"
}

export interface CourseRunRequest {
  runId: string;
  includeExpired?: boolean;
}

export interface CourseRunResponse {
  course?: {
    courseReferenceNumber?: string;
    title?: string;
    description?: string;
    trainingProvider?: {
      uen?: string;
      name?: string;
      code?: string;
    };
  };
  run?: {
    id?: string;
    sequenceNumber?: number;
    registrationDates?: {
      opening?: string;
      closing?: string;
    };
    courseDates?: {
      start?: string;
      end?: string;
    };
    scheduleInfo?: string;
    venue?: {
      block?: string;
      street?: string;
      floor?: string;
      unit?: string;
      building?: string;
      postalCode?: string;
      room?: string;
      wheelChairAccess?: boolean;
    };
    intakeSize?: number;
    threshold?: number;
    registeredUserCount?: number;
    modeOfTraining?: ModeOfTraining;
    courseAdminEmail?: {
      email: string;
    };
    courseVacancy?: {
      code: Vacancy;
      description?: string;
    };
  };
}

export interface AddCourseRunRequest {
  course: {
    courseReferenceNumber: string;
    trainingProvider: {
      uen: string;
      code?: string;
    };
  };
  runs: Array<{
    sequenceNumber?: number;
    registrationDates?: {
      opening?: string;
      closing?: string;
    };
    courseDates?: {
      start?: string;
      end?: string;
    };
    scheduleInfoType?: {
      code: string;
      description?: string;
    };
    scheduleInfo?: string;
    venue?: {
      block?: string;
      street?: string;
      floor?: string;
      unit?: string;
      building?: string;
      postalCode?: string;
      room?: string;
      wheelChairAccess?: boolean;
    };
    intakeSize?: number;
    threshold?: number;
    modeOfTraining?: ModeOfTraining;
    courseAdminEmail?: {
      email: string;
    };
    courseVacancy?: {
      code: Vacancy;
      description?: string;
    };
    sessions?: Array<{
      sessionId?: string;
      startDate?: string;
      endDate?: string;
      startTime?: string;
      endTime?: string;
      modeOfTraining?: ModeOfTraining;
      venue?: {
        block?: string;
        street?: string;
        floor?: string;
        unit?: string;
        building?: string;
        postalCode?: string;
        room?: string;
        wheelChairAccess?: boolean;
      };
    }>;
  }>;
}

export interface SSGApiResponse<T = any> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  status: number;
}