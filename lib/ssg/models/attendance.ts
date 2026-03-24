/**
 * SSG Attendance API — TypeScript interfaces
 * Mirrors Python core/models/attendance.py and core/attendance/ payloads
 */

import { AttendanceStatus, SurveyLanguage } from '../constants';
import { SSGApiResponse } from './course-runs';

// ── Upload Attendance ─────────────────────────────────────────────────────────

export interface AttendanceTrainee {
  id: string;
  name: string;
  email: string;
  idType: {
    code: string;   // SP | SB | SO | FP | OT
  };
  contactNumber: {
    mobile: string;
    areaCode?: number;
    countryCode: number;
  };
  numberOfHours: number;            // 0.5 – 8.0
  surveyLanguage: {
    code: SurveyLanguage;
  };
}

export interface UploadAttendancePayload {
  uen: string;
  course: {
    sessionID: string;
    referenceNumber: string;
    attendance: {
      status: {
        code: AttendanceStatus;
      };
      trainee: AttendanceTrainee;
    };
  };
  corppassId: string;
}

// ── View Attendance (Course Session Attendance) ───────────────────────────────

export interface CourseSessionAttendancePayload {
  uen: string;
  courseRunId: string;
  courseReferenceNumber: string;
  sessionId?: string;
}

// ── Response Types ────────────────────────────────────────────────────────────

export interface AttendanceRecord {
  sessionId: string;
  status: { code: string };
  trainee: {
    id: string;
    name: string;
    email: string;
    numberOfHours: number;
  };
  meta: { createdOn: string; updatedOn: string };
}

export type UploadAttendanceResponse   = SSGApiResponse<{ status: string }>;
export type ViewAttendanceResponse     = SSGApiResponse<AttendanceRecord[]>;
