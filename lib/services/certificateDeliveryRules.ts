export type CertificateEligibilityMode = 'standard' | 'manual';

export interface CertificateIssueInput {
  enrollmentId?: string;
  learnerName?: string;
  learnerEmail?: string;
  courseRunId?: string;
  courseCode?: string;
  courseTitle?: string;
  course?: string;
  sendEmail: boolean;
  resend: boolean;
  dryRun: boolean;
  eligibilityMode: CertificateEligibilityMode;
  requestReason?: string;
}

export class CertificateRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'CertificateRequestError';
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeCertificateIssueInput(body: unknown): CertificateIssueInput {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const enrollmentId = optionalString(input.enrollment_id ?? input.enrolment_id);
  const learnerName = optionalString(input.learner_name);
  const learnerEmail = optionalString(input.learner_email)?.toLowerCase();
  const courseRunId = optionalString(input.course_run_id);
  const courseCode = optionalString(input.course_code);
  const courseTitle = optionalString(input.course_title);
  const course = optionalString(input.course);
  const requestReason = optionalString(input.request_reason);
  const eligibilityMode: CertificateEligibilityMode = input.manual_override === true ? 'manual' : 'standard';

  if (!enrollmentId && !learnerEmail && !learnerName) {
    throw new CertificateRequestError(
      'Provide enrollment_id, learner_email, or learner_name.',
      'missing_learner',
    );
  }
  if (learnerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(learnerEmail)) {
    throw new CertificateRequestError('learner_email is invalid.', 'invalid_email');
  }
  if (eligibilityMode === 'manual' && !requestReason) {
    throw new CertificateRequestError(
      'request_reason is required when manual_override is true.',
      'manual_reason_required',
    );
  }

  return {
    enrollmentId,
    learnerName,
    learnerEmail,
    courseRunId,
    courseCode,
    courseTitle,
    course,
    sendEmail: input.send_email !== false,
    resend: input.resend === true,
    dryRun: input.dry_run === true,
    eligibilityMode,
    requestReason,
  };
}
