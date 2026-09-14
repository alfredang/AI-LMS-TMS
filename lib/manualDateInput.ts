/**
 * Format the digits entered in a date field as DD/MM/YYYY.
 *
 * Keeping this as a text input (instead of relying on the browser's native
 * date-field segments) makes keyboard entry consistent across browsers. The
 * native calendar still writes through `isoDateToDisplayValue` below.
 */
export const formatManualDateInput = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

/** Convert a valid DD/MM/YYYY value to the ISO date used by the API. */
export const displayDateToIso = (value: string): string | '' | null => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  // Date normalises impossible values (for example 31/02) into another month,
  // so compare every component to reject them rather than silently changing it.
  if (
    year < 1000 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
};

/** Convert an API/database date into the manual-entry display format. */
export const isoDateToDisplayValue = (value?: string | null): string => {
  if (!value) return '';
  const trimmed = String(value).trim();

  const displayMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (displayMatch && displayDateToIso(trimmed) !== null) return trimmed;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    const display = `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    return displayDateToIso(display) === null ? '' : display;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = String(parsed.getFullYear()).padStart(4, '0');
  const display = `${day}/${month}/${year}`;
  return displayDateToIso(display) === null ? '' : display;
};
