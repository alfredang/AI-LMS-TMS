/**
 * Next.js API route for Add Course Run
 * POST /api/ssg/courses/courseRuns/publish - Add/publish course runs
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { OptionalSelector, Vacancy, ModeOfTraining, TrainerType } from '../../../../../lib/ssg/models/course-runs';
import { 
  AddRunInfo, 
  AddCourseRunResponse, 
  AddCourseRunUtils 
} from '../../../../../lib/ssg/models/add-course-run';
import { createSSGCourseAPI } from '../../../../../lib/ssg/api/course-api';
import { getSSGCredentialsService } from '../../../../../lib/ssg/services/credentials-service';

// Helper function to get optional selector from query
const getOptionalSelector = (value: string | string[] | undefined): OptionalSelector => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' ? OptionalSelector.YES : OptionalSelector.NO;
  }
  return OptionalSelector.NO;
};

// Interface for the complex nested payload structure from the form
interface ComplexCoursePayload {
  course: {
    courseReferenceNumber: string;
    trainingProvider: {
      uen: string;
    };
    runs: Array<{
      sequenceNumber: number;
      registrationDates: {
        opening: number;
        closing: number;
      };
      courseDates: {
        start: number;
        end: number;
      };
      scheduleInfoType: {
        code: string;
        description: string;
      };
      scheduleInfo: string;
      venue: {
        floor: string;
        unit: string;
        postalCode: string;
        room: string;
        block?: string;
        street?: string;
        building?: string;
        wheelChairAccess?: boolean;
      };
      modeOfTraining: string;
      courseAdminEmail: string;
      courseVacancy: {
        code: string;
        description: string;
      };
      file: {
        Name: string;
        content: string;
      };
      sessions?: Array<{
        startDate: string;
        endDate: string;
        startTime: string;
        endTime: string;
        modeOfTraining: string;
        venue: {
          floor: string;
          unit: string;
          postalCode: string;
          room: string;
        };
      }>;
      linkCourseRunTrainer?: Array<{
        trainer: {
          photo: {
            name: string;
            content: string;
          };
          trainerType: {
            code: string;
            description: string;
          };
          idNumber: string;
        };
      }>;
    }>;
  };
}

// Function to transform complex payload to AddRunInfo format
const transformComplexPayloadToAddRunInfo = (complexPayload: ComplexCoursePayload): AddRunInfo => {
  return {
    courseReferenceNumber: complexPayload.course.courseReferenceNumber,
    runs: complexPayload.course.runs.map(run => ({
      sequenceNumber: run.sequenceNumber,
      openingRegistrationDate: String(run.registrationDates.opening).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      closingRegistrationDate: String(run.registrationDates.closing).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      courseStartDate: String(run.courseDates.start).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      courseEndDate: String(run.courseDates.end).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      scheduleInfoTypeCode: run.scheduleInfoType.code,
      scheduleInfoTypeDescription: run.scheduleInfoType.description,
      scheduleInfo: run.scheduleInfo,
      block: run.venue.block || "",
      street: run.venue.street || "",
      floor: run.venue.floor,
      unit: run.venue.unit,
      building: run.venue.building || "",
      postalCode: run.venue.postalCode,
      room: run.venue.room,
      wheelChairAccess: run.venue.wheelChairAccess ? OptionalSelector.YES : OptionalSelector.NO,
      modeOfTraining: run.modeOfTraining as ModeOfTraining,
      courseAdminEmail: run.courseAdminEmail,
      courseVacancy: run.courseVacancy.code as Vacancy,
      fileName: run.file.Name,
      fileContent: run.file.content,
      sessions: run.sessions ? run.sessions.map(session => ({
        modeOfTraining: session.modeOfTraining as ModeOfTraining,
        startDate: session.startDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
        endDate: session.endDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
        startTime: session.startTime,
        endTime: session.endTime,
        floor: session.venue.floor,
        unit: session.venue.unit,
        postalCode: session.venue.postalCode,
        room: session.venue.room,
        wheelChairAccess: OptionalSelector.NO,
        primaryVenue: OptionalSelector.YES
      })) : [],
      linkCourseRunTrainer: run.linkCourseRunTrainer ? run.linkCourseRunTrainer.map(link => ({
        trainerTypeCode: link.trainer.trainerType.code as TrainerType,
        trainerTypeDescription: link.trainer.trainerType.description,
        trainerIdNumber: link.trainer.idNumber,
        photoName: link.trainer.photo.name,
        photoContent: link.trainer.photo.content
      })) : []
    }))
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { includeExpiredCourses } = req.query;
    const requestBody = req.body;

    // Validate required request body
    if (!requestBody) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    let runInfo: AddRunInfo;

    // Check if this is the complex nested structure from the form
    if (requestBody.course && requestBody.course.runs) {
      console.log('Detected complex payload structure, transforming...');
      runInfo = transformComplexPayloadToAddRunInfo(requestBody as ComplexCoursePayload);
    } else if (requestBody.courseReferenceNumber && requestBody.runs) {
      console.log('Detected simple AddRunInfo structure');
      runInfo = requestBody as AddRunInfo;
    } else {
      return res.status(400).json({ 
        error: 'Invalid request body structure',
        message: 'Expected either { course: { ... } } or { courseReferenceNumber, runs: [...] } format'
      });
    }

    // Validate the run info structure
    const validation = AddCourseRunUtils.validateAddRunInfo(runInfo);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    // Get SSG credentials from database (using the single training provider)
    const credentialsService = getSSGCredentialsService();
    const credentials = await credentialsService.getSSGCredentials();

    if (!credentials) {
      return res.status(404).json({ error: 'Training provider credentials not found' });
    }

    // Validate credentials
    const validationErrors = credentialsService.validateCredentials(credentials);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Invalid SSG credentials',
        message: `Credential validation failed: ${validationErrors.join(', ')}`
      });
    }

    // Check for required fields for Add Course Run
    if (!credentials.encryptionKey) {
      return res.status(400).json({
        error: 'Missing encryption key',
        message: 'Encryption key is required for Add Course Run operations'
      });
    }

    if (!credentials.uen) {
      return res.status(400).json({
        error: 'Missing UEN',
        message: 'UEN is required for Add Course Run operations'
      });
    }

    // Get base URL from credentials (DB-first)
    const baseUrl = credentials.ssgApiBaseUrl;

    // Create SSG API client
    const ssgAPI = createSSGCourseAPI(baseUrl, credentials);

    const includeExpiredOption = getOptionalSelector(includeExpiredCourses);
    
    // Call the API method
    const result = await ssgAPI.addCourseRun(runInfo, includeExpiredOption);

    if (result.error) {
      return res.status(result.status || 400).json(result);
    }

    // Include validation warnings in successful response if any
    const response: any = {
      ...result,
      validationWarnings: validation.warnings.length > 0 ? validation.warnings : undefined
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Add Course Run API Error:', error);
    
    // Handle validation errors specifically
    if (error instanceof Error && error.message.includes('Validation failed')) {
      return res.status(400).json({
        error: 'Validation error',
        message: error.message
      });
    }

    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}