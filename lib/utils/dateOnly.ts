const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const COMPACT_DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

export function toDateOnlyIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const compact = raw.match(COMPACT_DATE_RE);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  const dateOnly = raw.match(DATE_ONLY_RE);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function formatDateOnlyEnSg(value: string | Date | null | undefined, fallback = '-'): string {
  const iso = toDateOnlyIso(value);
  if (!iso) return fallback;

  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-SG', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
