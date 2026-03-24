/**
 * SSG API Constants & Enumerations
 * Converted from Python core/constants.py
 */

export enum IdType {
  SINGAPOREAN_PR = 'SP',
  SINGAPOREAN_BIRTH_CERT = 'SB',
  OTHERS_SINGAPORE = 'SO',
  FOREIGN_PASSPORT = 'FP',
  OTHERS = 'OT'
}

export enum IdTypeSummary {
  NRIC = 'NRIC',
  FIN = 'FIN',
  OTHERS = 'OTHERS'
}

export enum SponsorshipType {
  EMPLOYER = 'EMPLOYER',
  INDIVIDUAL = 'Individual'
}

export enum CollectionStatus {
  PENDING_PAYMENT = 'Pending Payment',
  PARTIAL_PAYMENT = 'Partial Payment',
  FULL_PAYMENT = 'Full Payment'
}

export enum CancellableCollectionStatus {
  PENDING_PAYMENT = 'Pending Payment',
  PARTIAL_PAYMENT = 'Partial Payment',
  FULL_PAYMENT = 'Full Payment',
  CANCELLED = 'Cancelled'
}

export enum Grade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  E = 'E',
  F = 'F'
}

export enum AssessmentResult {
  PASS = 'Pass',
  FAIL = 'Fail',
  EXEMPT = 'Exempt'
}

export enum AssessmentAction {
  UPDATE = 'update',
  VOID = 'void'
}

export enum AttendanceStatus {
  CONFIRMED = '1',
  UNCONFIRMED = '2',
  REJECTED = '3',
  TP_VOIDED = '4'
}

export enum SurveyLanguage {
  ENGLISH = 'EL',
  MANDARIN = 'MN',
  MALAY = 'MY',
  TAMIL = 'TM'
}

export enum ModeOfTraining {
  CLASSROOM = '1',
  ASYNCHRONOUS_ELEARNING = '2',
  IN_HOUSE = '3',
  ON_THE_JOB = '4',
  PRACTICAL_OR_PRACTICUM = '5',
  SUPERVISED_FIELD = '6',
  TRAINEESHIP = '7',
  ASSESSMENT = '8',
  SYNCHRONOUS_ELEARNING = '9'
}

export enum Salutation {
  MR = 'Mr',
  MS = 'Ms',
  MDM = 'Mdm',
  MRS = 'Mrs',
  DR = 'Dr',
  PROF = 'Prof'
}

export enum TrainerType {
  EXISTING = 'existing',
  NEW = 'new'
}

export enum Vacancy {
  AVAILABLE = 'A',
  FULL = 'F',
  LIMITED = 'L'
}

export enum SortField {
  UPDATED_ON = 'updatedOn',
  CREATED_ON = 'createdOn',
  ASSESSMENT_DATE = 'assessmentDate'
}

export enum SortOrder {
  ASCENDING = 'asc',
  DESCENDING = 'desc'
}

export enum EnrolmentStatus {
  CONFIRMED = 'Confirmed',
  CANCELLED = 'Cancelled',
  WAITLISTED = 'Waitlisted'
}

export enum CancelClaimsCode {
  NO_CREDIT_CLAIM = 'NCC',
  RESUBMIT_CLAIM = 'RSC',
  COURSE_CANCELLED = 'CC',
  COURSE_POSTPONED = 'CP',
  NOT_ENROLLED = 'NE'
}

export enum PermittedFileType {
  PDF = 'pdf',
  DOC = 'doc',
  DOCX = 'docx',
  TIF = 'tif',
  JPG = 'jpg',
  JPEG = 'jpeg',
  PNG = 'png',
  XLS = 'xls',
  XLSM = 'xlsm',
  XLSX = 'xlsx'
}

/** SSG API Base URLs */
export const SSG_ENDPOINTS = {
  UAT: 'https://uat-api.ssg-wsg.sg',
  PRODUCTION: 'https://api.ssg-wsg.gov.sg'
} as const;
