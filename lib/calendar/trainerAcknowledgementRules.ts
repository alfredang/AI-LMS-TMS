export interface CalendarTrainerResponse {
  courseCode: string | null;
  dateIso: string;
  email: string | null;
  name: string | null;
  responseStatus: string | null;
}

export interface TrainerDirectoryEntry {
  email: string | null;
  name: string | null;
}

export interface TrainerAcknowledgement {
  courseCode: string;
  dateIso: string;
  trainerEmails: string[];
  trainerNames: string[];
}

export function normalizeTgsCode(value: unknown): string {
  const normalized = String(value || '').trim().toUpperCase();
  return /^TGS-\d+$/.test(normalized) ? normalized : '';
}

export function tgsDateKey(courseCode: unknown, dateIso: unknown): string {
  return `${normalizeTgsCode(courseCode)}|${String(dateIso || '').slice(0, 10)}`;
}

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();
const normalizeName = (value: unknown): string => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Pure matching rule used by the preview, queue and release gate. */
export function matchAcknowledgedTrainerTgs(
  responses: CalendarTrainerResponse[],
  directory: TrainerDirectoryEntry[],
): Map<string, TrainerAcknowledgement> {
  const trainerEmails = new Set(directory.map((entry) => normalizeEmail(entry.email)).filter(Boolean));
  const trainerNames = new Set(directory.map((entry) => normalizeName(entry.name)).filter(Boolean));
  const acknowledged = new Map<string, TrainerAcknowledgement>();

  for (const response of responses) {
    if (response.responseStatus !== 'accepted') continue;
    const courseCode = normalizeTgsCode(response.courseCode);
    const dateIso = String(response.dateIso || '').slice(0, 10);
    if (!courseCode || !dateIso) continue;

    const email = normalizeEmail(response.email);
    const name = normalizeName(response.name);
    const matchedEmail = !!email && trainerEmails.has(email);
    const matchedName = !!name && trainerNames.has(name);
    if (!matchedEmail && !matchedName) continue;

    const key = tgsDateKey(courseCode, dateIso);
    const current = acknowledged.get(key) || {
      courseCode,
      dateIso,
      trainerEmails: [],
      trainerNames: [],
    };
    if (matchedEmail && !current.trainerEmails.includes(email)) current.trainerEmails.push(email);
    if (matchedName && !current.trainerNames.includes(name)) current.trainerNames.push(name);
    acknowledged.set(key, current);
  }

  return acknowledged;
}

