export function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function fmtDateRange(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start && !end) return '-';
  if (start && end && start.slice(0, 10) !== end.slice(0, 10)) {
    return `${fmtDate(start)} – ${fmtDate(end)}`;
  }
  return fmtDate(start || end);
}
