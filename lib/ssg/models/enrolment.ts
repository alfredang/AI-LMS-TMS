/**
 * SSG Enrolment API — TypeScript interfaces
 * Mirrors Python core/models/enrolment.py and core/enrolment/ payloads
 */

import { IdTypeSummary, SponsorshipType, CollectionStatus, SortField, SortOrder } from '../constants';
import { SSGApiResponse } from './course-runs';

// ── Contact Number ────────────────────────────────────────────────────────────

export interface ContactNumber {
  countryCode: string;   // e.g. "+65"
  areaCode?: string;
  phoneNumber: string;
}

// ── Employer ──────────────────────────────────────────────────────────────────

export interface EmployerContact {
  fullName?: string;
  contactNumber?: ContactNumber;
  email?: { full: string };
}

export interface Employer {
  uen?: string;
  name?: string;
  contact?: EmployerContact;
}

// ── Create Enrolment ──────────────────────────────────────────────────────────

export interface CreateEnrolmentTrainee {
  id: string;                       // NRIC / FIN / Passport
  idType: IdTypeSummary;
  fullName: string;
  dateOfBirth: string;              // YYYY-MM-DD
  emailAddress: string;
  contactNumber: ContactNumber;
  sponsorshipType: SponsorshipType;
  employer?: Employer;
  fees: {
    discountAmount: number;
    collectionStatus: CollectionStatus;
  };
  enrolmentDate: string;            // YYYY-MM-DD
}

export interface CreateEnrolmentPayload {
  course: {
    run: { id: string };
    referenceNumber: string;
  };
  trainee: CreateEnrolmentTrainee;
  trainingPartner: {
    code: string;
    uen: string;
  };
}

// ── Search Enrolment ──────────────────────────────────────────────────────────

export interface SearchEnrolmentPayload {
  meta: {
    lastUpdateDateTo?: string;      // YYYY-MM-DD
    lastUpdateDateFrom?: string;
    courseRunId?: string;
    courseReferenceNumber?: string;
    enrolmentDate?: string;
    traineeId?: string;
    enrolmentReferenceNumber?: string;
    pageSize?: number;
    lastPage?: number;
    pageIndex?: number;
    sortBy?: {
      field: SortField;
      order: SortOrder;
    };
  };
  enrolment?: {
    course?: {
      run?: { id?: string };
      referenceNumber?: string;
    };
    trainee?: {
      id?: string;
      fees?: {
        collectionStatus?: CollectionStatus;
      };
      idType?: IdTypeSummary;
      sponsorshipType?: SponsorshipType;
    };
    trainingPartner?: {
      code?: string;
      uen?: string;
    };
  };
}

// ── Update Enrolment ──────────────────────────────────────────────────────────

export interface UpdateEnrolmentPayload {
  enrolment: {
    trainee: {
      fees?: {
        discountAmount?: number;
        collectionStatus?: CollectionStatus;
      };
      contactNumber?: ContactNumber;
      email?: { full: string };
      employer?: Employer;
    };
    course?: {
      run?: { id?: string };
    };
  };
}

// ── Update Fee Collection ─────────────────────────────────────────────────────

export interface UpdateFeeCollectionPayload {
  enrolment: {
    fees: {
      collectionStatus: CollectionStatus;
    };
  };
}

// ── Cancel Enrolment ──────────────────────────────────────────────────────────

export interface CancelEnrolmentPayload {
  enrolment: {
    course: {
      run: { id: string };
      referenceNumber: string;
    };
    trainee: {
      id: string;
      idType: IdTypeSummary;
    };
    trainingPartner: {
      code: string;
      uen: string;
    };
  };
}

// ── Response Types ────────────────────────────────────────────────────────────

export interface EnrolmentRecord {
  referenceNumber: string;
  status: string;
  trainingPartner: { code: string; uen: string; name: string };
  course: {
    referenceNumber: string;
    title: string;
    run: { id: string; startDate: string; endDate: string };
  };
  trainee: {
    id: string;
    idType: { type: string };
    fullName: string;
    dateOfBirth: string;
    contactNumber: ContactNumber;
    email: { full: string };
    sponsorshipType: string;
    employer?: Employer;
    fees: { discountAmount: string; collectionStatus: string };
    enrolmentDate: string;
  };
  meta: { createdOn: string; updatedOn: string };
}

export interface EnrolmentSearchResult {
  enrolment: EnrolmentRecord;
}

export type CreateEnrolmentResponse = SSGApiResponse<{ referenceNumber: string }>;
export type SearchEnrolmentResponse = SSGApiResponse<EnrolmentSearchResult[]>;
export type ViewEnrolmentResponse   = SSGApiResponse<EnrolmentRecord>;
