import crypto from 'crypto';

/**
 * SSG returns the View-Attendance response as AES-256-CBC base64 ciphertext
 * with a fixed IV "SSGAPIInitVector". The shared HTTP client doesn't decrypt
 * it (it returns the raw string), so any caller using attendanceAPI.viewAttendance
 * must run the response through these helpers to extract real records.
 */

const SSG_ATTENDANCE_IV = Buffer.from('SSGAPIInitVector', 'utf8');

export function decryptSSGAttendanceBody(rawBody: string, encryptionKeyB64: string): any {
  const encKey = Buffer.from(encryptionKeyB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, SSG_ATTENDANCE_IV);
  let decrypted = decipher.update(rawBody, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

/**
 * Walks an SSG attendance payload (decrypted or already-JSON) to find the
 * attendance records for a given session. Tolerant of common wrapping shapes:
 *   { courseRun: { sessions: [{ id, attendance: [...] }] } }
 *   { data: { courseRun: ... } }
 *   { attendance: [...] }
 *   [...]  // legacy
 */
export function extractAttendanceRecords(decoded: any, sessionId: string): any[] {
  const root = decoded?.data ?? decoded;
  const courseRun = root?.courseRun ?? root;
  const sessions = courseRun?.sessions;
  if (Array.isArray(sessions)) {
    const match = sessions.find((s: any) => s?.id === sessionId) || sessions[0];
    if (match?.attendance && Array.isArray(match.attendance)) return match.attendance;
  }
  if (Array.isArray(root?.attendance)) return root.attendance;
  if (Array.isArray(root)) return root;
  return [];
}

/**
 * Convenience: takes whatever attendanceAPI.viewAttendance returned in `.data`
 * (string for ciphertext, object for already-decoded) plus the credentials,
 * and returns the attendance records array. Throws on decrypt failure so the
 * caller can record a per-session error.
 */
export function extractRecordsFromViewAttendance(
  rawData: any,
  encryptionKeyB64: string,
  sessionId: string
): any[] {
  if (typeof rawData === 'string') {
    const decoded = decryptSSGAttendanceBody(rawData, encryptionKeyB64);
    return extractAttendanceRecords(decoded, sessionId);
  }
  return extractAttendanceRecords(rawData, sessionId);
}

/**
 * Normalize one SSG attendance record into { nric, isPresent }.
 * SSG records can carry NRIC at `nric` or `trainee.id`, and presence as a
 * status string ('Confirmed' | 'Present' | 'Attended') or the legacy boolean
 * `attendance` field. Returns null when no NRIC is present.
 */
export function normalizeAttendanceRecord(att: any): { nric: string; isPresent: boolean } | null {
  const nric: string | undefined = att?.nric || att?.trainee?.id || att?.traineeId;
  if (!nric) return null;
  const status = (att?.status || '').toString().toLowerCase();
  const isPresent =
    status === 'confirmed' ||
    status === 'present' ||
    status === 'attended' ||
    att?.attendance === true;
  return { nric, isPresent };
}
