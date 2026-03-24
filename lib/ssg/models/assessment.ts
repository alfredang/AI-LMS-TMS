/**
 * SSG Assessment API — TypeScript interfaces
 * Mirrors Python core/models/assessments.py and core/assessments/ payloads
 */

import { IdTypeSummary, Grade, AssessmentResult, AssessmentAction, SortField, SortOrder } from '../constants';
import { SSGApiResponse } from './course-runs';

// ── Create Assessment ─────────────────────────────────────────────────────────

export interface AssessmentTrainee {
  id: string;
  idType: IdTypeSummary;
  fullName: string;
}

export interface CreateAssessmentPayload {
  assessment: {
    grade?: Grade;
    score?: number;
    result: AssessmentResult;
    course: {
      run: { id: string };
      referenceNumber: string;
    };
    trainee: AssessmentTrainee;
    skillCode?: string;
    assessmentDate: string;          // YYYY-MM-DD
    trainingPartner: {
      code: string;
      uen: string;
    };
    conferringInstitute?: {
      code: string;
    };
  };
}

// ── Search Assessment ─────────────────────────────────────────────────────────

export interface SearchAssessmentPayload {
  meta: {
    lastUpdateDateTo?: string;
    lastUpdateDateFrom?: string;
    pageSize?: number;
    lastPage?: number;
    pageIndex?: number;
    sortBy?: {
      field: SortField;
      order: SortOrder;
    };
  };
  assessment?: {
    course?: {
      run?: { id?: string };
      referenceNumber?: string;
    };
    trainee?: {
      id?: string;
      idType?: IdTypeSummary;
    };
    skillCode?: string;
    result?: AssessmentResult;
    grade?: Grade;
    assessmentDateFrom?: string;
    assessmentDateTo?: string;
    trainingPartner?: {
      code?: string;
      uen?: string;
    };
  };
}

// ── Update / Void Assessment ──────────────────────────────────────────────────

export interface UpdateVoidAssessmentPayload {
  assessment: {
    action: AssessmentAction;
    grade?: Grade;
    score?: number;
    result?: AssessmentResult;
    assessmentDate?: string;
    skillCode?: string;
    trainee?: {
      id: string;
      idType: IdTypeSummary;
      fullName: string;
    };
    trainingPartner?: {
      code: string;
      uen: string;
    };
  };
}

// ── Response Types ────────────────────────────────────────────────────────────

export interface AssessmentRecord {
  referenceNumber: string;
  result: string;
  grade?: string;
  score?: number;
  course: {
    referenceNumber: string;
    run: { id: string };
  };
  trainee: {
    id: string;
    idType: string;
    fullName: string;
  };
  assessmentDate: string;
  skillCode?: string;
  trainingPartner: { code: string; uen: string };
  conferringInstitute?: { code: string };
  meta: { createdOn: string; updatedOn: string };
}

export type CreateAssessmentResponse  = SSGApiResponse<{ referenceNumber: string }>;
export type SearchAssessmentResponse  = SSGApiResponse<{ assessment: AssessmentRecord }[]>;
export type ViewAssessmentResponse    = SSGApiResponse<AssessmentRecord>;
