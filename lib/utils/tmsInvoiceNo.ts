import { createHash } from 'crypto';

/**
 * TMS invoice number: TC + 2-digit year + "-" + MMDD + "-" + 6 digits (from enrolment ref).
 * Date parts use Asia/Singapore at generation time.
 * If `salt > 0`, the last 6 digits are derived uniquely (collision retry) while keeping the same visible format.
 */
export function buildTmsInvoiceNo(enrolmentId: string, generatedAt: Date, salt = 0): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(generatedAt)
      .map(p => [p.type, p.value])
  ) as { year?: string; month?: string; day?: string };
  const y = parts.year ?? '2000';
  const yy = y.slice(-2);
  const month = parts.month ?? '01';
  const day = parts.day ?? '01';
  const mmdd = `${month}${day}`;
  const last6 = lastSixDigits(enrolmentId, salt);
  return `TC${yy}-${mmdd}-${last6}`;
}

function lastSixDigits(enrolmentId: string, salt: number): string {
  const digits = enrolmentId.replace(/\D/g, '');
  if (salt === 0) {
    if (digits.length >= 6) return digits.slice(-6);
    if (digits.length > 0) return digits.padStart(6, '0').slice(-6);
  }
  const h = createHash('sha256').update(`${enrolmentId}:${salt}`).digest('hex');
  return String(parseInt(h.slice(0, 8), 16) % 1000000).padStart(6, '0');
}
