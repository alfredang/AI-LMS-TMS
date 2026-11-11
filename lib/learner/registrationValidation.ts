// Shared by the self-registration form (client) and /api/auth/self-register (server).
// Pure functions only — no DB/Node imports, so it is safe in the client bundle.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// SSG/TPGateway Course Run IDs are exactly 7 digits (e.g. 1362296).
const COURSE_RUN_ID_RE = /^\d{7}$/;

// Learners often paste the course reference number (TGS-2024043854) instead.
const COURSE_CODE_RE = /^(TGS|CRS|C)[-\s]?\d+/i;

export function validateRegistrationEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Please enter your email address.';
  if (/\s/.test(v)) return 'Your email address cannot contain spaces.';
  if (v.length >= 255 || !EMAIL_RE.test(v)) {
    return 'Please enter a valid email address, e.g. name@example.com.';
  }
  return null;
}

export function validateCourseRunId(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Please enter your Course Run ID.';
  if (COURSE_CODE_RE.test(v)) {
    return `"${v}" looks like the course code, not the Course Run ID. The Course Run ID is a 7-digit number (e.g. 1234567) — ask your course administrator or trainer if you don't have it.`;
  }
  if (!COURSE_RUN_ID_RE.test(v)) {
    return 'The Course Run ID must be exactly 7 digits (e.g. 1234567), with no letters, spaces or dashes.';
  }
  return null;
}
